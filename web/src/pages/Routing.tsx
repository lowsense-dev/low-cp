import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, RotateCcw, X } from "lucide-react";
import { post, type Config } from "../lib/api";
import { useI18n, type TKey } from "../lib/i18n";
import { useConfig, useConfigPatch } from "../lib/queries";
import { DEFAULT_NO_ROTATE, STRATEGIES } from "../lib/providers";
import { cn } from "../lib/util";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Skeleton, Switch, useNotify } from "../components/ui";

type Form = {
  strategy: string;
  noRotate: number[];
  requestRetry: number;
  maxRetryInterval: number;
  maxRetryCredentials: number;
  sessionAffinity: boolean;
  forcePrefix: boolean;
  disableCooling: boolean;
};

function toForm(c: Config): Form {
  const r = c.routing ?? {};
  return {
    strategy: r.strategy || "round-robin",
    noRotate: r["no-rotate-statuses"] ?? DEFAULT_NO_ROTATE,
    requestRetry: r.retry?.["request-retry"] ?? 3,
    maxRetryInterval: r.retry?.["max-retry-interval"] ?? 30,
    maxRetryCredentials: r.retry?.["max-retry-credentials"] ?? 0,
    sessionAffinity: !!r["session-affinity"],
    forcePrefix: !!r["force-model-prefix"],
    disableCooling: !!r.cooldown?.["disable-cooling"],
  };
}

export function Routing() {
  const { t } = useI18n();
  const notify = useNotify();
  const { data: config, isLoading, error } = useConfig();
  const patchConfig = useConfigPatch();
  const [form, setForm] = useState<Form | null>(null);
  const [newStatus, setNewStatus] = useState("");

  useEffect(() => {
    if (config) setForm(toForm(config));
  }, [config]);

  const resetCooldown = useMutation({
    mutationFn: () => post("/routing/cooldown/reset", {}),
    onSuccess: () => notify.ok(t("routing.cooldownReset")),
    onError: notify.err,
  });

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !form || !config) return <Skeleton className="h-96 rounded-xl" />;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(config));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });

  const save = async () => {
    try {
      await patchConfig.mutateAsync({
        routing: {
          strategy: form.strategy,
          "no-rotate-statuses": [...form.noRotate].sort((a, b) => a - b),
          "session-affinity": form.sessionAffinity,
          "force-model-prefix": form.forcePrefix,
          retry: { "request-retry": form.requestRetry, "max-retry-interval": form.maxRetryInterval, "max-retry-credentials": form.maxRetryCredentials },
          cooldown: { "disable-cooling": form.disableCooling },
        },
      });
      notify.ok(t("common.saved"));
    } catch (e) {
      notify.err(e);
    }
  };

  const addStatus = () => {
    const code = Number(newStatus);
    if (Number.isInteger(code) && code >= 400 && code <= 599 && !form.noRotate.includes(code)) set("noRotate", [...form.noRotate, code].sort((a, b) => a - b));
    setNewStatus("");
  };

  return (
    <>
      <PageHeader
        title={t("routing.title")}
        subtitle={t("routing.subtitle")}
        actions={
          <Button icon={<RotateCcw className="size-4" />} onClick={() => resetCooldown.mutate()} loading={resetCooldown.isPending}>
            {t("routing.resetCooldown")}
          </Button>
        }
      />

      <div className="space-y-5 pb-20">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">{t("routing.strategy")}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {STRATEGIES.map((s) => (
              <button
                key={s}
                onClick={() => set("strategy", s)}
                className={cn("flex flex-col rounded-xl border p-3.5 text-left transition-colors", form.strategy === s ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line hover:bg-surface-2")}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-4 items-center justify-center rounded-full border-2", form.strategy === s ? "border-accent" : "border-line-strong")}>
                    {form.strategy === s && <span className="size-1.5 rounded-full bg-accent" />}
                  </span>
                  <span className="font-medium">{t(`routing.s.${s}` as TKey)}</span>
                </div>
                <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted">{t(`routing.s.${s}.d` as TKey)}</p>
              </button>
            ))}
          </div>

          {form.strategy === "while-no-limit" && (
            <div className="animate-fade-in mt-4 rounded-xl border border-line bg-surface-2/50 p-4">
              <h3 className="text-sm font-medium">{t("routing.noRotate")}</h3>
              <p className="mt-1 text-xs text-muted">{t("routing.noRotateHint")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {form.noRotate.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface py-1 pr-1 pl-2.5 font-mono text-sm">
                    {code}
                    <button onClick={() => set("noRotate", form.noRotate.filter((c) => c !== code))} className="rounded p-0.5 text-faint hover:text-err" aria-label={`${t("common.delete")} ${code}`}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addStatus();
                  }}
                  className="flex items-center gap-1"
                >
                  <Input value={newStatus} onChange={(e) => setNewStatus(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={t("routing.addStatus")} className="h-8 w-20 font-mono" inputMode="numeric" />
                  <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} disabled={newStatus.length !== 3} />
                </form>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold">{t("routing.retry")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("routing.requestRetry")} hint={t("routing.requestRetryHint")}>
              <Input type="number" min={0} value={form.requestRetry} onChange={(e) => set("requestRetry", Number(e.target.value))} />
            </Field>
            <Field label={t("routing.maxRetryCredentials")} hint={t("routing.maxRetryCredentialsHint")}>
              <Input type="number" min={0} value={form.maxRetryCredentials} onChange={(e) => set("maxRetryCredentials", Number(e.target.value))} />
            </Field>
            <Field label={t("routing.maxRetryInterval")}>
              <Input type="number" min={0} value={form.maxRetryInterval} onChange={(e) => set("maxRetryInterval", Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card className="divide-y divide-line">
          <ToggleRow title={t("routing.sessionAffinity")} hint={t("routing.sessionAffinityHint")} checked={form.sessionAffinity} onChange={(v) => set("sessionAffinity", v)} />
          <ToggleRow title={t("routing.forcePrefix")} hint={t("routing.forcePrefixHint")} checked={form.forcePrefix} onChange={(v) => set("forcePrefix", v)} />
          <ToggleRow title={t("routing.disableCooling")} hint={t("routing.disableCoolingHint")} checked={form.disableCooling} onChange={(v) => set("disableCooling", v)} />
        </Card>
      </div>

      {dirty && (
        <div className="animate-pop-in fixed right-0 bottom-0 left-0 z-40 flex justify-center p-4 md:left-60">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pr-2 pl-4 shadow-panel">
            <span className="text-sm text-muted">{t("common.unsaved")}</span>
            <Button size="sm" onClick={() => setForm(toForm(config))}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={save} loading={patchConfig.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ToggleRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={title} />
    </label>
  );
}
