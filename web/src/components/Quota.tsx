import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Gauge } from "lucide-react";
import type { Credential, QuotaReport, QuotaWindow } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { QUOTA_PROVIDERS, fetchQuotaRaw, quotaKey, useQuota } from "../lib/queries";
import { providerName } from "../lib/providers";
import { cn, relativeTime } from "../lib/util";
import { Badge, Modal, Spinner } from "./ui";

export const supportsQuota = (c: Credential) => QUOTA_PROVIDERS.includes(c.provider);

function tone(used: number) {
  if (used >= 90) return "var(--err)";
  if (used >= 70) return "var(--warn)";
  return "var(--ok)";
}

/** Fetch quotas for many accounts with bounded concurrency; returns how many succeeded. */
export function useQuotaCheck() {
  const qc = useQueryClient();
  return async (names: string[]) => {
    let ok = 0;
    const queue = [...names];
    const worker = async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try {
          await qc.fetchQuery({ queryKey: quotaKey(name), queryFn: () => fetchQuotaRaw(name), staleTime: 0, retry: false });
          ok++;
        } catch {
          /* the error stays on the query and shows in the cell */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, names.length) }, worker));
    return ok;
  };
}

function Bar({ window, compact }: { window: QuotaWindow; compact?: boolean }) {
  const used = Math.min(100, Math.max(0, window.used_percent));
  return (
    <div className={compact ? "w-28" : ""}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span className={cn("truncate", compact ? "text-faint" : "text-muted")}>{window.label}</span>
        <span className="tabular-nums" style={{ color: tone(used) }}>
          {Math.round(used)}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${used}%`, background: tone(used) }} />
      </div>
    </div>
  );
}

export function QuotaCell({ credential, onCheck }: { credential: Credential; onCheck: () => void }) {
  const { t } = useI18n();
  const { data, error, isFetching } = useQuota(credential.name);
  const [open, setOpen] = useState(false);
  if (!supportsQuota(credential)) return <span className="text-faint">{t("common.none")}</span>;
  if (isFetching) return <Spinner />;
  if (error && !data)
    return (
      <button onClick={onCheck} title={error instanceof Error ? error.message : String(error)} className="inline-flex items-center gap-1 text-xs text-err hover:underline">
        <AlertCircle className="size-3.5" />
        {t("common.error")}
      </button>
    );
  if (!data)
    return (
      <button onClick={onCheck} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
        <Gauge className="size-3.5" />
        {t("quota.check")}
      </button>
    );
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex flex-col gap-1 rounded-md text-left hover:opacity-80" title={t("quota.title")}>
        {data.windows.length === 0 ? <span className="text-xs text-faint">{t("quota.none")}</span> : data.windows.slice(0, 2).map((w) => <Bar key={w.label} window={w} compact />)}
      </button>
      <QuotaModal open={open} onClose={() => setOpen(false)} credential={credential} report={data} />
    </>
  );
}

function QuotaModal({ open, onClose, credential, report }: { open: boolean; onClose: () => void; credential: Credential; report: QuotaReport }) {
  const { t, lang } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t("quota.title")} description={`${providerName(credential.provider)} · ${credential.email || credential.label || credential.name}`}>
      {report.plan && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-muted">{t("quota.plan")}</span>
          <Badge tone="accent">{report.plan}</Badge>
        </div>
      )}
      {report.windows.length === 0 ? (
        <p className="text-sm text-faint">{t("quota.none")}</p>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {report.windows.map((w) => (
            <div key={w.label}>
              <Bar window={w} />
              {w.resets_at && new Date(w.resets_at).getTime() > Date.now() && <div className="mt-0.5 text-[11px] text-faint">{t("quota.resets", { when: relativeTime(w.resets_at, lang) })}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
