"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowDownToLine,
  ArrowLeft,
  FileText,
  LayoutTemplate,
  Loader2,
  Mic,
  MonitorPlay,
  Presentation,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getErrorMessage } from "@/lib/api";
import {
  type PresentationSlide,
  useGeneratePresentation,
  usePresentation,
} from "@/hooks/use-presentation";
import { useToast } from "@/providers/toast-provider";

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
      return "Собираем слайды";
    case "ERROR":
      return "Ошибка";
    default:
      return "В очереди";
  }
}

function getSourceIcon(sourceType: "FILE" | "AUDIO" | "VIDEO") {
  if (sourceType === "AUDIO") {
    return <Mic className="h-3.5 w-3.5" />;
  }

  if (sourceType === "VIDEO") {
    return <Video className="h-3.5 w-3.5" />;
  }

  return <FileText className="h-3.5 w-3.5" />;
}

function SlidePreview({
  slide,
  index,
}: {
  slide: PresentationSlide;
  index: number;
}) {
  return (
    <div className="h-full w-full overflow-y-auto rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,rgba(16,24,38,0.99),rgba(15,23,42,0.99))] p-8 shadow-[0_22px_48px_rgba(0,0,0,0.24)]">
      <div className="flex min-h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Слайд {index + 1}
            </p>
            <h3 className="mt-3 text-3xl font-semibold leading-tight text-slate-50">
              {slide.title}
            </h3>
          </div>
          <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 p-2.5 text-orange-400">
            <MonitorPlay className="h-4 w-4" />
          </div>
        </div>

        <div className="grid flex-1 gap-4">
          {slide.bullets.map((bullet, bulletIndex) => (
            <div
              key={`${index}-${bulletIndex}`}
              className="rounded-2xl border border-white/8 bg-white/4 px-5 py-4 text-base leading-7 text-slate-100"
            >
              {bullet}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PresentationWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = usePresentation(id);
  const generatePresentation = useGeneratePresentation(id);
  const toast = useToast();
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const isBusy =
    data?.presentation?.status === "PENDING" ||
    data?.presentation?.status === "GENERATING";
  const slides = data?.presentation?.slides.slides ?? [];
  const hasSlides = slides.length > 0;
  const activeSlide = slides[activeSlideIndex] ?? slides[0] ?? null;
  const updatedLabel = useMemo(() => {
    if (!data?.presentation?.updatedAt) {
      return "только что";
    }

    return formatDistanceToNow(new Date(data.presentation.updatedAt), {
      locale: ru,
      addSuffix: true,
    });
  }, [data?.presentation?.updatedAt]);

  useEffect(() => {
    if (!slides.length) {
      setActiveSlideIndex(0);
      return;
    }

    setActiveSlideIndex((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  const handleGenerate = async () => {
    await generatePresentation.mutateAsync();
  };

  const handleDownloadPptx = async () => {
    try {
      setIsDownloading(true);
      const response = await api.get(`/presentation/${id}/file`, {
        responseType: "blob",
      });
      const blob = response.data as Blob;
      const contentDisposition = response.headers["content-disposition"] as
        | string
        | undefined;
      const utfNameMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiNameMatch = contentDisposition?.match(/filename="(.+?)"/i);
      const fileName = utfNameMatch?.[1]
        ? decodeURIComponent(utfNameMatch[1])
        : asciiNameMatch?.[1] || `${data?.workspace.name || "presentation"}.pptx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.show({
        variant: "error",
        title: "Не удалось скачать PPTX",
        message: getErrorMessage(error),
      });
    } finally {
      setIsDownloading(false);
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
    return <div className="p-8 text-muted-foreground">Презентация недоступна</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/workspace/${id}`}
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться к воркспейсу
          </Link>
          <h1 className="text-3xl font-semibold">Презентация</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.presentation?.status)}`}>
            <Presentation className="h-3.5 w-3.5" />
            {getStatusLabel(data.presentation?.status)}
          </Badge>
          <Badge className="gap-2 border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-500/20 dark:bg-orange-500/15 dark:text-orange-300 dark:hover:bg-orange-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            PPTX + предпросмотр слайдов
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-border/80 xl:min-h-0">
          <CardHeader>
            <CardTitle>Панель презентации</CardTitle>
            <CardDescription>
              Собирайте структуру слайдов по материалам воркспейса и
              экспортируйте её в PPTX.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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
                    Пока нет готовых материалов для генерации.
                  </p>
                )}
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={handleGenerate}
              disabled={!canGenerate || generatePresentation.isPending || isBusy}
            >
              {generatePresentation.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasSlides ? "Пересобрать презентацию" : "Собрать презентацию"}
            </Button>

            {!canGenerate && (
              <Button asChild variant="outline" className="w-full">
                <Link href={`/workspace/${id}`}>Перейти к загрузке</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden border-border/80">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {data.presentation?.title || `Презентация: ${data.workspace.name}`}
                </CardTitle>
                <CardDescription className="mt-2">
                  {hasSlides
                    ? "Слайды можно просмотреть, пересобрать и скачать в PPTX."
                    : "Соберите презентацию по готовым материалам этого воркспейса."}
                </CardDescription>
              </div>

              {hasSlides ? (
                <Button
                  variant="outline"
                  onClick={handleDownloadPptx}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                  )}
                  PPTX
                </Button>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-6">
            {hasSlides ? (
              <div className="flex h-full min-h-0 flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{slides.length} слайдов</Badge>
                  <Badge variant="outline">Обновлено {updatedLabel}</Badge>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto rounded-2xl border border-border/70 bg-muted/10 p-3">
                    <div className="space-y-3">
                      {slides.map((slide, index) => (
                        <button
                          key={`${slide.title}-${index}`}
                          type="button"
                          onClick={() => setActiveSlideIndex(index)}
                          className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                            index === activeSlideIndex
                              ? "border-orange-500/50 bg-orange-500/10"
                              : "border-border/70 bg-background/70 hover:border-orange-500/30 hover:bg-orange-500/5"
                          }`}
                        >
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Слайд {index + 1}
                          </p>
                          <p className="mt-2 line-clamp-2 text-sm font-medium">
                            {slide.title}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0">
                    {activeSlide ? (
                      <SlidePreview slide={activeSlide} index={activeSlideIndex} />
                    ) : null}
                  </div>
                </div>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию презентации. Текущие слайды остаются на
                    экране, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : !canGenerate ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
                    <Presentation className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">
                      Пока нет готовых материалов
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Загрузите документы, аудио или видео в воркспейс и
                      дождитесь обработки, чтобы собрать презентацию.
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/workspace/${id}`}>Перейти к загрузке</Link>
                  </Button>
                </div>
              </div>
            ) : !hasSlides && !isBusy ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <LayoutTemplate className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">
                      Соберите первую презентацию
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI подготовит структуру слайдов и готовый экспорт в PPTX.
                    </p>
                  </div>
                  <Button
                    onClick={handleGenerate}
                    disabled={generatePresentation.isPending}
                  >
                    {generatePresentation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    Запустить генерацию
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="rounded-2xl border border-border bg-background/95 px-5 py-4 shadow-lg">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Собираем презентацию...
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
