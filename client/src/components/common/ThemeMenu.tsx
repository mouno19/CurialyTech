import type { ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { parseChoice, useTheme, type ThemeChoice } from "@/lib/theme";
import { Tip } from "./Tooltip";

export const THEME_OPTIONS: { id: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

/** The chosen option (its label and icon) for a trigger. */
export function useThemeOption() {
  const { choice } = useTheme();
  return THEME_OPTIONS.find(option => option.id === choice) ?? THEME_OPTIONS[2];
}

/**
 * The theme picker around any trigger button: Light, Dark, or System (the device's, which it names).
 * tip: wraps the trigger in a tooltip (an icon-only trigger, e.g. the collapsed sidebar).
 */
export function ThemeMenu({ children, side = "bottom", align = "end", tip }: { children: ReactElement; side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end"; tip?: string }) {
  const { choice, system, setChoice } = useTheme();
  const trigger = <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>;
  return (
    <DropdownMenu.Root>
      {tip ? <Tip content={tip} side={side === "right" ? "right" : "top"}>{trigger}</Tip> : trigger}
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu theme-menu" side={side} align={align} sideOffset={8} collisionPadding={12}>
          <DropdownMenu.Label className="menu-label">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={choice} onValueChange={value => setChoice(parseChoice(value))}>
            {THEME_OPTIONS.map(option => (
              <DropdownMenu.RadioItem key={option.id} value={option.id} className="menu-item">
                <option.icon size={15} aria-hidden="true" />
                <span className="menu-item-body">
                  {option.label}
                  {option.id === "system" && <span className="menu-item-hint">Follows your device (now {system})</span>}
                </span>
                <DropdownMenu.ItemIndicator className="menu-item-end"><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
