// Package keyusage aggregates token usage per client key, provider, account and
// model into hourly buckets. It backs per-key token limits and the panel's
// statistics, and persists to a JSON file so limits survive restarts.
package keyusage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

// Retention bounds the hourly buckets kept for statistics. Lifetime key totals
// are kept separately and never expire.
const Retention = 35 * 24 * time.Hour

// Counters are additive usage figures.
type Counters struct {
	Requests  int64 `json:"requests"`
	Failed    int64 `json:"failed"`
	Input     int64 `json:"input_tokens"`
	Output    int64 `json:"output_tokens"`
	Cached    int64 `json:"cached_tokens"`
	Reasoning int64 `json:"reasoning_tokens"`
	Total     int64 `json:"total_tokens"`
	// Billable is Total minus cache reads; key token limits count only these.
	Billable int64 `json:"billable_tokens"`
}

func (c *Counters) add(o Counters) {
	c.Requests += o.Requests
	c.Failed += o.Failed
	c.Input += o.Input
	c.Output += o.Output
	c.Cached += o.Cached
	c.Reasoning += o.Reasoning
	c.Total += o.Total
	c.Billable += o.Billable
}

// Dims identify one bucket. Key is KeyID(apiKey), never the raw key.
type Dims struct {
	Hour     int64  `json:"hour"`
	Key      string `json:"key"`
	Provider string `json:"provider"`
	Account  string `json:"account"`
	Model    string `json:"model"`
}

type bucket struct {
	Dims
	Counters
}

type daily struct {
	Day    string `json:"day"`
	Tokens int64  `json:"tokens"`
}

type fileFormat struct {
	Version  int              `json:"version"`
	Buckets  []bucket         `json:"buckets"`
	KeyTotal map[string]int64 `json:"key_total"`
	KeyDaily map[string]daily `json:"key_daily"`
}

// Store is safe for concurrent use.
type Store struct {
	mu       sync.Mutex
	path     string
	buckets  map[Dims]*Counters
	keyTotal map[string]int64
	keyDaily map[string]daily
	dirty    bool
	now      func() time.Time
}

// KeyID derives the identifier stored instead of the raw client key.
func KeyID(apiKey string) string {
	if apiKey == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:8])
}

// New creates a store backed by path; an empty path keeps data in memory only.
func New(path string) *Store {
	s := &Store{path: path, buckets: map[Dims]*Counters{}, keyTotal: map[string]int64{}, keyDaily: map[string]daily{}, now: time.Now}
	if path == "" {
		return s
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.WithError(err).Warn("keyusage: failed to read usage file; starting empty")
		}
		return s
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		log.WithError(err).Warn("keyusage: usage file is corrupt; starting empty")
		return s
	}
	for _, b := range f.Buckets {
		c := b.Counters
		s.buckets[b.Dims] = &c
	}
	if f.KeyTotal != nil {
		s.keyTotal = f.KeyTotal
	}
	if f.KeyDaily != nil {
		s.keyDaily = f.KeyDaily
	}
	return s
}

// Figures are one record's tokens normalised across providers: Input includes
// cache reads and writes, Total = Input + Output, Billable = Total - cache reads.
type Figures struct {
	Input, Output, Cached, Reasoning, Total, Billable int64
}

// TokenFigures normalises a usage record. It prefers the canonical breakdown,
// whose buckets do not overlap whatever the provider's own usage format is.
func TokenFigures(rec coreusage.Record) Figures {
	d := coreusage.EnsureTokenBreakdownForProvider(rec.Detail, rec.Provider, rec.ExecutorType)
	b := d.TokenBreakdown
	var f Figures
	if b.Valid() && b.UnclassifiedTokens == 0 {
		f = Figures{Input: b.Input.TotalTokens, Output: b.Output.TotalTokens, Cached: b.Input.CacheReadTokens, Reasoning: b.Output.ReasoningTokens, Total: b.TotalTokens}
	} else {
		total := d.TotalTokens
		if total == 0 {
			total = d.InputTokens + d.OutputTokens
		}
		f = Figures{Input: d.InputTokens, Output: d.OutputTokens, Cached: max(d.CacheReadTokens, d.CachedTokens), Reasoning: d.ReasoningTokens, Total: total}
	}
	f.Billable = f.Total - f.Cached
	if f.Billable < 0 {
		f.Billable = f.Total
	}
	return f
}

