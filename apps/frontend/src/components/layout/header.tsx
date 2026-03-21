"use client";

import { Bell, Moon, Sun, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  onMobileMenuToggle?: () => void;
  title?: string;
}

const PROVIDER_BADGE: Record<string, { label: string; className: string }> = {
  centrinvest: { label: "⚡ Центр-Инвест", className: "bg-primary/15 text-primary border-primary/30 hover:bg-primary/20" },
  gemini: { label: "✦ Gemini", className: "bg-blue-500/15 text-blue-400 border-blue-400/30 hover:bg-blue-500/20" },
  ollama: { label: "◉ Ollama", className: "bg-muted text-muted-foreground border-border hover:bg-muted/80" },
};

export function Header({ onMobileMenuToggle, title }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);

  const provider = (process.env.NEXT_PUBLIC_LLM_PROVIDER as string) || "centrinvest";
  const badge = PROVIDER_BADGE[provider] ?? PROVIDER_BADGE.centrinvest;

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuToggle}>
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1">
        {title && <h1 className="text-sm font-medium text-foreground">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn("hidden sm:inline-flex cursor-pointer text-xs", badge.className)}
          onClick={() => window.location.href = "/settings#ai-provider"}
        >
          {badge.label}
        </Badge>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
        </Button>

        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold ring-2 ring-primary/20">
          {user?.firstName?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?"}
        </div>
      </div>
    </header>
  );
}
