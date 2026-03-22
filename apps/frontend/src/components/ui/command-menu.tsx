"use client";

import { useDeferredValue, useEffect, useState, startTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface SearchResult {
  id: string;
  type: "workspace" | "document";
  title: string;
  subtitle: string;
  href: string;
}

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const { data, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["command-search", deferredQuery],
    queryFn: () =>
      api
        .get("/search", {
          params: { q: deferredQuery.trim() },
        })
        .then((response) => response.data),
    enabled: open && deferredQuery.trim().length > 1,
    staleTime: 10_000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden border-border/60 bg-card/95 p-0 backdrop-blur-xl">
        <Command className="flex h-[26rem] flex-col bg-transparent">
          <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Поиск по воркспейсам и документам..."
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <Command.List className="flex-1 overflow-y-auto p-2">
            {!query.trim() && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Введите минимум 2 символа, чтобы найти воркспейс или документ.
              </div>
            )}

            {query.trim().length > 1 && !isLoading && !data?.length && (
              <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
                Ничего не найдено.
              </Command.Empty>
            )}

            {isLoading && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Ищем подходящие результаты...
              </div>
            )}

            {!!data?.length && (
              <Command.Group heading="Результаты" className="flex flex-col gap-y-2">
                {data.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.type}-${item.title}-${item.subtitle}`}
                    onSelect={() => {
                      onOpenChange(false);
                      startTransition(() => router.push(item.href));
                    }}
                    className="flex cursor-pointer flex-col gap-1 rounded-xl px-3 py-3 text-left data-[selected=true]:bg-primary/10"
                  >
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
