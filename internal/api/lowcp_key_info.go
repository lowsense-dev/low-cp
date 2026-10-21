package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keyusage"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
)

type tokenLimit struct {
	Limit     *int64 `json:"limit"` // null = unlimited
	Used      int64  `json:"used"`
	Remaining *int64 `json:"remaining"`
	ResetsAt  string `json:"resets_at,omitempty"`
}

func newTokenLimit(limit, used int64) tokenLimit {
	out := tokenLimit{Used: used}
	if limit > 0 {
		remaining := max(0, limit-used)
		out.Limit, out.Remaining = &limit, &remaining
	}
	return out
}

// keyInfoHandler serves GET /v1/key: the calling client key's own limits and usage.
// Token counts exclude cache reads, matching how limits are enforced.
func (s *Server) keyInfoHandler(c *gin.Context) {
	value, _ := c.Get("userApiKey")
	key, _ := value.(string)
	var policy config.KeyPolicy
	if cfg := s.getConfig(); cfg != nil {
		policy = cfg.APIKeyPolicies[key]
	}
	var total, today int64
	if store := keyusage.Default(); store != nil {
		total, today = store.KeyTokens(key)
	}
	now := time.Now().UTC()
	daily := newTokenLimit(policy.DailyTokens, today)
	daily.ResetsAt = time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	body := gin.H{
		"key":          util.HideAPIKey(key),
		"name":         policy.Name,
		"models":       policy.Models, // null = every enabled model
		"total_tokens": newTokenLimit(policy.TotalTokens, total),
		"daily_tokens": daily,
		"expires_at":   nil,
		"expired":      false,
	}
	if policy.ExpiresAt != "" {
		body["expires_at"] = policy.ExpiresAt
		if expires, err := time.Parse(time.RFC3339, policy.ExpiresAt); err == nil {
			body["expired"] = !now.Before(expires)
		}
	}
	c.JSON(http.StatusOK, body)
}
