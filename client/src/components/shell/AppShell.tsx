import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode, type RefObject, useLayoutEffect } from "react";
import { Link, useLocation } from "wouter";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import type { LucideIcon } from "lucide-react";
import { Activity, ChevronsUpDown, ExternalLink, Images, KeyRound, LayoutDashboard, LogOut, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PlugZap, RefreshCw, SquareTerminal, Store, Unplug, X } from "lucide-react";
import { toast } from "sonner";
import { agentApi, authApi, errorMessage, relativeTime, type ProviderProbe } from "@/lib/api";
import { needsOperator, useGitHub, useHealth } from "@/lib/appStatus";
import { useIsDesktop } from "@/lib/breakpoints";
import { CurialyMark, Wordmark } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { cx } from "@/components/common/cx";
import { GitHubMark } from "@/components/common/GitHubMark";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { Tip } from "@/components/common/Tooltip";

// Older screens import these from here.
export { EmptyState } from "@/components/common/StateNotice";
export { GitHubMark } from "@/components/common/GitHubMark";
export { BrandMark } from "@/components/brand/Logo";
export { useGitHub } from "@/lib/appStatus";

/**
 * A topbar action. primary: always inline. secondary: inline at >= 1024px, in the "More actions"
 * menu below that. overflow: always in the menu (danger items last, after a separator).
 * href: app routes navigate client-side; /api/... and http(s) links are real navigations.
 */
export type TopbarAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  href?: string;
  priority: "primary" | "secondary" | "overflow";
  tone?: "danger" | "accent";
  disabled?: boolean;
  busy?: boolean;
  /** Tooltip for inline actions, hint line in the menu (e.g. why it is disabled). */
  title?: string;
  /**
   * Run inside the click itself instead of after the menu closes (needed for clipboard writes,
   * which browsers only allow during the user's gesture). Not for actions that open a dialog.
   */
  immediate?: boolean;
};

export type AppShellProps = {
  title: string;
  crumb?: string;
  crumbHref?: string;
  /** Rendered right after the title (a StatusBadge, for instance). Keep it small. */
  titleAddon?: ReactNode;
  /** Legacy free-form actions (kept for compatibility; prefer topbarActions). */
  actions?: ReactNode;
  topbarActions?: TopbarAction[];
  children: ReactNode;
};

const NAV: { href: string; label: string; icon: LucideIcon; badge?: boolean }[] = [
  { href: "/", label: "Workspace Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Live Tasks", icon: Activity, badge: true },
  { href: "/sandbox", label: "Code Sandbox", icon: SquareTerminal },
  { href: "/media", label: "Media Vault", icon: Images },
  { href: "/integrations", label: "System Integrations", icon: PlugZap },
  { href: "/skills", label: "Skill Store", icon: Store },
  { href: "/keys", label: "API Key Manager", icon: KeyRound },
];

const COLLAPSED_KEY = "curialy.sidebar.collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

