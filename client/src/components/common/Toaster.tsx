import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { useIsPhone } from "@/lib/breakpoints";
import { Spinner } from "./Spinner";

// Sonner reads these variables; the toasts render as ink panels (paper text 15:1).
const THEME = {
  "--normal-bg": "var(--panel)",
  "--normal-bg-hover": "var(--panel-2)",
  "--normal-border": "rgb(243 239 230 / 0.14)",
  "--normal-border-hover": "rgb(243 239 230 / 0.26)",
  "--normal-text": "var(--panel-text)",
  "--border-radius": "12px",
  "--width": "380px",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

const ICONS = {
  success: <CircleCheck size={16} aria-hidden="true" />,
  error: <CircleX size={16} aria-hidden="true" />,
  warning: <TriangleAlert size={16} aria-hidden="true" />,
  info: <Info size={16} aria-hidden="true" />,
  loading: <Spinner size={16} />,
};

/** Mount once (App.tsx). Use `toast` / `toast.error` / `toast.success` from "sonner" anywhere. */
export function AppToaster() {
  const phone = useIsPhone();
  return (
    <Toaster
      theme="dark"
      // Phones: top, so toasts never cover the bottom composer.
      position={phone ? "top-center" : "bottom-right"}
      closeButton
      visibleToasts={4}
      gap={8}
      duration={6000}
      offset={16}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)", left: 8, right: 8 }}
      containerAriaLabel="Notifications"
      icons={ICONS}
      style={THEME}
      toastOptions={{ classNames: { toast: "toast" } }}
    />
  );
}
