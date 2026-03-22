"use client";

import { FileText, ScrollText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/hooks/use-workspaces";

export default function ReportsIndexPage() {
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
          <h1 className="text-3xl font-semibold">Отчёты</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Собирайте официальные резюме и деловые сводки по готовым материалам
            воркспейса.
          </p>
        </div>
        <Badge className="gap-2 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/20">
          <Sparkles className="h-3.5 w-3.5" />
          DOCX + деловой шаблон
        </Badge>
      </div>

      {!workspaces.length ? (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Пока не из чего собирать отчёт</CardTitle>
            <CardDescription>
              Сначала загрузите и обработайте хотя бы один документ в любом
              воркспейсе.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <a key={workspace.id} href={`/reports/${workspace.id}`} className="block">
              <Card className="h-full border-border/80 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5">
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {workspace.description ||
                          "Соберите официальный отчёт по ключевым фактам, выводам и рекомендациям."}
                      </CardDescription>
                    </div>
                    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-500">
                      <FileText className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <ScrollText className="h-4 w-4" />
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
