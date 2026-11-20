package cliproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"

	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

func TestEmptyProviderModelsDiscoverUpstream(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		basePath string
		path     string
		response string
		config   func(string) *config.Config
		attrs    map[string]string
	}{
		{
			name: "gemini", provider: "gemini", path: "/v1beta/models",
			response: `{"models":[{"name":"models/discovered-a"},{"name":"models/discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{GeminiKey: []config.GeminiKey{{APIKey: "test-key", BaseURL: base}}}
			},
		},
		{
			name: "interactions", provider: "gemini-interactions", path: "/v1beta/models",
			response: `{"models":[{"name":"models/discovered-a"},{"name":"models/discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{InteractionsKey: []config.GeminiKey{{APIKey: "test-key", BaseURL: base}}}
			},
		},
		{
			name: "claude", provider: "claude", path: "/v1/models",
			response: `{"data":[{"id":"discovered-a"},{"id":"discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{ClaudeKey: []config.ClaudeKey{{APIKey: "test-key", BaseURL: base}}}
			},
		},
		{
			name: "codex", provider: "codex", basePath: "/v1", path: "/v1/models",
			response: `{"data":[{"id":"discovered-a"},{"id":"discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{CodexKey: []config.CodexKey{{APIKey: "test-key", BaseURL: base + "/v1"}}}
			},
		},
		{
			name: "xai", provider: "xai", basePath: "/v1", path: "/v1/models",
			response: `{"data":[{"id":"discovered-a"},{"id":"discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{XAIKey: []config.XAIKey{{APIKey: "test-key", BaseURL: base + "/v1"}}}
			},
		},
		{
			name: "openai compatibility", provider: "openai-compatibility", basePath: "/v1", path: "/v1/models",
			response: `{"data":[{"id":"discovered-a"},{"id":"discovered-b"}]}`,
			config: func(base string) *config.Config {
				return &config.Config{OpenAICompatibility: []config.OpenAICompatibility{{
					Name: "custom", BaseURL: base + "/v1",
					APIKeyEntries: []config.OpenAICompatibilityAPIKey{{APIKey: "test-key"}},
				}}}
			},
			attrs: map[string]string{"compat_name": "custom", "config_index": "0"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tt.path {
					t.Errorf("model list path = %q, want %q", r.URL.Path, tt.path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tt.response)
			}))
			defer server.Close()

			attrs := map[string]string{"api_key": "test-key", "base_url": server.URL + tt.basePath}
			for key, value := range tt.attrs {
				attrs[key] = value
			}
			auth := &coreauth.Auth{ID: "discover-" + tt.name, Provider: tt.provider, Attributes: attrs}
			service := &Service{cfg: tt.config(server.URL)}
			t.Cleanup(func() { GlobalModelRegistry().UnregisterClient(auth.ID) })

			service.registerModelsForAuth(t.Context(), auth)

			var ids []string
			for _, model := range GlobalModelRegistry().GetModelsForClient(auth.ID) {
				if model != nil {
					ids = append(ids, model.ID)
				}
			}
			sort.Strings(ids)
			if want := []string{"discovered-a", "discovered-b"}; !reflect.DeepEqual(ids, want) {
				t.Fatalf("registered models = %v, want %v", ids, want)
			}
		})
	}
}

func TestConfiguredProviderModelsSkipDiscovery(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[]}`)
	}))
	defer server.Close()

	auth := &coreauth.Auth{ID: "configured-models", Provider: "openai-compatibility", Attributes: map[string]string{
		"api_key": "test-key", "base_url": server.URL + "/v1", "compat_name": "custom", "config_index": "0",
	}}
	service := &Service{cfg: &config.Config{OpenAICompatibility: []config.OpenAICompatibility{{
		Name: "custom", BaseURL: server.URL + "/v1", Models: []config.OpenAICompatibilityModel{{Name: "configured-model"}},
		APIKeyEntries: []config.OpenAICompatibilityAPIKey{{APIKey: "test-key"}},
	}}}}
	t.Cleanup(func() { GlobalModelRegistry().UnregisterClient(auth.ID) })

	service.registerModelsForAuth(t.Context(), auth)

	if requests != 0 {
		t.Fatalf("upstream model requests = %d, want 0", requests)
	}
	models := GlobalModelRegistry().GetModelsForClient(auth.ID)
	if len(models) != 1 || models[0].ID != "configured-model" {
		t.Fatalf("registered models = %+v, want configured-model", models)
	}
}
