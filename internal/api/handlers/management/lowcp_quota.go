package management

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/misc"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/tidwall/gjson"
)

// quotaWindow is one usage limit normalised across providers.
type quotaWindow struct {
	Label       string  `json:"label"`
	UsedPercent float64 `json:"used_percent"`
	ResetsAt    string  `json:"resets_at,omitempty"`
}

type quotaReport struct {
	Provider string        `json:"provider"`
	Plan     string        `json:"plan,omitempty"`
	Windows  []quotaWindow `json:"windows"`
}

// Upstream quota endpoints; variables so tests can point them at a fake server.
var (
	codexUsageURL       = "https://chatgpt.com/backend-api/wham/usage"
	claudeUsageURL      = "https://api.anthropic.com/api/oauth/usage"
	antigravityQuotaURL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
)

// GetQuota fetches live usage limits for a Codex, Claude or Antigravity OAuth account.
func (h *Handler) GetQuota(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	auth, ok := h.lookupAuthFile(body.Name, "")
	if !ok || auth == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "credential not found"})
		return
	}
	provider := strings.ToLower(auth.Provider)
	if provider != "codex" && provider != "claude" && provider != "antigravity" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quota check is supported for codex, claude and antigravity"})
		return
	}
	ctx := c.Request.Context()
	token, err := h.resolveTokenForAuth(ctx, auth, "")
	if err != nil || token == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "access token unavailable; try refreshing the account"})
		return
	}
	req, err := buildQuotaRequest(ctx, provider, auth, token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	client := &http.Client{Timeout: defaultAPICallTimeout, Transport: h.apiCallTransport(auth, "")}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "quota request failed: " + err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read quota response"})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("upstream returned %d: %s", resp.StatusCode, truncateForError(data))})
		return
	}
	report := parseQuota(provider, data)
	c.JSON(http.StatusOK, report)
}

func buildQuotaRequest(ctx context.Context, provider string, auth *coreauth.Auth, token string) (*http.Request, error) {
	var (
		req *http.Request
		err error
	)
	switch provider {
	case "codex":
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, codexUsageURL, nil)
		if err == nil {
			if accountID := stringValue(auth.Metadata, "account_id"); accountID != "" {
				req.Header.Set("ChatGPT-Account-Id", accountID)
			}
			req.Header.Set("User-Agent", "codex_cli_rs/0.50.0")
		}
	case "claude":
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, claudeUsageURL, nil)
		if err == nil {
			req.Header.Set("anthropic-beta", "oauth-2025-04-20")
			req.Header.Set("User-Agent", "claude-cli/2.0.0 (external, cli)")
		}
	case "antigravity":
		payload, _ := json.Marshal(map[string]string{"project": stringValue(auth.Metadata, "project_id")})
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, antigravityQuotaURL, bytes.NewReader(payload))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", misc.AntigravityUserAgent())
		}
	}
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func parseQuota(provider string, data []byte) quotaReport {
	root := gjson.ParseBytes(data)
	report := quotaReport{Provider: provider, Windows: []quotaWindow{}}
	switch provider {
	case "codex":
		report.Plan = root.Get("plan_type").String()
		addCodexWindows(&report, "", root.Get("rate_limit"))
		root.Get("additional_rate_limits").ForEach(func(_, extra gjson.Result) bool {
			addCodexWindows(&report, extra.Get("limit_name").String()+" ", extra.Get("rate_limit"))
			return true
		})
	case "claude":
		labels := map[string]string{"five_hour": "5h", "seven_day": "7d", "seven_day_opus": "7d Opus", "seven_day_sonnet": "7d Sonnet", "seven_day_oauth_apps": "7d OAuth apps"}
		root.ForEach(func(key, value gjson.Result) bool {
			if !value.IsObject() || !value.Get("utilization").Exists() {
				return true
			}
			label := labels[key.String()]
			if label == "" {
				label = strings.ReplaceAll(key.String(), "_", " ")
			}
			report.Windows = append(report.Windows, quotaWindow{Label: label, UsedPercent: round1(value.Get("utilization").Float()), ResetsAt: value.Get("resets_at").String()})
			return true
		})
	case "antigravity":
		// Models without a displayName are internal (e.g. chat_23310); several IDs can
		// share one display name, so keep the most used entry per name.
		seen := map[string]int{}
		root.Get("models").ForEach(func(_, value gjson.Result) bool {
			info := value.Get("quotaInfo")
			label := value.Get("displayName").String()
			if !info.Exists() || label == "" {
				return true
			}
			remaining := 1.0
			if fraction := info.Get("remainingFraction"); fraction.Exists() {
				remaining = fraction.Float()
			}
			window := quotaWindow{Label: label, UsedPercent: round1((1 - remaining) * 100), ResetsAt: info.Get("resetTime").String()}
			if index, ok := seen[label]; ok {
				if window.UsedPercent > report.Windows[index].UsedPercent {
					report.Windows[index] = window
				}
				return true
			}
			seen[label] = len(report.Windows)
			report.Windows = append(report.Windows, window)
			return true
		})
	}
	sort.SliceStable(report.Windows, func(i, j int) bool { return report.Windows[i].UsedPercent > report.Windows[j].UsedPercent })
	return report
}

func addCodexWindows(report *quotaReport, prefix string, rateLimit gjson.Result) {
	for _, name := range []string{"primary_window", "secondary_window"} {
		window := rateLimit.Get(name)
		if !window.IsObject() || !window.Get("used_percent").Exists() {
			continue
		}
		seconds := window.Get("limit_window_seconds").Int()
		if seconds == 0 {
			seconds = window.Get("window_minutes").Int() * 60
		}
		resetsAt := ""
		if at := window.Get("reset_at").Int(); at > 0 {
			resetsAt = time.Unix(at, 0).UTC().Format(time.RFC3339)
		} else if after := window.Get("reset_after_seconds"); after.Exists() {
			resetsAt = time.Now().Add(time.Duration(after.Int()) * time.Second).UTC().Format(time.RFC3339)
		}
		report.Windows = append(report.Windows, quotaWindow{Label: prefix + windowLabel(seconds), UsedPercent: round1(window.Get("used_percent").Float()), ResetsAt: resetsAt})
	}
}

func windowLabel(seconds int64) string {
	switch {
	case seconds <= 0:
		return "limit"
	case seconds%86400 == 0:
		return fmt.Sprintf("%dd", seconds/86400)
	case seconds%3600 == 0:
		return fmt.Sprintf("%dh", seconds/3600)
	default:
		return fmt.Sprintf("%dm", seconds/60)
	}
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func truncateForError(data []byte) string {
	text := strings.TrimSpace(string(data))
	if len(text) > 300 {
		text = text[:300] + "…"
	}
	return text
}
