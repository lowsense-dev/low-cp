import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileWarning, Pause, Play, Search, Trash2 } from "lucide-react";
import { ApiError, api, get } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useConfigPatch } from "../lib/queries";
import { cn, downloadBlob } from "../lib/util";
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Segmented, useConfirm, useNotify } from "../components/ui";
import { RequestLog } from "./RequestLog";

type LogsResponse = { lines?: string[]; "next-cursor"?: string; "cursor-reset"?: boolean };
type ErrorFile = { name: string; size?: number; modified?: string | number };

const MAX_LINES = 2000;

function lineTone(line: string) {
  if (/\[(error|fatal|panic)\s*\]/i.test(line)) return "text-err";
  if (/\[warn(ing)?\s*\]/i.test(line)) return "text-warn";
  if (/\[debug\s*\]/i.test(line)) return "text-faint";
  return "text-fg/85";
}

function SystemLog() {
  const { t } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const patchConfig = useConfigPatch();
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cursor = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const query = cursor.current ? `?cursor=${encodeURIComponent(cursor.current)}` : "?limit=500";
        const res = await get<LogsResponse>(`/observability/logs${query}`);
        if (cancelled) return;
        setDisabled(false);
        setError(null);
        cursor.current = res["next-cursor"] ?? cursor.current;
        const fresh = res.lines ?? [];
        setLines((prev) => (res["cursor-reset"] ? fresh : [...prev, ...fresh]).slice(-MAX_LINES));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 400 && /disabled/i.test(e.message)) setDisabled(true);
        else setError(e);
      }
    };
    void tick();
    const timer = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live]);

  // Keep the view pinned to the bottom unless the user scrolled up.
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
  }, [lines, filter]);

  const errorFiles = useQuery({ queryKey: ["error-logs"], queryFn: async () => (await get<{ files?: ErrorFile[] }>("/observability/logs/errors")).files ?? [], refetchInterval: 30_000 });

  const clear = async () => {
    if (!(await confirm({ title: t("logs.clear"), body: t("logs.clearConfirm"), confirm: t("logs.clear"), danger: true }))) return;
    try {
      await api("/observability/logs", { method: "DELETE" });
      setLines([]);
      cursor.current = "";
    } catch (e) {
      notify.err(e);
    }
  };

  const downloadError = async (name: string) => {
    try {
      const body = await api<unknown>(`/observability/logs/errors/${encodeURIComponent(name)}`);
      downloadBlob(name, typeof body === "string" ? body : JSON.stringify(body, null, 2), "text/plain");
    } catch (e) {
      notify.err(e);
    }
  };

  const enableFileLogging = async () => {
    try {
      await patchConfig.mutateAsync({ observability: { logs: { "logging-to-file": true } } });
      setDisabled(false);
      cursor.current = "";
    } catch (e) {
      notify.err(e);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("logs.filter")} className="pl-9" aria-label={t("logs.filter")} />
            </div>
            <Button icon={live ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => setLive(!live)}>
              {live ? t("logs.live") : t("logs.paused")}
            </Button>
            <Button icon={<Trash2 className="size-4" />} onClick={clear} disabled={disabled}>
              {t("logs.clear")}
            </Button>
                </div>

      {disabled ? (
        <Card>
          <Empty
            icon={<FileWarning className="size-5" />}
            title={t("logs.disabled")}
            action={
              <Button variant="primary" onClick={enableFileLogging} loading={patchConfig.isPending}>
                {t("logs.enable")}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {error != null && (
            <div className="mb-3">
              <ErrorBox error={error} />
            </div>
          )}
          <div
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="h-[60vh] overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-[12px] leading-5"
          >
            {shown.map((line, i) => (
              <div key={i} className={cn("whitespace-pre-wrap break-all", lineTone(line))}>
                {line}
              </div>
            ))}
            {shown.length === 0 && <div className="py-10 text-center text-faint">{t("common.none")}</div>}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 font-semibold">{t("logs.errors")}</h2>
      <Card>
        {(errorFiles.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-faint">{t("logs.noErrors")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {errorFiles.data!.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
                {f.size != null && <span className="text-xs text-faint tabular-nums">{(f.size / 1024).toFixed(1)} KB</span>}
                <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => downloadError(f.name)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function Logs() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"requests" | "system">(() => {
    try {
      return sessionStorage.getItem("lowcp.logsTab") === "system" ? "system" : "requests";
    } catch {
      return "requests";
    }
  });
  const pick = (v: "requests" | "system") => {
    setTab(v);
    try {
      sessionStorage.setItem("lowcp.logsTab", v);
    } catch {
      /* ignore */
    }
  };
  return (
    <>
      <PageHeader
        title={t("logs.title")}
        actions={
          <Segmented
            value={tab}
            onChange={pick}
            options={[
              { value: "requests", label: t("logs.tabRequests") },
              { value: "system", label: t("logs.tabSystem") },
            ]}
          />
        }
      />
      {tab === "requests" ? <RequestLog /> : <SystemLog />}
    </>
  );
}
