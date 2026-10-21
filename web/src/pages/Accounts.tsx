import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, FileUp, Gauge, LogIn, Pencil, RefreshCw, Search, Tag, Trash2, UploadCloud, Users, XCircle } from "lucide-react";
import { api, del, get, patch, post, type Credential, type ImportResult } from "../lib/api";
import { useI18n, type TKey } from "../lib/i18n";
import { qk, useCredentials } from "../lib/queries";
import { OAUTH_PROVIDERS, providerColor, providerName } from "../lib/providers";
import { cn, downloadBlob, relativeTime } from "../lib/util";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Skeleton, Spinner, Switch, Textarea, useConfirm, useNotify } from "../components/ui";
import { RowMenu } from "../components/RowMenu";
import { QuotaCell, supportsQuota, useQuotaCheck } from "../components/Quota";
import { ProviderPrefixesModal } from "../components/ProviderPrefixes";
import { Sparkline } from "../components/Sparkline";

type Status = "active" | "disabled" | "cooldown" | "error";

export function credentialStatus(c: Credential): Status {
  if (c.disabled || c.status === "disabled") return "disabled";
  if (c.status === "error") return "error";
  const retry = c.next_retry_after ? new Date(c.next_retry_after).getTime() : 0;
  if (c.unavailable || retry > Date.now() || (c.cooldowns?.length ?? 0) > 0) return "cooldown";
  return "active";
}

const STATUS_TONE: Record<Status, "ok" | "neutral" | "warn" | "err"> = { active: "ok", disabled: "neutral", cooldown: "warn", error: "err" };

