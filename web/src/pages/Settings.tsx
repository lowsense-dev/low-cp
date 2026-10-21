import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { ApiError, getKey } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { qk } from "../lib/queries";
import { Button, ErrorBox, PageHeader, Skeleton, useNotify } from "../components/ui";

/** Raw config.yaml editor with ETag-based conflict detection. */
export function Settings() {
  const { t } = useI18n();
  const notify = useNotify();
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [etag, setEtag] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/v8/management/config.yaml", { headers: { Authorization: `Bearer ${getKey()}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      const body = await res.text();
      setText(body);
      setOriginal(body);
      setEtag(res.headers.get("ETag") ?? "");
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (text == null) return;
    setSaving(true);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${getKey()}`, "Content-Type": "application/yaml" };
      if (etag) headers["If-Match"] = etag;
      const res = await fetch("/v8/management/config.yaml", { method: "PUT", headers, body: text });
      if (res.status === 412) throw new Error(t("settings.conflict"));
      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try {
          const parsed = JSON.parse(body);
          msg = parsed.message ?? parsed.error ?? body;
        } catch {
          /* plain text */
        }
        throw new Error(msg);
      }
      notify.ok(t("common.saved"));
      qc.invalidateQueries({ queryKey: qk.config });
      await load();
    } catch (e) {
      notify.err(e);
    } finally {
      setSaving(false);
    }
  };

  const dirty = text != null && text !== original;

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <>
            <Button icon={<RefreshCw className="size-4" />} onClick={load}>
              {t("settings.reload")}
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
              {t("common.save")}
            </Button>
          </>
        }
      />
      {error != null && (
        <div className="mb-3">
          <ErrorBox error={error} />
        </div>
      )}
      {text == null ? (
        <Skeleton className="h-[70vh] rounded-xl" />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              if (dirty) void save();
            }
            if (e.key === "Tab") {
              // YAML is indentation-based: insert spaces instead of moving focus.
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: start, selectionEnd: end } = el;
              const next = text.slice(0, start) + "  " + text.slice(end);
              setText(next);
              requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
            }
          }}
          spellCheck={false}
          aria-label={t("settings.title")}
          className="h-[70vh] w-full resize-none rounded-xl border border-line bg-surface p-4 font-mono text-[12.5px] leading-5 focus:border-accent focus:outline-none"
        />
      )}
    </>
  );
}
