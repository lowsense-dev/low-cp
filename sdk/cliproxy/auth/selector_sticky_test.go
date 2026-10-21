package auth

import (
	"context"
	"net/http"
	"testing"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestStickySelectorPick_StaysUntilCredentialDrops(t *testing.T) {
	t.Parallel()

	selector := &StickySelector{}
	a, b, c := &Auth{ID: "a"}, &Auth{ID: "b"}, &Auth{ID: "c"}
	pick := func(auths ...*Auth) string {
		t.Helper()
		got, err := selector.Pick(context.Background(), "codex", "gpt", cliproxyexecutor.Options{}, auths)
		if err != nil {
			t.Fatalf("Pick() error = %v", err)
		}
		return got.ID
	}

	for i := 0; i < 3; i++ {
		if got := pick(a, b, c); got != "a" {
			t.Fatalf("pick %d = %q, want sticky %q", i, got, "a")
		}
	}
	// "a" failed and was excluded: move to its successor.
	if got := pick(b, c); got != "b" {
		t.Fatalf("after drop = %q, want %q", got, "b")
	}
	// "a" is back, but the selector must not return to it while "b" works.
	if got := pick(a, b, c); got != "b" {
		t.Fatalf("after recovery = %q, want to stay on %q", got, "b")
	}
	// Last credential drops: wrap around to the start.
	if got := pick(a); got != "a" {
		t.Fatalf("wrap = %q, want %q", got, "a")
	}
}

type statusOnlyError int

func (e statusOnlyError) Error() string   { return http.StatusText(int(e)) }
func (e statusOnlyError) StatusCode() int { return int(e) }

func TestNoRotateStatuses(t *testing.T) {
	sticky := func(statuses []int) internalconfig.RoutingConfig {
		return internalconfig.RoutingConfig{Strategy: "while-no-limit", NoRotateStatuses: statuses}
	}
	setNoRotateStatuses(sticky(nil))
	t.Cleanup(func() { setNoRotateStatuses(internalconfig.RoutingConfig{}) })

	for _, status := range []int{400, 404, 413, 422} {
		if !isRequestInvalidError(statusOnlyError(status)) {
			t.Fatalf("status %d should not rotate by default", status)
		}
	}
	for _, status := range []int{401, 429, 500, 502, 503} {
		if isRequestInvalidError(statusOnlyError(status)) {
			t.Fatalf("status %d should rotate by default", status)
		}
	}

	setNoRotateStatuses(sticky([]int{503}))
	if !isRequestInvalidError(statusOnlyError(503)) {
		t.Fatalf("configured 503 should not rotate")
	}
	if isRequestInvalidError(statusOnlyError(404)) {
		t.Fatalf("404 should rotate once removed from the list")
	}

	// Other strategies keep the upstream classification.
	setNoRotateStatuses(internalconfig.RoutingConfig{Strategy: "round-robin", NoRotateStatuses: []int{503}})
	if isRequestInvalidError(statusOnlyError(503)) {
		t.Fatalf("round-robin must ignore no-rotate-statuses")
	}
}
