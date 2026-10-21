import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, KeyRound, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { api, put, type KeyEntry, type ModelEntry, type ProviderGroup } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { qk, useConfig, useKeyUsage, type KeyUsage } from "../lib/queries";
import { FAMILIES, PRIMARY_FAMILIES, familyById, providerColor } from "../lib/providers";
import { cn, maskSecret, parseKeys } from "../lib/util";
import { UpstreamModelsModal } from "../components/UpstreamModels";
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, IconButton, Input, Modal, PageHeader, Skeleton, Switch, Textarea, useConfirm, useNotify } from "../components/ui";

type Editing = { family: string; index: number | null };

export function Providers() {
  const notify = useNotify();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { data: config, isLoading, error } = useConfig();
  const { data: usage } = useKeyUsage();
  const [editing, setEditing] = useState<Editing | null>(null);

  const groups = config?.["api-keys"] ?? {};

  const toggle = async (family: string, index: number, off: boolean) => {
    const list = (groups[family] ?? []).map((g, i) => {
      const next = i === index ? withDisabled(family, g, off) : g;
      return { ...next, keys: next.keys && stripRuntime(next.keys) };
    });
    try {
      await put(`/config/api-keys/${family}`, list);
      notify.ok(off ? t("providers.turnedOff") : t("providers.turnedOn"));
      qc.invalidateQueries({ queryKey: qk.config });
    } catch (e) {
      notify.err(e);
    }
  };
  const families = FAMILIES.filter((f) => (groups[f.id]?.length ?? 0) > 0);
  const total = families.reduce((n, f) => n + groups[f.id].length, 0);

  return (
    <>
      <PageHeader
        title={t("providers.title")}
        subtitle={t("providers.subtitle")}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ family: "openai-compatibility", index: null })}>
            {t("providers.add")}
          </Button>
        }
      />

      {error ? (
        <ErrorBox error={error} />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : total === 0 ? (
        <Card>
          <Empty
            icon={<Server className="size-5" />}
            title={t("providers.empty")}
            hint={t("providers.emptyHint")}
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ family: "openai-compatibility", index: null })}>
                {t("providers.add")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {families.map((family) => (
            <section key={family.id}>
              <div className="mb-3 flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: providerColor(family.id) }} />
                <h2 className="font-semibold">{family.title}</h2>
                <code className="font-mono text-xs text-faint">{family.endpoint}</code>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groups[family.id].map((group, index) => (
                  <ProviderCard
                    key={`${group.name}-${index}`}
                    family={family.id}
                    group={group}
                    usage={usage}
                    onClick={() => setEditing({ family: family.id, index })}
                    onToggle={(off) => toggle(family.id, index, off)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && config && <ProviderEditor editing={editing} groups={groups} onClose={() => setEditing(null)} />}
    </>
  );
}

function groupUsage(family: string, group: ProviderGroup, usage?: KeyUsage) {
  let success = 0;
  let failed = 0;
  const keys = new Set((group.keys ?? []).map((k) => k["api-key"]));
  for (const [provider, entries] of Object.entries(usage ?? {})) {
    if (provider !== family && provider !== group.name) continue;
    for (const [id, stat] of Object.entries(entries)) {
      const key = id.split("|").pop() ?? "";
      if (keys.has(key)) {
        success += stat.success ?? 0;
        failed += stat.failed ?? 0;
      }
    }
  }
  return { success, failed };
}

const DISABLE_ALL = "*";

/** OpenAI-compatible groups have a disabled flag; other families are switched off the
 * upstream way, by excluding every model ("*"). */
function isGroupDisabled(family: string, g: ProviderGroup) {
  return family === "openai-compatibility" ? !!g.disabled : (g["excluded-models"] ?? []).includes(DISABLE_ALL);
}

function withDisabled(family: string, g: ProviderGroup, off: boolean): ProviderGroup {
  const next = { ...g };
  if (family === "openai-compatibility") {
    if (off) next.disabled = true;
    else delete next.disabled;
    return next;
  }
  const excluded = (g["excluded-models"] ?? []).filter((m) => m !== DISABLE_ALL);
  if (off) next["excluded-models"] = [...excluded, DISABLE_ALL];
  else if (excluded.length) next["excluded-models"] = excluded;
  else delete next["excluded-models"];
  return next;
}

function ProviderCard({ family, group, usage, onClick, onToggle }: { family: string; group: ProviderGroup; usage?: KeyUsage; onClick: () => void; onToggle: (off: boolean) => void }) {
  const { t } = useI18n();
  const stats = groupUsage(family, group, usage);
  const keyCount = group.keys?.length ?? 0;
  const off = isGroupDisabled(family, group);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={cn("group flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-4 text-left transition-all hover:border-line-strong hover:shadow-panel", off && "opacity-60")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{group.name || familyById(family).title}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-faint">{group["base-url"] || familyById(family).defaultBase || t("common.none")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {group.prefix && <Badge tone="accent">{group.prefix}/</Badge>}
          {/* The switch must not open the editor. */}
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Switch checked={!off} onChange={(on) => onToggle(!on)} label={t("common.enabled")} />
          </span>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-muted">
        <span className={cn("inline-flex items-center gap-1", keyCount === 0 && "text-err")}>
          <KeyRound className="size-3.5" />
          {keyCount} {t("providers.keys")}
        </span>
        <span>·</span>
        <span>{group.models?.length ? `${group.models.length} ${t("providers.models")}` : t("providers.allModels")}</span>
        {stats.success + stats.failed > 0 && (
          <span className="ml-auto tabular-nums">
            <span className="text-ok">{stats.success}</span>
            <span className="text-faint"> / </span>
            <span className={stats.failed ? "text-err" : "text-faint"}>{stats.failed}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Editor ----------

function modelsToText(models?: ModelEntry[]) {
  return (models ?? []).map((m) => (m.alias && m.alias !== m.name ? `${m.name} = ${m.alias}` : m.name)).join("\n");
}

/** Parse "upstream = alias" lines, keeping extra fields (thinking etc.) of existing entries. */
function textToModels(text: string, previous?: ModelEntry[]): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const line of text.split("\n")) {
    const [rawName, rawAlias] = line.split("=").map((s) => s?.trim());
    if (!rawName) continue;
    const old = previous?.find((m) => m.name === rawName && (m.alias ?? m.name) === (rawAlias || rawName)) ?? previous?.find((m) => m.name === rawName);
    const entry: ModelEntry = { ...old, name: rawName };
    // Keep an explicit alias equal to the name: the text view hides it, the config keeps it.
    if (rawAlias) entry.alias = rawAlias;
    else if (old?.alias !== rawName) delete entry.alias;
    out.push(entry);
  }
  return out;
}

function headersToText(headers?: Record<string, string>) {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function textToHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function stripRuntime(keys: KeyEntry[]): KeyEntry[] {
  return keys.map(({ auth_index: _ignored, ...rest }) => rest);
}

function ProviderEditor({ editing, groups, onClose }: { editing: Editing; groups: Record<string, ProviderGroup[]>; onClose: () => void }) {
  const { t } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const original = editing.index != null ? groups[editing.family]?.[editing.index] : undefined;
  const isNew = !original;

  const [family, setFamily] = useState(editing.family);
  const [name, setName] = useState(original?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(original?.["base-url"] ?? "");
  const [prefix, setPrefix] = useState(original?.prefix ?? "");
  const [proxy, setProxy] = useState(original?.["proxy-url"] ?? "");
  const [headers, setHeaders] = useState(headersToText(original?.headers));
  const [models, setModels] = useState(modelsToText(original?.models));
  const [excluded, setExcluded] = useState((original?.["excluded-models"] ?? []).filter((m) => m !== DISABLE_ALL).join(", "));
  const [disabled, setDisabled] = useState(original ? isGroupDisabled(editing.family, original) : false);
  const [keys, setKeys] = useState<KeyEntry[]>(original?.keys ?? []);
  const [bulk, setBulk] = useState("");
  const [nameError, setNameError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = familyById(family);

  useEffect(() => setNameError(""), [name, family]);

  const addBulk = (text: string) => {
    const existing = new Set(keys.map((k) => k["api-key"]));
    const fresh = parseKeys(text).filter((k) => !existing.has(k));
    setKeys([...keys, ...fresh.map((k) => ({ "api-key": k }))]);
    setBulk("");
    notify.ok(t("providers.bulkAdded", { n: fresh.length }));
  };

  const familyOptions = isNew ? PRIMARY_FAMILIES : FAMILIES.filter((f) => f.format || f.id === editing.family);

  const save = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw Object.assign(new Error(t("providers.nameRequired")), { field: "name" });
      const target = groups[family] ?? [];
      const clash = target.some((g, i) => g.name === trimmedName && !(family === editing.family && i === editing.index));
      if (clash) throw Object.assign(new Error(t("providers.nameTaken")), { field: "name" });

      let group: ProviderGroup = { ...original, name: trimmedName, keys: stripRuntime(keys) };
      const assign = (key: string, value: unknown) => {
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete group[key];
        else group[key] = value;
      };
      assign("base-url", baseUrl.trim());
      assign("prefix", prefix.trim());
      assign("proxy-url", proxy.trim());
      assign("headers", textToHeaders(headers));
      assign("models", textToModels(models, original?.models));
      assign(
        "excluded-models",
        excluded
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      group = withDisabled(family, group, disabled);

      if (family === editing.family) {
        const list = [...target];
        if (editing.index != null) list[editing.index] = group;
        else list.push(group);
        await put(`/config/api-keys/${family}`, list);
      } else {
        // Moving between families: add to the new list first so nothing is lost on failure.
        await put(`/config/api-keys/${family}`, [...target, group]);
        if (editing.index != null) await writeFamily(editing.family, (groups[editing.family] ?? []).filter((_, i) => i !== editing.index));
      }
    },
    onSuccess: () => {
      notify.ok(t("common.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      onClose();
    },
    onError: (e: Error & { field?: string }) => {
      if (e.field === "name") setNameError(e.message);
      else notify.err(e);
    },
  });

  const remove = async () => {
    if (editing.index == null) return;
    if (!(await confirm({ title: t("common.delete"), body: t("providers.deleteConfirm", { name: original?.name ?? "" }), confirm: t("common.delete"), danger: true }))) return;
    try {
      await writeFamily(editing.family, (groups[editing.family] ?? []).filter((_, i) => i !== editing.index));
      qc.invalidateQueries({ queryKey: qk.config });
      onClose();
    } catch (e) {
      notify.err(e);
    }
  };

  const keyPreview = useMemo(() => parseKeys(bulk).length, [bulk]);
  const [upstreamOpen, setUpstreamOpen] = useState(false);
  const modelNames = textToModels(models).map((m) => m.name);
  const openUpstream = () => {
    if (!keys[0]?.["api-key"]) {
      notify.err(t("upstream.needKey"));
      return;
    }
    setUpstreamOpen(true);
  };
  // Keep "name = alias" lines for models that stay selected.
  const applyUpstream = (names: string[]) => {
    const lines = new Map(models.split("\n").map((line) => [line.split("=")[0].trim(), line.trim()] as const));
    setModels(names.map((n) => lines.get(n) ?? n).join("\n"));
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? t("providers.new") : original?.name || t("providers.edit")}
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" className="mr-auto text-err hover:text-err" icon={<Trash2 className="size-4" />} onClick={remove}>
              {t("common.delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted">{t("providers.format")}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {familyOptions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFamily(f.id)}
                  className={cn("rounded-lg border px-2.5 py-2 text-left transition-colors", family === f.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}
                >
                  <span className={cn("block text-xs font-medium", family === f.id && "text-accent")}>{f.format ? t(f.format) : f.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{f.endpoint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("providers.name")} hint={t("providers.nameHint")} error={nameError}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="dashscope" autoFocus={isNew} />
            </Field>
            <Field label={t("providers.prefix")} hint={t("providers.prefixHint")}>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\s|\//g, ""))} placeholder="ds" className="font-mono" />
            </Field>
          </div>
          <Field label={t("providers.baseUrl")}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={meta.defaultBase} className="font-mono text-xs" />
          </Field>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{t("providers.modelsLabel")}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={openUpstream}>
                {t("upstream.fetch")}
              </Button>
            </div>
            <Textarea value={models} onChange={(e) => setModels(e.target.value)} placeholder={"qwen-max\nqwen3-coder-plus = coder"} className="min-h-24 font-mono text-xs" spellCheck={false} aria-label={t("providers.modelsLabel")} />
            <span className="block text-xs text-faint">{t("providers.modelsHint")}</span>
          </div>
          <Field label={t("providers.excluded")} hint={t("providers.excludedHint")}>
            <Input value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="*-preview, gpt-4o" className="font-mono text-xs" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("providers.proxy")} hint={t("providers.proxyHint")}>
              <Input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={t("common.optional")} className="font-mono text-xs" />
            </Field>
            <Field label={t("providers.headers")} hint={t("providers.headersHint")}>
              <Textarea value={headers} onChange={(e) => setHeaders(e.target.value)} className="min-h-9 font-mono text-xs" rows={1} spellCheck={false} />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <span className="text-sm">{t("providers.disabledToggle")}</span>
            <Switch checked={disabled} onChange={setDisabled} />
          </label>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              {t("providers.keysLabel")} · {keys.length}
            </span>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
            {keys.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-faint">{t("providers.noKeys")}</p>
            ) : (
              keys.map((k, i) => (
                <div key={`${k["api-key"]}-${i}`} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={k["api-key"]}>
                    {maskSecret(k["api-key"])}
                  </span>
                  <CopyButton value={k["api-key"]} className="opacity-0 group-hover:opacity-100" />
                  <input
                    type="number"
                    min={0}
                    aria-label={t("providers.weight")}
                    title={t("providers.weight")}
                    placeholder="1"
                    value={k.weight ?? ""}
                    onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, weight: e.target.value === "" ? undefined : Number(e.target.value) } : x)))}
                    className="h-7 w-14 rounded-md border border-line bg-surface px-1.5 text-xs tabular-nums focus:border-accent focus:outline-none"
                  />
                  <IconButton label={t("common.delete")} className="size-7 hover:text-err" onClick={() => setKeys(keys.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              ))
            )}
          </div>
          <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{t("providers.bulk")}</span>
              <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                {t("providers.bulkFile")}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,.json,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) addBulk(await file.text());
                }}
              />
            </div>
            <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"sk-aaa, sk-bbb\nsk-ccc"} className="min-h-20 font-mono text-xs" spellCheck={false} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-faint">{t("providers.bulkHint")}</span>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} disabled={keyPreview === 0} onClick={() => addBulk(bulk)}>
                {t("providers.bulkAdd")}
                {keyPreview > 0 && ` · ${keyPreview}`}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {upstreamOpen && (
        <UpstreamModelsModal
          source={{ family, baseUrl: baseUrl.trim() || meta.defaultBase, apiKeys: keys.map((k) => k["api-key"]), headers: textToHeaders(headers) }}
          current={modelNames}
          title={name || meta.title}
          onApply={applyUpstream}
          onClose={() => setUpstreamOpen(false)}
        />
      )}
    </Modal>
  );
}

/** Replace a family list, deleting the key entirely when it becomes empty. */
async function writeFamily(family: string, list: ProviderGroup[]) {
  if (list.length) await put(`/config/api-keys/${family}`, list);
  else await api(`/config/api-keys/${family}`, { method: "DELETE" });
}
