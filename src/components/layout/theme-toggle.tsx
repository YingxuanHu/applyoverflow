"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const groupName = useId();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const selectedTheme =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system";

  return (
    <div
      aria-label="Theme"
      className="relative grid w-full max-w-sm grid-cols-3 rounded-2xl border border-border/70 bg-background/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      role="radiogroup"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === selectedTheme;

        return (
          <label key={option.value} className="relative min-w-0 cursor-pointer">
            <input
              checked={isActive}
              className="peer sr-only"
              name={groupName}
              onChange={() => setTheme(option.value)}
              type="radio"
              value={option.value}
            />
            <span className={cn(
              "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
              isActive ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}>
              <Icon aria-hidden="true" className="h-4 w-4" />
              <span>{option.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
