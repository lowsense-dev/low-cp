package management

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keyusage"
)

// GetStats aggregates usage for the panel. Query: days (1-35, default 7), provider,
// account (auth_index), key (raw client key), model. Hourly series up to 2 days, daily beyond.
func (h *Handler) GetStats(c *gin.Context) {
	store := keyusage.Default()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "usage store unavailable"})
		return
	}
	days, err := strconv.Atoi(c.DefaultQuery("days", "7"))
	if err != nil || days < 1 || days > 35 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "days must be between 1 and 35"})
		return
	}
	now := time.Now().UTC()
	step := int64(3600)
	from := now.Truncate(time.Hour).Add(-time.Duration(days*24-1) * time.Hour)
	if days > 2 {
		step = 86400
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		from = today.AddDate(0, 0, -(days - 1))
	}
	filter := keyusage.Filter{
		From:     from,
		Provider: strings.TrimSpace(c.Query("provider")),
		Account:  strings.TrimSpace(c.Query("account")),
		Model:    strings.TrimSpace(c.Query("model")),
	}
	if key := strings.TrimSpace(c.Query("key")); key != "" {
		filter.Key = keyusage.KeyID(key)
	}
	report := store.Query(filter, step)
	c.JSON(http.StatusOK, gin.H{"from": from.Unix(), "report": report, "key_labels": h.keyLabels()})
}

// keyLabels maps stored key IDs back to the client keys in the config.
func (h *Handler) keyLabels() map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	labels := make(map[string]string, len(h.cfg.APIKeys))
	for _, key := range h.cfg.APIKeys {
		labels[keyusage.KeyID(key)] = key
	}
	return labels
}

// GetKeyUsage returns lifetime and today's token totals per configured client key.
func (h *Handler) GetKeyUsage(c *gin.Context) {
	store := keyusage.Default()
	out := map[string]gin.H{}
	if store != nil {
		for _, key := range h.keyLabels() {
			total, today := store.KeyTokens(key)
			out[key] = gin.H{"total": total, "today": today}
		}
	}
	c.JSON(http.StatusOK, out)
}

// ResetKeyUsage clears a client key's token counters (its limits start over).
func (h *Handler) ResetKeyUsage(c *gin.Context) {
	var body struct {
		Key string `json:"key"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}
	if store := keyusage.Default(); store != nil {
		store.ResetKey(body.Key)
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
