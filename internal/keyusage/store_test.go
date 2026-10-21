package keyusage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func TestStoreAggregatesLimitsAndPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	now := time.Date(2026, 10, 21, 15, 30, 0, 0, time.UTC)
	s := New(path)
	s.now = func() time.Time { return now }

	rec := func(at time.Time, key, provider, auth, model string, in, out int64, failed bool) {
		s.HandleUsage(context.Background(), coreusage.Record{RequestedAt: at, APIKey: key, Provider: provider, AuthIndex: auth, Model: model, Failed: failed,
			Detail: coreusage.Detail{InputTokens: in, OutputTokens: out}})
	}
	yesterday := now.Add(-24 * time.Hour)
	rec(yesterday, "sk-a", "codex", "acc1", "gpt-5", 100, 50, false)
	rec(now, "sk-a", "codex", "acc1", "gpt-5", 10, 5, false)
	// A late record for yesterday must not reset today's counter.
	rec(yesterday, "sk-a", "codex", "acc1", "gpt-5", 1, 0, false)
	rec(now, "sk-a", "claude", "acc2", "opus", 1, 1, true)
	rec(now, "sk-b", "codex", "acc1", "gpt-5", 7, 3, false)

	total, today := s.KeyTokens("sk-a")
	if total != 168 || today != 17 {
		t.Fatalf("sk-a tokens total=%d today=%d, want 168/17", total, today)
	}

	r := s.Query(Filter{Provider: "codex"}, 86400)
	if r.Totals.Requests != 4 || r.Totals.Total != 176 {
		t.Fatalf("codex totals = %+v", r.Totals)
	}
	if len(r.Series) != 2 || r.Series[0].Total != 151 || r.Series[1].Total != 25 {
		t.Fatalf("daily series = %+v", r.Series)
	}
	if len(r.Keys) != 2 || r.Keys[0].ID != KeyID("sk-a") || r.Keys[0].Total != 166 {
		t.Fatalf("keys = %+v", r.Keys)
	}
	if len(r.Accounts) != 1 || r.Accounts[0].Provider != "codex" {
		t.Fatalf("accounts = %+v", r.Accounts)
	}
	if got := s.Query(Filter{From: now.Truncate(time.Hour)}, 3600).Totals.Failed; got != 1 {
		t.Fatalf("failed today = %d", got)
	}

	if err := s.Flush(); err != nil {
		t.Fatal(err)
	}
	reloaded := New(path)
	reloaded.now = s.now
	if total, today := reloaded.KeyTokens("sk-a"); total != 168 || today != 17 {
		t.Fatalf("after reload total=%d today=%d", total, today)
	}
	if reloaded.Query(Filter{}, 3600).Totals.Requests != 5 {
		t.Fatalf("buckets not persisted")
	}

	// A new UTC day starts the daily counter from zero; the lifetime total stays.
	reloaded.now = func() time.Time { return now.Add(24 * time.Hour) }
	if total, today := reloaded.KeyTokens("sk-a"); total != 168 || today != 0 {
		t.Fatalf("next day total=%d today=%d", total, today)
	}
	reloaded.ResetKey("sk-a")
	if total, _ := reloaded.KeyTokens("sk-a"); total != 0 {
		t.Fatalf("reset total = %d", total)
	}
}

func TestCacheReadsDoNotCountTowardLimits(t *testing.T) {
	// Claude-style: cache reads are reported separately from input.
	claude := coreusage.Record{Detail: coreusage.Detail{InputTokens: 100, OutputTokens: 50, CacheReadTokens: 1000, TotalTokens: 1150,
		TokenBreakdown: coreusage.NewIndependentTokenBreakdown(100, 1000, 0, 50, 0, 1150)}}
	// OpenAI-style: cached tokens are a subset of the prompt.
	openai := coreusage.Record{Detail: coreusage.Detail{InputTokens: 1100, OutputTokens: 50, CachedTokens: 1000, TotalTokens: 1150,
		TokenBreakdown: coreusage.NewSubsetTokenBreakdown(1100, 1000, 0, 50, 0, 1150)}}
	// No breakdown: fall back to total minus cache reads.
	unknown := coreusage.Record{Detail: coreusage.Detail{InputTokens: 1100, OutputTokens: 50, CacheReadTokens: 1000, TotalTokens: 1150}}

	for name, rec := range map[string]coreusage.Record{"claude": claude, "openai": openai, "unknown": unknown} {
		f := TokenFigures(rec)
		if f.Total != 1150 || f.Cached != 1000 || f.Billable != 150 {
			t.Fatalf("%s: figures = %+v", name, f)
		}
	}

	s := New("")
	claude.APIKey = "k"
	s.HandleUsage(context.Background(), claude)
	if total, today := s.KeyTokens("k"); total != 150 || today != 150 {
		t.Fatalf("limit tokens total=%d today=%d, want 150 (cache reads excluded)", total, today)
	}
	if r := s.Query(Filter{}, 3600); r.Totals.Total != 1150 || r.Totals.Cached != 1000 {
		t.Fatalf("stats keep full totals: %+v", r.Totals)
	}
}
