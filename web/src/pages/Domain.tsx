import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Globe, Info, X } from "lucide-react";
import { api, put } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { qk, useDomain } from "../lib/queries";
import { cn } from "../lib/util";
import { Button, Card, CopyButton, ErrorBox, Field, Input, PageHeader, Skeleton, useConfirm, useNotify } from "../components/ui";

export function Domain() {
  const { t } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useDomain();
  const [domain, setDomain] = useState("");
  const [restartNotice, setRestartNotice] = useState(false);

  useEffect(() => {
    if (data) setDomain(data.domain);
  }, [data]);

  const bind = useMutation({
    mutationFn: () => put<{ restart_required?: boolean }>("/lowcp/domain", { domain: domain.trim() }),
    onSuccess: (res) => {
      notify.ok(t("domain.bound"));
      setRestartNotice(!!res.restart_required);
      qc.invalidateQueries({ queryKey: qk.domain });
      qc.invalidateQueries({ queryKey: qk.config });
    },
    onError: notify.err,
  });

  const unbind = async () => {
    if (!data?.domain) return;
    if (!(await confirm({ title: t("domain.unbind"), body: t("domain.unbindConfirm", { domain: data.domain }), confirm: t("domain.unbind"), danger: true }))) return;
    try {
      await api("/lowcp/domain", { method: "DELETE" });
      notify.ok(t("domain.unbound"));
      qc.invalidateQueries({ queryKey: qk.domain });
    } catch (e) {
      notify.err(e);
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Skeleton className="h-80 rounded-xl" />;

  const checks = [
    { ok: data.caddy_installed, label: t("domain.check.caddy") },
    { ok: data.import_present, label: t("domain.check.import") },
    { ok: data.snippet_writable, label: t("domain.check.writable") },
    { ok: data.trusted_proxies_ok, label: t("domain.check.trusted"), soft: true },
  ];
  const ready = data.caddy_installed && data.import_present && data.snippet_writable;

  return (
    <>
      <PageHeader title={t("domain.title")} subtitle={t("domain.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-5 flex items-center gap-3">
              <div className={cn("flex size-10 items-center justify-center rounded-xl", data.domain ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>
                <Globe className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted">{t("domain.current")}</div>
                {data.domain ? (
                  <a href={`https://${data.domain}/panel/`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-accent">
                    {data.domain}
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <div className="font-medium text-faint">{t("overview.noDomain")}</div>
                )}
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                bind.mutate();
              }}
              className="space-y-3"
            >
              <Field label={t("domain.input")} hint={t("domain.dns")}>
                <Input value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))} placeholder="llm.example.com" className="font-mono" disabled={!ready} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" loading={bind.isPending} disabled={!ready || !domain.trim() || domain.trim() === data.domain}>
                  {data.domain ? t("domain.rebind") : t("domain.bind")}
                </Button>
                {data.domain && (
                  <Button type="button" variant="ghost" className="text-err hover:text-err" onClick={unbind}>
                    {t("domain.unbind")}
                  </Button>
                )}
              </div>
            </form>
            {restartNotice && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t("domain.restart")}
              </div>
            )}
          </Card>

          {!ready && (
            <Card className="p-5">
              <h2 className="font-semibold">{t("domain.setup")}</h2>
              <p className="mt-1 mb-3 text-sm text-muted">{t("domain.setupHint")}</p>
              <div className="space-y-2">
                {data.setup_commands.map((cmd) => (
                  <div key={cmd} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3">
                    <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">{cmd}</code>
                    <CopyButton value={cmd} />
                  </div>
                ))}
              </div>
              <Button className="mt-4" onClick={() => refetch()} loading={isFetching}>
                {t("common.refresh")}
              </Button>
            </Card>
          )}
        </div>

        <Card className="h-fit p-5">
          <ul className="space-y-2.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2.5 text-sm">
                <span className={cn("flex size-5 items-center justify-center rounded-full", c.ok ? "bg-ok-soft text-ok" : c.soft ? "bg-warn-soft text-warn" : "bg-err-soft text-err")}>
                  {c.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                </span>
                {c.label}
              </li>
            ))}
          </ul>
          <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-xs text-muted">
            <div className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t("domain.upstream")} <code className="font-mono">{data.upstream}</code>
              </span>
            </div>
            <div className="font-mono break-all text-faint">{data.snippet}</div>
            <div className="font-mono break-all text-faint">{data.caddyfile}</div>
          </div>
        </Card>
      </div>
    </>
  );
}
