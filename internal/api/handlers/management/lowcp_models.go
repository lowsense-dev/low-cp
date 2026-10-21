package management

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/tidwall/gjson"
)

// modelGroup is one model source: an OAuth provider, a named OpenAI-compatible
// provider, or an API-key group identified by its prefix or base URL.
type modelGroup struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"` // "oauth" or "apikey"
	Provider string   `json:"provider"`
	Prefix   string   `json:"prefix,omitempty"`
	BaseURL  string   `json:"base_url,omitempty"`
	Compat   string   `json:"compat_name,omitempty"`
	Models   []string `json:"models"`
}

// ListAvailableModels returns the registered model IDs (including prefixed aliases)
// with their routing.disabled-models state, plus the sources serving them.
func (h *Handler) ListAvailableModels(c *gin.Context) {
	type model struct {
		ID       string `json:"id"`
		OwnedBy  string `json:"owned_by,omitempty"`
		Disabled bool   `json:"disabled,omitempty"`
	}
	h.mu.Lock()
	disabled := append([]string(nil), h.cfg.Routing.DisabledModels...)
	h.mu.Unlock()
	reg := registry.GetGlobalRegistry()
	out := make([]model, 0)
	for _, entry := range reg.GetAvailableModels("openai") {
		id, _ := entry["id"].(string)
		if id == "" {
			continue
		}
		ownedBy, _ := entry["owned_by"].(string)
		out = append(out, model{ID: id, OwnedBy: ownedBy, Disabled: slices.Contains(disabled, id)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })

	groups := map[string]*modelGroup{}
	if h.authManager != nil {
		for _, auth := range h.authManager.List() {
			if auth == nil || auth.Disabled {
				continue
			}
			g := groupForAuth(auth.Provider, auth.Prefix, auth.Attributes)
			existing := groups[g.ID]
			if existing == nil {
				existing = &g
				groups[g.ID] = existing
			}
			for _, info := range reg.GetModelsForClient(auth.ID) {
				if info != nil && info.ID != "" && !slices.Contains(existing.Models, info.ID) {
					existing.Models = append(existing.Models, info.ID)
				}
			}
		}
	}
	groupList := make([]*modelGroup, 0, len(groups))
	for _, g := range groups {
		if len(g.Models) == 0 {
			continue
		}
		sort.Strings(g.Models)
		groupList = append(groupList, g)
	}
	sort.Slice(groupList, func(i, j int) bool {
		if groupList[i].Kind != groupList[j].Kind {
			return groupList[i].Kind == "oauth"
		}
		return groupList[i].Label < groupList[j].Label
	})
	c.JSON(http.StatusOK, gin.H{"models": out, "groups": groupList})
}

func groupForAuth(provider, prefix string, attrs map[string]string) modelGroup {
	base := strings.TrimSpace(attrs["base_url"])
	if compat := strings.TrimSpace(attrs["compat_name"]); compat != "" {
		return modelGroup{ID: "compat:" + compat, Label: compat, Kind: "apikey", Provider: provider, Prefix: prefix, BaseURL: base, Compat: compat}
	}
	if attrs["api_key"] == "" {
		return modelGroup{ID: "oauth:" + provider, Label: provider, Kind: "oauth", Provider: provider}
	}
	label := prefix
	if label == "" {
		if u, err := url.Parse(base); err == nil && u.Host != "" {
			label = u.Host
		} else {
			label = provider
		}
	}
	return modelGroup{ID: "apikey:" + provider + "|" + prefix + "|" + base, Label: label, Kind: "apikey", Provider: provider, Prefix: prefix, BaseURL: base}
}

// upstreamModelsRequest identifies an upstream to list models from. Keys are
// tried in order until one answers, so a dead first key does not block listing.
type upstreamModelsRequest struct {
	Family  string            `json:"family"`
	BaseURL string            `json:"base_url"`
	APIKey  string            `json:"api_key"`
	APIKeys []string          `json:"api_keys"`
	Headers map[string]string `json:"headers"`
}

// ListUpstreamModels asks a provider's own API for its model list, for the
// "refresh models" actions in the panel.
func (h *Handler) ListUpstreamModels(c *gin.Context) {
	var body upstreamModelsRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	keys := body.APIKeys
	if body.APIKey != "" {
		keys = append([]string{body.APIKey}, keys...)
	}
	if len(keys) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}
	// shortcut: ignores per-provider proxy-url; add proxy support if an upstream is only reachable through one.
	client := &http.Client{Timeout: 30 * time.Second}
	lastErr := ""
	for _, key := range keys {
		body.APIKey = key
		req, err := buildUpstreamModelsRequest(c.Request.Context(), body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		models, errFetch := fetchUpstreamModels(client, req)
		if errFetch == nil {
			c.JSON(http.StatusOK, gin.H{"models": models})
			return
		}
		lastErr = errFetch.Error()
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": lastErr})
}

func fetchUpstreamModels(client *http.Client, req *http.Request) ([]string, error) {
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read response")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, truncateForError(data))
	}
	return parseUpstreamModels(data), nil
}

func buildUpstreamModelsRequest(ctx context.Context, body upstreamModelsRequest) (*http.Request, error) {
	base := strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
	var target string
	switch body.Family {
	case "openai-compatibility", "codex", "xai":
		if base == "" {
			return nil, fmt.Errorf("base_url is required")
		}
		target = base + "/models"
	case "claude":
		if base == "" {
			base = "https://api.anthropic.com"
		}
		target = base + "/v1/models?limit=1000"
	case "gemini", "interactions":
		if base == "" {
			base = "https://generativelanguage.googleapis.com"
		}
		target = base + "/v1beta/models?pageSize=1000"
	default:
		return nil, fmt.Errorf("model listing is not supported for %q", body.Family)
	}
	if u, err := url.Parse(target); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("invalid base_url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	switch body.Family {
	case "claude":
		req.Header.Set("x-api-key", body.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	case "gemini", "interactions":
		req.Header.Set("x-goog-api-key", body.APIKey)
	default:
		req.Header.Set("Authorization", "Bearer "+body.APIKey)
	}
	for k, v := range body.Headers {
		// "$X" headers copy a client header at request time; there is no client here.
		if !strings.HasPrefix(v, "$") {
			req.Header.Set(k, v)
		}
	}
	req.Header.Set("Accept", "application/json")
	return req, nil
}

// parseUpstreamModels reads OpenAI/Anthropic ({"data":[{"id"}]}) and Gemini
// ({"models":[{"name":"models/x"}]}) list formats.
func parseUpstreamModels(data []byte) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(id string) {
		id = strings.TrimPrefix(strings.TrimSpace(id), "models/")
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	root := gjson.ParseBytes(data)
	for _, field := range []string{"data", "models"} {
		root.Get(field).ForEach(func(_, item gjson.Result) bool {
			if item.Type == gjson.String {
				add(item.String())
			} else {
				add(firstNonEmpty(item.Get("id").String(), item.Get("name").String()))
			}
			return true
		})
	}
	if len(out) == 0 && json.Valid(data) && root.IsArray() {
		root.ForEach(func(_, item gjson.Result) bool { add(item.Get("id").String()); return true })
	}
	sort.Strings(out)
	return out
}
