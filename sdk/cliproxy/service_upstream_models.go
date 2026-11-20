package cliproxy

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/upstreammodels"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	log "github.com/sirupsen/logrus"
)

const upstreamModelsDiscoveryTimeout = 30 * time.Second

// upstreamModelIDs fetches the provider's own model list for an API-key auth.
func upstreamModelIDs(ctx context.Context, family string, auth *coreauth.Auth) ([]string, error) {
	if auth == nil || auth.Attributes == nil || strings.TrimSpace(auth.Attributes["api_key"]) == "" {
		return nil, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	requestCtx, cancel := context.WithTimeout(ctx, upstreamModelsDiscoveryTimeout)
	defer cancel()
	req, err := upstreammodels.BuildRequest(requestCtx, upstreammodels.Request{
		Family:  family,
		BaseURL: auth.Attributes["base_url"],
		APIKey:  auth.Attributes["api_key"],
		Headers: upstreamModelHeaders(auth.Attributes),
	})
	if err != nil {
		return nil, err
	}
	return upstreammodels.Fetch(http.DefaultClient, req)
}

func upstreamModelHeaders(attrs map[string]string) map[string]string {
	headers := make(map[string]string)
	for key, value := range attrs {
		if name := strings.TrimSpace(strings.TrimPrefix(key, "header:")); name != key && name != "" {
			headers[name] = value
		}
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

func (s *Service) upstreamModelsOrFallback(ctx context.Context, family string, auth *coreauth.Auth, fallback []*ModelInfo, ownedBy, modelType, metadataChannel string) []*ModelInfo {
	ids, err := upstreamModelIDs(ctx, family, auth)
	if err != nil || len(ids) == 0 {
		if err != nil {
			log.WithError(err).Warnf("model discovery failed for %s; keeping the existing catalog", family)
		}
		return fallback
	}
	return buildDiscoveredModels(ids, ownedBy, modelType, metadataChannel)
}

func (s *Service) upstreamOpenAICompatibilityModels(ctx context.Context, auth *coreauth.Auth, name string) []*ModelInfo {
	ids, err := upstreamModelIDs(ctx, "openai-compatibility", auth)
	if err != nil || len(ids) == 0 {
		if err != nil {
			log.WithError(err).Warnf("model discovery failed for OpenAI-compatible provider %s", name)
		}
		return nil
	}
	return buildOpenAICompatibilityConfigModels(&config.OpenAICompatibility{Name: name, Models: discoveredModelEntries(ids)})
}

func buildDiscoveredModels(ids []string, ownedBy, modelType, metadataChannel string) []*ModelInfo {
	return buildConfigModels(discoveredModelEntries(ids), ownedBy, modelType, metadataChannel)
}

func discoveredModelEntries(ids []string) []config.OpenAICompatibilityModel {
	entries := make([]config.OpenAICompatibilityModel, 0, len(ids))
	for _, id := range ids {
		entries = append(entries, config.OpenAICompatibilityModel{Name: id})
	}
	return entries
}
