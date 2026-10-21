package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keyusage"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/thinking"
	"github.com/tidwall/gjson"
)

// keyPolicyMiddleware enforces routing.disabled-models for everyone and
// access.key-policies for the authenticated client key (expiry, token budgets, model
// allowlist); model listings are filtered accordingly. It runs after AuthMiddleware,
// which stores the authenticated key as "userApiKey".
func (s *Server) keyPolicyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		key, policy, hasPolicy := s.policyForRequest(c)
		var disabled []string
		if cfg := s.getConfig(); cfg != nil {
			disabled = cfg.Routing.DisabledModels
		}
		if !hasPolicy && len(disabled) == 0 {
			c.Next()
			return
		}
		if hasPolicy && !checkKeyBudget(c, key, policy) {
			return
		}
		allowed := policy.Models
		if len(allowed) == 0 && len(disabled) == 0 {
			c.Next()
			return
		}
		permitted := func(model string) bool {
			return (len(allowed) == 0 || modelAllowed(allowed, model)) && !modelAllowed(disabled, model)
		}
		// Websocket transports carry the model inside frames after the upgrade, where
		// this middleware cannot see it; restricted keys fall back to HTTP.
		// shortcut: globally disabled models are not enforced on websocket transports.
		if websocket.IsWebSocketUpgrade(c.Request) {
			if len(allowed) > 0 {
				denyModel(c, "websocket transport is not available for model-restricted API keys")
				return
			}
			c.Next()
			return
		}
		if isModelListPath(c.Request.URL.Path) {
			filterModelList(c, permitted)
			return
		}
		model, found := requestedModel(c)
		if !found {
			if len(allowed) > 0 && c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
				denyModel(c, "request has no model; this API key is restricted to specific models")
				return
			}
			c.Next()
			return
		}
		if modelAllowed(disabled, model) {
			denyKey(c, http.StatusForbidden, "model_disabled", "model "+model+" is disabled on this proxy")
			return
		}
		if !permitted(model) {
			denyModel(c, "model "+model+" is not allowed for this API key")
			return
		}
		c.Next()
	}
}

// checkKeyBudget rejects expired keys and keys over their token budgets. Token
// budgets gate spending only, so reads such as model listings stay available.
func checkKeyBudget(c *gin.Context, key string, policy config.KeyPolicy) bool {
	if policy.ExpiresAt != "" {
		if expires, err := time.Parse(time.RFC3339, policy.ExpiresAt); err == nil && !time.Now().Before(expires) {
			denyKey(c, http.StatusForbidden, "key_expired", "this API key expired at "+policy.ExpiresAt)
			return false
		}
	}
	spends := c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead
	store := keyusage.Default()
	if !spends || store == nil || (policy.TotalTokens <= 0 && policy.DailyTokens <= 0) {
		return true
	}
	total, today := store.KeyTokens(key)
	if policy.TotalTokens > 0 && total >= policy.TotalTokens {
		denyKey(c, http.StatusForbidden, "token_limit_exhausted", fmt.Sprintf("this API key used its %d token limit", policy.TotalTokens))
		return false
	}
	if policy.DailyTokens > 0 && today >= policy.DailyTokens {
		now := time.Now().UTC()
		midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
		c.Header("Retry-After", strconv.Itoa(int(midnight.Sub(now).Seconds())+1))
		denyKey(c, http.StatusTooManyRequests, "daily_token_limit_exhausted", fmt.Sprintf("this API key used its daily limit of %d tokens; it resets at 00:00 UTC", policy.DailyTokens))
		return false
	}
	return true
}

func (s *Server) policyForRequest(c *gin.Context) (string, config.KeyPolicy, bool) {
	cfg := s.getConfig()
	if cfg == nil || len(cfg.APIKeyPolicies) == 0 {
		return "", config.KeyPolicy{}, false
	}
	value, _ := c.Get("userApiKey")
	key, _ := value.(string)
	policy, ok := cfg.APIKeyPolicies[key]
	return key, policy, ok
}

func denyModel(c *gin.Context, message string) {
	denyKey(c, http.StatusForbidden, "model_not_allowed", message)
}

func denyKey(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{
		"message": message,
		"type":    "permission_error",
		"code":    code,
	}})
}

