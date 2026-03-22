"use client";

import { useEffect, useState } from "react";
import { Bot, Menu, Mic, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { CommandMenu } from "@/components/ui/command-menu";
import { NotificationBell } from "@/components/ui/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCurrentLlmProvider,
  useLlmProviders,
  useSwitchLlmProvider,
} from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth.store";

interface HeaderProps {
  onMobileMenuToggle?: () => void;
  title?: string;
}

const PROVIDER_BADGE: Record<string, { className: string }> = {
  centrinvest: {
    className: "border-primary/30 bg-primary/15 text-primary",
  },
  gemini: {
    className: "border-blue-400/30 bg-blue-500/15 text-blue-400",
  },
  ollama: {
    className: "border-border bg-muted text-muted-foreground",
  },
};

export function Header({ onMobileMenuToggle, title }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const [commandOpen, setCommandOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const currentProvider = useCurrentLlmProvider();
  const providers = useLlmProviders();
  const switchProvider = useSwitchLlmProvider();

  const provider = currentProvider.data?.provider ?? "centrinvest";
  const providerBadge = PROVIDER_BADGE[provider] ?? PROVIDER_BADGE.centrinvest;
  const initials = user?.firstName?.[0] ?? user?.email?.[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    setMounted(true);
  }, []);

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

          <Select
            value={provider}
            onValueChange={(value) =>
              switchProvider.mutate(value as "centrinvest" | "gemini" | "ollama")
            }
            disabled={
              currentProvider.isLoading || providers.isLoading || switchProvider.isPending
            }
          >
            <SelectTrigger
              className={cn(
                "hidden h-9 w-52.5 border-border/70 bg-background/60 text-xs sm:flex",
                providerBadge.className,
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <SelectValue placeholder="AI-провайдер" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {providers.data?.map((item) => (
                <SelectItem key={item.id} value={item.id} disabled={!item.available}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentProvider.data?.sttAvailable ? (
            <Badge
              variant="outline"
              className="hidden gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 sm:inline-flex"
            >
              <Mic className="h-3 w-3" />
              Голос
            </Badge>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {!mounted ? (
              <Sun className="h-4 w-4 opacity-0" />
            ) : theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
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
