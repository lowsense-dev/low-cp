import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Table2, X } from "lucide-react";
import { get, type Counters, type StatsResponse, type StatsRow } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useConfig, useCredentials } from "../lib/queries";
import { providerColor, providerName } from "../lib/providers";
import { cn, maskSecret } from "../lib/util";
import { Button, Card, ErrorBox, PageHeader, Segmented, Select, Skeleton } from "../components/ui";
import { StackedBars, formatCompact, type Datum } from "../components/StackedBars";

type Filters = { provider: string; account: string; key: string; model: string };
const NO_FILTERS: Filters = { provider: "", account: "", key: "", model: "" };

export function Stats() {
  const { t, lang } = useI18n();
  const [days, setDays] = useState("7");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [tableView, setTableView] = useState(false);
  const { data: credentials } = useCredentials();
  const { data: config } = useConfig();

  const query = useQuery({
    queryKey: ["stats", days, filters],
    queryFn: () => {
      const params = new URLSearchParams({ days, ...filters });
      for (const [k, v] of [...params]) if (!v) params.delete(k);
      return get<StatsResponse>(`/lowcp/stats?${params}`);
    },
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  // Account ids are auth_index values: OAuth credentials and API-key entries both carry one.
  const accountLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const c of credentials ?? []) if (c.auth_index) labels[c.auth_index] = c.email || c.label || c.name;
    for (const [family, groups] of Object.entries(config?.["api-keys"] ?? {}))
      for (const g of groups ?? []) for (const k of g.keys ?? []) if (k.auth_index) labels[k.auth_index] = `${g.name || family} · ${maskSecret(k["api-key"])}`;
    return labels;
  }, [credentials, config]);

  const data = query.data;
  const report = data?.report;
  const keyNames = config?.access?.["key-policies"] ?? {};
  const keyLabel = (id: string) => {
    if (id === "") return t("stats.noKey");
    const raw = data?.key_labels[id];
    if (!raw) return t("stats.unknownKey");
    return keyNames[raw]?.name || maskSecret(raw);
  };
  const rawKey = (id: string) => data?.key_labels[id] ?? "";

  const step = report?.step ?? 3600;
  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return step >= 86400 ? d.toLocaleDateString(lang, { day: "numeric", month: "short" }) : d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  };

  // Fill empty buckets so the time axis is continuous.
  const series = useMemo(() => {
    if (!data || !report) return [];
    const byT = new Map(report.series.map((p) => [p.t, p]));
    const out: (Counters & { t: number })[] = [];
    const now = Date.now() / 1000;
    for (let ts = data.from; ts <= now; ts += report.step) {
      out.push(byT.get(ts) ?? { t: ts, requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 0 });
    }
    return out;
  }, [data, report]);

  const tokenData: Datum[] = series.map((p) => ({ t: p.t, values: { input: p.input_tokens, output: p.output_tokens } }));
  const requestData: Datum[] = series.map((p) => ({ t: p.t, values: { ok: p.requests - p.failed, failed: p.failed } }));
  const totals = report?.totals;
  const active = Object.values(filters).some(Boolean);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  return (
    <>
      <PageHeader
        title={t("stats.title")}
        subtitle={t("stats.subtitle")}
        actions={
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: "1", label: t("stats.d1") },
              { value: "7", label: t("stats.d7") },
              { value: "30", label: t("stats.d30") },
            ]}
          />
        }
      />

      {/* Filters: one row above the charts */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect value={filters.provider} onChange={(v) => set({ provider: v, account: "" })} all={t("stats.allProviders")} options={(report?.providers ?? []).map((r) => ({ value: r.id, label: providerName(r.id) }))} />
        <FilterSelect value={filters.account} onChange={(v) => set({ account: v })} all={t("stats.allAccounts")} options={(report?.accounts ?? []).map((r) => ({ value: r.id, label: accountLabels[r.id] ?? r.id }))} />
        <FilterSelect value={filters.key} onChange={(v) => set({ key: v })} all={t("stats.allKeys")} options={(report?.keys ?? []).filter((r) => rawKey(r.id)).map((r) => ({ value: rawKey(r.id), label: keyLabel(r.id) }))} />
        <FilterSelect value={filters.model} onChange={(v) => set({ model: v })} all={t("stats.allModels")} options={(report?.models ?? []).map((r) => ({ value: r.id, label: r.id }))} />
        {active && (
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setFilters(NO_FILTERS)}>
            {t("stats.reset")}
          </Button>
        )}
      </div>

      {query.error ? (
        <ErrorBox error={query.error} />
      ) : !totals ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("stats.requests")} value={totals.requests.toLocaleString(lang)} sub={totals.requests ? `${((totals.failed / totals.requests) * 100).toFixed(1)}% ${t("stats.errorRate")}` : undefined} />
            <Tile label={t("stats.tokens")} value={formatCompact(totals.total_tokens, lang)} sub={totals.total_tokens.toLocaleString(lang)} />
            <Tile label={t("stats.input")} value={formatCompact(totals.input_tokens, lang)} sub={totals.cached_tokens ? `${formatCompact(totals.cached_tokens, lang)} ${t("stats.cached").toLowerCase()}` : undefined} />
            <Tile label={t("stats.output")} value={formatCompact(totals.output_tokens, lang)} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <ChartHeader title={t("stats.tokensChart")} tableView={tableView} onToggle={() => setTableView(!tableView)} />
              {tableView ? (
                <SeriesTable rows={series} formatTime={formatTime} columns={[{ label: t("stats.input"), get: (p) => p.input_tokens }, { label: t("stats.output"), get: (p) => p.output_tokens }]} lang={lang} />
              ) : (
                <StackedBars
                  data={tokenData}
                  lang={lang}
                  formatTime={formatTime}
                  emptyLabel={t("stats.empty")}
                  series={[
                    { key: "input", label: t("stats.input"), color: "var(--series-1)" },
                    { key: "output", label: t("stats.output"), color: "var(--series-2)" },
                  ]}
                />
              )}
            </Card>
            <Card className="p-5">
              <ChartHeader title={t("stats.requestsChart")} tableView={tableView} onToggle={() => setTableView(!tableView)} />
              {tableView ? (
                <SeriesTable rows={series} formatTime={formatTime} columns={[{ label: t("stats.success"), get: (p) => p.requests - p.failed }, { label: t("stats.failed"), get: (p) => p.failed }]} lang={lang} />
              ) : (
                <StackedBars
                  data={requestData}
                  lang={lang}
                  formatTime={formatTime}
                  emptyLabel={t("stats.empty")}
                  series={[
                    { key: "ok", label: t("stats.success"), color: "var(--series-1)" },
                    { key: "failed", label: t("stats.failed"), color: "var(--err)" },
                  ]}
                />
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Breakdown title={t("stats.byProvider")} rows={report!.providers} label={(r) => providerName(r.id)} dot={(r) => providerColor(r.id)} active={filters.provider} onPick={(r) => set({ provider: filters.provider === r.id ? "" : r.id, account: "" })} />
            <Breakdown title={t("stats.byAccount")} rows={report!.accounts} label={(r) => accountLabels[r.id] ?? r.id ?? "—"} dot={(r) => providerColor(r.provider ?? "")} active={filters.account} onPick={(r) => set({ account: filters.account === r.id ? "" : r.id })} />
            <Breakdown title={t("stats.byKey")} rows={report!.keys} label={(r) => keyLabel(r.id)} mono active={filters.key ? keyIdOf(filters.key, data!.key_labels) : ""} onPick={(r) => rawKey(r.id) && set({ key: filters.key === rawKey(r.id) ? "" : rawKey(r.id) })} />
            <Breakdown title={t("stats.byModel")} rows={report!.models} label={(r) => r.id || "—"} mono active={filters.model} onPick={(r) => set({ model: filters.model === r.id ? "" : r.id })} />
          </div>
        </>
      )}
    </>
  );
}