const isCurrent = (location: string, href: string) => (href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`));
const isAppRoute = (href: string) => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/");
const externalProps = (href: string) => (/^https?:\/\//.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {});

let shellMountedBefore = false;
/** After a client-side navigation the old page (and the focused link) is gone: move focus to the new title. */
function useFocusRescue(target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!shellMountedBefore) {
      shellMountedBefore = true;
      return;
    }
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) target.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [target]);
}

/**
 * Menu items run their action after the menu has closed and focus is back on its trigger, so a
 * dialog opened from the menu returns focus to the trigger when it closes.
 */
function useDeferredSelect(trigger: RefObject<HTMLElement | null>) {
  const pending = useRef<(() => void) | null>(null);
  return {
    defer: (run?: () => void) => () => {
      pending.current = run ?? null;
    },
    onCloseAutoFocus: (event: Event) => {
      const run = pending.current;
      pending.current = null;
      if (!run) return;
      event.preventDefault();
      trigger.current?.focus();
      run();
    },
  };
}

export function AppShell({ title, crumb, crumbHref, titleAddon, actions, topbarActions, children }: AppShellProps) {
  const desktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable: the choice lasts for this page */
    }
  }, [collapsed]);
  useEffect(() => {
    if (desktop) setDrawerOpen(false);
  }, [desktop]);
  useEffect(() => {
    document.title = title ? `${title} · Curialy` : "Curialy";
  }, [title]);
  useFocusRescue(titleRef);

  const skipToMain = (event: MouseEvent) => {
    event.preventDefault();
    document.getElementById("main")?.focus();
  };

  return (
    // One Dialog root around the whole shell keeps the tree stable across the 1024px breakpoint
    // (a conditional wrapper would remount the page). The drawer only exists below 1024px.
    <Dialog.Root open={drawerOpen && !desktop} onOpenChange={setDrawerOpen}>
      {/* inert while the drawer is open (the drawer is portalled outside .shell, so it stays usable). */}
      <div className="shell" inert={drawerOpen && !desktop ? true : undefined}>
        <a className="skip-link" href="#main" onClick={skipToMain}>
          Skip to content
        </a>
        <aside id="app-sidebar" className="sidebar" data-state={collapsed ? "rail" : "expanded"} aria-label="Sidebar">
          <SidebarBody
            rail={collapsed}
            headEnd={
              <IconButton
                label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                tooltipSide="right"
                aria-expanded={!collapsed}
                aria-controls="app-sidebar"
                onClick={() => setCollapsed(value => !value)}
              />
            }
          />
        </aside>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="sheet nav-drawer" data-side="left" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarBody
              rail={false}
              onNavigate={() => setDrawerOpen(false)}
              headEnd={
                <Dialog.Close asChild>
                  <IconButton label="Close navigation" icon={X} tooltip={false} />
                </Dialog.Close>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>
        <div className="shell-main">
          <header className="topbar">
            <Dialog.Trigger asChild>
              <IconButton className="topbar-menu" label="Open navigation" icon={Menu} tooltip={false} />
            </Dialog.Trigger>
            {crumb && (
              <span className="topbar-crumb">
                {crumbHref ? <Link href={crumbHref}>{crumb}</Link> : crumb}
                <span className="topbar-crumb-sep" aria-hidden="true">/</span>
              </span>
            )}
            <h1 ref={titleRef} className="topbar-title" title={title} tabIndex={-1}>
              {title}
            </h1>
            {titleAddon && <div className="topbar-addon">{titleAddon}</div>}
            {(actions || (topbarActions && topbarActions.length > 0)) && <TopbarActions legacy={actions} items={topbarActions ?? []} desktop={desktop} crowded={Boolean(titleAddon)} />}
          </header>
          <main id="main" className="app-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Sidebar (desktop column and phone/tablet drawer share it)
// ---------------------------------------------------------------------------------------------

function SidebarBody({ rail, headEnd, onNavigate }: { rail: boolean; headEnd?: ReactNode; onNavigate?: () => void }) {
  const [location] = useLocation();
  const { activeTasks } = useHealth();
  return (
    <>
      <div className="sidebar-head">
        <Link href="/" className="brand-link" aria-label="Curialy home" onClick={onNavigate}>
          {rail ? <CurialyMark size={30} /> : <Wordmark />}
        </Link>
        {headEnd}
      </div>
      <nav className="nav" aria-label="Main">
        <div className="nav-section micro" aria-hidden="true">Workspace</div>
        {NAV.map(item => {
          const current = isCurrent(location, item.href);
          const count = item.badge ? activeTasks : 0;
          const link = (
            <Link href={item.href} className="nav-item" aria-current={current ? "page" : undefined} onClick={onNavigate}>
              <item.icon size={17} aria-hidden="true" />
              <span className="nav-text">{item.label}</span>
              {count > 0 && (
                <span className="nav-badge">
                  <span className="sr-only">, </span>
                  {count}
                  <span className="sr-only"> running</span>
                </span>
              )}
            </Link>
          );
          return rail ? (
            <Tip key={item.href} content={count > 0 ? `${item.label} · ${count} running` : item.label} side="right">
              {link}
            </Tip>
          ) : (
            <Fragment key={item.href}>{link}</Fragment>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <HealthStatus rail={rail} />
        <GitHubAccount rail={rail} />
        <SignOut rail={rail} />
      </div>
    </>
  );
}

function probeTone(probe: ProviderProbe) {
  if (!probe.configured) return "neutral";
  if (probe.ok) return "success";
  return needsOperator(probe) ? "warning" : "danger";
}

function HealthStatus({ rail }: { rail: boolean }) {
  const { providers, summary, checkedAt, checking, error, refresh } = useHealth();
  const sorted = providers ? [...providers].sort((a, b) => Number(b.configured) - Number(a.configured)) : [];
  const issues = summary.issues.map(probe => probe.label).join(", ");
  const trigger = (
    <Popover.Trigger asChild>
      <button type="button" className="health-summary" aria-label={rail ? `System status: ${summary.label}` : undefined}>
        <span className="dot" data-tone={summary.tone} data-live={providers === null && !error ? "" : undefined} aria-hidden="true" />
        <span className="health-text">
          <span>{summary.label}</span>
          {issues && <small>Needs attention: {issues}</small>}
        </span>
        {!rail && <ChevronsUpDown size={14} className="faint" aria-hidden="true" />}
      </button>
    </Popover.Trigger>
  );
  return (
    <Popover.Root>
      {rail ? <Tip content={summary.label} side="right">{trigger}</Tip> : trigger}
      <Popover.Portal>
        <Popover.Content className="popover health-popover" side={rail ? "right" : "top"} align="start" sideOffset={8} collisionPadding={12}>
          <div className="health-popover-head">
            <span className="micro">System status</span>
            <span className="status-badge" data-tone={summary.tone} data-size="sm">
              {summary.label}
            </span>
          </div>
          {providers === null ? (
            <StateNotice size="sm" variant={error ? "error" : "loading"} title={error ? "Status unavailable" : "Checking systems…"}>
              {error ?? undefined}
            </StateNotice>
          ) : (
            <ul className="health-list">
              {sorted.map(probe => (
                <li key={probe.id} className="health-row">
                  <span className="dot" data-tone={probeTone(probe)} aria-hidden="true" />
                  <span className="health-row-label">{probe.label}</span>
                  <span className="health-row-meta">{!probe.configured ? "off" : !probe.ok ? (needsOperator(probe) ? "setup" : "down") : probe.latencyMs > 0 ? `${probe.latencyMs} ms` : "ok"}</span>
                  <span className="health-row-detail">{probe.configured ? probe.detail : "Not configured on this server"}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="health-popover-foot">
            <span>{checkedAt ? `Checked ${relativeTime(new Date(checkedAt).toISOString())}` : " "}</span>
            <span className="row">
              <Button size="sm" variant="ghost" icon={RefreshCw} busy={checking} onClick={() => void refresh()}>
                Check now
              </Button>
              <Link href="/integrations" className="btn sm">
                Details
              </Link>
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GitHubAccount({ rail }: { rail: boolean }) {
  const { status, loading, error, refresh } = useGitHub();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deferred = useDeferredSelect(triggerRef);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const withTip = (label: string, element: ReactElement) => (rail ? <Tip content={label} side="right">{element}</Tip> : element);

  if (!status) {
    if (loading || !error) {
      return (
        <span className="nav-item" data-muted="">
          <GitHubMark />
          <span className="nav-text">GitHub…</span>
        </span>
      );
    }
    return withTip(
      "Couldn't check the GitHub connection. Retry",
      <button type="button" className="nav-item" onClick={() => void refresh()}>
        <GitHubMark />
        <span className="nav-text">GitHub · Retry</span>
      </button>,
    );
  }
  if (!status.configured) {
    const explain = "GitHub isn't set up on this server. An operator needs to configure the GitHub app.";
    return withTip(
      explain,
      <button type="button" className="nav-item" aria-disabled="true" onClick={() => toast(explain)}>
        <GitHubMark />
        <span className="nav-text">GitHub not set up</span>
      </button>,
    );
  }
  if (!status.connected) {
    return withTip(
      "Connect GitHub",
      <a className="nav-item" href="/api/auth/github/start">
        <GitHubMark />
        <span className="nav-text">Connect GitHub</span>
      </a>,
    );
  }

  const login = status.login ?? "GitHub";
  const missing = status.missingScopes.length > 0;
  const disconnect = async () => {
    await agentApi.disconnectGithub();
    toast.success("GitHub disconnected.");
    // Refresh after the dialog has closed: the account menu is replaced by "Connect GitHub".
    setTimeout(() => void refresh(), 0);
  };
  return (
    <>
      <DropdownMenu.Root>
        {withTip(
          missing ? `${login} · reconnect needed` : login,
          <DropdownMenu.Trigger asChild>
            <button ref={triggerRef} type="button" className="nav-item" aria-label={rail ? `GitHub account ${login}` : undefined}>
              {status.avatarUrl ? <img className="nav-avatar" src={status.avatarUrl} alt="" width={18} height={18} /> : <GitHubMark />}
              <span className="nav-text">{login}</span>
              {missing && !rail && <span className="dot" data-tone="warning" aria-hidden="true" />}
            </button>
          </DropdownMenu.Trigger>,
        )}
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" side={rail ? "right" : "top"} align="start" sideOffset={8} collisionPadding={12} onCloseAutoFocus={deferred.onCloseAutoFocus}>
            <DropdownMenu.Label className="menu-label">GitHub · {login}</DropdownMenu.Label>
            <DropdownMenu.Item asChild className="menu-item">
              <a href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" />
                <span className="menu-item-body">Open profile</span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild className="menu-item">
              <a href="/api/auth/github/start">
                <RefreshCw size={15} aria-hidden="true" />
                <span className="menu-item-body">
                  <span>Reconnect</span>
                  {missing && <span className="menu-item-hint">Grants the missing access: {status.missingScopes.join(", ")}</span>}
                </span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-sep" />
            <DropdownMenu.Item className="menu-item" data-tone="danger" onSelect={deferred.defer(() => setConfirmOpen(true))}>
              <Unplug size={15} aria-hidden="true" />
              <span className="menu-item-body">Disconnect GitHub</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Disconnect ${login}?`} confirmLabel="Disconnect" busyLabel="Disconnecting…" tone="danger" onConfirm={disconnect}>
        Curialy will no longer be able to clone, push to or export to your repositories until you connect again. Your repositories are not changed.
      </ConfirmDialog>
    </>
  );
}

