package management

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// The panel binds a custom domain by owning one Caddyfile snippet that the main
// Caddyfile imports. The snippet itself is the source of truth for the domain.
const (
	defaultCaddyfile    = "/etc/caddy/Caddyfile"
	defaultCaddySnippet = "/etc/caddy/sites.d/low-cp.caddy"
	caddySnippetHeader  = "# Managed by low-cp. Changes are overwritten from the panel."
)

var domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$`)

type caddyPaths struct {
	caddyfile string
	snippet   string
}

func lowcpCaddyPaths() caddyPaths {
	paths := caddyPaths{caddyfile: defaultCaddyfile, snippet: defaultCaddySnippet}
	if v := strings.TrimSpace(os.Getenv("LOWCP_CADDYFILE")); v != "" {
		paths.caddyfile = v
	}
	if v := strings.TrimSpace(os.Getenv("LOWCP_CADDY_SNIPPET")); v != "" {
		paths.snippet = v
	}
	return paths
}

// runCaddyReload is replaceable in tests.
var runCaddyReload = func(ctx context.Context, caddyfile string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "caddy", "reload", "--config", caddyfile, "--adapter", "caddyfile").CombinedOutput()
	if err != nil {
		return fmt.Errorf("caddy reload failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// GetDomain reports the bound domain and whether the Caddy integration is ready.
func (h *Handler) GetDomain(c *gin.Context) {
	paths := lowcpCaddyPaths()
	h.mu.Lock()
	port := h.cfg.Port
	trusted := trustsLoopback(h.cfg.TrustedProxies)
	h.mu.Unlock()
	_, errCaddy := exec.LookPath("caddy")
	c.JSON(http.StatusOK, gin.H{
		"domain":             readSnippetDomain(paths.snippet),
		"caddyfile":          paths.caddyfile,
		"snippet":            paths.snippet,
		"upstream":           fmt.Sprintf("127.0.0.1:%d", port),
		"caddy_installed":    errCaddy == nil,
		"import_present":     caddyfileImports(paths.caddyfile, paths.snippet),
		"snippet_writable":   dirWritable(filepath.Dir(paths.snippet)),
		"trusted_proxies_ok": trusted,
		"setup_commands":     caddySetupCommands(paths),
	})
}

// PutDomain writes the Caddy snippet for the domain and reloads Caddy. On reload
// failure the previous snippet is restored so Caddy keeps a loadable config.
func (h *Handler) PutDomain(c *gin.Context) {
	var body struct {
		Domain string `json:"domain"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	domain := strings.ToLower(strings.TrimSpace(body.Domain))
	if !domainPattern.MatchString(domain) || len(domain) > 253 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain"})
		return
	}
	paths := lowcpCaddyPaths()
	if !caddyfileImports(paths.caddyfile, paths.snippet) {
		c.JSON(http.StatusConflict, gin.H{"error": "caddyfile does not import the low-cp snippet", "setup_commands": caddySetupCommands(paths)})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	snippet := fmt.Sprintf("%s\n%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", caddySnippetHeader, domain, h.cfg.Port)
	if err := swapCaddySnippet(c.Request.Context(), paths, []byte(snippet)); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// Behind Caddy every request arrives from loopback; without trusting it, all
	// clients would look local to the management access checks.
	restartRequired := false
	if !trustsLoopback(h.cfg.TrustedProxies) {
		h.cfg.TrustedProxies = append(h.cfg.TrustedProxies, "127.0.0.1", "::1")
		if err := config.SaveConfigPreserveComments(h.configFilePath, h.cfg, c.GetBool(ConfigV8ContextKey)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("domain bound, but saving trusted-proxies failed: %v", err)})
			return
		}
		h.reloadConfigAfterManagementSaveAsync(c.Request.Context(), h.reloadSnapshotConfigLocked())
		restartRequired = true
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "domain": domain, "restart_required": restartRequired})
}

// DeleteDomain removes the Caddy snippet and reloads Caddy.
func (h *Handler) DeleteDomain(c *gin.Context) {
	paths := lowcpCaddyPaths()
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := swapCaddySnippet(c.Request.Context(), paths, nil); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// swapCaddySnippet replaces (or with nil content removes) the snippet and reloads
// Caddy, restoring the previous snippet if the reload is rejected.
func swapCaddySnippet(ctx context.Context, paths caddyPaths, content []byte) error {
	previous, errRead := os.ReadFile(paths.snippet)
	hadPrevious := errRead == nil
	if errRead != nil && !errors.Is(errRead, os.ErrNotExist) {
		return fmt.Errorf("read snippet: %w", errRead)
	}
	if content == nil {
		// Keep an empty file: some Caddy versions reject an import glob with no match.
		content = []byte(caddySnippetHeader + "\n")
	}
	if err := os.WriteFile(paths.snippet, content, 0o644); err != nil {
		return fmt.Errorf("write snippet: %w", err)
	}
	if errReload := runCaddyReload(ctx, paths.caddyfile); errReload != nil {
		var errRestore error
		if hadPrevious {
			errRestore = os.WriteFile(paths.snippet, previous, 0o644)
		} else {
			errRestore = os.Remove(paths.snippet)
		}
		if errRestore != nil {
			return fmt.Errorf("%v; restoring previous snippet also failed: %v", errReload, errRestore)
		}
		return errReload
	}
	return nil
}

func readSnippetDomain(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = file.Close() }()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		return strings.TrimSpace(strings.TrimSuffix(line, "{"))
	}
	return ""
}

// caddyfileImports reports whether the Caddyfile has an import line covering the snippet.
func caddyfileImports(caddyfile, snippet string) bool {
	data, err := os.ReadFile(caddyfile)
	if err != nil {
		return false
	}
	base := filepath.Dir(caddyfile)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != "import" {
			continue
		}
		pattern := fields[1]
		if !filepath.IsAbs(pattern) {
			pattern = filepath.Join(base, pattern)
		}
		if ok, _ := filepath.Match(pattern, snippet); ok {
			return true
		}
	}
	return false
}

func caddySetupCommands(paths caddyPaths) []string {
	dir := filepath.Dir(paths.snippet)
	return []string{
		fmt.Sprintf("sudo install -d -o %s %s", currentUserName(), dir),
		fmt.Sprintf("echo 'import %s/*.caddy' | sudo tee -a %s", dir, paths.caddyfile),
	}
}

func currentUserName() string {
	if name := os.Getenv("USER"); name != "" {
		return name
	}
	return "$USER"
}

func dirWritable(dir string) bool {
	probe, err := os.CreateTemp(dir, ".low-cp-probe-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return true
}

func trustsLoopback(proxies []string) bool {
	return slices.Contains(proxies, "127.0.0.1") || slices.Contains(proxies, "127.0.0.0/8")
}
