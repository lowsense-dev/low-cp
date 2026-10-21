package synthesizer

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestSynthesizeAuthFileAppliesProviderPrefix(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{OAuthProviderPrefixes: map[string]string{"codex": "cx", "claude": "/cc/"}}
	ctx := &SynthesisContext{Config: cfg, AuthDir: dir, Now: time.Now()}

	cases := []struct{ file, raw, want string }{
		{"codex-a.json", `{"type":"codex","email":"a@b.c"}`, "cx"},
		{"claude-a.json", `{"type":"claude"}`, "cc"},
		{"codex-own.json", `{"type":"codex","prefix":"mine"}`, "mine"},
		{"antigravity-a.json", `{"type":"antigravity"}`, ""},
	}
	for _, tc := range cases {
		auths := mustSynthesizeAuthFile(t, ctx, filepath.Join(dir, tc.file), tc.raw)
		if len(auths) != 1 || auths[0].Prefix != tc.want {
			t.Fatalf("%s: prefix = %q, want %q", tc.file, auths[0].Prefix, tc.want)
		}
	}
}
