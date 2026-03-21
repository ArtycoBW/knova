"use client";

import { MessageSquare, Sparkles } from "lucide-react";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ChatIndexPage() {
  const { data, isLoading } = useWorkspaces();
  const workspaces = data?.filter((workspace) => workspace.readyCount > 0) ?? [];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-[Syne] text-3xl font-bold">Чат с источниками</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите воркспейс, где уже есть готовые документы, и начните диалог.
          </p>
        </div>
        <Badge className="gap-2 border-emerald-500/20 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20 dark:text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          RAG по документам
        </Badge>
      </div>

      {!workspaces.length ? (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Пока нечего открыть</CardTitle>
            <CardDescription>
              Сначала загрузите и дождитесь обработки хотя бы одного документа в воркспейсе.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workspaces.map((workspace) => (
            <a key={workspace.id} href={`/chat/${workspace.id}`} className="block">
              <Card className="h-full border-border/80 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <CardDescription className="mt-2">
                        {workspace.description || "Откройте чат по материалам этого воркспейса."}
                      </CardDescription>
                    </div>
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Готовых документов: {workspace.readyCount}</span>
                  <span>Открыть чат</span>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
