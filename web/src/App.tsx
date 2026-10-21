import { useEffect, useState, type ReactNode } from "react";
import { Activity, BarChart3, Boxes, Globe, KeyRound, LayoutDashboard, Languages, LogOut, Moon, Network, ScrollText, Server, Settings2, Sun, Users } from "lucide-react";
import { setKey, setUnauthorizedHandler, getKey } from "./lib/api";
import { useI18n, type TKey } from "./lib/i18n";
import { cn } from "./lib/util";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Accounts } from "./pages/Accounts";
import { Providers } from "./pages/Providers";
import { AccessKeys } from "./pages/AccessKeys";
import { Routing } from "./pages/Routing";
import { Domain } from "./pages/Domain";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { Stats } from "./pages/Stats";
import { Models } from "./pages/Models";

const BASE = "/panel";

const ROUTES: { path: string; label: TKey; icon: ReactNode; page: () => ReactNode }[] = [
  { path: "", label: "nav.overview", icon: <LayoutDashboard />, page: () => <Overview /> },
  { path: "stats", label: "nav.stats", icon: <BarChart3 />, page: () => <Stats /> },
  { path: "accounts", label: "nav.accounts", icon: <Users />, page: () => <Accounts /> },
  { path: "providers", label: "nav.providers", icon: <Server />, page: () => <Providers /> },
  { path: "models", label: "nav.models", icon: <Boxes />, page: () => <Models /> },
  { path: "access", label: "nav.access", icon: <KeyRound />, page: () => <AccessKeys /> },
  { path: "routing", label: "nav.routing", icon: <Network />, page: () => <Routing /> },
  { path: "domain", label: "nav.domain", icon: <Globe />, page: () => <Domain /> },
  { path: "logs", label: "nav.logs", icon: <ScrollText />, page: () => <Logs /> },
  { path: "settings", label: "nav.settings", icon: <Settings2 />, page: () => <Settings /> },
];

function currentRoute() {
  return location.pathname.replace(new RegExp(`^${BASE}/?`), "").replace(/\/$/, "");
}

export function navigate(path: string) {
  history.pushState(null, "", `${BASE}/${path}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("lowcp.theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* ignore */
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("lowcp.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")] as const;
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getKey());
  const [route, setRoute] = useState(currentRoute);
  const [theme, toggleTheme] = useTheme();
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPop);
    setUnauthorizedHandler(() => {
      setKey("");
      setAuthed(false);
    });
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const active = ROUTES.find((r) => r.path === route) ?? ROUTES[0];
  const logout = () => {
    setKey("");
    setAuthed(false);
  };

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Activity className="size-4.5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight">low-cp</div>
            <div className="truncate text-[11px] text-faint">{t("app.tagline")}</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {ROUTES.map((r) => (
            <NavLink key={r.path} active={r === active} onClick={() => navigate(r.path)} icon={r.icon}>
              {t(r.label)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t border-line px-1 pt-3">
          <button onClick={() => setLang(lang === "ru" ? "en" : "ru")} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg" title="Language">
            <Languages className="size-4" />
            {lang.toUpperCase()}
          </button>
          <button onClick={toggleTheme} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" title={t("theme.toggle")} aria-label={t("theme.toggle")}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button onClick={logout} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
            <LogOut className="size-4" />
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 overflow-x-auto border-b border-line bg-surface/90 px-3 py-2 backdrop-blur md:hidden">
          {ROUTES.map((r) => (
            <button key={r.path} onClick={() => navigate(r.path)} className={cn("h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium", r === active ? "bg-accent-soft text-accent" : "text-muted")}>
              {t(r.label)}
            </button>
          ))}
          <button onClick={toggleTheme} className="ml-auto shrink-0 p-1.5 text-muted" aria-label={t("theme.toggle")}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button onClick={() => setLang(lang === "ru" ? "en" : "ru")} className="shrink-0 px-1.5 text-xs font-medium text-muted">
            {lang.toUpperCase()}
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">{active.page()}</main>
      </div>
    </div>
  );
}

function NavLink({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors [&_svg]:size-4",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
