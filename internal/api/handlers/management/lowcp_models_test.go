package management

import (
	"context"
	"reflect"
	"testing"
)

func TestParseUpstreamModels(t *testing.T) {
	cases := map[string][]string{
		`{"object":"list","data":[{"id":"gpt-5"},{"id":"o3"},{"id":"gpt-5"}]}`:             {"gpt-5", "o3"},
		`{"data":[{"id":"claude-opus-4","type":"model"}],"has_more":false}`:                {"claude-opus-4"},
		`{"models":[{"name":"models/gemini-2.5-pro"},{"name":"models/gemini-2.5-flash"}]}`: {"gemini-2.5-flash", "gemini-2.5-pro"},
		`[{"id":"a"},{"id":"b"}]`: {"a", "b"},
	}
	for raw, want := range cases {
		if got := parseUpstreamModels([]byte(raw)); !reflect.DeepEqual(got, want) {
			t.Errorf("parse(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestBuildUpstreamModelsRequest(t *testing.T) {
	req, err := buildUpstreamModelsRequest(context.Background(), upstreamModelsRequest{Family: "codex", BaseURL: "https://dashscope.example/v1/", APIKey: "k", Headers: map[string]string{"X-A": "1", "X-Copy": "$Y"}})
	if err != nil || req.URL.String() != "https://dashscope.example/v1/models" || req.Header.Get("Authorization") != "Bearer k" || req.Header.Get("X-A") != "1" || req.Header.Get("X-Copy") != "" {
		t.Fatalf("codex: %v %v %v", err, req.URL, req.Header)
	}
	req, _ = buildUpstreamModelsRequest(context.Background(), upstreamModelsRequest{Family: "claude", APIKey: "k"})
	if req.URL.String() != "https://api.anthropic.com/v1/models?limit=1000" || req.Header.Get("x-api-key") != "k" {
		t.Fatalf("claude: %v", req.URL)
	}
	if _, err := buildUpstreamModelsRequest(context.Background(), upstreamModelsRequest{Family: "openai-compatibility", BaseURL: "file:///etc", APIKey: "k"}); err == nil {
		t.Fatalf("non-http base_url must be rejected")
	}
}

func TestGroupForAuth(t *testing.T) {
	if g := groupForAuth("codex", "bt", map[string]string{"api_key": "x", "base_url": "https://inference.baseten.co/v1"}); g.Label != "bt" || g.Kind != "apikey" {
		t.Fatalf("prefixed api-key group = %+v", g)
	}
	if g := groupForAuth("codex", "", map[string]string{"api_key": "x", "base_url": "https://api.example.com/v1"}); g.Label != "api.example.com" {
		t.Fatalf("unprefixed api-key group = %+v", g)
	}
	if g := groupForAuth("openai-compatibility", "xai", map[string]string{"api_key": "x", "compat_name": "xai"}); g.Label != "xai" || g.Compat != "xai" {
		t.Fatalf("compat group = %+v", g)
	}
	if g := groupForAuth("codex", "", map[string]string{}); g.Kind != "oauth" || g.ID != "oauth:codex" {
		t.Fatalf("oauth group = %+v", g)
	}
}