function keyIdOf(raw: string, labels: Record<string, string>) {
  return Object.entries(labels).find(([, v]) => v === raw)?.[0] ?? "";
}

function FilterSelect({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[] }) {
  // Keep a selected value visible even when the current report no longer lists it.
  const list = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-8 w-auto max-w-56 text-xs", value && "border-accent/50 text-accent")}>
      <option value="">{all}</option>
      {list.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ChartHeader({ title, tableView, onToggle }: { title: string; tableView: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      <Button size="sm" variant="ghost" icon={tableView ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} onClick={onToggle}>
        {tableView ? t("stats.showChart") : t("stats.showTable")}
      </Button>
    </div>
  );
}

function SeriesTable({ rows, columns, formatTime, lang }: { rows: (Counters & { t: number })[]; columns: { label: string; get: (p: Counters) => number }[]; formatTime: (t: number) => string; lang: string }) {
  const { t } = useI18n();
  return (
    <div className="max-h-56 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            <th className="py-1 text-left font-medium">{t("stats.time")}</th>
            {columns.map((c) => (
              <th key={c.label} className="py-1 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.t} className="border-t border-line">
              <td className="py-1">{formatTime(p.t)}</td>
              {columns.map((c) => (
                <td key={c.label} className="py-1 text-right tabular-nums">
                  {c.get(p).toLocaleString(lang)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ title, rows, label, dot, mono, active, onPick }: { title: string; rows: StatsRow[]; label: (r: StatsRow) => string; dot?: (r: StatsRow) => string; mono?: boolean; active: string; onPick: (r: StatsRow) => void }) {
  const { t, lang } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.total_tokens));
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-faint">{t("stats.empty")}</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {rows.slice(0, 50).map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onPick(r)}
                title={t("stats.filterBy", { name: label(r) })}
                className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-2", active && active === r.id && "bg-accent-soft")}
              >
                <div className="flex items-center gap-2 text-sm">
                  {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot(r) }} />}
                  <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-xs")}>{label(r)}</span>
                  <span className="text-xs text-muted tabular-nums">{r.requests.toLocaleString(lang)}</span>
                  <span className="w-16 text-right text-xs font-medium tabular-nums">{formatCompact(r.total_tokens, lang)}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(r.total_tokens / max) * 100}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

