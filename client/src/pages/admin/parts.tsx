import type { InputHTMLAttributes, ReactNode, RefObject } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";

// Small pieces the admin panels and dialogs share: a labelled fact, a block-explorer link, a field
// with its hint or error, and where focus goes after a confirmed action.

/**
 * Puts focus on `target` once the confirmation that is closing has gone. A confirmed action can
 * remove the button that opened it (Approve on an order that is now completed, End now on a plan
 * that has ended): focus would fall to the page behind the dialog that is still open. Focus that
 * landed on something still there is left where it is.
 */
export function focusWhenClosed(target: RefObject<HTMLElement | null>) {
  const until = performance.now() + 2_000;
  const step = () => {
    // Open or still animating out: its focus trap would take focus straight back.
    if (document.querySelector('[role="alertdialog"]') && performance.now() < until) {
      requestAnimationFrame(step);
      return;
    }
    // Left on the page's body, or on the dialog's own box (where its trap puts focus it lost): not placed yet.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && active.getAttribute("role") !== "dialog") return;
    target.current?.focus();
  };
  requestAnimationFrame(step);
}

/** One fact in a <dl className="admin-facts">: a label and its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A link to the block explorer, opening in a new tab. what: what it shows, for assistive tech ("the wallet address"). */
export function ExplorerLink({ href, explorer, what }: { href: string | null; explorer: string | undefined; what: string }) {
  if (!href) return null;
  return (
    <a className="link admin-explorer" href={href} target="_blank" rel="noopener noreferrer">
      View on {explorer ?? "the block explorer"}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> ({what}, opens in a new tab)</span>
    </a>
  );
}

/** A labelled input with its hint, or its error once there is one (the input points at whichever is shown). */
export function TextField({ id, label, hint, error, className, ...input }: { id: string; label: string; hint?: ReactNode; error?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  return (
    <div className={className ? `field ${className}` : "field"}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input {...input} id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
