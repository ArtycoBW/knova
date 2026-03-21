"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { CheckSquare, Sparkles, Trophy } from "lucide-react";

export default function QuizIndexPage() {
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
          <h1 className="font-[Syne] text-3xl font-bold">Тесты и карточки</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите воркспейс с готовыми материалами, соберите вопросы и
            пройдите AI-проверку знаний с начислением XP.
          </p>
        </div>
        <Badge className="gap-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/20">
          <Sparkles className="h-3.5 w-3.5" />
          Flash-карточки + XP
        </Badge>
      </div>

      {!workspaces.length ? (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Пока нечего проверять</CardTitle>
            <CardDescription>
              Сначала загрузите и дождитесь обработки хотя бы одного документа
              в любом воркспейсе.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <a key={workspace.id} href={`/quiz/${workspace.id}`} className="block">
              <Card className="h-full border-border/80 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {workspace.description ||
                          "Соберите 10 вопросов по материалам этого воркспейса и проверьте понимание темы."}
                      </CardDescription>
                    </div>
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-500">
                      <CheckSquare className="h-5 w-5" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
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
