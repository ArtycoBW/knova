"use client";

import { useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowDownToLine,
  ArrowLeft,
  AudioLines,
  BarChart2,
  FileText,
  LineChart,
  Loader2,
  PieChart,
  Video,
  WandSparkles,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartType, useGenerateInfographic, useInfographic } from "@/hooks/use-infographic";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
);

function getStatusBadge(
  status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null,
) {
  switch (status) {
    case "READY":
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "GENERATING":
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300";
    case "ERROR":
      return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300";
  }
}

function getStatusLabel(
  status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null,
) {
  switch (status) {
    case "READY":
      return "Готово";
    case "GENERATING":
      return "Собираем инфографику";
    case "ERROR":
      return "Ошибка";
    default:
      return "В очереди";
  }
}

function getSourceIcon(sourceType: "FILE" | "AUDIO" | "VIDEO") {
  if (sourceType === "AUDIO") {
    return <AudioLines className="h-3.5 w-3.5" />;
  }

  if (sourceType === "VIDEO") {
    return <Video className="h-3.5 w-3.5" />;
  }

  return <FileText className="h-3.5 w-3.5" />;
}

function getChartButtonLabel(type: ChartType) {
  switch (type) {
    case "line":
      return "Линия";
    case "pie":
      return "Pie";
    case "doughnut":
      return "Doughnut";
    default:
      return "Bar";
  }
}

