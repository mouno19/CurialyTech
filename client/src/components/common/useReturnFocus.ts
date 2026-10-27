import { useRef } from "react";

/**
 * Focus goes back to whatever opened a dialog (a menu's trigger, a button) when it closes. Radix
 * only restores focus to its own Trigger, and most dialogs here are opened programmatically.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const element = opener.current;
      opener.current = null;
      if (!element?.isConnected) return; // the opener is gone (e.g. a deleted item): keep Radix's default
      event.preventDefault();
      element.focus();
    },
  };
}