function SignOut({ rail }: { rail: boolean }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await authApi.logout();
      window.location.assign("/login");
    } catch (error) {
      setBusy(false);
      toast.error("Couldn't sign out.", { description: errorMessage(error) });
    }
  };
  const button = (
    <button type="button" className="nav-item" onClick={() => void signOut()} aria-busy={busy || undefined} aria-disabled={busy || undefined}>
      {busy ? <Spinner size={17} /> : <LogOut size={17} aria-hidden="true" />}
      <span className="nav-text">{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
  return rail ? <Tip content="Sign out" side="right">{button}</Tip> : button;
}

// ---------------------------------------------------------------------------------------------
// Topbar actions: priority-based, never past the right edge
// ---------------------------------------------------------------------------------------------

function TopbarActions({ legacy, items, desktop, crowded }: { legacy?: ReactNode; items: TopbarAction[]; desktop: boolean; crowded: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredSelect(triggerRef);
  const primary = items.filter(action => action.priority === "primary");
  const secondary = items.filter(action => action.priority === "secondary");
  const overflow = items.filter(action => action.priority === "overflow");
  // Desktop widths vary with the sidebar and long titles: when the inline secondary actions would
  // crowd the title or the right edge, they move into the menu (and come back once there is room).
  const [squeezed, setSqueezed] = useState(false);
  const squeezedRef = useRef(false);
  const squeezedAt = useRef(0);
  const secondaryKey = secondary.map(action => `${action.id}:${action.label}`).join("|");
  useLayoutEffect(() => {
    const bar = rootRef.current?.parentElement;
    if (!desktop || !bar) return;
    squeezedRef.current = false;
    setSqueezed(false);
    const check = () => {
      const width = bar.clientWidth;
      if (!squeezedRef.current) {
        const title = bar.querySelector<HTMLElement>(".topbar-title");
        if (bar.scrollWidth > width + 1 || (title !== null && title.clientWidth < 140)) {
          squeezedRef.current = true;
          squeezedAt.current = width;
          setSqueezed(true);
        }
      } else if (width > squeezedAt.current + 160) {
        squeezedRef.current = false;
        setSqueezed(false);
      }
    };
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    // Measure again once the un-squeezed actions are laid out (the bar's own size may not change).
    const frame = requestAnimationFrame(check);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [desktop, secondaryKey]);
  const roomy = desktop && !squeezed;
  const inline = roomy ? [...primary, ...secondary] : primary;
  const menu = roomy ? overflow : [...secondary, ...overflow];
  const regular = menu.filter(action => action.tone !== "danger");
  const danger = menu.filter(action => action.tone === "danger");
  return (
    // Phones: icon actions drop their visible label when several share the bar or a title addon needs the room.
    <div ref={rootRef} className="topbar-actions" data-compact={!desktop && (inline.length > 1 || crowded) ? "" : undefined}>
      {legacy && <div className="topbar-legacy">{legacy}</div>}
      {inline.map(action => (
        <InlineAction key={action.id} action={action} />
      ))}
      {menu.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton ref={triggerRef} label="More actions" icon={MoreHorizontal} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={8} onCloseAutoFocus={deferred.onCloseAutoFocus}>
              {regular.map(action => (
                <MenuAction key={action.id} action={action} defer={deferred.defer} />
              ))}
              {regular.length > 0 && danger.length > 0 && <DropdownMenu.Separator className="menu-sep" />}
              {danger.map(action => (
                <MenuAction key={action.id} action={action} defer={deferred.defer} />
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function InlineAction({ action }: { action: TopbarAction }) {
  const { label, icon: Icon, tone, busy, disabled, title, href, onSelect } = action;
  const className = cx("btn sm tb-action", tone === "accent" ? "primary" : tone === "danger" ? "danger" : "secondary");
  const content = (
    <>
      {busy ? <Spinner size={14} /> : Icon && <Icon size={14} aria-hidden="true" />}
      <span className="tb-label">{label}</span>
    </>
  );
  const hasIcon = Icon || busy ? "" : undefined;
  let element: ReactElement;
  if (href && !disabled && !busy) {
    element = isAppRoute(href) ? (
      <Link href={href} className={className} data-icon={hasIcon}>
        {content}
      </Link>
    ) : (
      <a href={href} className={className} data-icon={hasIcon} {...externalProps(href)}>
        {content}
      </a>
    );
  } else {
    element = (
      <button
        type="button"
        className={className}
        data-icon={hasIcon}
        aria-disabled={disabled || busy || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!disabled && !busy) onSelect?.();
        }}
      >
        {content}
      </button>
    );
  }
  return <Tip content={title}>{element}</Tip>;
}

function MenuAction({ action, defer }: { action: TopbarAction; defer: (run?: () => void) => () => void }) {
  const { label, icon: Icon, tone, busy, disabled, title, href, onSelect, immediate } = action;
  const body = (
    <>
      {busy ? <Spinner size={15} /> : Icon ? <Icon size={15} aria-hidden="true" /> : null}
      <span className="menu-item-body">
        <span>{label}</span>
        {title && <span className="menu-item-hint">{title}</span>}
      </span>
    </>
  );
  const toneAttr = tone === "danger" ? "danger" : undefined;
  if (href && !disabled && !busy) {
    return (
      <DropdownMenu.Item asChild className="menu-item" data-tone={toneAttr}>
        {isAppRoute(href) ? <Link href={href}>{body}</Link> : <a href={href} {...externalProps(href)}>{body}</a>}
      </DropdownMenu.Item>
    );
  }
  return (
    <DropdownMenu.Item className="menu-item" data-tone={toneAttr} disabled={disabled || busy} onSelect={immediate ? () => onSelect?.() : defer(onSelect)}>
      {body}
    </DropdownMenu.Item>
  );
}
