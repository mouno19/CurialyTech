import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

/** Mounted once in App.tsx; every Tip needs it above in the tree. */
export const TooltipProvider = RadixTooltip.Provider;

type TipProps = {
  content: ReactNode;
  /** One focusable element (it becomes the trigger). Disabled native buttons get no tooltip: use aria-disabled. */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
};

/** Hover/focus tooltip (Radix). Not a substitute for a visible label on touch screens. */
export function Tip({ content, children, side = "top", align = "center", delay }: TipProps) {
  if (content === null || content === undefined || content === false || content === "") return children;
  return (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltip" side={side} align={align} sideOffset={6} collisionPadding={8}>
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
