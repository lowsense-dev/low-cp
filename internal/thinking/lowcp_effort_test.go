package thinking_test

import (
	"testing"

	"github.com/MoeForge/moego/ojson"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/thinking"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/codex"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/openai"
)

func TestEffortPassthrough(t *testing.T) {
	for _, tc := range []struct {
		name, model, format, body, path, want string
		updates                               bool
	}{
		{"chat xhigh", "model", "openai", `{"reasoning_effort":"xhigh"}`, "reasoning_effort", "xhigh", false},
		{"chat unknown", "model", "openai", `{"reasoning_effort":"future-level"}`, "reasoning_effort", "future-level", false},
		{"chat none", "model", "openai", `{"reasoning_effort":"none"}`, "reasoning_effort", "none", false},
		{"chat auto", "model", "openai", `{"reasoning_effort":"auto"}`, "reasoning_effort", "auto", false},
		{"suffix ultra", "model(ultra)", "openai", `{}`, "reasoning_effort", "ultra", false},
		{"responses xhigh", "model", "codex", `{"reasoning":{"effort":"xhigh"}}`, "reasoning.effort", "xhigh", true},
		{"responses update", "model", "codex", `{"input":[{"type":"configuration_update","reasoning":{"effort":"xhigh"}}]}`, "input.0.reasoning.effort", "xhigh", true},
		{"responses none", "model", "codex", `{"reasoning":{"effort":"none"}}`, "reasoning.effort", "none", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := &registry.ModelInfo{ID: "model", Type: tc.format, Thinking: &registry.ThinkingSupport{Levels: []string{"low", "medium", "high"}}, SupportConfigurationUpdate: tc.updates}
			out, err := thinking.ApplyThinkingWithModelInfo([]byte(tc.body), []byte(tc.body), tc.model, tc.format, tc.format, tc.format, info)
			if err != nil || ojson.GetBytes(out, tc.path).String() != tc.want {
				t.Fatalf("output=%s, error=%v; want %s=%s", out, err, tc.path, tc.want)
			}
			if info.UserDefined {
				t.Fatal("request must not change shared model metadata")
			}
		})
	}
}
