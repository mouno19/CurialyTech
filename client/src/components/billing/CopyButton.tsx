import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/common/Button";

/**
 * Copies one value. The button says "Copied" for a moment and the page announces it (onCopied); a
 * copy the browser blocks says so, so nobody pastes whatever was on the clipboard before.
 * A newer click, a new value or unmounting wins over a copy still in flight.
 */
export function CopyButton({ value, what, label = "Copy", onCopied, size = "sm", variant = "secondary", className }: {
  value: string;
  /** What is copied, for the accessible name and the messages: "Address", "Amount". */
  what: string;
  label?: string;
  onCopied?: (message: string) => void;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current += 1;
    setCopied(false);
  }, [value]);
  useEffect(() => () => {
    sequence.current += 1;
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const mine = ++sequence.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard");
      await navigator.clipboard.writeText(value);
      if (mine !== sequence.current) return;
      setCopied(true);
      onCopied?.(`${what} copied.`);
    } catch {
      if (mine === sequence.current) toast.error(`Couldn't copy here: select the ${what.toLowerCase()} and copy it yourself.`);
    }
  };

  return (
    // A bare "Copy" says what it copies to assistive tech; a longer label already does.
    <Button size={size} variant={variant} className={className} icon={copied ? Check : Copy} disabled={!value} onClick={() => void copy()} aria-label={!copied && label === "Copy" ? `Copy the ${what.toLowerCase()}` : undefined}>
      {copied ? "Copied" : label}
    </Button>
  );
}
