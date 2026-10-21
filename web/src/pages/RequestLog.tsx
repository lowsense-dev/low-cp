import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Pause, Play, ScrollText, Search } from "lucide-react";
import { get, type RequestEntry } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useConfig, useCredentials } from "../lib/queries";
import { providerColor, providerName } from "../lib/providers";
import { cn, maskSecret } from "../lib/util";
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Input, Skeleton, Switch } from "../components/ui";
import { formatCompact as formatCompactNum } from "../components/StackedBars";

function statusTone(status: number) {
  if (status >= 500) return "err" as const;
  if (status >= 400) return "warn" as const;
  return "ok" as const;
}

function formatDuration(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`;
}

/** Pretty-print JSON error bodies; leave plain text alone. */
function prettyError(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function RequestLog() {
  const { t, lang } = useI18n();
  const [live, setLive] = useState(true);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data: credentials } = useCredentials();
  const { data: config } = useConfig();

  const query = useQuery({
    queryKey: ["requests", onlyErrors, search],
    queryFn: async () => (await get<{ entries: RequestEntry[] }>(`/lowcp/requests?limit=500${onlyErrors ? "&errors=1" : ""}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`)).entries,
    refetchInterval: live ? 3000 : false,
    placeholderData: (prev) => prev,
  });

  const accountLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const c of credentials ?? []) if (c.auth_index) labels[c.auth_index] = c.email || c.label || c.name;
    for (const [family, groups] of Object.entries(config?.["api-keys"] ?? {})) for (const g of groups ?? []) for (const k of g.keys ?? []) if (k.auth_index) labels[k.auth_index] = g.name || family;
    return labels;
  }, [credentials, config]);

  const keyNames = config?.access?.["key-policies"] ?? {};
  const rows = query.data ?? [];
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("logs.filter")} className="pl-9" aria-label={t("logs.filter")} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch checked={onlyErrors} onChange={setOnlyErrors} label={t("logs.onlyErrors")} />
          {t("logs.onlyErrors")}
        </label>
        <Button className="ml-auto" icon={live ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => setLive(!live)}>
          {live ? t("logs.live") : t("logs.paused")}
        </Button>
      </div>

      {query.error ? (
        <ErrorBox error={query.error} />
      ) : query.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon={<ScrollText className="size-5" />} title={t("logs.noRequests")} hint={t("logs.memoryNote")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="w-6 py-2.5 pl-3" />
                  <th className="py-2.5 pr-3 font-medium">{t("logs.col.time")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("logs.col.ip")}</th>
                  <th className="hidden py-2.5 pr-3 font-medium xl:table-cell">{t("logs.col.key")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("logs.col.provider")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("logs.col.model")}</th>
                  <th className="py-2.5 pr-3 text-right font-medium">{t("logs.col.tokens")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("logs.col.status")}</th>
                  <th className="py-2.5 pr-4 text-right font-medium">{t("logs.col.duration")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const failed = r.status >= 400;
                  const expanded = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => failed && setOpen(expanded ? null : r.id)}
                        className={cn("border-b border-line last:border-0", failed ? "cursor-pointer hover:bg-surface-2/60" : "", expanded && "bg-surface-2/60")}
                        aria-expanded={failed ? expanded : undefined}
                      >
                        <td className="py-2 pl-3 text-faint">{failed && <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />}</td>
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap text-muted" title={new Date(r.time).toLocaleString(lang)}>
                          {time(r.time)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{r.ip}</td>
                        <td className="hidden max-w-40 truncate py-2 pr-3 text-xs text-muted xl:table-cell" title={r.key ? maskSecret(r.key) : undefined}>
                          {r.key ? keyNames[r.key]?.name || <span className="font-mono">{maskSecret(r.key)}</span> : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {r.provider ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={r.account ? accountLabels[r.account] ?? r.account : undefined}>
                              <span className="size-2 rounded-full" style={{ background: providerColor(r.provider) }} />
                              {providerName(r.provider)}
                              {r.attempts > 1 && <span className="text-xs text-faint">×{r.attempts}</span>}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="max-w-56 truncate py-2 pr-3 font-mono text-xs" title={r.model}>
                          {r.model || <span className="text-faint">—</span>}
                        </td>
                        <td className="py-2 pr-3 text-right text-xs whitespace-nowrap tabular-nums">
                          {r.total_tokens ? (
                            <span title={r.cached_tokens ? `${t("stats.cached")}: ${r.cached_tokens.toLocaleString(lang)}` : undefined}>
                              {r.input_tokens.toLocaleString(lang)}
                              {!!r.cached_tokens && <span className="text-faint"> ({formatCompactNum(r.cached_tokens, lang)} {t("stats.cached").toLowerCase()})</span>} <span className="text-faint">→</span> {r.output_tokens.toLocaleString(lang)}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={statusTone(r.status)} className="font-mono">
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-right text-xs whitespace-nowrap text-muted tabular-nums">{formatDuration(r.duration_ms)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-line bg-surface-2/40">
                          <td />
                          <td colSpan={8} className="py-3 pr-4">
                            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                              <span>
                                {t("logs.errorText")} · <span className="font-mono">{r.method} {r.path}</span>
                                {r.attempts > 1 && ` · ${t("logs.attempts", { n: r.attempts })}`}
                                {r.account && ` · ${accountLabels[r.account] ?? r.account}`}
                              </span>
                              {r.error && <CopyButton value={r.error} />}
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-surface p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-err">{r.error ? prettyError(r.error) : "—"}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {rows.length > 0 && <p className="mt-2 text-xs text-faint">{t("logs.memoryNote")}</p>}
    </>
  );
}
