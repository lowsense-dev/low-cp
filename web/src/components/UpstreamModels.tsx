import { useEffect, useMemo, useState } from "react";
import { post } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, ErrorBox, Modal } from "./ui";
import { ModelPicker } from "./ModelPicker";

export type UpstreamSource = { family: string; baseUrl: string; apiKeys: string[]; headers?: Record<string, string> };

/** Fetches a provider's own model list and lets the user pick which to keep. */
export function UpstreamModelsModal({ source, current, title, onApply, onClose }: { source: UpstreamSource; current: string[]; title: string; onApply: (models: string[]) => Promise<void> | void; onClose: () => void }) {
  const { t } = useI18n();
  const [upstream, setUpstream] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(current));
  const [saving, setSaving] = useState(false);

  // Callers pass a fresh object each render; fetch once per distinct source.
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    const s = JSON.parse(sourceKey) as UpstreamSource;
    post<{ models: string[] }>("/lowcp/upstream-models", { family: s.family, base_url: s.baseUrl, api_keys: s.apiKeys, headers: s.headers })
      .then((res) => setUpstream(res.models))
      .catch(setError);
  }, [sourceKey]);

  // Keep configured models visible even when the upstream no longer lists them.
  const models = useMemo(() => [...new Set([...(upstream ?? []), ...current])].sort().map((id) => ({ id, owned_by: upstream && !upstream.includes(id) ? t("upstream.notListed") : undefined })), [upstream, current, t]);
  const added = [...selected].filter((m) => !current.includes(m)).length;
  const removed = current.filter((m) => !selected.has(m)).length;

  const apply = async () => {
    setSaving(true);
    try {
      await onApply([...selected].sort());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("upstream.title")}
      description={title}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted tabular-nums">{upstream ? t("upstream.diff", { added, removed, total: upstream.length }) : ""}</span>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={apply} loading={saving} disabled={!upstream || selected.size === 0}>
            {t("upstream.apply")}
          </Button>
        </>
      }
    >
      {error ? <ErrorBox error={error} /> : <ModelPicker models={models} loading={!upstream} selected={selected} onChange={setSelected} />}
    </Modal>
  );
}
