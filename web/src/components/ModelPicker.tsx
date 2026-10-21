import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AvailableModel } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Checkbox, Input, Spinner } from "./ui";

/** Checkbox list of models with search, select all / deselect all / invert. */
export function ModelPicker({ models, loading, selected, onChange }: { models: AvailableModel[]; loading: boolean; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.owned_by?.toLowerCase().includes(q)) : models;
  }, [models, query]);

  const groups = useMemo(() => {
    const map = new Map<string, AvailableModel[]>();
    for (const m of visible) {
      const owner = m.owned_by || "—";
      map.set(owner, [...(map.get(owner) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  // Bulk buttons act on the visible (filtered) list only.
  const apply = (fn: (id: string, isOn: boolean) => boolean) => {
    const next = new Set(selected);
    for (const m of visible) {
      if (fn(m.id, next.has(m.id))) next.add(m.id);
      else next.delete(m.id);
    }
    onChange(next);
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  const count = models.filter((m) => selected.has(m.id)).length;

  return (
    <div className="rounded-xl border border-line">
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("access.modelsSearch")} className="h-8 pl-9 text-xs" aria-label={t("access.modelsSearch")} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => apply(() => true)}>
            {t("access.selectAll")}
          </Button>
          <Button size="sm" onClick={() => apply(() => false)}>
            {t("access.deselectAll")}
          </Button>
          <Button size="sm" onClick={() => apply((_, isOn) => !isOn)}>
            {t("access.invert")}
          </Button>
          <span className="ml-auto text-xs text-muted tabular-nums">{t("access.selectedCount", { n: count, total: models.length })}</span>
        </div>
        {query.trim() && <p className="text-[11px] text-faint">{t("access.filteredNote")}</p>}
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">{t("access.noModels")}</p>
        ) : (
          groups.map(([owner, list]) => (
            <div key={owner} className="mb-1">
              {owner !== "—" && <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{owner}</div>}
              {list.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 hover:bg-surface-2">
                  <Checkbox label={m.id} checked={selected.has(m.id)} onChange={(v) => toggle(m.id, v)} />
                  <span className="truncate font-mono text-xs">{m.id}</span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
