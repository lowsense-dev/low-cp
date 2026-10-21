import { useEffect, useState } from "react";
import { api, put } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { DEFAULT_PROVIDER_PREFIXES, OAUTH_PROVIDERS, providerColor } from "../lib/providers";
import { qk, useConfig } from "../lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Switch, useNotify } from "./ui";

type Row = { enabled: boolean; prefix: string };

const PREFIX_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** Edit oauth.provider-prefixes: one optional prefix per OAuth provider. */
export function ProviderPrefixesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const notify = useNotify();
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = config?.oauth?.["provider-prefixes"] ?? {};
    setRows(Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p.id, { enabled: !!current[p.id], prefix: current[p.id] || DEFAULT_PROVIDER_PREFIXES[p.id] || p.id }])));
  }, [open, config]);

  const enabled = Object.entries(rows).filter(([, r]) => r.enabled);
  const errorFor = (id: string): string => {
    const row = rows[id];
    if (!row?.enabled) return "";
    if (!PREFIX_RE.test(row.prefix)) return t("prefixes.invalid");
    if (enabled.some(([other, r]) => other !== id && r.prefix.toLowerCase() === row.prefix.toLowerCase())) return t("prefixes.duplicate", { prefix: row.prefix });
    return "";
  };
  const hasErrors = OAUTH_PROVIDERS.some((p) => errorFor(p.id));

  const save = async () => {
    setSaving(true);
    try {
      const value = Object.fromEntries(enabled.map(([id, r]) => [id, r.prefix.trim()]));
      if (Object.keys(value).length) await put("/config/oauth/provider-prefixes", value);
      else await api("/config/oauth/provider-prefixes", { method: "DELETE" }).catch(() => {});
      notify.ok(t("common.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      // The server re-reads auth files to apply prefixes; refresh the list shortly after.
      setTimeout(() => qc.invalidateQueries({ queryKey: qk.credentials }), 1500);
      onClose();
    } catch (e) {
      notify.err(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("prefixes.title")}
      description={t("prefixes.subtitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={hasErrors}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="divide-y divide-line">
        {OAUTH_PROVIDERS.map((p) => {
          const row = rows[p.id];
          if (!row) return null;
          const error = errorFor(p.id);
          return (
            <div key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: providerColor(p.id) }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-faint">{p.hint}</span>
              </span>
              <div className="w-32">
                <div className="relative">
                  <Input
                    value={row.prefix}
                    disabled={!row.enabled}
                    onChange={(e) => setRows({ ...rows, [p.id]: { ...row, prefix: e.target.value.replace(/[\s/]/g, "") } })}
                    className="h-8 pr-5 font-mono text-xs"
                    aria-label={`${p.name} prefix`}
                    aria-invalid={!!error}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-xs text-faint">/</span>
                </div>
                {error && <span className="mt-0.5 block text-[11px] leading-tight text-err">{error}</span>}
              </div>
              <Switch label={p.name} checked={row.enabled} onChange={(v) => setRows({ ...rows, [p.id]: { ...row, enabled: v } })} />
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-faint">{t("prefixes.forceHint")}</p>
    </Modal>
  );
}
