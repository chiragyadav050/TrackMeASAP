"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";
import type { ThemePreference } from "@/types/profile";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun, stored: "LIGHT" },
  { value: "dark", label: "Dark", icon: Moon, stored: "DARK" },
  { value: "system", label: "System", icon: Monitor, stored: "SYSTEM" },
] as const satisfies readonly {
  value: string;
  label: string;
  icon: typeof Sun;
  stored: ThemePreference;
}[];

type ThemeToggleProps = {
  /**
   * Persists the choice to the user's profile so it follows them to other
   * devices. Omitted on public pages, where there is nobody to persist for.
   */
  readonly onPersist?: (preference: ThemePreference) => void;
};

export function ThemeToggle({ onPersist }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const select = useCallback(
    (option: (typeof THEME_OPTIONS)[number]) => {
      setTheme(option.value);
      onPersist?.(option.stored);
    },
    [onPersist, setTheme],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            // The resolved theme is unknown until hydration, so the label is
            // kept generic rather than announcing a value that may be wrong.
            aria-label="Change theme"
          >
            <Sun className="size-4 scale-100 rotate-0 transition-transform duration-200 dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute size-4 scale-0 rotate-90 transition-transform duration-200 dark:scale-100 dark:rotate-0" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          // Before hydration `theme` is undefined; showing no tick is
          // preferable to briefly ticking the wrong row.
          const isActive = mounted && theme === option.value;

          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => select(option)}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {option.label}
              </span>
              {isActive ? <Check className="size-3.5" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
