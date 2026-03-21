"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { jsPDF } from "jspdf";
import {
  ArrowDownToLine,
  ArrowLeft,
  FileBadge2,
  FileText,
  Loader2,
  Mic,
  Radio,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/providers/toast-provider";
import {
  PodcastLength,
  PodcastTone,
  useGeneratePodcast,
  usePodcast,
} from "@/hooks/use-podcast";

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
      return "Собираем выпуск";
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

function getToneMeta(tone: PodcastTone) {
  return tone === "scientific"
    ? {
        label: "Научная",
        description: "Более строгая, аналитичная и деловая подача.",
      }
    : {
        label: "Популярная",
        description: "Более живая, разговорная и лёгкая подача.",
      };
}

function getLengthMeta(length: PodcastLength) {
  switch (length) {
    case "short":
      return { label: "Короткий", description: "Примерно 2 минуты" };
    case "long":
      return { label: "Длинный", description: "Примерно 10 минут" };
    default:
      return { label: "Средний", description: "Примерно 5 минут" };
  }
}

function estimateDuration(lines: Array<{ text: string }>) {
  const words = lines
    .map((line) => line.text.trim().split(/\s+/).filter(Boolean).length)
    .reduce((sum, count) => sum + count, 0);
  const minutes = Math.max(1, Math.round(words / 130));
  return `${minutes} мин`;
}

function buildTranscriptTxt(
  title: string,
  lines: Array<{ speaker: "A" | "B"; text: string }>,
) {
  return [title, "", ...lines.map((line) => `Ведущий ${line.speaker}: ${line.text}`)].join(
    "\n",
  );
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export default function PodcastWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = usePodcast(id);
  const generatePodcast = useGeneratePodcast(id);
  const toast = useToast();
  const [tone, setTone] = useState<PodcastTone>("popular");
  const [length, setLength] = useState<PodcastLength>("medium");

  const isBusy =
    data?.podcast?.status === "PENDING" || data?.podcast?.status === "GENERATING";
  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const hasScript = (data?.podcast?.script?.lines.length ?? 0) > 0;

  const toneMeta = getToneMeta(tone);
  const lengthMeta = getLengthMeta(length);
  const generatedToneMeta = getToneMeta(data?.podcast?.settings?.tone ?? tone);
  const generatedLengthMeta = getLengthMeta(
    data?.podcast?.settings?.length ?? length,
  );

  const transcriptText = useMemo(() => {
    if (!data?.podcast?.script?.lines?.length) {
      return "";
    }

    return buildTranscriptTxt(data.podcast.title, data.podcast.script.lines);
  }, [data?.podcast]);

  const getSafeFileName = () =>
    (data?.podcast?.title || `podcast-${id}`).replace(/[\\/:*?"<>|]+/g, "-");

  const handleDownloadTxt = () => {
    if (!data?.podcast || !transcriptText) {
      return;
    }

    const blob = new Blob([transcriptText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${getSafeFileName()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDoc = () => {
    if (!data?.podcast?.script?.lines?.length) {
      return;
    }

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${data.podcast.title}</title>
        </head>
        <body>
          <h1>${data.podcast.title}</h1>
          ${data.podcast.script.lines
            .map(
              (line) =>
                `<p><strong>Ведущий ${line.speaker}:</strong> ${line.text.replace(/\n/g, "<br/>")}</p>`,
            )
            .join("")}
        </body>
      </html>
    `;

    const blob = new Blob(["\ufeff", html], {
      type: "application/msword",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${getSafeFileName()}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!data?.podcast?.script?.lines?.length) {
      return;
    }

    const pdf = new jsPDF({
      orientation: "p",
      unit: "pt",
      format: "a4",
    });
    const pageWidth = 1240;
    const pageHeight = 1754;
    const marginX = 72;
    const marginY = 88;
    const contentWidth = pageWidth - marginX * 2;
    const lineHeight = 32;
    const titleGap = 52;
    const paragraphGap = 18;
    const bottomLimit = pageHeight - marginY;
    const pages: string[][] = [];

    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      toast.show({
        variant: "error",
        title: "Не удалось собрать PDF",
        message: "Браузер не поддержал рендер документа",
      });
      return;
    }

    context.font = '28px Arial, "DejaVu Sans", sans-serif';
    const titleLines = wrapCanvasText(context, data.podcast.title, contentWidth);
    context.font = '22px Arial, "DejaVu Sans", sans-serif';

    let currentPage: string[] = [];
    let cursorY =
      marginY + titleLines.length * 40 + titleGap;

    for (const line of data.podcast.script.lines) {
      const textLines = wrapCanvasText(
        context,
        `Ведущий ${line.speaker}: ${line.text}`,
        contentWidth,
      );
      const blockHeight = textLines.length * lineHeight + paragraphGap;

      if (cursorY + blockHeight > bottomLimit && currentPage.length) {
        pages.push(currentPage);
        currentPage = [];
        cursorY = marginY;
      }

      currentPage.push(...textLines, "__gap__");
      cursorY += blockHeight;
    }

    if (currentPage.length) {
      pages.push(currentPage);
    }

    pages.forEach((pageLines, index) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageWidth, pageHeight);

      let drawY = marginY;
      if (index === 0) {
        context.fillStyle = "#0f172a";
        context.font = 'bold 28px Arial, "DejaVu Sans", sans-serif';
        for (const line of titleLines) {
          context.fillText(line, marginX, drawY);
          drawY += 40;
        }
        drawY += titleGap - 40;
      }

      context.fillStyle = "#111827";
      context.font = '22px Arial, "DejaVu Sans", sans-serif';
      for (const line of pageLines) {
        if (line === "__gap__") {
          drawY += paragraphGap;
          continue;
        }
        context.fillText(line, marginX, drawY);
        drawY += lineHeight;
      }

      const image = canvas.toDataURL("image/png");
      if (index > 0) {
        pdf.addPage();
      }
      pdf.addImage(
        image,
        "PNG",
        0,
        0,
        pdf.internal.pageSize.getWidth(),
        pdf.internal.pageSize.getHeight(),
      );
    });

    pdf.save(`${getSafeFileName()}.pdf`);
  };

  const handleGenerate = async () => {
    await generatePodcast.mutateAsync({ tone, length });
    toast.show({
      variant: "success",
      title: "Сценарий обновляется",
      message: "Если генерация завершится быстро, страница сама подхватит готовый результат",
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Подкаст недоступен</div>;
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
          <h1 className="font-[Syne] text-3xl font-bold">Подкаст</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.podcast?.status)}`}>
            <Radio className="h-3.5 w-3.5" />
            {getStatusLabel(data.podcast?.status)}
          </Badge>
          <Badge className="gap-2 border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 dark:border-pink-500/20 dark:bg-pink-500/15 dark:text-pink-300 dark:hover:bg-pink-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            AI-диалог
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-border/80 xl:min-h-0">
          <CardHeader>
            <CardTitle>Настройки выпуска</CardTitle>
            <CardDescription>
              Выберите стиль разговора и длину, чтобы собрать сценарий под нужный формат.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-y-2">
              <Label>Тональность</Label>
              <Select value={tone} onValueChange={(value) => setTone(value as PodcastTone)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Выберите тональность" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popular">Популярная</SelectItem>
                  <SelectItem value="scientific">Научная</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {toneMeta.description}
              </p>
            </div>

            <div className="flex flex-col gap-y-2">
              <Label>Длина</Label>
              <Select
                value={length}
                onValueChange={(value) => setLength(value as PodcastLength)}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Выберите длину" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Короткий</SelectItem>
                  <SelectItem value="medium">Средний</SelectItem>
                  <SelectItem value="long">Длинный</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {lengthMeta.description}
              </p>
            </div>

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
              disabled={!canGenerate || generatePodcast.isPending || isBusy}
            >
              {generatePodcast.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasScript ? "Пересобрать сценарий" : "Собрать сценарий"}
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
                <CardTitle>{data.podcast?.title || `Подкаст: ${data.workspace.name}`}</CardTitle>
                <CardDescription className="mt-2">
                  {hasScript
                    ? `Диалог собран по ${
                        data.podcast?.script.generatedFrom || data.readyDocuments.length
                      } источникам`
                    : "Соберите сценарий диалога двух ведущих по материалам воркспейса."}
                </CardDescription>
              </div>

              {hasScript ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadTxt}>
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    TXT
                  </Button>
                  <Button variant="outline" onClick={handleDownloadDoc}>
                    <FileBadge2 className="mr-2 h-4 w-4" />
                    DOC
                  </Button>
                  <Button variant="outline" onClick={handleDownloadPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-6">
            {hasScript ? (
              <div className="flex h-full min-h-0 flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{generatedToneMeta.label}</Badge>
                  <Badge variant="outline">{generatedLengthMeta.label}</Badge>
                  <Badge variant="outline">
                    {estimateDuration(data.podcast?.script.lines ?? [])}
                  </Badge>
                  <Badge variant="outline">
                    Обновлено{" "}
                    {data.podcast?.updatedAt
                      ? formatDistanceToNow(new Date(data.podcast.updatedAt), {
                          locale: ru,
                          addSuffix: true,
                        })
                      : "только что"}
                  </Badge>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/70 bg-muted/10 p-4 pr-3">
                  <div className="space-y-3">
                    {(data.podcast?.script.lines ?? []).map((line, index) => (
                      <div
                        key={`${line.speaker}-${index}`}
                        className={`rounded-2xl border p-4 ${
                          line.speaker === "A"
                            ? "border-pink-500/20 bg-pink-500/5"
                            : "border-cyan-500/20 bg-cyan-500/5"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs font-medium">
                            <Mic className="h-3.5 w-3.5" />
                            {line.speaker === "A" ? "Ведущий А" : "Ведущий Б"}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Реплика {index + 1}
                          </span>
                        </div>
                        <p className="text-sm leading-7 text-foreground/95">{line.text}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию сценария. Текущий текст остаётся на экране, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : !canGenerate ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
                    <Mic className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">Пока нет готовых материалов</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Загрузите документы, аудио или видео в воркспейс и дождитесь обработки,
                      чтобы собрать подкаст.
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/workspace/${id}`}>Перейти к загрузке</Link>
                  </Button>
                </div>
              </div>
            ) : !hasScript && !isBusy ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <Radio className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Соберите первый выпуск</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI подготовит диалог двух ведущих по вашим материалам. После этого
                      сценарий можно будет скачать в TXT, DOC или PDF.
                    </p>
                  </div>
                  <Button onClick={handleGenerate} disabled={generatePodcast.isPending}>
                    {generatePodcast.isPending ? (
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
                    Собираем сценарий подкаста...
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