// HandleUsage implements the usage plugin interface.
func (s *Store) HandleUsage(_ context.Context, rec coreusage.Record) {
	when := rec.RequestedAt
	if when.IsZero() {
		when = s.now()
	}
	account := rec.AuthIndex
	if account == "" {
		account = rec.AuthID
	}
	f := TokenFigures(rec)
	c := Counters{Requests: 1, Input: f.Input, Output: f.Output, Cached: f.Cached, Reasoning: f.Reasoning, Total: f.Total, Billable: f.Billable}
	if rec.Failed {
		c.Failed = 1
	}
	model := rec.Alias
	if model == "" {
		model = rec.Model
	}
	s.Add(Dims{Hour: when.UTC().Truncate(time.Hour).Unix(), Key: KeyID(rec.APIKey), Provider: rec.Provider, Account: account, Model: model}, c)
}

// Add records counters for one bucket and updates the key's lifetime and daily
// billable totals (cache reads excluded).
func (s *Store) Add(d Dims, c Counters) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing := s.buckets[d]; existing != nil {
		existing.add(c)
	} else {
		copied := c
		s.buckets[d] = &copied
	}
	if d.Key != "" && c.Billable > 0 {
		s.keyTotal[d.Key] += c.Billable
		day := time.Unix(d.Hour, 0).UTC().Format(time.DateOnly)
		// ISO dates compare lexically; a late record for an earlier day must not reset today.
		entry := s.keyDaily[d.Key]
		if day > entry.Day {
			entry = daily{Day: day}
		}
		if day == entry.Day {
			entry.Tokens += c.Billable
			s.keyDaily[d.Key] = entry
		}
	}
	s.dirty = true
}

// KeyTokens returns the lifetime and current-UTC-day token totals for a raw client key.
func (s *Store) KeyTokens(apiKey string) (total, today int64) {
	id := KeyID(apiKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	total = s.keyTotal[id]
	if entry := s.keyDaily[id]; entry.Day == s.now().UTC().Format(time.DateOnly) {
		today = entry.Tokens
	}
	return total, today
}

// ResetKey clears the lifetime and daily totals of a raw client key.
func (s *Store) ResetKey(apiKey string) {
	id := KeyID(apiKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.keyTotal, id)
	delete(s.keyDaily, id)
	s.dirty = true
}

// Filter narrows a query; empty fields match everything.
type Filter struct {
	From, To                      time.Time
	Key, Provider, Account, Model string
}

// Row is one aggregated group.
type Row struct {
	ID       string `json:"id"`
	Provider string `json:"provider,omitempty"`
	Counters
}

// Point is one time-series sample.
type Point struct {
	T int64 `json:"t"`
	Counters
}

// Report aggregates buckets matching a filter.
type Report struct {
	Totals    Counters `json:"totals"`
	Series    []Point  `json:"series"`
	Step      int64    `json:"step"`
	Providers []Row    `json:"providers"`
	Accounts  []Row    `json:"accounts"`
	Keys      []Row    `json:"keys"`
	Models    []Row    `json:"models"`
}

// Query aggregates matching buckets; step is the series resolution in seconds.
func (s *Store) Query(f Filter, step int64) Report {
	if step <= 0 {
		step = 3600
	}
	series := map[int64]*Counters{}
	groups := map[string]map[string]*Row{"provider": {}, "account": {}, "key": {}, "model": {}}
	var totals Counters
	s.mu.Lock()
	for d, c := range s.buckets {
		t := time.Unix(d.Hour, 0)
		if (!f.From.IsZero() && t.Before(f.From)) || (!f.To.IsZero() && !t.Before(f.To)) ||
			(f.Key != "" && d.Key != f.Key) || (f.Provider != "" && d.Provider != f.Provider) ||
			(f.Account != "" && d.Account != f.Account) || (f.Model != "" && d.Model != f.Model) {
			continue
		}
		totals.add(*c)
		slot := d.Hour - d.Hour%step
		if series[slot] == nil {
			series[slot] = &Counters{}
		}
		series[slot].add(*c)
		for dim, id := range map[string]string{"provider": d.Provider, "account": d.Account, "key": d.Key, "model": d.Model} {
			row := groups[dim][id]
			if row == nil {
				row = &Row{ID: id}
				groups[dim][id] = row
			}
			if dim == "account" {
				row.Provider = d.Provider
			}
			row.add(*c)
		}
	}
	s.mu.Unlock()

	report := Report{Totals: totals, Step: step, Series: make([]Point, 0, len(series))}
	for t, c := range series {
		report.Series = append(report.Series, Point{T: t, Counters: *c})
	}
	sort.Slice(report.Series, func(i, j int) bool { return report.Series[i].T < report.Series[j].T })
	report.Providers = sortedRows(groups["provider"])
	report.Accounts = sortedRows(groups["account"])
	report.Keys = sortedRows(groups["key"])
	report.Models = sortedRows(groups["model"])
	return report
}

func sortedRows(m map[string]*Row) []Row {
	rows := make([]Row, 0, len(m))
	for _, r := range m {
		rows = append(rows, *r)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Total != rows[j].Total {
			return rows[i].Total > rows[j].Total
		}
		if rows[i].Requests != rows[j].Requests {
			return rows[i].Requests > rows[j].Requests
		}
		return rows[i].ID < rows[j].ID
	})
	return rows
}

