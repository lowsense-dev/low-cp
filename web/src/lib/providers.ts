import type { TKey } from "./i18n";

/** OAuth providers the server can log into (GET /oauth/auth-url?provider=…). */
export const OAUTH_PROVIDERS: { id: string; name: string; hint: string }[] = [
  { id: "codex", name: "Codex", hint: "ChatGPT Plus / Pro / Team" },
  { id: "claude", name: "Claude", hint: "Claude Pro / Max" },
  { id: "antigravity", name: "Antigravity", hint: "Google · Gemini & Claude" },
  { id: "xai", name: "xAI", hint: "Grok" },
  { id: "kimi", name: "Kimi", hint: "Moonshot" },
  { id: "kimi-ai", name: "Kimi AI", hint: "kimi.ai" },
  { id: "devin", name: "Devin", hint: "Cognition" },
  { id: "meta", name: "Meta", hint: "Meta AI" },
];

/** Suggested model prefix per OAuth provider (oauth.provider-prefixes). */
export const DEFAULT_PROVIDER_PREFIXES: Record<string, string> = {
  codex: "cx",
  claude: "cc",
  antigravity: "agy",
  xai: "grok",
  kimi: "kimi",
  "kimi-ai": "kimiai",
  devin: "devin",
  meta: "meta",
};

/** Colour per provider, used for the small avatar dot. */
const PROVIDER_COLORS: Record<string, string> = {
  codex: "#10a37f",
  openai: "#10a37f",
  "openai-compatibility": "#10a37f",
  claude: "#d97757",
  antigravity: "#4285f4",
  gemini: "#4285f4",
  vertex: "#34a853",
  interactions: "#4285f4",
  xai: "#8b8b93",
  kimi: "#6e56cf",
  "kimi-ai": "#6e56cf",
  devin: "#2f9e8f",
  meta: "#0866ff",
};

export function providerColor(id: string) {
  if (id.startsWith("openai-compatible-")) return PROVIDER_COLORS["openai-compatibility"];
  return PROVIDER_COLORS[id] ?? "#8b8b93";
}

export function providerName(id: string) {
  // API-key OpenAI-compatible providers report as "openai-compatible-<group name>".
  if (id.startsWith("openai-compatible-")) return id.slice("openai-compatible-".length);
  return OAUTH_PROVIDERS.find((p) => p.id === id)?.name ?? FAMILIES.find((f) => f.id === id)?.title ?? id;
}

/**
 * API-key families of the v8 config (api-keys.<family>). Each family speaks one
 * upstream wire format; a "custom provider" is a group inside a family.
 */
export type Family = { id: string; title: string; format: TKey | null; endpoint: string; defaultBase: string; needsModels: boolean };

export const FAMILIES: Family[] = [
  { id: "openai-compatibility", title: "OpenAI-compatible", format: "providers.format.openai", endpoint: "/v1/chat/completions", defaultBase: "https://api.example.com/v1", needsModels: true },
  { id: "codex", title: "OpenAI Responses", format: "providers.format.responses", endpoint: "/v1/responses", defaultBase: "https://api.openai.com/v1", needsModels: false },
  { id: "claude", title: "Anthropic", format: "providers.format.claude", endpoint: "/v1/messages", defaultBase: "https://api.anthropic.com", needsModels: false },
  { id: "gemini", title: "Gemini", format: "providers.format.gemini", endpoint: "/v1beta/models/*:generateContent", defaultBase: "https://generativelanguage.googleapis.com", needsModels: false },
  { id: "vertex", title: "Vertex", format: null, endpoint: "Vertex AI", defaultBase: "", needsModels: false },
  { id: "interactions", title: "Gemini Interactions", format: null, endpoint: "/v1beta/interactions", defaultBase: "https://generativelanguage.googleapis.com", needsModels: false },
  { id: "xai", title: "xAI", format: null, endpoint: "/v1/responses", defaultBase: "https://api.x.ai/v1", needsModels: false },
  { id: "meta", title: "Meta", format: null, endpoint: "Meta API", defaultBase: "", needsModels: false },
];

/** The four families offered first in the "new provider" form. */
export const PRIMARY_FAMILIES = FAMILIES.filter((f) => f.format);

export function familyById(id: string): Family {
  return FAMILIES.find((f) => f.id === id) ?? { id, title: id, format: null, endpoint: "", defaultBase: "", needsModels: false };
}

export const STRATEGIES = ["round-robin", "weighted-round-robin", "fill-first", "while-no-limit"] as const;
export const DEFAULT_NO_ROTATE = [400, 404, 413, 422];

/** Client-facing endpoints exposed by the proxy, for the overview cheat sheet. */
export const CLIENT_ENDPOINTS = [
  { method: "POST", path: "/v1/chat/completions", note: "OpenAI Chat" },
  { method: "POST", path: "/v1/responses", note: "OpenAI Responses" },
  { method: "POST", path: "/v1/messages", note: "Anthropic Messages" },
  { method: "POST", path: "/v1beta/models/{model}:generateContent", note: "Gemini" },
  { method: "GET", path: "/v1/models", note: "Model list" },
];
