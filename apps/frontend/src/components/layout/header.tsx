"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { CommandMenu } from "@/components/ui/command-menu";
import { NotificationBell } from "@/components/ui/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth.store";

interface HeaderProps {
  onMobileMenuToggle?: () => void;
  title?: string;
}

const PROVIDER_BADGE: Record<string, { label: string; className: string }> = {
  centrinvest: {
    label: "Центр-Инвест",
    className: "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20",
  },
  gemini: {
    label: "Gemini",
    className: "border-blue-400/30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/20",
  },
  ollama: {
    label: "Ollama",
    className: "border-border bg-muted text-muted-foreground hover:bg-muted/80",
  },
};

export function Header({ onMobileMenuToggle, title }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const [commandOpen, setCommandOpen] = useState(false);

  const providerInfo = useQuery<{ provider: string }>({
    queryKey: ["settings", "llm"],
    queryFn: () => api.get("/settings/llm").then((response) => response.data),
    staleTime: 30_000,
  });

  const provider =
    providerInfo.data?.provider ||
    ((process.env.NEXT_PUBLIC_LLM_PROVIDER as string) || "centrinvest");
  const badge = PROVIDER_BADGE[provider] ?? PROVIDER_BADGE.centrinvest;
  const initials = user?.firstName?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex-1">
          {title && <h1 className="text-sm font-medium text-foreground">{title}</h1>}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCommandOpen(true)}
            className="hidden w-72 justify-start gap-2 border-border/70 bg-background/60 text-xs text-muted-foreground sm:flex"
          >
            <Search className="h-3.5 w-3.5" />
            Поиск
            <span className="ml-auto rounded border border-border/70 px-1.5 py-0.5 text-[10px]">
              Ctrl K
            </span>
          </Button>

          <Badge
            variant="outline"
            className={cn("hidden cursor-pointer text-xs sm:inline-flex", badge.className)}
            onClick={() => {
              window.location.href = "/settings#ai-provider";
            }}
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

          <NotificationBell />

          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt="Аватар"
              className="h-8 w-8 rounded-full object-cover ring-2 ring-primary/20"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary ring-2 ring-primary/20">
              {initials}
            </div>
          )}
        </div>
      </header>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