export function Accounts() {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error } = useCredentials();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [oauthOpen, setOauthOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [prefixesOpen, setPrefixesOpen] = useState(false);
  const [checkingQuota, setCheckingQuota] = useState(false);
  const checkQuota = useQuotaCheck();

  const all = data ?? [];
  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of all) counts.set(c.provider, (counts.get(c.provider) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((c) => provider === "all" || c.provider === provider)
      .filter((c) => !q || [c.label, c.email, c.name, c.prefix, c.note].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => a.provider.localeCompare(b.provider) || (a.label ?? a.name).localeCompare(b.label ?? b.name));
  }, [all, provider, query]);

  // Drop selections that disappeared after a refetch or filter change.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((name) => rows.some((r) => r.name === name))));
  }, [rows]);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.credentials });

  const setDisabled = useMutation({
    mutationFn: async ({ names, disabled }: { names: string[]; disabled: boolean }) => {
      for (const name of names) await patch("/credentials/status", { name, disabled });
    },
    onSuccess: invalidate,
    onError: notify.err,
  });

  const refresh = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) await post("/credentials/refresh", { name });
    },
    onSuccess: () => {
      notify.ok(t("accounts.refreshed"));
      invalidate();
    },
    onError: (e) => {
      notify.err(e);
      invalidate();
    },
  });

  const remove = async (names: string[]) => {
    if (!(await confirm({ title: t("common.delete"), body: t("accounts.deleteConfirm", { n: names.length }), confirm: t("common.delete"), danger: true }))) return;
    try {
      await del("/credentials", { names });
      notify.ok(t("accounts.deleted", { n: names.length }));
      setSelected(new Set());
    } catch (e) {
      notify.err(e);
    }
    invalidate();
  };

  const download = async (c: Credential) => {
    try {
      const body = await get<unknown>(`/credentials/download?name=${encodeURIComponent(c.name)}`);
      downloadBlob(c.name, JSON.stringify(body, null, 2));
    } catch (e) {
      notify.err(e);
    }
  };

  const runQuotaCheck = async (list: Credential[]) => {
    const names = list.filter(supportsQuota).map((c) => c.name);
    if (!names.length) {
      notify.err(t("quota.unsupported"));
      return;
    }
    setCheckingQuota(true);
    const ok = await checkQuota(names);
    setCheckingQuota(false);
    if (ok === names.length) notify.ok(t("quota.checked", { n: ok }));
    else notify.err(t("quota.checked", { n: `${ok}/${names.length}` }));
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));
  const someSelected = selected.size > 0;
  const selectedNames = [...selected];

  return (
    <>
      <PageHeader
        title={t("accounts.title")}
        subtitle={t("accounts.subtitle")}
        actions={
          <>
            <Button icon={<Tag className="size-4" />} onClick={() => setPrefixesOpen(true)}>
              {t("prefixes.button")}
            </Button>
            <Button icon={<Gauge className="size-4" />} onClick={() => runQuotaCheck(rows)} loading={checkingQuota} disabled={!rows.some(supportsQuota)}>
              {t("quota.checkAll")}
            </Button>
            <Button icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
              {t("accounts.import")}
            </Button>
            <Button variant="primary" icon={<LogIn className="size-4" />} onClick={() => setOauthOpen(true)}>
              {t("accounts.login")}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} className="pl-9" aria-label={t("common.search")} />
        </div>
        <div className="flex flex-wrap gap-1">
          <FilterChip active={provider === "all"} onClick={() => setProvider("all")}>
            {t("accounts.all")} <span className="text-faint">{all.length}</span>
          </FilterChip>
          {providers.map(([id, count]) => (
            <FilterChip key={id} active={provider === id} onClick={() => setProvider(id)}>
              <span className="size-2 rounded-full" style={{ background: providerColor(id) }} />
              {providerName(id)} <span className="text-faint">{count}</span>
            </FilterChip>
          ))}
        </div>
      </div>

      {someSelected && (
        <div className="animate-fade-in mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2">
          <span className="mr-2 text-sm font-medium text-accent">{t("common.selected", { n: selected.size })}</span>
          <Button size="sm" onClick={() => setDisabled.mutate({ names: selectedNames, disabled: false })} loading={setDisabled.isPending}>
            {t("common.enable")}
          </Button>
          <Button size="sm" onClick={() => setDisabled.mutate({ names: selectedNames, disabled: true })} loading={setDisabled.isPending}>
            {t("common.disable")}
          </Button>
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => refresh.mutate(selectedNames)} loading={refresh.isPending}>
            {t("accounts.refreshToken")}
          </Button>
          <Button size="sm" icon={<Gauge className="size-3.5" />} onClick={() => runQuotaCheck(rows.filter((r) => selected.has(r.name)))} loading={checkingQuota}>
            {t("quota.check")}
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => remove(selectedNames)}>
            {t("common.delete")}
          </Button>
          <button className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSelected(new Set())}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      <Card className="overflow-hidden">
        {error ? (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty
            icon={<Users className="size-5" />}
            title={t("accounts.empty")}
            hint={t("accounts.emptyHint")}
            action={
              <Button variant="primary" icon={<LogIn className="size-4" />} onClick={() => setOauthOpen(true)}>
                {t("accounts.login")}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="w-10 py-2.5 pl-4">
                    <Checkbox label={t("accounts.all")} checked={allSelected} indeterminate={someSelected && !allSelected} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.name)) : new Set())} />
                  </th>
                  <th className="w-[30%] min-w-56 py-2.5 pr-3 font-medium">{t("accounts.col.account")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("accounts.col.status")}</th>
                  <th className="hidden py-2.5 pr-3 font-medium lg:table-cell">{t("accounts.col.prefix")}</th>
                  <th className="hidden py-2.5 pr-3 font-medium lg:table-cell">{t("quota.col")}</th>
                  <th className="hidden py-2.5 pr-3 font-medium md:table-cell">{t("accounts.col.activity")}</th>
                  <th className="hidden py-2.5 pr-3 font-medium xl:table-cell">{t("accounts.col.refresh")}</th>
                  <th className="w-28 py-2.5 pr-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const status = credentialStatus(c);
                  return (
                    <tr key={c.name} className={cn("group border-b border-line last:border-0 hover:bg-surface-2/60", selected.has(c.name) && "bg-accent-soft/40")}>
                      <td className="py-2.5 pl-4">
                        <Checkbox
                          label={c.name}
                          checked={selected.has(c.name)}
                          onChange={(v) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(c.name);
                              else next.delete(c.name);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-0 min-w-56 py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white" style={{ background: providerColor(c.provider) }}>
                            {providerName(c.provider).slice(0, 2)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.email || c.label || c.name}</div>
                            <div className="truncate text-xs text-faint">
                              {providerName(c.provider)}
                              {c.note ? ` · ${c.note}` : ""}
                              {c.priority ? ` · P${c.priority}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={STATUS_TONE[status]}>{t(`accounts.status.${status}` as TKey)}</Badge>
                        {c.status_message && status !== "active" && (
                          <div className="mt-1 max-w-56 truncate text-xs text-faint" title={c.status_message}>
                            {c.status_message}
                          </div>
                        )}
                      </td>
                      <td className="hidden py-2.5 pr-3 lg:table-cell">{c.prefix ? <Badge tone="accent">{c.prefix}/</Badge> : <span className="text-faint">{t("common.none")}</span>}</td>
                      <td className="hidden py-2.5 pr-3 lg:table-cell">
                        <QuotaCell credential={c} onCheck={() => runQuotaCheck([c])} />
                      </td>
                      <td className="hidden py-2.5 pr-3 md:table-cell">
                        <div className="flex items-center gap-3">
                          <Sparkline buckets={c.recent_requests ?? []} />
                          <span className="text-xs whitespace-nowrap tabular-nums">
                            <span className="text-ok">{c.success ?? 0}</span>
                            <span className="text-faint"> / </span>
                            <span className={(c.failed ?? 0) > 0 ? "text-err" : "text-faint"}>{c.failed ?? 0}</span>
                          </span>
                        </div>
                      </td>
                      <td className="hidden py-2.5 pr-3 text-xs whitespace-nowrap text-muted xl:table-cell">{relativeTime(c.last_refresh, lang) || t("common.none")}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Switch label={t("common.enabled")} checked={!c.disabled} onChange={(v) => setDisabled.mutate({ names: [c.name], disabled: !v })} />
                          <RowMenu
                            items={[
                              { label: t("common.edit"), icon: <Pencil />, onClick: () => setEditing(c) },
                              { label: t("accounts.refreshToken"), icon: <RefreshCw />, onClick: () => refresh.mutate([c.name]) },
                              { label: t("quota.check"), icon: <Gauge />, onClick: () => runQuotaCheck([c]), hidden: !supportsQuota(c) },
                              { label: t("accounts.download"), icon: <Download />, onClick: () => download(c) },
                              { label: t("common.delete"), icon: <Trash2 />, onClick: () => remove([c.name]), danger: true },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OAuthModal open={oauthOpen} onClose={() => setOauthOpen(false)} onAdded={invalidate} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={invalidate} />
      <EditModal credential={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      <ProviderPrefixesModal open={prefixesOpen} onClose={() => setPrefixesOpen(false)} />
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors", active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

// ---------- OAuth login ----------

type OAuthState = { provider: string; url: string; state: string } | null;

function OAuthModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const [session, setSession] = useState<OAuthState>(null);
  const [starting, setStarting] = useState("");
  const [redirect, setRedirect] = useState("");
  const [phase, setPhase] = useState<"pick" | "wait" | "ok" | "error">("pick");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    if (session && phase === "wait") void api(`/oauth/session?state=${session.state}`, { method: "DELETE" }).catch(() => {});
    setSession(null);
    setRedirect("");
    setPhase("pick");
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  // Poll the login status while waiting.
  useEffect(() => {
    if (!session || phase !== "wait") return;
    const timer = setInterval(async () => {
      try {
        const res = await get<{ status: string; error?: string }>(`/oauth/status?state=${session.state}`);
        if (res.status === "ok") {
          setPhase("ok");
          onAdded();
        } else if (res.status === "error") {
          setPhase("error");
          setError(res.error ?? t("oauth.failed"));
        }
      } catch {
        /* transient: keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [session, phase, onAdded, t]);

  const start = async (provider: string) => {
    setStarting(provider);
    setError("");
    try {
      const res = await get<{ url: string; state: string }>(`/oauth/auth-url?provider=${provider}&is_webui=1`);
      setSession({ provider, url: res.url, state: res.state });
      setPhase("wait");
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting("");
    }
  };

  const submitRedirect = async () => {
    if (!session) return;
    setSubmitting(true);
    setError("");
    try {
      await post("/oauth/callback", { provider: session.provider, redirect_url: redirect.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={t("oauth.title")} description={phase === "pick" ? t("oauth.pick") : session && providerName(session.provider)}>
      {phase === "pick" && (
        <div className="grid grid-cols-2 gap-2">
          {OAUTH_PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => start(p.id)} disabled={!!starting} className="flex items-center gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-accent/50 hover:bg-surface-2 disabled:opacity-60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ background: providerColor(p.id) }}>
                {starting === p.id ? <Spinner className="text-white" /> : p.name.slice(0, 2)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-faint">{p.hint}</span>
              </span>
            </button>
          ))}
          {error && (
            <div className="col-span-2">
              <ErrorBox error={error} />
            </div>
          )}
        </div>
      )}

      {phase === "wait" && session && (
        <div className="space-y-5">
          <Step n={1} title={t("oauth.step1")}>
            <a href={session.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">
              <ExternalLink className="size-4" />
              {t("oauth.open")}
            </a>
          </Step>
          <Step n={2} title={t("oauth.step2")}>
            <p className="mb-2 text-xs text-muted">{t("oauth.step2Hint")}</p>
            <div className="flex gap-2">
              <Input value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder={t("oauth.redirectPlaceholder")} className="font-mono text-xs" />
              <Button variant="primary" onClick={submitRedirect} loading={submitting} disabled={!redirect.trim()}>
                {t("oauth.submit")}
              </Button>
            </div>
          </Step>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> {t("oauth.waiting")}
          </div>
          {error && <ErrorBox error={error} />}
        </div>
      )}

      {(phase === "ok" || phase === "error") && (
        <div className="flex flex-col items-center py-4 text-center">
          {phase === "ok" ? <CheckCircle2 className="mb-3 size-10 text-ok" /> : <XCircle className="mb-3 size-10 text-err" />}
          <p className="font-medium">{phase === "ok" ? t("oauth.success") : t("oauth.failed")}</p>
          {error && <p className="mt-1 max-w-sm text-sm text-muted">{error}</p>}
          <div className="mt-5 flex gap-2">
            <Button onClick={reset}>{t("oauth.again")}</Button>
            <Button variant="primary" onClick={close}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

// ---------- Import ----------

function ImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useI18n();
  const notify = useNotify();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [format, setFormat] = useState("auto");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setText("");
    setResult(null);
  };

  const run = useMutation({
    mutationFn: async () => {
      const items = await Promise.all(files.map((f) => f.text()));
      if (text.trim()) items.push(text.trim());
      if (items.length === 0) throw new Error(t("import.nothing"));
      return post<ImportResult>("/credentials/import", { provider: format, items });
    },
    onSuccess: (res) => {
      setResult(res);
      if (res.imported.length) onImported();
      const msg = t("import.done", { ok: res.imported.length, fail: res.failed.length });
      if (res.failed.length) notify.err(msg);
      else notify.ok(msg);
      if (!res.failed.length) {
        reset();
        onClose();
      }
    },
    onError: notify.err,
  });

  const labelFor = (index: number) => (index < files.length ? files[index].name : "JSON");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("import.title")}
      description={t("import.subtitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending} disabled={!files.length && !text.trim()}>
            {t("import.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("import.provider")}>
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="auto">{t("import.auto")}</option>
            <option value="codex">Codex (~/.codex/auth.json)</option>
            <option value="claude">Claude Code (~/.claude/.credentials.json)</option>
            <option value="antigravity">Antigravity / Google refresh token</option>
          </Select>
        </Field>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-surface-2")}
        >
          <UploadCloud className="mb-2 size-6 text-muted" />
          <p className="text-sm text-muted">{t("import.drop")}</p>
          {files.length > 0 && <p className="mt-2 text-xs font-medium text-accent">{t("import.files", { n: files.length })}</p>}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-1 pl-2 text-xs">
                {f.name}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-0.5 text-faint hover:text-err" aria-label={t("common.delete")}>
                  <XCircle className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Field label={t("import.paste")}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{"tokens": {...}}' className="min-h-28 font-mono text-xs" spellCheck={false} />
        </Field>
        {result && result.failed.length > 0 && (
          <div className="space-y-1.5">
            {result.failed.map((f, i) => (
              <ErrorBox key={i} error={`${labelFor(f.index)}: ${f.error}`} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Edit ----------

function EditModal({ credential, onClose, onSaved }: { credential: Credential | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const notify = useNotify();
  const [priority, setPriority] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!credential) return;
    setPriority(credential.priority != null ? String(credential.priority) : "");
    setNote(credential.note ?? "");
  }, [credential]);

  const save = useMutation({
    mutationFn: () =>
      patch("/credentials/fields", {
        name: credential!.name,
        priority: priority.trim() === "" ? 0 : Number(priority),
        note: note.trim(),
      }),
    onSuccess: () => {
      notify.ok(t("common.saved"));
      onSaved();
      onClose();
    },
    onError: notify.err,
  });

  return (
    <Modal
      open={!!credential}
      onClose={onClose}
      title={t("accounts.edit.title")}
      description={credential?.email || credential?.name}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={priority.trim() !== "" && Number.isNaN(Number(priority))}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("accounts.edit.priority")} hint={t("accounts.edit.priorityHint")}>
          <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" />
        </Field>
        <Field label={t("accounts.edit.note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
