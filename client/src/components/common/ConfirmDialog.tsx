import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useReturnFocus } from "./useReturnFocus";
import { toast } from "sonner";
import { Button } from "./Button";

export type ConfirmDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled use: the element that opens the dialog. */
  trigger?: ReactElement;
  title: ReactNode;
  /** Name the exact consequence and target ("Stop this run? Files written so far are kept."). */
  children?: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while busy, e.g. "Cancelling…". */
  busyLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /**
   * Runs on confirm. A returned promise keeps the dialog open and busy until it settles: it closes
   * on success and shows the error inline on failure (or as a toast if the dialog was closed).
   */
  onConfirm: () => unknown;
  /** External busy state (e.g. the caller tracks the request itself). */
  busy?: boolean;
  confirmDisabled?: boolean;
};

const messageOf = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : "That did not work. Try again.");

/**
 * Confirmation on Radix AlertDialog. Cancel is focused first, and Esc, Cancel or Close never
 * confirm anything. While busy the request keeps running if the dialog is closed.
 */
export function ConfirmDialog({ open: openProp, onOpenChange, trigger, title, children, confirmLabel, busyLabel, cancelLabel = "Cancel", tone = "default", onConfirm, busy: busyProp, confirmDisabled }: ConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = openProp ?? openState;
  const openRef = useRef(open);
  openRef.current = open;
  const busy = Boolean(busyProp) || pending;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (busy || confirmDisabled) return;
    setError(null);
    let result: unknown;
    try {
      result = onConfirm();
    } catch (failure) {
      return setError(messageOf(failure));
    }
    if (!(result instanceof Promise)) return setOpen(false);
    setPending(true);
    try {
      await result;
      if (openRef.current) setOpen(false);
    } catch (failure) {
      // The dialog may have been closed while the request ran: report the failure where it is visible.
      if (openRef.current) setError(messageOf(failure));
      else toast.error(messageOf(failure));
    } finally {
      setPending(false);
    }
  };

  const focus = useReturnFocus();
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog" data-size="sm" onOpenAutoFocus={focus.onOpenAutoFocus} onCloseAutoFocus={focus.onCloseAutoFocus} {...(children ? {} : { "aria-describedby": undefined })}>
          <div className="dialog-head">
            <AlertDialog.Title className="dialog-title">{title}</AlertDialog.Title>
          </div>
          <div className="dialog-body">
            {children && <AlertDialog.Description asChild><div>{children}</div></AlertDialog.Description>}
            {error && <p className="notice" data-tone="danger" role="alert">{error}</p>}
          </div>
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{busy ? "Close" : cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button variant={tone === "danger" ? "danger-solid" : "primary"} busy={busy} disabled={confirmDisabled} onClick={() => void confirm()}>
              {busy && busyLabel ? busyLabel : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
