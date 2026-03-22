"use client";

import { CheckCircle2, Cpu, Mic, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCurrentLlmProvider,
  useLlmProviders,
  useSwitchLlmProvider,
} from "@/hooks/use-settings";

export default function SettingsPage() {
  const currentProvider = useCurrentLlmProvider();
  const providers = useLlmProviders();
  const switchProvider = useSwitchLlmProvider();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-[Syne] text-3xl font-bold">Настройки</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Управляйте активным AI-провайдером и проверяйте готовность подключённых моделей.
        </p>
      </div>

      <Card id="ai-provider" className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            AI-провайдер
          </CardTitle>
          <CardDescription>
            Можно быстро переключаться между Центр-Инвест, Gemini и Ollama без
            перезапуска интерфейса.
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
                <Badge className="gap-1 border-primary/20 bg-primary/10 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {providers.data?.find((item) => item.id === currentProvider.data?.provider)?.name ??
                    currentProvider.data.provider}
                </Badge>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        STT: {provider.sttAvailable ? "есть" : "нет"}
                      </Badge>
                      <Badge variant={provider.available ? "secondary" : "outline"}>
                        {provider.available ? "Готов" : "Не настроен"}
                      </Badge>
                    </div>
                    {provider.reason ? (
                      <p className="text-xs leading-5 text-muted-foreground">{provider.reason}</p>
                    ) : (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Провайдер готов к переключению.
                      </p>
                    )}
                    <Button
                      className="w-full"
                      variant={active ? "secondary" : "default"}
                      disabled={
                        active || switchProvider.isPending || !provider.available
                      }
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
