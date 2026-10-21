import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Globe, KeyRound, Network, Server, Users } from "lucide-react";
import { useI18n, type TKey } from "../lib/i18n";
import { useConfig, useCredentials, useDomain } from "../lib/queries";
import { CLIENT_ENDPOINTS, providerColor, providerName } from "../lib/providers";
import { navigate } from "../App";
import { Badge, Card, CopyButton, Skeleton } from "../components/ui";
import { credentialStatus } from "./Accounts";
import type { RecentBucket } from "../lib/api";

export function Overview() {
  const { t } = useI18n();
  const credentials = useCredentials();
  const config = useConfig();
  const domain = useDomain();

  const creds = credentials.data ?? [];
  const groups = config.data?.["api-keys"] ?? {};
  const providerCount = Object.values(groups).reduce((n, list) => n + (list?.length ?? 0), 0);
  const keyCount = Object.values(groups).reduce((n, list) => n + (list ?? []).reduce((m, g) => m + (g.keys?.length ?? 0), 0), 0);
  const active = creds.filter((c) => credentialStatus(c) === "active").length;
  const problems = creds.filter((c) => ["error", "cooldown"].includes(credentialStatus(c)));

  const byProvider = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const c of creds) {
      const entry = map.get(c.provider) ?? { total: 0, active: 0 };
      entry.total++;
      if (credentialStatus(c) === "active") entry.active++;
      map.set(c.provider, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [creds]);

  // Sum the per-account 10-minute buckets into one series.
  const traffic = useMemo(() => {
    const sum = new Map<string, RecentBucket>();
    for (const c of creds)
      for (const b of c.recent_requests ?? []) {
        const e = sum.get(b.time) ?? { time: b.time, success: 0, failed: 0 };
        e.success += b.success;
        e.failed += b.failed;
        sum.set(b.time, e);
      }
    return [...sum.values()];
  }, [creds]);
  const totals = traffic.reduce((a, b) => ({ success: a.success + b.success, failed: a.failed + b.failed }), { success: 0, failed: 0 });

  const strategy = config.data?.routing?.strategy || "round-robin";
  const origin = domain.data?.domain ? `https://${domain.data.domain}` : location.origin;

  if (credentials.isLoading || config.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold tracking-tight">{t("overview.title")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Users />} label={t("overview.accounts")} value={creds.length} sub={`${active} ${t("overview.active")}`} onClick={() => navigate("accounts")} />
        <Stat icon={<Server />} label={t("overview.providers")} value={providerCount} sub={`${keyCount} ${t("overview.keys")}`} onClick={() => navigate("providers")} />
        <Stat icon={<Network />} label={t("overview.strategy")} value={t(`routing.s.${strategy}` as TKey)} small onClick={() => navigate("routing")} />
        <Stat icon={<Globe />} label={t("overview.domain")} value={domain.data?.domain || t("overview.noDomain")} small muted={!domain.data?.domain} onClick={() => navigate("domain")} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">{t("overview.traffic")}</h2>
            <span className="text-xs text-muted tabular-nums">
              <span className="text-ok">{totals.success}</span> {t("overview.success")} · <span className={totals.failed ? "text-err" : ""}>{totals.failed}</span> {t("overview.failed")}
            </span>
          </div>
          <TrafficChart data={traffic} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold">{t("overview.byProvider")}</h2>
          {byProvider.length === 0 ? (
            <p className="text-sm text-faint">{t("accounts.empty")}</p>
          ) : (
            <ul className="space-y-3">
              {byProvider.map(([id, s]) => (
                <li key={id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: providerColor(id) }} />
                      {providerName(id)}
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      {s.active}/{s.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(s.active / s.total) * 100}%`, background: providerColor(id) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            {problems.length ? <AlertTriangle className="size-4 text-warn" /> : <CheckCircle2 className="size-4 text-ok" />}
            {t("overview.attention")}
          </h2>
          {problems.length === 0 ? (
            <p className="text-sm text-muted">{t("overview.allGood")}</p>
          ) : (
            <ul className="space-y-2">
              {problems.slice(0, 8).map((c) => (
                <li key={c.name} className="flex items-center gap-2 text-sm">
                  <Badge tone={credentialStatus(c) === "error" ? "err" : "warn"}>{t(`accounts.status.${credentialStatus(c)}` as TKey)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{c.email || c.label || c.name}</span>
                  <span className="max-w-48 truncate text-xs text-faint" title={c.status_message}>
                    {c.status_message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-muted" />
            {t("overview.endpoints")}
          </h2>
          <ul className="space-y-1.5">
            {CLIENT_ENDPOINTS.map((e) => (
              <li key={e.path} className="group flex items-center gap-2 text-sm">
                <span className="w-10 shrink-0 font-mono text-[11px] font-semibold text-muted">{e.method}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{e.path}</code>
                <span className="hidden text-xs text-faint sm:inline">{e.note}</span>
                <CopyButton value={origin + e.path} className="opacity-0 group-hover:opacity-100" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Stat({ icon, label, value, sub, small, muted, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; small?: boolean; muted?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col rounded-xl border border-line bg-surface p-4 text-left transition-all hover:border-line-strong hover:shadow-panel">
      <div className="flex items-center gap-2 text-xs font-medium text-muted [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <div className={small ? "mt-3 truncate text-base font-semibold" : "mt-2 text-2xl font-semibold tabular-nums"} style={muted ? { color: "var(--faint)" } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </button>
  );
}

function TrafficChart({ data }: { data: RecentBucket[] }) {
  const height = 140;
  const max = Math.max(1, ...data.map((b) => b.success + b.failed));
  if (data.length === 0) return <div style={{ height }} className="flex items-center justify-center text-sm text-faint">—</div>;
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((b) => {
          const total = b.success + b.failed;
          const h = total ? Math.max(3, (total / max) * height) : 3;
          return (
            <div key={b.time} className="group relative flex flex-1 flex-col justify-end" style={{ height }} title={`${b.time} · ${b.success} / ${b.failed}`}>
              <div className="flex flex-col overflow-hidden rounded-[3px]" style={{ height: h }}>
                {b.failed > 0 && <div style={{ height: `${(b.failed / total) * 100}%`, background: "var(--err)" }} />}
                <div className="flex-1" style={{ background: total ? "var(--accent)" : "var(--border)", opacity: total ? 0.85 : 1 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
        <span>{data[0]?.time.split("-")[0]}</span>
        <span>{data[data.length - 1]?.time.split("-")[1]}</span>
      </div>
    </div>
  );
}
