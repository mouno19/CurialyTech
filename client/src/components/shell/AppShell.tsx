import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Boxes, ChevronsLeft, ChevronsRight, KeyRound, LayoutDashboard, LogOut, Menu, PlugZap, SquareTerminal, Store } from "lucide-react";
import { agentApi, authApi, type ProviderProbe } from "@/lib/api";

const NAV = [
  { href: "/", label: "Workspace Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Live Tasks", icon: Activity, badge: true },
  { href: "/sandbox", label: "Code Sandbox", icon: SquareTerminal },
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

  useEffect(() => { try { localStorage.setItem("curialy.sidebar.collapsed", collapsed ? "1" : "0"); } catch { /* storage unavailable */ } }, [collapsed]);
  useEffect(() => setMobileOpen(false), [location]);

  const healthy = providers?.filter(probe => probe.configured && probe.ok).length ?? 0;
  const configured = providers?.filter(probe => probe.configured).length ?? 0;
  const cortex = providers?.find(probe => probe.id === "cortex");
  const pillState = providers === null ? "" : cortex?.ok && healthy === configured ? "ok" : cortex?.ok ? "warn" : "bad";

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
              <span>{providers === null ? "Checking providers…" : `${healthy}/${configured} providers online`}</span>
              <small>{cortex ? `Cortex ${cortex.ok ? `${cortex.latencyMs} ms` : "unreachable"}` : "Model connections"}</small>
            </span>
            <span className={`dot ${pillState}`} style={{ marginLeft: "auto" }} />
          </Link>
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

export function EmptyState({ icon: Icon = Boxes, title, children }: { icon?: typeof Boxes; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