// Flush prunes expired buckets and writes the store atomically when it changed.
func (s *Store) Flush() error {
	s.mu.Lock()
	if !s.dirty || s.path == "" {
		s.mu.Unlock()
		return nil
	}
	cutoff := s.now().Add(-Retention).Unix()
	f := fileFormat{Version: 1, Buckets: make([]bucket, 0, len(s.buckets)), KeyTotal: map[string]int64{}, KeyDaily: map[string]daily{}}
	for d, c := range s.buckets {
		if d.Hour < cutoff {
			delete(s.buckets, d)
			continue
		}
		f.Buckets = append(f.Buckets, bucket{Dims: d, Counters: *c})
	}
	for k, v := range s.keyTotal {
		f.KeyTotal[k] = v
	}
	for k, v := range s.keyDaily {
		f.KeyDaily[k] = v
	}
	s.dirty = false
	s.mu.Unlock()

	data, err := json.Marshal(f)
	if err == nil {
		tmp := s.path + ".tmp"
		if err = os.WriteFile(tmp, data, 0o600); err == nil {
			err = os.Rename(tmp, s.path)
		}
	}
	if err != nil {
		s.mu.Lock()
		s.dirty = true
		s.mu.Unlock()
	}
	return err
}

var (
	defaultOnce  sync.Once
	defaultStore *Store
)

// Init opens the process-wide store next to the config file, registers it as a
// usage plugin and starts periodic flushing. Later calls return the same store.
func Init(configFilePath string) *Store {
	defaultOnce.Do(func() {
		path := ""
		if configFilePath != "" {
			path = filepath.Join(filepath.Dir(configFilePath), "low-cp-usage.json")
		}
		defaultStore = New(path)
		coreusage.RegisterNamedPlugin("low-cp-keyusage", defaultStore)
		go func() {
			for range time.Tick(30 * time.Second) {
				if err := defaultStore.Flush(); err != nil {
					log.WithError(err).Warn("keyusage: flush failed")
				}
			}
		}()
	})
	return defaultStore
}

// Default returns the process-wide store, or nil before Init.
func Default() *Store { return defaultStore }

// SetDefault replaces the process-wide store; intended for tests.
func SetDefault(s *Store) { defaultStore = s }
