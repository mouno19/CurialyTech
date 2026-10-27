import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CloudOff, Inbox, Info, TriangleAlert } from "lucide-react";
import { CurialyMark } from "@/components/brand/Logo";
import { cx } from "./cx";

export type StateVariant = "loading" | "empty" | "unavailable" | "error" | "info";

export type StateNoticeProps = {
  variant: StateVariant;
  title: ReactNode;
  /** What happened and what the user can do about it. */
  children?: ReactNode;
  /** Override the variant's icon; "mark" shows the Curialy mark; null shows none. */
  icon?: LucideIcon | "mark" | null;
  /** The relevant next step (Retry, Restore, Connect…). Every non-loading state should offer one when one exists. */
  actions?: ReactNode;
  /** sm: inside panels and cards (sans title). md: default. lg: fills a page section. */
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
};

const ICONS: Record<Exclude<StateVariant, "loading">, LucideIcon> = { empty: Inbox, unavailable: CloudOff, error: TriangleAlert, info: Info };

/**
 * Loading, empty, unavailable, error and info states. loading/unavailable are polite status
 * regions, error is an alert; empty/info are plain content. Never use a static loader icon:
 * loading shows the pulsing mark.
 */
export function StateNotice({ variant, title, children, icon, actions, size = "md", className, id }: StateNoticeProps) {
  const role = variant === "error" ? "alert" : variant === "loading" || variant === "unavailable" ? "status" : undefined;
  const Icon = icon === null || icon === "mark" ? null : icon ?? (variant === "loading" ? null : ICONS[variant]);
  return (
    <div id={id} className={cx("state-notice", className)} data-variant={variant} data-size={size} role={role}>
      {variant === "loading" ? (
        <span className="state-icon is-mark" aria-hidden="true"><CurialyMark size={size === "sm" ? 28 : 40} pulse /></span>
      ) : icon === "mark" ? (
        <span className="state-icon is-mark" aria-hidden="true"><CurialyMark size={size === "sm" ? 32 : 44} /></span>
      ) : Icon ? (
        <span className="state-icon" aria-hidden="true"><Icon size={size === "sm" ? 18 : 22} /></span>
      ) : null}
      <p className="state-title">{title}</p>
      {children && <div className="state-body">{children}</div>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/** Empty state (kept for older imports from AppShell): icon, title, body and an optional action. */
export function EmptyState({ icon, title, children, action, size }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <StateNotice variant="empty" icon={icon} title={title} actions={action} size={size}>
      {children}
    </StateNotice>
  );
}
