package management

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSwapCaddySnippetRestoresOnReloadFailure(t *testing.T) {
	dir := t.TempDir()
	paths := caddyPaths{caddyfile: filepath.Join(dir, "Caddyfile"), snippet: filepath.Join(dir, "sites.d", "low-cp.caddy")}
	if err := os.MkdirAll(filepath.Dir(paths.snippet), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.caddyfile, []byte("a.example {\n}\nimport sites.d/*.caddy\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !caddyfileImports(paths.caddyfile, paths.snippet) {
		t.Fatalf("relative import glob should cover the snippet")
	}

	reloadErr := error(nil)
	orig := runCaddyReload
	runCaddyReload = func(context.Context, string) error { return reloadErr }
	t.Cleanup(func() { runCaddyReload = orig })

	good := []byte(caddySnippetHeader + "\nllm.example {\n\treverse_proxy 127.0.0.1:8317\n}\n")
	if err := swapCaddySnippet(context.Background(), paths, good); err != nil {
		t.Fatalf("swap: %v", err)
	}
	if got := readSnippetDomain(paths.snippet); got != "llm.example" {
		t.Fatalf("domain = %q", got)
	}

	reloadErr = errors.New("ambiguous site definition")
	if err := swapCaddySnippet(context.Background(), paths, []byte("bad.example {\n}\n")); err == nil {
		t.Fatalf("expected reload error")
	}
	if got := readSnippetDomain(paths.snippet); got != "llm.example" {
		t.Fatalf("previous snippet not restored, domain = %q", got)
	}

	reloadErr = nil
	if err := swapCaddySnippet(context.Background(), paths, nil); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := readSnippetDomain(paths.snippet); got != "" {
		t.Fatalf("domain after delete = %q", got)
	}
}

func TestDomainPattern(t *testing.T) {
	for _, ok := range []string{"llm-api.example.com", "a.b.co", "xn--80a.xn--p1ai"} {
		if !domainPattern.MatchString(ok) {
			t.Fatalf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"localhost", "a..b", "-a.com", "a.com {\n}", "a.com/x", "*.a.com", "a.com:443"} {
		if domainPattern.MatchString(bad) {
			t.Fatalf("%q should be invalid", bad)
		}
	}
}
