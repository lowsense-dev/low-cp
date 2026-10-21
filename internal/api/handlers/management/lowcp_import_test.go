package management

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func fakeJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"none"}`)) + "." + enc(payload) + ".sig"
}

func convertOne(t *testing.T, provider, raw string) (importedCredential, map[string]any) {
	t.Helper()
	docs, err := splitCredentialDocuments(raw)
	if err != nil || len(docs) != 1 {
		t.Fatalf("split: %v (%d docs)", err, len(docs))
	}
	cred, data, err := convertCredentialDocument(provider, docs[0], time.Unix(1700000000, 0))
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	var meta map[string]any
	if err := json.Unmarshal(data, &meta); err != nil {
		t.Fatal(err)
	}
	return cred, meta
}

func TestImportCodexCLI(t *testing.T) {
	idToken := fakeJWT(t, map[string]any{
		"email":                       "a@b.c",
		"https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "acc-1", "chatgpt_plan_type": "plus"},
	})
	access := fakeJWT(t, map[string]any{"exp": 1800000000})
	raw := `{"OPENAI_API_KEY":null,"tokens":{"id_token":"` + idToken + `","access_token":"` + access + `","refresh_token":"rt","account_id":"acc-1"},"last_refresh":"2026-01-01T00:00:00Z"}`

	cred, meta := convertOne(t, "auto", raw)
	if cred.Provider != "codex" || meta["email"] != "a@b.c" || meta["refresh_token"] != "rt" || meta["plan_type"] != "plus" {
		t.Fatalf("unexpected codex meta: %+v", meta)
	}
	if meta["expired"] != time.Unix(1800000000, 0).UTC().Format(time.RFC3339) {
		t.Fatalf("expired = %v", meta["expired"])
	}
	if !strings.HasPrefix(cred.Name, "codex-") || !strings.HasSuffix(cred.Name, "-a@b.c-plus.json") {
		t.Fatalf("name = %q", cred.Name)
	}
}

func TestImportClaudeCode(t *testing.T) {
	raw := `{"claudeAiOauth":{"accessToken":"at","refreshToken":"rt","expiresAt":1800000000000,"scopes":["user:inference"]}}`
	cred, meta := convertOne(t, "auto", raw)
	if cred.Provider != "claude" || meta["access_token"] != "at" || meta["refresh_token"] != "rt" {
		t.Fatalf("unexpected claude meta: %+v", meta)
	}
	if meta["expired"] != time.UnixMilli(1800000000000).UTC().Format(time.RFC3339) {
		t.Fatalf("expired = %v", meta["expired"])
	}
	if !strings.HasPrefix(cred.Name, "claude-imported-") {
		t.Fatalf("name = %q", cred.Name)
	}
}

func TestImportAntigravity(t *testing.T) {
	cred, meta := convertOne(t, "auto", `{"email":"g@x.y","token":{"refresh_token":"1//abc","project_id":"p1"}}`)
	if cred.Provider != "antigravity" || cred.Name != "antigravity-g@x.y.json" || meta["project_id"] != "p1" {
		t.Fatalf("unexpected antigravity: %+v %+v", cred, meta)
	}
	// Non-Google-looking token needs an explicit provider.
	docs, _ := splitCredentialDocuments(`{"refresh_token":"opaque"}`)
	if _, _, err := convertCredentialDocument("auto", docs[0], time.Now()); err == nil {
		t.Fatalf("auto should reject unknown format")
	}
	if _, _, err := convertCredentialDocument("antigravity", docs[0], time.Now()); err != nil {
		t.Fatalf("explicit antigravity: %v", err)
	}
}

func TestImportPassthroughAndArray(t *testing.T) {
	docs, err := splitCredentialDocuments(`[{"type":"codex","email":"x@y.z","refresh_token":"r"},{"type":"claude","refresh_token":"r2"}]`)
	if err != nil || len(docs) != 2 {
		t.Fatalf("split array: %v", err)
	}
	cred, _, err := convertCredentialDocument("auto", docs[0], time.Now())
	if err != nil || cred.Name != "codex-x@y.z.json" {
		t.Fatalf("passthrough: %v %q", err, cred.Name)
	}
	cred, _, err = convertCredentialDocument("auto", docs[1], time.Now())
	if err != nil || !strings.HasPrefix(cred.Name, "claude-imported-") {
		t.Fatalf("passthrough no email: %v %q", err, cred.Name)
	}
	// A provider filter that disagrees with the document type is rejected.
	if _, _, err := convertCredentialDocument("claude", docs[0], time.Now()); err == nil {
		t.Fatalf("mismatched provider should fail")
	}
}
