package management

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/auth/antigravity"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/auth/codex"
)

// importCredentialsRequest carries raw credential documents pasted or read from files.
// Each item may hold one JSON object or an array of objects.
type importCredentialsRequest struct {
	Provider string   `json:"provider"`
	Items    []string `json:"items"`
}

type importedCredential struct {
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Email    string `json:"email,omitempty"`
}

type importFailure struct {
	Index int    `json:"index"`
	Error string `json:"error"`
}

// ImportCredentials converts native CLI credential files (Codex auth.json, Claude
// .credentials.json, Antigravity token exports) or CPA auth files into CPA auth files.
func (h *Handler) ImportCredentials(c *gin.Context) {
	if h.authManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "core auth manager unavailable"})
		return
	}
	var req importCredentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: " + err.Error()})
		return
	}
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	switch provider {
	case "", "auto", "codex", "claude", "antigravity":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider must be auto, codex, claude or antigravity"})
		return
	}

	imported := make([]importedCredential, 0)
	failed := make([]importFailure, 0)
	for i, item := range req.Items {
		docs, err := splitCredentialDocuments(item)
		if err != nil {
			failed = append(failed, importFailure{Index: i, Error: err.Error()})
			continue
		}
		for _, doc := range docs {
			cred, data, errConvert := convertCredentialDocument(provider, doc, time.Now())
			if errConvert == nil {
				errConvert = h.writeAuthFile(c.Request.Context(), cred.Name, data)
			}
			if errConvert != nil {
				failed = append(failed, importFailure{Index: i, Error: errConvert.Error()})
				continue
			}
			imported = append(imported, cred)
		}
	}
	status := http.StatusOK
	if len(failed) > 0 {
		status = http.StatusMultiStatus
	}
	c.JSON(status, gin.H{"imported": imported, "failed": failed})
}

func splitCredentialDocuments(raw string) ([]map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty document")
	}
	if strings.HasPrefix(raw, "[") {
		var docs []map[string]any
		if err := json.Unmarshal([]byte(raw), &docs); err != nil {
			return nil, fmt.Errorf("invalid JSON array: %w", err)
		}
		return docs, nil
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return []map[string]any{doc}, nil
}

// convertCredentialDocument returns the CPA file name and content for one document.
func convertCredentialDocument(provider string, doc map[string]any, now time.Time) (importedCredential, []byte, error) {
	if doc == nil {
		return importedCredential{}, nil, fmt.Errorf("document is not an object")
	}
	var (
		meta map[string]any
		name string
		err  error
	)
	switch {
	case stringField(doc, "type") != "" && (provider == "" || provider == "auto" || provider == stringField(doc, "type")):
		meta, name = doc, cpaFileName(doc)
	case objectField(doc, "tokens") != nil && (provider == "" || provider == "auto" || provider == "codex"):
		meta, name, err = convertCodexCLI(objectField(doc, "tokens"), doc, now)
	case objectField(doc, "claudeAiOauth") != nil && (provider == "" || provider == "auto" || provider == "claude"):
		meta, name, err = convertClaudeCode(objectField(doc, "claudeAiOauth"), now)
	case provider == "antigravity" || ((provider == "" || provider == "auto") && looksLikeGoogleToken(doc)):
		meta, name, err = convertAntigravity(doc)
	default:
		return importedCredential{}, nil, fmt.Errorf("unrecognized credential format")
	}
	if err != nil {
		return importedCredential{}, nil, err
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return importedCredential{}, nil, err
	}
	return importedCredential{Name: name, Provider: stringField(meta, "type"), Email: stringField(meta, "email")}, data, nil
}

