import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post, put, type AvailableModel, type Config, type Credential, type DomainState, type QuotaReport, type KeyUsage as KeyTokenUsage } from "./api";

export const qk = {
  config: ["config"] as const,
  credentials: ["credentials"] as const,
  domain: ["domain"] as const,
  usage: ["usage"] as const,
};

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: () => get<Config>("/config") });
}

export function useCredentials() {
  return useQuery({
    queryKey: qk.credentials,
    queryFn: async () => (await get<{ files: Credential[] }>("/credentials")).files ?? [],
    refetchInterval: 15_000,
  });
}

export function useDomain() {
  return useQuery({ queryKey: qk.domain, queryFn: () => get<DomainState>("/lowcp/domain") });
}

export type KeyUsage = Record<string, Record<string, { success?: number; failed?: number }>>;
export function useKeyUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => get<KeyUsage>("/observability/usage/api-keys"), refetchInterval: 30_000 });
}

/** PUT or PATCH a v8 config path, then refresh the cached config. */
export function useConfigWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, value, method = "PUT" }: { path: string; value: unknown; method?: "PUT" | "PATCH" }) =>
      method === "PUT" ? put(`/config/${path}`, value) : patch(`/config/${path}`, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.config }),
  });
}

/** PATCH the whole config tree with a partial object (deep merge on the server). */
export function useConfigPatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partial: Partial<Config>) => patch("/config", partial),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.config }),
  });
}

export function useAvailableModels(enabled = true) {
  return useQuery({ queryKey: ["models"], queryFn: async () => (await get<{ models: AvailableModel[] }>("/lowcp/models")).models ?? [], enabled });
}

export const QUOTA_PROVIDERS = ["codex", "claude", "antigravity"];
export const quotaKey = (name: string) => ["quota", name] as const;

/** Cached quota for one account; only filled by explicit checks (fetchQuota). */
export function useQuota(name: string) {
  return useQuery({ queryKey: quotaKey(name), queryFn: () => fetchQuotaRaw(name), enabled: false, staleTime: Infinity, retry: false });
}

export function fetchQuotaRaw(name: string) {
  return post<QuotaReport>("/lowcp/quota", { name });
}

export function useKeyTokenUsage() {
  return useQuery({ queryKey: ["key-usage"], queryFn: () => get<KeyTokenUsage>("/lowcp/key-usage"), refetchInterval: 30_000 });
}
