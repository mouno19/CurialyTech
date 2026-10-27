import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "accent" | "link";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconEnd?: LucideIcon;
  /** Shows the spinner in place of the icon and blocks clicks, but keeps focus (aria-disabled, not disabled). */
  busy?: boolean;
  pill?: boolean;
  block?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = { primary: "primary", secondary: "secondary", ghost: "ghost", danger: "danger", "danger-solid": "danger solid", accent: "accent", link: "link" };
export const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16 };

/** .btn as a component. type defaults to "button"; pass type="submit" in forms. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, iconEnd: IconEnd, busy = false, pill, block, className, children, type = "button", onClick, ...rest },
  ref,
) {
  const blocked = busy || rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("btn", VARIANT[variant], size !== "md" && size, pill && "pill", block && "block", className)}
      aria-busy={busy || undefined}
      aria-disabled={blocked || undefined}
      onClick={event => {
        if (blocked) return event.preventDefault();
        onClick?.(event);
      }}
    >
      {busy ? <Spinner size={ICON_SIZE[size]} /> : Icon ? <Icon size={ICON_SIZE[size]} aria-hidden="true" /> : null}
      {children}
      {IconEnd && !busy ? <IconEnd size={ICON_SIZE[size]} aria-hidden="true" /> : null}
    </button>
  );
});