func isModelListPath(path string) bool {
	return path == "/v1/models" || path == "/v1beta/models"
}

// requestedModel extracts the model from the URL (Gemini and model detail routes),
// a multipart form, or the JSON body. The body is restored for the handler.
func requestedModel(c *gin.Context) (string, bool) {
	path := c.Request.URL.Path
	for _, prefix := range []string{"/v1beta/models/", "/v1/models/"} {
		if rest, ok := strings.CutPrefix(path, prefix); ok {
			model, _, _ := strings.Cut(rest, ":")
			return normalizeRequestedModel(model), model != ""
		}
	}
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		model := c.Request.FormValue("model")
		return normalizeRequestedModel(model), model != ""
	}
	if c.Request.Body == nil {
		return "", false
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		// Replay what was read, then the same error, so handlers still see body-limit
		// failures (413) instead of a silently truncated body.
		c.Request.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), failingReader{err}))
		return "", false
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	model := gjson.GetBytes(body, "model").String()
	return normalizeRequestedModel(model), model != ""
}

func normalizeRequestedModel(model string) string {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	return strings.TrimSpace(thinking.ParseSuffix(model).ModelName)
}

func modelAllowed(patterns []string, model string) bool {
	model = strings.ToLower(model)
	for _, pattern := range patterns {
		if wildcardMatch(strings.ToLower(strings.TrimSpace(pattern)), model) {
			return true
		}
	}
	return false
}

// wildcardMatch matches with '*' standing for any substring, including '/'.
func wildcardMatch(pattern, value string) bool {
	if pattern == "" {
		return false
	}
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == value
	}
	if !strings.HasPrefix(value, parts[0]) {
		return false
	}
	value = value[len(parts[0]):]
	last := parts[len(parts)-1]
	for _, part := range parts[1 : len(parts)-1] {
		idx := strings.Index(value, part)
		if idx < 0 {
			return false
		}
		value = value[idx+len(part):]
	}
	return strings.HasSuffix(value, last)
}

// bufferedWriter captures a handler's response so the model list can be filtered.
type bufferedWriter struct {
	gin.ResponseWriter
	body   bytes.Buffer
	status int
}

func (w *bufferedWriter) WriteHeader(code int)              { w.status = code }
func (w *bufferedWriter) WriteHeaderNow()                   {}
func (w *bufferedWriter) Write(data []byte) (int, error)    { return w.body.Write(data) }
func (w *bufferedWriter) WriteString(s string) (int, error) { return w.body.WriteString(s) }
func (w *bufferedWriter) Status() int                       { return w.status }
func (w *bufferedWriter) Written() bool                     { return w.body.Len() > 0 }

func filterModelList(c *gin.Context, permitted func(string) bool) {
	original := c.Writer
	buffer := &bufferedWriter{ResponseWriter: original, status: http.StatusOK}
	c.Writer = buffer
	c.Next()
	c.Writer = original

	body := buffer.body.Bytes()
	if buffer.status == http.StatusOK {
		if filtered, ok := filterModelListBody(body, permitted); ok {
			body = filtered
		}
	}
	original.Header().Del("Content-Length")
	original.WriteHeader(buffer.status)
	_, _ = original.Write(body)
}

// filterModelListBody keeps entries of "data" (OpenAI/Claude) and "models" (Gemini,
// Codex client catalog) whose id, name or slug is allowed.
func filterModelListBody(body []byte, permitted func(string) bool) ([]byte, bool) {
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, false
	}
	for _, field := range []string{"data", "models"} {
		list, ok := doc[field].([]any)
		if !ok {
			continue
		}
		kept := make([]any, 0, len(list))
		for _, item := range list {
			entry, _ := item.(map[string]any)
			for _, key := range []string{"id", "name", "slug"} {
				if id, _ := entry[key].(string); id != "" {
					if permitted(normalizeRequestedModel(id)) {
						kept = append(kept, item)
					}
					break
				}
			}
		}
		doc[field] = kept
	}
	out, err := json.Marshal(doc)
	return out, err == nil
}

type failingReader struct{ err error }

func (r failingReader) Read([]byte) (int, error) { return 0, r.err }
