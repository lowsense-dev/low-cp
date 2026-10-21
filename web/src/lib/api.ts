// Thin client for the v8 management API. The management key lives in localStorage.

const KEY_STORAGE = "lowcp.key";
const BASE = "/v8/management";

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable: the key only lives for this tab */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; key?: string } = {}): Promise<T> {
  const { json, key, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${key ?? getKey()}`);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(BASE + path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* plain-text body */
  }
  if (res.status === 401 && key === undefined) onUnauthorized();
  if (!res.ok && res.status !== 207) {
    const msg = (body as { message?: string; error?: string })?.message ?? (body as { error?: string })?.error ?? (typeof body === "string" && body) ?? res.statusText;
    throw new ApiError(res.status, String(msg || `HTTP ${res.status}`), body);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json });
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: "DELETE", json });

// ---- Types (only the fields the panel reads) ----

export type RecentBucket = { time: string; success: number; failed: number };

export type Credential = {
  id: string;
  auth_index?: string;
  name: string;
  type?: string;
  provider: string;
  label?: string;
  email?: string;
  account?: string;
  account_type?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
  runtime_only?: boolean;
  priority?: number | null;
  prefix?: string | null;
  note?: string | null;
  last_refresh?: string | null;
  next_retry_after?: string | null;
  updated_at?: string;
  modtime?: string;
  success?: number;
  failed?: number;
  recent_requests?: RecentBucket[];
  cooldowns?: { model?: string; until?: string; reason?: string }[];
  project_id?: string;
};

export type KeyEntry = { "api-key": string; weight?: number; "proxy-url"?: string; auth_index?: string; [k: string]: unknown };
export type ModelEntry = { name: string; alias?: string; [k: string]: unknown };
export type ProviderGroup = {
  name?: string;
  prefix?: string;
  "base-url"?: string;
  "proxy-url"?: string;
  disabled?: boolean;
  priority?: number;
  headers?: Record<string, string>;
  models?: ModelEntry[];
  "excluded-models"?: string[];
  keys?: KeyEntry[];
  [k: string]: unknown;
};

export type Config = {
  server?: { host?: string; port?: number; "trusted-proxies"?: string[] };
  access?: { "api-keys"?: string[]; "key-policies"?: Record<string, KeyPolicy> };
  "api-keys"?: Record<string, ProviderGroup[]>;
  routing?: {
    strategy?: string;
    "no-rotate-statuses"?: number[];
    "disabled-models"?: string[];
    "session-affinity"?: boolean;
    "force-model-prefix"?: boolean;
    retry?: { "request-retry"?: number; "max-retry-credentials"?: number; "max-retry-interval"?: number };
    cooldown?: { "disable-cooling"?: boolean };
  };
  requests?: { "proxy-url"?: string };
  oauth?: { "provider-prefixes"?: Record<string, string>; [k: string]: unknown };
  observability?: { logs?: { debug?: boolean; "logging-to-file"?: boolean; [k: string]: unknown } };
  [k: string]: unknown;
};

export type DomainState = {
  domain: string;
  caddyfile: string;
  snippet: string;
  upstream: string;
  caddy_installed: boolean;
  import_present: boolean;
  snippet_writable: boolean;
  trusted_proxies_ok: boolean;
  setup_commands: string[];
};

export type ImportResult = {
  imported: { name: string; provider: string; email?: string }[];
  failed: { index: number; error: string }[];
};

export type QuotaWindow = { label: string; used_percent: number; resets_at?: string };
export type QuotaReport = { provider: string; plan?: string; windows: QuotaWindow[] };
export type AvailableModel = { id: string; owned_by?: string; disabled?: boolean };

export type KeyPolicy = { name?: string; models?: string[]; "total-tokens"?: number; "daily-tokens"?: number; "expires-at"?: string };
export type KeyUsage = Record<string, { total: number; today: number }>;

export type Counters = { requests: number; failed: number; input_tokens: number; output_tokens: number; cached_tokens: number; reasoning_tokens: number; total_tokens: number; billable_tokens?: number };
export type StatsRow = Counters & { id: string; provider?: string };
export type StatsReport = { totals: Counters; series: (Counters & { t: number })[]; step: number; providers: StatsRow[]; accounts: StatsRow[]; keys: StatsRow[]; models: StatsRow[] };
export type StatsResponse = { from: number; report: StatsReport; key_labels: Record<string, string> };

export type RequestEntry = {
  id: string;
  time: string;
  ip: string;
  key?: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  model?: string;
  provider?: string;
  account?: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  total_tokens: number;
  attempts: number;
  stream?: boolean;
  error?: string;
};
