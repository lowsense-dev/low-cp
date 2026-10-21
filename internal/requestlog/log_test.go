package requestlog

import (
	"context"
	"fmt"
	"testing"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func TestLogMergesUsageInEitherOrder(t *testing.T) {
	l := New()
	ctx := context.Background()

	// Usage arrives before the HTTP completion.
	l.HandleUsage(ctx, coreusage.Record{TraceID: "a", Provider: "codex", Model: "gpt-5", AuthIndex: "acc", Detail: coreusage.Detail{InputTokens: 10, OutputTokens: 5}})
	if got := l.List(Query{}); len(got) != 0 {
		t.Fatalf("incomplete entries must be hidden, got %d", len(got))
	}
	l.Complete(Entry{ID: "a", Time: time.Unix(100, 0), IP: "1.2.3.4", Status: 200, DurationMs: 42})

	// HTTP completion arrives first, a failed attempt follows.
	l.Complete(Entry{ID: "b", Time: time.Unix(200, 0), Status: 502, Model: "claude", Error: ""})
	l.HandleUsage(ctx, coreusage.Record{TraceID: "b", Provider: "claude", Failed: true, Fail: coreusage.Failure{StatusCode: 529, Body: "overloaded"}})

	got := l.List(Query{})
	if len(got) != 2 || got[0].ID != "b" || got[1].ID != "a" {
		t.Fatalf("order = %+v", got)
	}
	if got[1].TotalTokens != 15 || got[1].Provider != "codex" || got[1].IP != "1.2.3.4" || got[1].Attempts != 1 {
		t.Fatalf("merged a = %+v", got[1])
	}
	if got[0].Error != "overloaded" || got[0].Model != "claude" {
		t.Fatalf("merged b = %+v", got[0])
	}
	if errs := l.List(Query{OnlyErrs: true}); len(errs) != 1 || errs[0].ID != "b" {
		t.Fatalf("only errors = %+v", errs)
	}
	if found := l.List(Query{Search: "1.2.3"}); len(found) != 1 || found[0].ID != "a" {
		t.Fatalf("search = %+v", found)
	}
}

func TestLogEvictsOldest(t *testing.T) {
	l := New()
	for i := 0; i < Capacity+5; i++ {
		l.Complete(Entry{ID: fmt.Sprint(i), Status: 200})
	}
	got := l.List(Query{Limit: Capacity})
	if len(got) != Capacity || got[0].ID != fmt.Sprint(Capacity+4) || got[len(got)-1].ID != "5" {
		t.Fatalf("len=%d first=%s last=%s", len(got), got[0].ID, got[len(got)-1].ID)
	}
	if len(l.byID) != Capacity {
		t.Fatalf("index size = %d", len(l.byID))
	}
}
