import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Boxes, ChevronsLeft, ChevronsRight, Images, KeyRound, LayoutDashboard, LogOut, Menu, PlugZap, SquareTerminal, Store } from "lucide-react";
import { agentApi, authApi, type GitHubStatus, type ProviderProbe } from "@/lib/api";

const GitHubMark = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: `0 0 ${size}px` }}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export function useGitHub() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const refresh = () => agentApi.github().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void refresh(); }, []);
  return { status, refresh };
}

const NAV = [
  { href: "/", label: "Workspace Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Live Tasks", icon: Activity, badge: true },
  { href: "/sandbox", label: "Code Sandbox", icon: SquareTerminal },
  { href: "/media", label: "Media Vault", icon: Images },
  { href: "/integrations", label: "System Integrations", icon: PlugZap },
  { href: "/skills", label: "Skill Store", icon: Store },
  { href: "/keys", label: "API Key Manager", icon: KeyRound },
];

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="#8b75ff" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M16 5a11 11 0 0 1 11 11" fill="none" stroke="#8b75ff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="4" fill="#8b75ff" />
      <circle cx="25.5" cy="10.5" r="2" fill="#52d6b1" />
    </svg>
  );
}

function readCollapsed() {
  try { return localStorage.getItem("curialy.sidebar.collapsed") === "1"; } catch { return false; }
}

function useHealth() {
  const [providers, setProviders] = useState<ProviderProbe[] | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => agentApi.health().then(data => { if (alive) { setProviders(data.providers); setActive(data.activeTasks); } }).catch(() => alive && setProviders([]));
    load();
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return { providers, active };
}

export function AppShell({ title, crumb, actions, children }: { title: string; crumb?: string; actions?: ReactNode; children: ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { providers, active } = useHealth();
  const { status: github } = useGitHub();

  useEffect(() => { try { localStorage.setItem("curialy.sidebar.collapsed", collapsed ? "1" : "0"); } catch { /* storage unavailable */ } }, [collapsed]);
  useEffect(() => setMobileOpen(false), [location]);

  const healthy = providers?.filter(probe => probe.configured && probe.ok).length ?? 0;
  const configured = providers?.filter(probe => probe.configured).length ?? 0;
  const core = providers?.find(probe => probe.id === "core");
  const allUp = Boolean(core?.ok) && healthy === configured;
  const pillState = providers === null ? "" : allUp ? "ok" : core?.ok ? "warn" : "bad";
  const pillTitle = providers === null ? "Checking engines…" : allUp ? "All Engines Operational" : core?.ok ? "Curialy Core Online" : "Curialy Core Offline";
  const pillDetail = providers === null ? "Engine status" : core?.ok ? `${allUp ? "" : `${configured - healthy} degraded • `}Latency ${core.latencyMs}ms` : "Reconnecting…";

  const isActive = (href: string) => (href === "/" ? location === "/" : location.startsWith(href));

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " open" : ""}`} aria-label="Primary">
        <div className="sidebar-head">
          <Link href="/" className="brand" aria-label="Curialy home">
            <BrandMark />
            <span className="brand-word">Curialy<small>AI</small></span>
          </Link>
          <button className="icon-btn sm desktop-only" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        <nav>
          <div className="nav-section">Command</div>
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className={`nav-item${isActive(item.href) ? " active" : ""}`} title={collapsed ? item.label : undefined}>
              <item.icon size={17} />
              <span className="nav-text">{item.label}</span>
              {item.badge && active > 0 && <span className="nav-badge">{active}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/integrations" className="health-pill" title={providers?.map(probe => `${probe.label}: ${probe.ok ? "ok" : probe.detail}`).join("\n")}>
            <span className="dots">
              {(providers ?? [{ id: "x" } as ProviderProbe]).map(probe => <span key={probe.id} className={`dot ${providers === null ? "" : !probe.configured ? "" : probe.ok ? "ok" : "bad"}`} />)}
            </span>
            <span className="health-text">
              <span>{pillTitle}</span>
              <small>{pillDetail}</small>
            </span>
            <span className={`dot ${pillState}`} style={{ marginLeft: "auto" }} />
          </Link>
          {github?.connected ? (
            <Link href="/keys" className="nav-item" title={`GitHub: ${github.login}`}>
              {github.avatarUrl ? <img src={github.avatarUrl} alt="" width={17} height={17} style={{ borderRadius: "50%", flex: "0 0 17px" }} /> : <GitHubMark />}
              <span className="nav-text">{github.login}</span>
            </Link>
          ) : (
            <a href="/api/auth/github/start" className="nav-item" title="Connect GitHub" aria-disabled={github ? !github.configured : undefined}>
              <GitHubMark />
              <span className="nav-text">Connect GitHub</span>
            </a>
          )}
          <button className="nav-item" onClick={() => authApi.logout().finally(() => window.location.assign("/login"))} title="Sign out">
            <LogOut size={17} />
            <span className="nav-text">Sign out</span>
          </button>
        </div>
      </aside>
      <div className={`scrim${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
          {crumb && <span className="crumb desktop-only">{crumb} /</span>}
          <h1>{title}</h1>
          <div className="topbar-actions">{actions}</div>
        </header>
        {children}
      </div>
    </div>
  );
}

export { GitHubMark };

export function EmptyState({ icon: Icon = Boxes, title, children }: { icon?: typeof Boxes; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
