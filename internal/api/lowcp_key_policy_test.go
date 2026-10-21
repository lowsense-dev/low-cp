package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keyusage"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestlog"
)

func TestWildcardMatch(t *testing.T) {
	cases := []struct {
		pattern, value string
		want           bool
	}{
		{"gpt-5", "gpt-5", true},
		{"gpt-5", "gpt-5.1", false},
		{"ds/*", "ds/qwen-max", true},
		{"*", "anything/at-all", true},
		{"*claude*", "zai/claude-sonnet", true},
		{"claude-*-4", "claude-opus-4", true},
		{"claude-*-4", "claude-opus-4-1", false},
		{"", "x", false},
	}
	for _, tc := range cases {
		if got := wildcardMatch(tc.pattern, tc.value); got != tc.want {
			t.Errorf("wildcardMatch(%q, %q) = %v, want %v", tc.pattern, tc.value, got, tc.want)
		}
	}
}

func newKeyModelsEngine(t *testing.T, cfg *config.Config) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: cfg}
	engine := gin.New()
	fakeAuth := func(c *gin.Context) {
		c.Set("userApiKey", strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
	}
	engine.Use(fakeAuth, s.keyPolicyMiddleware())
	engine.POST("/v1/chat/completions", func(c *gin.Context) {
		var body map[string]any
		_ = c.ShouldBindJSON(&body)
		c.JSON(http.StatusOK, gin.H{"model": body["model"]})
	})
	engine.POST("/v1beta/models/*action", func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.GET("/v1/models", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"object": "list", "data": []gin.H{{"id": "gpt-5"}, {"id": "ds/qwen-max"}, {"id": "claude-opus-4"}}})
	})
	return engine
}

func TestKeyPolicyModels(t *testing.T) {
	cfg := &config.Config{}
	cfg.APIKeyPolicies = map[string]config.KeyPolicy{"limited": {Models: []string{"gpt-5", "ds/*"}}}
	engine := newKeyModelsEngine(t, cfg)

	do := func(key, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		return rec
	}

	if rec := do("limited", http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5(high)"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "gpt-5(high)") {
		t.Fatalf("allowed model with thinking suffix: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("limited", http.MethodPost, "/v1/chat/completions", `{"model":"ds/qwen-max"}`); rec.Code != http.StatusOK {
		t.Fatalf("wildcard model: %d", rec.Code)
	}
	if rec := do("limited", http.MethodPost, "/v1/chat/completions", `{"model":"claude-opus-4"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("denied model: %d", rec.Code)
	}
	if rec := do("limited", http.MethodPost, "/v1/chat/completions", `{}`); rec.Code != http.StatusForbidden {
		t.Fatalf("missing model must be denied for restricted keys: %d", rec.Code)
	}
	if rec := do("limited", http.MethodPost, "/v1beta/models/claude-opus-4:generateContent", `{}`); rec.Code != http.StatusForbidden {
		t.Fatalf("gemini path model: %d", rec.Code)
	}
	if rec := do("free", http.MethodPost, "/v1/chat/completions", `{"model":"claude-opus-4"}`); rec.Code != http.StatusOK {
		t.Fatalf("unrestricted key: %d", rec.Code)
	}

	rec := do("limited", http.MethodGet, "/v1/models", "")
	var list struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("model list: %d %v %s", rec.Code, err, rec.Body.String())
	}
	if len(list.Data) != 2 || list.Data[0].ID != "gpt-5" || list.Data[1].ID != "ds/qwen-max" {
		t.Fatalf("filtered list = %+v", list.Data)
	}
	if rec := do("free", http.MethodGet, "/v1/models", ""); !strings.Contains(rec.Body.String(), "claude-opus-4") {
		t.Fatalf("unrestricted list should be complete: %s", rec.Body.String())
	}

	ws := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5"}`))
	ws.Header.Set("Authorization", "Bearer limited")
	ws.Header.Set("Connection", "Upgrade")
	ws.Header.Set("Upgrade", "websocket")
	wsRec := httptest.NewRecorder()
	engine.ServeHTTP(wsRec, ws)
	if wsRec.Code != http.StatusForbidden {
		t.Fatalf("websocket upgrade for restricted key: %d", wsRec.Code)
	}
}