export default function InfographicWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useInfographic(id);
  const generateInfographic = useGenerateInfographic(id);
  const chartRef = useRef<ChartJS<ChartType> | null>(null);
  const [displayType, setDisplayType] = useState<ChartType>("bar");

  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const isBusy =
    data?.infographic?.status === "PENDING" ||
    data?.infographic?.status === "GENERATING";
  const chartData = data?.infographic?.chartData;
  const hasChart =
    (chartData?.data.labels.length ?? 0) > 0 &&
    (chartData?.data.datasets.length ?? 0) > 0;

  const effectiveType = hasChart ? displayType : data?.infographic?.chartType || "bar";

  const chartConfig = useMemo<ChartData<ChartType>>(
    () => ({
      labels: chartData?.data.labels ?? [],
      datasets:
        chartData?.data.datasets.map((dataset) => ({
          ...dataset,
          data: dataset.data,
          backgroundColor:
            effectiveType === "line"
              ? dataset.backgroundColor?.map((color) => `${color.slice(0, 7)}33`) ??
                dataset.backgroundColor
              : dataset.backgroundColor,
          borderColor: dataset.borderColor,
          borderWidth: dataset.borderWidth ?? 2,
          tension: dataset.tension ?? 0.35,
          fill: effectiveType === "line" ? false : dataset.fill,
        })) ?? [],
    }),
    [chartData?.data.datasets, chartData?.data.labels, effectiveType],
  );

  const chartOptions = useMemo<ChartOptions<ChartType>>(
    () => ({
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: {
          labels: {
            color: "rgb(148 163 184)",
          },
        },
      },
      scales:
        effectiveType === "bar" || effectiveType === "line"
          ? {
              x: {
                ticks: { color: "rgb(148 163 184)" },
                grid: { color: "rgba(148, 163, 184, 0.12)" },
              },
              y: {
                ticks: { color: "rgb(148 163 184)" },
                grid: { color: "rgba(148, 163, 184, 0.12)" },
              },
            }
          : undefined,
    }),
    [effectiveType],
  );

  const handleGenerate = async () => {
    await generateInfographic.mutateAsync();
  };

  const handleDownloadPng = () => {
    const url = chartRef.current?.toBase64Image?.();
    if (!url) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(data?.infographic?.title || `infographic-${id}`).replace(/[\\/:*?"<>|]+/g, "-")}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const renderChart = () => {
    const commonProps = {
      ref: (instance: ChartJS<ChartType> | null) => {
        chartRef.current = instance;
      },
      data: chartConfig,
      options: chartOptions,
    };

    switch (effectiveType) {
      case "line":
        return (
          <Line
            ref={commonProps.ref as never}
            data={chartConfig as ChartData<"line">}
            options={chartOptions as ChartOptions<"line">}
          />
        );
      case "pie":
        return (
          <Pie
            ref={commonProps.ref as never}
            data={chartConfig as ChartData<"pie">}
            options={chartOptions as ChartOptions<"pie">}
          />
        );
      case "doughnut":
        return (
          <Doughnut
            ref={commonProps.ref as never}
            data={chartConfig as ChartData<"doughnut">}
            options={chartOptions as ChartOptions<"doughnut">}
          />
        );
      default:
        return (
          <Bar
            ref={commonProps.ref as never}
            data={chartConfig as ChartData<"bar">}
            options={chartOptions as ChartOptions<"bar">}
          />
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Инфографика недоступна</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a
            href={`/workspace/${id}`}
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться к воркспейсу
          </a>
          <h1 className="text-3xl font-semibold">Инфографика</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.infographic?.status)}`}>
            <BarChart2 className="h-3.5 w-3.5" />
            {getStatusLabel(data.infographic?.status)}
          </Badge>
          <Badge className="gap-2 border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/20 dark:bg-cyan-500/15 dark:text-cyan-300 dark:hover:bg-cyan-500/20">
            <PieChart className="h-3.5 w-3.5" />
            PNG + switch type
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col border-border/80">
          <CardHeader>
            <CardTitle>Панель визуализации</CardTitle>
            <CardDescription>
              AI выбирает тип графика и собирает данные для наглядного представления.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium">Готовые источники</p>
              <div className="mt-3 space-y-2">
                {data.readyDocuments.length ? (
                  data.readyDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-sm"
                    >
                      {getSourceIcon(document.sourceType)}
                      <span className="truncate">{document.originalName}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Пока нет готовых материалов для инфографики.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Тип отображения</p>
              <div className="grid grid-cols-2 gap-2">
                {(["bar", "line", "pie", "doughnut"] as ChartType[]).map((type) => (
                  <Button
                    key={type}
                    variant={effectiveType === type ? "default" : "outline"}
                    onClick={() => setDisplayType(type)}
                    disabled={!hasChart}
                    className="justify-start"
                  >
                    {type === "bar" ? (
                      <BarChart2 className="mr-2 h-4 w-4" />
                    ) : type === "line" ? (
                      <LineChart className="mr-2 h-4 w-4" />
                    ) : (
                      <PieChart className="mr-2 h-4 w-4" />
                    )}
                    {getChartButtonLabel(type)}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={handleGenerate}
              disabled={!canGenerate || generateInfographic.isPending || isBusy}
            >
              {generateInfographic.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasChart ? "Пересобрать инфографику" : "Собрать инфографику"}
            </Button>

            {!canGenerate ? (
              <Button asChild variant="outline" className="w-full">
                <a href={`/workspace/${id}`}>Перейти к загрузке</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden border-border/80">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{data.infographic?.title || `Инфографика: ${data.workspace.name}`}</CardTitle>
                <CardDescription className="mt-2">
                  {hasChart
                    ? `Построено по ${chartData?.generatedFrom || data.readyDocuments.length} готовым источникам`
                    : "Соберите график по готовым материалам этого воркспейса."}
                </CardDescription>
              </div>

              {hasChart ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadPng}>
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    PNG
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-5 p-6">
            {!canGenerate ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-muted/40">
                    <PieChart className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Пока нет материалов</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Добавьте документы, аудио или видео в воркспейс, чтобы построить инфографику.
                    </p>
                  </div>
                  <Button asChild>
                    <a href={`/workspace/${id}`}>Перейти к загрузке</a>
                  </Button>
                </div>
              </div>
            ) : !hasChart && !isBusy ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <BarChart2 className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Соберите первую инфографику</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI выберет подходящий тип графика и визуально покажет ключевые числа и соотношения по вашим материалам.
                    </p>
                  </div>
                  <Button onClick={handleGenerate} disabled={generateInfographic.isPending}>
                    {generateInfographic.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    Запустить генерацию
                  </Button>
                </div>
              </div>
            ) : hasChart ? (
              <div className="flex min-h-0 flex-1 flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{effectiveType}</Badge>
                  <Badge variant="outline">{chartData?.data.labels.length || 0} меток</Badge>
                  <Badge variant="outline">
                    Обновлено{" "}
                    {data.infographic?.updatedAt
                      ? formatDistanceToNow(new Date(data.infographic.updatedAt), {
                          locale: ru,
                          addSuffix: true,
                        })
                      : "только что"}
                  </Badge>
                </div>

                {chartData?.summary ? (
                  <div className="rounded-2xl border border-border bg-muted/10 px-4 py-3 text-sm leading-6 text-muted-foreground">
                    {chartData.summary}
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-muted/10 p-4">
                  <div className="h-full min-h-[420px]">{renderChart()}</div>
                </div>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию инфографики. Текущий график остаётся на экране, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="rounded-2xl border border-border bg-background/95 px-5 py-4 shadow-lg">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Собираем инфографику...
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
