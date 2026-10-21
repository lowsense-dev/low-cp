import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Plus, RotateCcw, Settings2, Sparkles, Trash2 } from "lucide-react";
import { api, post, put, type KeyPolicy } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAvailableModels, useConfig, useConfigWrite, useKeyTokenUsage, qk } from "../lib/queries";
import { cn, maskSecret, parseKeys, randomKey, relativeTime } from "../lib/util";
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, IconButton, Input, Modal, PageHeader, Segmented, Skeleton, Switch, Textarea, useConfirm, useNotify } from "../components/ui";
import { ModelPicker } from "../components/ModelPicker";
import { formatCompact } from "../components/StackedBars";

const POLICIES_PATH = "/config/access/key-policies";

function isEmptyPolicy(p: KeyPolicy) {
  return !p.name && !p.models?.length && !p["total-tokens"] && !p["daily-tokens"] && !p["expires-at"];
}

/** Write the whole policy map; an empty map removes the section. */
async function writePolicies(policies: Record<string, KeyPolicy>) {
  if (Object.keys(policies).length) await put(POLICIES_PATH, policies);
  else await api(POLICIES_PATH, { method: "DELETE" }).catch(() => {});
}

export function AccessKeys() {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: config, isLoading, error } = useConfig();
  const { data: usage } = useKeyTokenUsage();
  const write = useConfigWrite();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const keys = config?.access?.["api-keys"] ?? [];
  const policies = config?.access?.["key-policies"] ?? {};

  const save = async (next: string[], message: string) => {
    try {
      await write.mutateAsync({ path: "access/api-keys", value: next });
      notify.ok(message);
      return true;
    } catch (e) {
      notify.err(e);
      return false;
    }
  };

  const generate = async () => {
    const key = randomKey();
    if (await save([...keys, key], t("common.saved"))) setRevealed(new Set([...revealed, key]));
  };

  const addBulk = async () => {
    const fresh = parseKeys(bulk).filter((k) => !keys.includes(k));
    if (await save([...keys, ...fresh], t("providers.bulkAdded", { n: fresh.length }))) {
      setBulk("");
      setBulkOpen(false);
    }
  };

  const remove = async (key: string) => {
    if (!(await confirm({ title: t("common.delete"), body: t("access.deleteConfirm", { key: maskSecret(key) }), confirm: t("common.delete"), danger: true }))) return;
    if (!(await save(keys.filter((k) => k !== key), t("common.saved")))) return;
    if (policies[key]) {
      const { [key]: _removed, ...rest } = policies;
      await writePolicies(rest).catch(notify.err);
      qc.invalidateQueries({ queryKey: qk.config });
    }
  };

  const toggle = (key: string) => {
    const next = new Set(revealed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRevealed(next);
  };

  const preview = parseKeys(bulk).filter((k) => !keys.includes(k)).length;

  return (
    <>
      <PageHeader
        title={t("access.title")}
        subtitle={t("access.subtitle")}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setBulkOpen(true)}>
              {t("access.bulk")}
            </Button>
            <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={generate} loading={write.isPending}>
              {t("access.generate")}
            </Button>
          </>
        }
      />
      <Card>
        {error ? (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : keys.length === 0 ? (
          <Empty icon={<KeyRound className="size-5" />} title={t("access.empty")} />
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((key) => {
              const policy = policies[key] ?? {};
              const used = usage?.[key] ?? { total: 0, today: 0 };
              return (
                <li key={key} className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <KeyRound className="size-4 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    {policy.name && <div className="truncate text-sm font-medium">{policy.name}</div>}
                    <code className={cn("block truncate font-mono", policy.name ? "text-xs text-muted" : "text-[13px]")}>{revealed.has(key) ? key : maskSecret(key)}</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PolicyBadges policy={policy} used={used} lang={lang} />
                  </div>
                  <div className="flex items-center">
                    <IconButton label={t("keys.settings")} onClick={() => setEditing(key)}>
                      <Settings2 className="size-4" />
                    </IconButton>
                    <IconButton label={revealed.has(key) ? t("access.hide") : t("access.show")} onClick={() => toggle(key)}>
                      {revealed.has(key) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </IconButton>
                    <CopyButton value={key} className="size-8" />
                    <IconButton label={t("common.delete")} className="hover:text-err" onClick={() => remove(key)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("access.bulk")}
        description={t("providers.bulkHint")}
        footer={
          <>
            <Button onClick={() => setBulkOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={addBulk} disabled={preview === 0} loading={write.isPending}>
              {t("common.add")}
              {preview > 0 && ` · ${preview}`}
            </Button>
          </>
        }
      >
        <Textarea autoFocus value={bulk} onChange={(e) => setBulk(e.target.value)} className="min-h-40 font-mono text-xs" placeholder={"sk-one, sk-two\nsk-three"} spellCheck={false} />
      </Modal>

      {editing && <KeySettingsModal apiKey={editing} policies={policies} used={usage?.[editing] ?? { total: 0, today: 0 }} onClose={() => setEditing(null)} />}
    </>
  );
}

function PolicyBadges({ policy, used, lang }: { policy: KeyPolicy; used: { total: number; today: number }; lang: string }) {
  const { t } = useI18n();
  const expires = policy["expires-at"] ? new Date(policy["expires-at"]) : null;
  const expired = expires != null && expires.getTime() <= Date.now();
  const total = policy["total-tokens"] ?? 0;
  const daily = policy["daily-tokens"] ?? 0;
  return (
    <>
      <Badge tone={policy.models?.length ? "accent" : "neutral"}>{policy.models?.length ? t("access.modelsCount", { n: policy.models.length }) : t("access.modelsAll")}</Badge>
      {total > 0 ? <UsageBadge used={used.total} limit={total} lang={lang} /> : used.total > 0 && <Badge>{t("keys.usedTotal", { n: formatCompact(used.total, lang) })}</Badge>}
      {daily > 0 && <UsageBadge used={used.today} limit={daily} lang={lang} suffix={t("keys.dailyExhausted").toLowerCase()} />}
      {expires && <Badge tone={expired ? "err" : "neutral"}>{expired ? t("keys.expired") : t("keys.expiresAt", { when: relativeTime(policy["expires-at"], lang) })}</Badge>}
    </>
  );
}

function UsageBadge({ used, limit, lang, suffix }: { used: number; limit: number; lang: string; suffix?: string }) {
  const ratio = Math.min(1, used / limit);
  const tone = ratio >= 1 ? "err" : ratio >= 0.8 ? "warn" : "neutral";
  return (
    <Badge tone={tone} className="gap-1.5">
      <span className="inline-block h-1 w-8 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <span className="block h-full rounded-full bg-current" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="tabular-nums">
        {formatCompact(used, lang)} / {formatCompact(limit, lang)}
      </span>
      {suffix && <span className="opacity-70">{suffix}</span>}
    </Badge>
  );
}

const TTL_PRESETS = [
  { value: "never", days: 0 },
  { value: "1d", days: 1 },
  { value: "7d", days: 7 },
  { value: "30d", days: 30 },
  { value: "90d", days: 90 },
  { value: "custom", days: -1 },
] as const;

function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function KeySettingsModal({ apiKey, policies, used, onClose }: { apiKey: string; policies: Record<string, KeyPolicy>; used: { total: number; today: number }; onClose: () => void }) {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const original = policies[apiKey] ?? {};
  const { data: models = [], isLoading: modelsLoading } = useAvailableModels();

  const [name, setName] = useState(original.name ?? "");
  const [restrict, setRestrict] = useState(!!original.models?.length);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [patterns, setPatterns] = useState("");
  const [total, setTotal] = useState(original["total-tokens"] ? String(original["total-tokens"]) : "");
  const [daily, setDaily] = useState(original["daily-tokens"] ? String(original["daily-tokens"]) : "");
  const [ttl, setTtl] = useState<string>(original["expires-at"] ? "custom" : "never");
  const [customDate, setCustomDate] = useState(original["expires-at"] ? toLocalInput(original["expires-at"]) : "");
  const [saving, setSaving] = useState(false);

  // Split stored entries into exact model IDs (checkboxes) and free-form patterns.
  useEffect(() => {
    const ids = new Set(models.map((m) => m.id));
    const stored = original.models ?? [];
    setSelected(new Set(stored.filter((m) => ids.has(m))));
    setPatterns(stored.filter((m) => !ids.has(m)).join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const expiresAt = useMemo(() => {
    const preset = TTL_PRESETS.find((p) => p.value === ttl);
    if (!preset || preset.days === 0) return "";
    if (preset.days > 0) return new Date(Date.now() + preset.days * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const d = new Date(customDate);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }, [ttl, customDate]);

  const parseLimit = (v: string) => {
    const n = Number(v.replace(/[\s_,]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const limitInvalid = [total, daily].some((v) => v.trim() !== "" && !Number.isFinite(Number(v.replace(/[\s_,]/g, ""))));
  const modelList = restrict
    ? [
        ...selected,
        ...patterns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ]
    : [];

  const saveDisabled = limitInvalid || (ttl === "custom" && !expiresAt) || (restrict && modelList.length === 0);

  const saveAll = async () => {
    setSaving(true);
    try {
      const policy: KeyPolicy = {};
      if (name.trim()) policy.name = name.trim();
      if (modelList.length) policy.models = [...new Set(modelList)];
      if (parseLimit(total)) policy["total-tokens"] = parseLimit(total);
      if (parseLimit(daily)) policy["daily-tokens"] = parseLimit(daily);
      if (expiresAt) policy["expires-at"] = expiresAt;
      const next = { ...policies };
      if (isEmptyPolicy(policy)) delete next[apiKey];
      else next[apiKey] = policy;
      await writePolicies(next);
      notify.ok(t("common.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      onClose();
    } catch (e) {
      notify.err(e);
    } finally {
      setSaving(false);
    }
  };

  const resetUsage = async () => {
    if (!(await confirm({ title: t("keys.resetUsage"), body: t("keys.resetConfirm"), confirm: t("keys.resetUsage"), danger: true }))) return;
    try {
      await post("/lowcp/key-usage/reset", { key: apiKey });
      qc.invalidateQueries({ queryKey: ["key-usage"] });
      notify.ok(t("common.saved"));
    } catch (e) {
      notify.err(e);
    }
  };

  const ttlLabel = (v: string) => (v === "never" ? t("keys.never") : v === "custom" ? t("keys.ttlCustom") : v);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("keys.settings")}
      description={<code className="font-mono">{maskSecret(apiKey)}</code>}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={saveAll} loading={saving} disabled={saveDisabled}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <Field label={t("keys.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("keys.namePlaceholder")} maxLength={64} autoFocus />
          </Field>

          <section className="flex items-center justify-between gap-3 rounded-xl bg-surface-2/60 px-4 py-3">
            <div>
              <div className="text-xs text-muted">{t("keys.used")}</div>
              <div className="mt-0.5 text-sm font-medium tabular-nums">
                {t("keys.usedTotal", { n: used.total.toLocaleString(lang) })} · {t("keys.usedToday", { n: used.today.toLocaleString(lang) })}
              </div>
            </div>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={resetUsage}>
              {t("keys.resetUsage")}
            </Button>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium">{t("keys.limits")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("keys.totalTokens")}>
                <Input inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={t("keys.unlimited")} className="tabular-nums" />
              </Field>
              <Field label={t("keys.dailyTokens")}>
                <Input inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={t("keys.unlimited")} className="tabular-nums" />
              </Field>
            </div>
            <p className="text-xs text-faint">
              {t("keys.limitHint")}
              {(parseLimit(total) > 0 || parseLimit(daily) > 0) && (
                <span className="ml-1 text-muted">
                  ({[parseLimit(total) && `${formatCompact(parseLimit(total), lang)}`, parseLimit(daily) && `${formatCompact(parseLimit(daily), lang)}/d`].filter(Boolean).join(" · ")})
                </span>
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("keys.expires")}</h3>
            <Segmented value={ttl} onChange={setTtl} options={TTL_PRESETS.map((p) => ({ value: p.value, label: ttlLabel(p.value) }))} />
            {ttl === "custom" && <Input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="w-auto" />}
            {expiresAt && <p className="text-xs text-muted">{t("keys.expiresAt", { when: `${relativeTime(expiresAt, lang)} · ${new Date(expiresAt).toLocaleString(lang)}` })}</p>}
          </section>
        </div>

        <section className="space-y-3">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">{t("access.modelsRestrict")}</span>
              <span className="mt-0.5 block text-xs text-muted">{t("access.modelsRestrictHint")}</span>
            </span>
            <Switch checked={restrict} onChange={setRestrict} label={t("access.modelsRestrict")} />
          </label>
          <div className={cn("space-y-3 transition-opacity", !restrict && "pointer-events-none opacity-40")} aria-disabled={!restrict}>
            <ModelPicker models={models} loading={modelsLoading} selected={selected} onChange={setSelected} />
            <Field label={t("access.patterns")} hint={t("access.patternsHint")}>
              <Input value={patterns} onChange={(e) => setPatterns(e.target.value)} placeholder="ds/*, *claude*" className="font-mono text-xs" />
            </Field>
          </div>
        </section>
      </div>
    </Modal>
  );
}