func TestKeyPolicyExpiryAndLimits(t *testing.T) {
	store := keyusage.New("")
	keyusage.SetDefault(store)
	t.Cleanup(func() { keyusage.SetDefault(nil) })

	cfg := &config.Config{}
	cfg.APIKeyPolicies = map[string]config.KeyPolicy{
		"expired": {ExpiresAt: time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)},
		"future":  {ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)},
		"total":   {TotalTokens: 100},
		"daily":   {DailyTokens: 50},
	}
	engine := newKeyModelsEngine(t, cfg)
	do := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5"}`))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		return rec
	}
	if rec := do("expired"); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "key_expired") {
		t.Fatalf("expired: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do("future"); rec.Code != http.StatusOK {
		t.Fatalf("not yet expired: %d", rec.Code)
	}

	use := func(key string, tokens int64) {
		store.Add(keyusage.Dims{Hour: time.Now().UTC().Truncate(time.Hour).Unix(), Key: keyusage.KeyID(key)}, keyusage.Counters{Requests: 1, Total: tokens, Billable: tokens})
	}
	use("total", 99)
	if rec := do("total"); rec.Code != http.StatusOK {
		t.Fatalf("under total limit: %d", rec.Code)
	}
	use("total", 1)
	if rec := do("total"); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "token_limit_exhausted") {
		t.Fatalf("total limit: %d %s", rec.Code, rec.Body.String())
	}
	use("daily", 60)
	rec := do("daily")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("daily limit: %d retry-after=%q", rec.Code, rec.Header().Get("Retry-After"))
	}

	list := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	list.Header.Set("Authorization", "Bearer daily")
	listRec := httptest.NewRecorder()
	engine.ServeHTTP(listRec, list)
	if listRec.Code != http.StatusOK {
		t.Fatalf("model listing must stay available after the daily limit: %d", listRec.Code)
	}
}

func TestDisabledModels(t *testing.T) {
	cfg := &config.Config{}
	cfg.Routing.DisabledModels = []string{"claude-*"}
	cfg.APIKeyPolicies = map[string]config.KeyPolicy{"limited": {Models: []string{"gpt-5", "claude-opus-4"}}}
	engine := newKeyModelsEngine(t, cfg)
	do := func(key, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		return rec
	}
	if rec := do("free", http.MethodPost, "/v1/chat/completions", `{"model":"claude-opus-4"}`); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "model_disabled") {
		t.Fatalf("disabled model for unrestricted key: %d %s", rec.Code, rec.Body.String())
	}
	// A key allowlist cannot re-enable a globally disabled model.
	if rec := do("limited", http.MethodPost, "/v1/chat/completions", `{"model":"claude-opus-4"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("disabled model for restricted key: %d", rec.Code)
	}
	if rec := do("free", http.MethodPost, "/v1/chat/completions", `{"model":"gpt-5"}`); rec.Code != http.StatusOK {
		t.Fatalf("enabled model: %d", rec.Code)
	}
	rec := do("free", http.MethodGet, "/v1/models", "")
	if strings.Contains(rec.Body.String(), "claude-opus-4") || !strings.Contains(rec.Body.String(), "ds/qwen-max") {
		t.Fatalf("listing must hide disabled models: %s", rec.Body.String())
	}
}

func TestRequestLogMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) { logging.SetGinRequestID(c, "req-"+c.GetHeader("X-Test-Id")) })
	engine.Use(requestLogMiddleware(), func(c *gin.Context) { c.Set("userApiKey", "k1") })
	engine.POST("/v1/chat/completions", func(c *gin.Context) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "slow down"})
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Id", "log-test")
	engine.ServeHTTP(httptest.NewRecorder(), req)

	for _, entry := range requestlog.Default().List(requestlog.Query{Search: "gpt-5"}) {
		if entry.ID != "req-log-test" {
			continue
		}
		if entry.Status != http.StatusTooManyRequests || entry.Key != "k1" || entry.Model != "gpt-5" || !strings.Contains(entry.Error, "slow down") {
			t.Fatalf("entry = %+v", entry)
		}
		return
	}
	t.Fatalf("request not logged")
}

func TestKeyInfoEndpoint(t *testing.T) {
	store := keyusage.New("")
	keyusage.SetDefault(store)
	t.Cleanup(func() { keyusage.SetDefault(nil) })
	store.Add(keyusage.Dims{Hour: time.Now().UTC().Truncate(time.Hour).Unix(), Key: keyusage.KeyID("sk-limited-key-123")}, keyusage.Counters{Requests: 1, Total: 900, Billable: 300})

	cfg := &config.Config{}
	cfg.APIKeyPolicies = map[string]config.KeyPolicy{"sk-limited-key-123": {Name: "bot", TotalTokens: 1000, Models: []string{"gpt-5"}, ExpiresAt: "2099-01-01T00:00:00Z"}}
	gin.SetMode(gin.TestMode)
	s := &Server{cfg: cfg}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set("userApiKey", strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")) })
	engine.GET("/v1/key", s.keyInfoHandler)

	get := func(key string) map[string]any {
		req := httptest.NewRequest(http.MethodGet, "/v1/key", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		return body
	}
	body := get("sk-limited-key-123")
	total := body["total_tokens"].(map[string]any)
	if body["name"] != "bot" || total["limit"] != float64(1000) || total["used"] != float64(300) || total["remaining"] != float64(700) || body["expired"] != false {
		t.Fatalf("limited key = %v", body)
	}
	if strings.Contains(body["key"].(string), "limited-key") {
		t.Fatalf("key must be masked: %v", body["key"])
	}
	daily := get("other")["daily_tokens"].(map[string]any)
	if daily["limit"] != nil || daily["remaining"] != nil || daily["resets_at"] == "" {
		t.Fatalf("unlimited key daily = %v", daily)
	}
}
