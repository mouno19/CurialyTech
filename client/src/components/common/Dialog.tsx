import type { ReactElement, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { useReturnFocus } from "./useReturnFocus";

export type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled use: the element that opens the dialog. */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned (full width and stacked on phones). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Render as a side sheet instead of a centred dialog. */
  side?: "left" | "right";
  /** false: Esc and outside clicks do not close it (e.g. while a request is in flight). */
  dismissible?: boolean;
  className?: string;
};

/**
 * Modal dialog or side sheet on Radix Dialog: focus trap, Esc, focus return to the opener,
 * background inert for assistive tech, scroll lock. Phones show dialogs as bottom sheets.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, children, footer, size = "md", side, dismissible = true, className }: DialogProps) {
  const focus = useReturnFocus();
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content
          className={cx(side ? "sheet" : "dialog", className)}
          data-side={side}
          data-size={size}
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className={side ? "sheet-head" : "dialog-head"}>
            <div>
              <RadixDialog.Title className={side ? "sheet-title" : "dialog-title"}>{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="dialog-desc">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild>
              <IconButton className="dialog-close" label="Close" icon={X} tooltip={false} aria-disabled={!dismissible || undefined} />
            </RadixDialog.Close>
          </div>
          <div className={side ? "sheet-body" : "dialog-body"}>{children}</div>
          {footer && <div className="dialog-actions">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
