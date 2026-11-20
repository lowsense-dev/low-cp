// Package upstreammodels discovers model IDs from provider APIs.
package upstreammodels

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/MoeForge/moego/json"
	"github.com/MoeForge/moego/ojson"
)

// Request identifies one provider model-list endpoint and its credential.
type Request struct {
	Family  string
	BaseURL string
	APIKey  string
	Headers map[string]string
}

// BuildRequest builds the provider-specific model-list request.
func BuildRequest(ctx context.Context, body Request) (*http.Request, error) {
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

// Fetch performs one model-list request and parses its response.
func Fetch(client *http.Client, req *http.Request) ([]string, error) {
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
		text := strings.TrimSpace(string(data))
		if len(text) > 300 {
			text = text[:300] + "…"
		}
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, text)
	}
	return Parse(data), nil
}

// Parse reads OpenAI/Anthropic ({"data":[{"id"}]}) and Gemini
// ({"models":[{"name":"models/x"}]}) list formats.
func Parse(data []byte) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(id string) {
		id = strings.TrimPrefix(strings.TrimSpace(id), "models/")
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	root := ojson.ParseBytes(data)
	for _, field := range []string{"data", "models"} {
		root.Get(field).ForEach(func(_, item ojson.Result) bool {
			if item.Type == ojson.String {
				add(item.String())
			} else {
				add(firstNonEmpty(item.Get("id").String(), item.Get("name").String()))
			}
			return true
		})
	}
	if len(out) == 0 && json.Valid(data) && root.IsArray() {
		root.ForEach(func(_, item ojson.Result) bool { add(item.Get("id").String()); return true })
	}
	sort.Strings(out)
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
