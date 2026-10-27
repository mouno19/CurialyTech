import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { Tip } from "./Tooltip";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Accessible name, and the tooltip unless `tooltip` says otherwise. Required: icon-only controls must be named. */
  label: string;
  icon: LucideIcon;
  size?: "sm" | "md";
  tone?: "danger";
  variant?: "outline";
  busy?: boolean;
  /** Tooltip content (defaults to the label); false for none (e.g. inside a menu trigger that already says it). */
  tooltip?: ReactNode | false;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  iconSize?: number;
};

/** Icon-only button: aria-label + tooltip, 40px target on phones. Works as a Radix asChild trigger (forwards ref and props). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, size = "md", tone, variant, busy = false, tooltip, tooltipSide, iconSize, className, type = "button", onClick, ...rest },
  ref,
) {
  const blocked = busy || rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  const glyph = iconSize ?? (size === "sm" ? 14 : 16);
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("icon-btn", size === "sm" && "sm", className)}
      data-tone={tone}
      data-variant={variant}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-disabled={blocked || undefined}
      onClick={event => {
        if (blocked) return event.preventDefault();
        onClick?.(event);
      }}
    >
      {busy ? <Spinner size={glyph} /> : <Icon size={glyph} aria-hidden="true" />}
    </button>
  );
  return tooltip === false ? button : <Tip content={tooltip ?? label} side={tooltipSide}>{button}</Tip>;
});
