"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cpu, Mic, RefreshCw } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProviderInfo {
  provider: string;
  model: string;
  sttAvailable: boolean;
}

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  sttAvailable: boolean;
}

export default function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const currentProvider = useQuery<ProviderInfo>({
    queryKey: ["settings", "llm"],
    queryFn: () => api.get("/settings/llm").then((response) => response.data),
  });

  const providers = useQuery<ProviderItem[]>({
    queryKey: ["settings", "providers"],
    queryFn: () => api.get("/settings/llm/providers").then((response) => response.data),
  });

  const switchProvider = useMutation({
    mutationFn: (provider: string) =>
      api.put("/settings/llm", { provider }).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "llm"] });
      toast.show({ variant: "success", title: "Провайдер обновлён", message: "Настройка сохранена" });
    },
    onError: (error) => {
      toast.show({ variant: "error", title: "Ошибка", message: getErrorMessage(error) });
    },
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-[Syne] text-3xl font-bold">Настройки</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Управляйте активным AI-провайдером и проверяйте готовность инфраструктуры.
        </p>
      </div>

      <Card id="ai-provider" className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            AI-провайдер
          </CardTitle>
          <CardDescription>
            Переключение между Центр-Инвест, Gemini и Ollama без изменения кода.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            {currentProvider.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Загружаем текущую конфигурацию...
              </div>
            ) : currentProvider.data ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge>{currentProvider.data.provider}</Badge>
                <span className="text-sm text-muted-foreground">
                  Модель: {currentProvider.data.model}
                </span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Mic className="h-4 w-4" />
                  STT {currentProvider.data.sttAvailable ? "доступен" : "недоступен"}
                </span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {providers.data?.map((provider) => {
              const active = currentProvider.data?.provider === provider.id;

              return (
                <Card key={provider.id} className={active ? "border-primary/40 bg-primary/5" : ""}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-lg">
                      <span>{provider.name}</span>
                      {active ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
                    </CardTitle>
                    <CardDescription>{provider.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      STT: {provider.sttAvailable ? "поддерживается" : "не поддерживается"}
                    </p>
                    <Button
                      className="w-full"
                      variant={active ? "secondary" : "default"}
                      disabled={active || switchProvider.isPending}
                      onClick={() => switchProvider.mutate(provider.id)}
                    >
                      {active ? "Активен" : "Выбрать"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
