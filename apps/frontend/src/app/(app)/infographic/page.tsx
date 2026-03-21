"use client";

import { BarChart2, PieChart, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/hooks/use-workspaces";

export default function InfographicIndexPage() {
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
          <h1 className="text-3xl font-semibold">Инфографика</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI превращает числовые данные и метаданные ваших материалов в наглядный график.
          </p>
        </div>
        <Badge className="gap-2 border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/20 dark:bg-cyan-500/15 dark:text-cyan-300 dark:hover:bg-cyan-500/20">
          <Sparkles className="h-3.5 w-3.5" />
          Chart.js + PNG
        </Badge>
      </div>

      {!workspaces.length ? (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Пока не из чего строить графики</CardTitle>
            <CardDescription>
              Сначала загрузите и обработайте хотя бы один источник в любом воркспейсе.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <a key={workspace.id} href={`/infographic/${workspace.id}`} className="block">
              <Card className="h-full border-border/80 transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5">
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {workspace.description || "Соберите график и быстро покажите главное по материалам этого воркспейса."}
                      </CardDescription>
                    </div>
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-500">
                      <BarChart2 className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <PieChart className="h-4 w-4" />
                      {workspace.readyCount} готовых источника
                    </div>
                    <span>Открыть</span>
                  </div>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
