import { useState } from "react";
import { Activity, KeyRound } from "lucide-react";
import { api, ApiError, setKey } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, ErrorBox, Input } from "../components/ui";

export function Login({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/config", { key: value.trim() });
      setKey(value.trim());
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t("login.invalid"));
      else if (err instanceof ApiError && err.status === 403) setError(t("login.banned"));
      else setError(t("login.unreachable"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="animate-pop-in w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-panel">
            <Activity className="size-6" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">low-cp</h1>
          <p className="mt-1 text-sm text-muted">{t("app.tagline")}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-panel">
          <div>
            <h2 className="font-semibold">{t("login.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("login.subtitle")}</p>
          </div>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input type="password" autoFocus autoComplete="current-password" placeholder={t("login.key")} aria-label={t("login.key")} value={value} onChange={(e) => setValue(e.target.value)} className="pl-9" />
          </div>
          {error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!value.trim()}>
            {t("login.submit")}
          </Button>
        </form>
        <div className="mt-4 text-center">
          <button onClick={() => setLang(lang === "ru" ? "en" : "ru")} className="text-xs text-muted hover:text-fg">
            {lang === "ru" ? "English" : "Русский"}
          </button>
        </div>
      </div>
    </div>
  );
}
