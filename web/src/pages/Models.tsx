import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, RefreshCw, Search } from "lucide-react";
import { api, get, put, type AvailableModel, type ProviderGroup } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { qk, useConfig } from "../lib/queries";
import { familyById, providerColor, providerName } from "../lib/providers";
import { cn } from "../lib/util";
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, IconButton, Input, PageHeader, Skeleton, Switch, useNotify } from "../components/ui";
import { UpstreamModelsModal, type UpstreamSource } from "../components/UpstreamModels";

const PATH = "/config/routing/disabled-models";

type ModelGroup = { id: string; label: string; kind: "oauth" | "apikey"; provider: string; prefix?: string; base_url?: string; compat_name?: string; models: string[] };
type ModelsResponse = { models: AvailableModel[]; groups: ModelGroup[] };

/** Find the config group behind an API-key model source. */
function configGroupFor(g: ModelGroup, all: Record<string, ProviderGroup[]>) {
  const family = g.compat_name ? "openai-compatibility" : g.provider;
  const list = all[family] ?? [];
  const index = g.compat_name ? list.findIndex((x) => x.name === g.compat_name) : list.findIndex((x) => (x.prefix ?? "") === (g.prefix ?? "") && (x["base-url"] ?? "") === (g.base_url ?? ""));
  return index >= 0 ? { family, index, list, group: list[index] } : null;
}

