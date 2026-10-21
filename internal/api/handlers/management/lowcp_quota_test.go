package management

import "testing"

func TestParseQuotaCodex(t *testing.T) {
	data := []byte(`{"plan_type":"plus","rate_limit":{"allowed":true,"primary_window":{"used_percent":12.34,"limit_window_seconds":18000,"reset_at":1800000000},"secondary_window":{"used_percent":40,"limit_window_seconds":604800,"reset_after_seconds":60}},
	"additional_rate_limits":[{"limit_name":"Spark","rate_limit":{"primary_window":{"used_percent":90,"limit_window_seconds":18000,"reset_at":1800000000}}}]}`)
	r := parseQuota("codex", data)
	if r.Plan != "plus" || len(r.Windows) != 3 {
		t.Fatalf("report = %+v", r)
	}
	// Sorted by usage, highest first.
	if r.Windows[0].Label != "Spark 5h" || r.Windows[0].UsedPercent != 90 {
		t.Fatalf("first window = %+v", r.Windows[0])
	}
	if r.Windows[1].Label != "7d" || r.Windows[2].Label != "5h" || r.Windows[2].UsedPercent != 12.3 {
		t.Fatalf("windows = %+v", r.Windows)
	}
	if r.Windows[2].ResetsAt != "2027-01-15T08:00:00Z" {
		t.Fatalf("resets_at = %q", r.Windows[2].ResetsAt)
	}
}

func TestParseQuotaClaude(t *testing.T) {
	data := []byte(`{"five_hour":{"utilization":23,"resets_at":"2026-10-21T05:00:00Z"},"seven_day":{"utilization":5.55,"resets_at":"2026-10-25T00:00:00Z"},"seven_day_opus":null,"extra_usage":{"is_enabled":false}}`)
	r := parseQuota("claude", data)
	if len(r.Windows) != 2 || r.Windows[0].Label != "5h" || r.Windows[0].UsedPercent != 23 || r.Windows[1].UsedPercent != 5.6 {
		t.Fatalf("report = %+v", r)
	}
}

func TestParseQuotaAntigravity(t *testing.T) {
	data := []byte(`{"models":{
		"gemini-2.5-pro":{"displayName":"Gemini 2.5 Pro","quotaInfo":{"remainingFraction":0.25,"resetTime":"2026-10-21T10:00:00Z"}},
		"gemini-2.5-pro-alt":{"displayName":"Gemini 2.5 Pro","quotaInfo":{"remainingFraction":0.5}},
		"claude-sonnet":{"displayName":"Claude Sonnet","quotaInfo":{"resetTime":"2026-10-21T10:00:00Z"}},
		"chat_23310":{"quotaInfo":{"remainingFraction":0}},
		"no-quota":{"displayName":"x"}}}`)
	r := parseQuota("antigravity", data)
	if len(r.Windows) != 2 || r.Windows[0].Label != "Gemini 2.5 Pro" || r.Windows[0].UsedPercent != 75 {
		t.Fatalf("report = %+v", r)
	}
	// A missing remainingFraction means untouched quota.
	if r.Windows[1].Label != "Claude Sonnet" || r.Windows[1].UsedPercent != 0 {
		t.Fatalf("second = %+v", r.Windows[1])
	}
}

func TestWindowLabel(t *testing.T) {
	for seconds, want := range map[int64]string{18000: "5h", 604800: "7d", 90: "1m", 0: "limit"} {
		if got := windowLabel(seconds); got != want {
			t.Errorf("windowLabel(%d) = %q, want %q", seconds, got, want)
		}
	}
}
