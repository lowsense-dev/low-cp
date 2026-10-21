// Package requestlog keeps the most recent client requests in memory for the
// panel: who called (IP, key), what (provider, model), the outcome (status,
// latency, tokens) and the error text of failures.
package requestlog

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/keyusage"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

// Capacity is the number of requests kept; older entries are dropped.
const Capacity = 2000

// maxErrorBytes bounds the stored error text of one request.
const maxErrorBytes = 2048

// Entry is one client request. HTTP fields come from the middleware, usage
// fields from upstream usage records with the same request ID.
type Entry struct {
	ID           string    `json:"id"`
	Time         time.Time `json:"time"`
	IP           string    `json:"ip"`
	Key          string    `json:"key,omitempty"`
	Method       string    `json:"method"`
	Path         string    `json:"path"`
	Status       int       `json:"status"`
	DurationMs   int64     `json:"duration_ms"`
	Model        string    `json:"model,omitempty"`
	Provider     string    `json:"provider,omitempty"`
	Account      string    `json:"account,omitempty"`
	InputTokens  int64     `json:"input_tokens"`
	OutputTokens int64     `json:"output_tokens"`
	CachedTokens int64     `json:"cached_tokens"`
	TotalTokens  int64     `json:"total_tokens"`
	Attempts     int       `json:"attempts"`
	Stream       bool      `json:"stream,omitempty"`
	Error        string    `json:"error,omitempty"`
	done         bool
}

// Log is a fixed-size ring of entries indexed by request ID.
type Log struct {
	mu    sync.Mutex
	ring  []*Entry
	next  int
	byID  map[string]*Entry
	clock func() time.Time
}

// New returns an empty log.
func New() *Log {
	return &Log{ring: make([]*Entry, 0, Capacity), byID: map[string]*Entry{}, clock: time.Now}
}

// upsert returns the entry for id, creating it (and evicting the oldest) when missing.
// Callers must hold l.mu.
func (l *Log) upsert(id string) *Entry {
	if entry := l.byID[id]; entry != nil {
		return entry
	}
	entry := &Entry{ID: id, Time: l.clock()}
	if len(l.ring) < Capacity {
		l.ring = append(l.ring, entry)
	} else {
		delete(l.byID, l.ring[l.next].ID)
		l.ring[l.next] = entry
		l.next = (l.next + 1) % Capacity
	}
	l.byID[id] = entry
	return entry
}

// Complete records the HTTP outcome of a finished request.
func (l *Log) Complete(e Entry) {
	if e.ID == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.upsert(e.ID)
	entry.Time = e.Time
	entry.IP, entry.Key, entry.Method, entry.Path = e.IP, e.Key, e.Method, e.Path
	entry.Status, entry.DurationMs = e.Status, e.DurationMs
	if entry.Model == "" {
		entry.Model = e.Model
	}
	if e.Error != "" {
		entry.Error = truncate(e.Error)
	}
	entry.done = true
}

// HandleUsage implements the usage plugin interface; it merges upstream attempt
// data into the entry of the inbound request.
func (l *Log) HandleUsage(_ context.Context, rec coreusage.Record) {
	if rec.TraceID == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.upsert(rec.TraceID)
	entry.Attempts++
	entry.Provider = rec.Provider
	entry.Account = rec.AuthIndex
	if model := firstNonEmpty(rec.Alias, rec.Model); model != "" {
		entry.Model = model
	}
	entry.Stream = rec.Stream
	f := keyusage.TokenFigures(rec)
	entry.InputTokens += f.Input
	entry.OutputTokens += f.Output
	entry.CachedTokens += f.Cached
	entry.TotalTokens += f.Total
	if rec.Failed && entry.Error == "" && rec.Fail.Body != "" {
		entry.Error = truncate(rec.Fail.Body)
	}
}

// Query filters entries, newest first.
type Query struct {
	Limit    int
	OnlyErrs bool
	Search   string
}

// List returns completed entries matching q, newest first.
func (l *Log) List(q Query) []Entry {
	if q.Limit <= 0 || q.Limit > Capacity {
		q.Limit = 200
	}
	search := strings.ToLower(strings.TrimSpace(q.Search))
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Entry, 0, q.Limit)
	n := len(l.ring)
	for i := 0; i < n && len(out) < q.Limit; i++ {
		// Walk backwards from the newest slot.
		entry := l.ring[(l.next-1-i+2*n)%n]
		if !entry.done || (q.OnlyErrs && entry.Status < 400) {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(strings.Join([]string{entry.IP, entry.Model, entry.Provider, entry.Path, entry.Error, entry.Account}, " ")), search) {
			continue
		}
		out = append(out, *entry)
	}
	return out
}

func truncate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxErrorBytes {
		s = s[:maxErrorBytes] + "…"
	}
	return s
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

var (
	defaultOnce sync.Once
	defaultLog  *Log
)

// Default returns the process-wide log, registering it as a usage plugin once.
func Default() *Log {
	defaultOnce.Do(func() {
		defaultLog = New()
		coreusage.RegisterNamedPlugin("low-cp-requestlog", defaultLog)
	})
	return defaultLog
}