// convertCodexCLI maps ~/.codex/auth.json ({"tokens":{...},"last_refresh":...}).
func convertCodexCLI(tokens, doc map[string]any, now time.Time) (map[string]any, string, error) {
	refresh := stringField(tokens, "refresh_token")
	if refresh == "" {
		return nil, "", fmt.Errorf("codex: tokens.refresh_token is missing")
	}
	meta := map[string]any{
		"type":          "codex",
		"id_token":      stringField(tokens, "id_token"),
		"access_token":  stringField(tokens, "access_token"),
		"refresh_token": refresh,
		"account_id":    stringField(tokens, "account_id"),
		"last_refresh":  firstNonEmpty(stringField(doc, "last_refresh"), now.Format(time.RFC3339)),
	}
	email, plan, hashAccountID := "", "", ""
	if claims, errParse := codex.ParseJWTToken(stringField(tokens, "id_token")); errParse == nil && claims != nil {
		email = claims.GetUserEmail()
		plan = strings.TrimSpace(claims.CodexAuthInfo.ChatgptPlanType)
		if accountID := claims.GetAccountID(); accountID != "" {
			hashAccountID = shortHash(accountID)
			if meta["account_id"] == "" {
				meta["account_id"] = accountID
			}
		}
	}
	if claims, errParse := codex.ParseJWTToken(stringField(tokens, "access_token")); errParse == nil && claims != nil && claims.Exp > 0 {
		meta["expired"] = time.Unix(int64(claims.Exp), 0).UTC().Format(time.RFC3339)
	}
	if plan == "" {
		plan = codex.DefaultPlanType
	}
	meta["plan_type"] = plan
	if email == "" {
		email = "imported-" + shortHash(refresh)
	} else {
		meta["email"] = email
	}
	return meta, codex.CredentialFileName(email, plan, hashAccountID, true), nil
}

// convertClaudeCode maps ~/.claude/.credentials.json ({"claudeAiOauth":{...}}).
func convertClaudeCode(oauth map[string]any, now time.Time) (map[string]any, string, error) {
	refresh := stringField(oauth, "refreshToken")
	if refresh == "" {
		return nil, "", fmt.Errorf("claude: claudeAiOauth.refreshToken is missing")
	}
	meta := map[string]any{
		"type":          "claude",
		"access_token":  stringField(oauth, "accessToken"),
		"refresh_token": refresh,
		"last_refresh":  now.Format(time.RFC3339),
	}
	if expiresAt, ok := oauth["expiresAt"].(float64); ok && expiresAt > 0 {
		meta["expired"] = time.UnixMilli(int64(expiresAt)).UTC().Format(time.RFC3339)
	}
	// The Claude Code file carries no email; the hash keeps distinct accounts apart.
	return meta, "claude-imported-" + shortHash(refresh) + ".json", nil
}

// convertAntigravity maps a Google OAuth token export. Antigravity Manager style
// {"email":..., "token":{...}} is flattened first. A refresh token alone is enough:
// the executor refreshes the access token and resolves project_id on first use.
func convertAntigravity(doc map[string]any) (map[string]any, string, error) {
	src := doc
	if nested := objectField(doc, "token"); nested != nil {
		src = nested
	}
	refresh := firstNonEmpty(stringField(src, "refresh_token"), stringField(src, "refreshToken"))
	if refresh == "" {
		return nil, "", fmt.Errorf("antigravity: refresh_token is missing")
	}
	meta := map[string]any{
		"type":          "antigravity",
		"refresh_token": refresh,
		"access_token":  firstNonEmpty(stringField(src, "access_token"), stringField(src, "accessToken")),
		// Force a refresh on first use: the export rarely carries a reliable expiry.
		"expired": time.Unix(0, 0).UTC().Format(time.RFC3339),
	}
	email := firstNonEmpty(stringField(doc, "email"), stringField(src, "email"))
	if email != "" {
		meta["email"] = email
	}
	if projectID := firstNonEmpty(stringField(src, "project_id"), stringField(doc, "project_id")); projectID != "" {
		meta["project_id"] = projectID
	}
	if email == "" {
		return meta, "antigravity-imported-" + shortHash(refresh) + ".json", nil
	}
	return meta, antigravity.CredentialFileName(email), nil
}

var unsafeFileNameChars = regexp.MustCompile(`[^A-Za-z0-9@._+-]+`)

// cpaFileName names an already-converted CPA auth file by its type and identity.
func cpaFileName(doc map[string]any) string {
	identity := stringField(doc, "email")
	if identity == "" {
		identity = "imported-" + shortHash(firstNonEmpty(stringField(doc, "refresh_token"), stringField(doc, "access_token"), stringField(doc, "api_key")))
	}
	return unsafeFileNameChars.ReplaceAllString(stringField(doc, "type")+"-"+identity, "_") + ".json"
}

func looksLikeGoogleToken(doc map[string]any) bool {
	if nested := objectField(doc, "token"); nested != nil {
		doc = nested
	}
	refresh := firstNonEmpty(stringField(doc, "refresh_token"), stringField(doc, "refreshToken"))
	return strings.HasPrefix(refresh, "1//")
}

func stringField(doc map[string]any, key string) string {
	value, _ := doc[key].(string)
	return strings.TrimSpace(value)
}

func objectField(doc map[string]any, key string) map[string]any {
	value, _ := doc[key].(map[string]any)
	return value
}

func shortHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])[:8]
}