export function Models() {
  const { t } = useI18n();
  const notify = useNotify();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["models", "groups"], queryFn: () => get<ModelsResponse>("/lowcp/models") });
  const { data: config } = useConfig();
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState<ModelGroup | null>(null);

  const models = query.data?.models ?? [];
  const groups = query.data?.groups ?? [];

  // The config list may hold wildcard patterns the panel does not edit; keep them.
  const stored = useMemo(() => config?.routing?.["disabled-models"] ?? [], [config]);
  const ids = useMemo(() => new Set(models.map((m) => m.id)), [models]);
  const patterns = stored.filter((p) => !ids.has(p));
  const original = useMemo(() => new Set(stored.filter((p) => ids.has(p))), [stored, ids]);
  useEffect(() => setDisabled(new Set(original)), [original]);

  const q = search.trim().toLowerCase();
  const visibleGroups = useMemo(
    () => groups.map((g) => ({ ...g, models: q ? g.models.filter((m) => m.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) : g.models })).filter((g) => g.models.length > 0),
    [groups, q],
  );
  const visibleIds = useMemo(() => [...new Set(visibleGroups.flatMap((g) => g.models))], [visibleGroups]);
  const dirty = disabled.size !== original.size || [...disabled].some((id) => !original.has(id));

  // Bulk actions apply to the visible (filtered) models.
  const apply = (fn: (enabled: boolean) => boolean) => {
    const next = new Set(disabled);
    for (const id of visibleIds) {
      if (fn(!next.has(id))) next.delete(id);
      else next.add(id);
    }
    setDisabled(next);
  };
  const setEnabled = (id: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(id);
    else next.add(id);
    setDisabled(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const list = [...patterns, ...[...disabled].sort()];
      if (list.length) await put(PATH, list);
      else await api(PATH, { method: "DELETE" }).catch(() => {});
      notify.ok(t("models.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      qc.invalidateQueries({ queryKey: ["models"] });
    } catch (e) {
      notify.err(e);
    } finally {
      setSaving(false);
    }
  };

  const target = refreshing && config ? configGroupFor(refreshing, config["api-keys"] ?? {}) : null;
  const openRefresh = (g: ModelGroup) => {
    const found = config ? configGroupFor(g, config["api-keys"] ?? {}) : null;
    if (!found) return notify.err(t("upstream.noConfig"));
    if (!found.group.keys?.[0]?.["api-key"]) return notify.err(t("upstream.needKey"));
    setRefreshing(g);
  };
  const source: UpstreamSource | null = target
    ? { family: target.family, baseUrl: target.group["base-url"] || familyById(target.family).defaultBase, apiKeys: (target.group.keys ?? []).map((k) => k["api-key"]), headers: target.group.headers }
    : null;
  const applyRefresh = async (names: string[]) => {
    if (!target) return;
    const previous = target.group.models ?? [];
    const next = names.map((name) => previous.find((m) => m.name === name) ?? { name });
    const list = target.list.map((g, i) => (i === target.index ? { ...g, models: next, keys: g.keys?.map(({ auth_index: _ignored, ...k }) => k) } : g));
    try {
      await put(`/config/api-keys/${target.family}`, list);
      notify.ok(t("common.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      // The server reloads models asynchronously after a config write.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["models"] }), 1500);
    } catch (e) {
      notify.err(e);
      throw e;
    }
  };

  const enabledCount = models.length - models.filter((m) => disabled.has(m.id)).length;

  return (
    <>
      <PageHeader
        title={t("models.title")}
        subtitle={t("models.subtitle")}
        actions={
          <Button icon={<RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />} onClick={() => query.refetch()}>
            {t("models.refresh")}
          </Button>
        }
      />
      {query.error ? (
        <ErrorBox error={query.error} />
      ) : query.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : models.length === 0 ? (
        <Card>
          <Empty icon={<Boxes className="size-5" />} title={t("models.empty")} />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("access.modelsSearch")} className="pl-9" aria-label={t("access.modelsSearch")} />
            </div>
            <Button size="sm" onClick={() => apply(() => true)}>
              {t("access.selectAll")}
            </Button>
            <Button size="sm" onClick={() => apply(() => false)}>
              {t("access.deselectAll")}
            </Button>
            <Button size="sm" onClick={() => apply((on) => !on)}>
              {t("access.invert")}
            </Button>
            <span className="ml-auto text-sm text-muted tabular-nums">{t("models.enabled", { n: enabledCount, total: models.length })}</span>
          </div>
          {q && <p className="mb-2 text-xs text-faint">{t("access.filteredNote")}</p>}

          <div className="space-y-4 pb-20">
            {visibleGroups.map((g) => {
              const family = g.compat_name ? "openai-compatibility" : g.provider;
              const format = familyById(family).format;
              return (
                <Card key={g.id} className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                    <span className="size-2.5 rounded-full" style={{ background: providerColor(g.kind === "oauth" ? g.provider : family) }} />
                    <span className="font-medium">{g.kind === "oauth" ? providerName(g.provider) : g.label}</span>
                    <Badge>{g.kind === "oauth" ? t("models.oauth") : format ? t(format) : familyById(family).title}</Badge>
                    {g.base_url && <span className="hidden truncate font-mono text-xs text-faint md:inline">{g.base_url}</span>}
                    <span className="text-xs text-faint tabular-nums">
                      {g.models.filter((m) => !disabled.has(m)).length}/{g.models.length}
                    </span>
                    {g.kind === "apikey" && (
                      <IconButton label={t("upstream.refreshGroup")} className="ml-auto" onClick={() => openRefresh(g)}>
                        <RefreshCw className="size-4" />
                      </IconButton>
                    )}
                  </div>
                  <ul className="grid sm:grid-cols-2 xl:grid-cols-3">
                    {g.models.map((id) => {
                      const on = !disabled.has(id);
                      return (
                        <li key={id} className="group flex items-center gap-2 border-b border-line px-4 py-2">
                          <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", !on && "text-faint line-through")} title={id}>
                            {id}
                          </span>
                          <CopyButton value={id} className="opacity-0 group-hover:opacity-100" />
                          <Switch checked={on} onChange={(v) => setEnabled(id, v)} label={id} />
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {refreshing && source && target && (
        <UpstreamModelsModal source={source} current={(target.group.models ?? []).map((m) => m.name)} title={refreshing.label} onApply={applyRefresh} onClose={() => setRefreshing(null)} />
      )}

      {dirty && (
        <div className="animate-pop-in fixed right-0 bottom-0 left-0 z-40 flex justify-center p-4 md:left-60">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pr-2 pl-4 shadow-panel">
            <span className="text-sm text-muted">{t("common.unsaved")}</span>
            <Button size="sm" onClick={() => setDisabled(new Set(original))}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={save} loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
