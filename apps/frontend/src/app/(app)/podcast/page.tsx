"use client";

import { Mic, Radio, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/hooks/use-workspaces";

export default function PodcastIndexPage() {
  const { data, isLoading } = useWorkspaces();
  const workspaces = data?.filter((workspace) => workspace.readyCount > 0) ?? [];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-[Syne] text-3xl font-bold">Подкасты</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите воркспейс с готовыми материалами и соберите диалог двух ведущих с нужной тональностью.
          </p>
        </div>
        <Badge className="gap-2 border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 dark:border-pink-500/20 dark:bg-pink-500/15 dark:text-pink-300 dark:hover:bg-pink-500/20">
          <Sparkles className="h-3.5 w-3.5" />
          AI-сценарий + TXT
        </Badge>
      </div>

      {!workspaces.length ? (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Пока нечего озвучивать</CardTitle>
            <CardDescription>
              Сначала загрузите и дождитесь обработки хотя бы одного документа в любом воркспейсе.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <a key={workspace.id} href={`/podcast/${workspace.id}`} className="block">
              <Card className="h-full border-border/80 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {workspace.description || "Соберите разговорный сценарий по материалам этого воркспейса."}
                      </CardDescription>
                    </div>
                    <div className="rounded-2xl border border-pink-500/20 bg-pink-500/10 p-2 text-pink-500">
                      <Mic className="h-5 w-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    {workspace.readyCount} готовых источника
                  </div>
                  <span>Открыть</span>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
