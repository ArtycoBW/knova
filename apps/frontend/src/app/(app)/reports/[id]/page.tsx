"use client";

import { useMemo } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine,
  ArrowLeft,
  FileBadge2,
  FileText,
  Loader2,
  Mic,
  ScrollText,
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
import { Skeleton } from "@/components/ui/skeleton";
import { useGenerateReport, useReport } from "@/hooks/use-report";

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
      return "Собираем отчёт";
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

function markdownToDocxChildren(content: string) {
  return content.split("\n").flatMap((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return [new Paragraph({})];
    }

    if (trimmed.startsWith("## ")) {
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(trimmed.replace(/^##\s+/, ""))],
        }),
      ];
    }

    if (trimmed.startsWith("# ")) {
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(trimmed.replace(/^#\s+/, ""))],
        }),
      ];
    }

    if (trimmed.startsWith("- ")) {
      return [
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(trimmed.replace(/^-\s+/, ""))],
        }),
      ];
    }

    return [
      new Paragraph({
        children: [new TextRun(trimmed)],
      }),
    ];
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useReport(id);
  const generateReport = useGenerateReport(id);

  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const isBusy =
    data?.report?.status === "PENDING" || data?.report?.status === "GENERATING";
  const hasContent = !!data?.report?.content.trim();

  const plainText = useMemo(() => {
    if (!data?.report?.content) {
      return "";
    }

    return data.report.content
      .replace(/^##\s+/gm, "")
      .replace(/^#\s+/gm, "")
      .replace(/^- /gm, "• ");
  }, [data?.report?.content]);

  const safeFileName = useMemo(
    () =>
      (data?.report?.title || `report-${id}`).replace(/[\\/:*?"<>|]+/g, "-"),
    [data?.report?.title, id],
  );

  const handleGenerate = async () => {
    await generateReport.mutateAsync();
  };

  const handleDownloadTxt = () => {
    if (!plainText) {
      return;
    }

    const blob = new Blob([plainText], {
      type: "text/plain;charset=utf-8",
    });

    downloadBlob(blob, `${safeFileName}.txt`);
  };

  const handleDownloadDocx = async () => {
    if (!data?.report?.content) {
      return;
    }

    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              children: [new TextRun(data.report.title)],
            }),
            ...markdownToDocxChildren(data.report.content),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(document);
    downloadBlob(blob, `${safeFileName}.docx`);
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
    return <div className="p-8 text-muted-foreground">Отчёт недоступен</div>;
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
          <h1 className="text-3xl font-semibold">Отчёт</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.report?.status)}`}>
            <ScrollText className="h-3.5 w-3.5" />
            {getStatusLabel(data.report?.status)}
          </Badge>
          <Badge className="gap-2 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            Официальный стиль
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-border/80 xl:min-h-0">
          <CardHeader>
            <CardTitle>Панель отчёта</CardTitle>
            <CardDescription>
              Собирайте деловое резюме по готовым материалам и скачивайте его в
              удобном формате.
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
              disabled={!canGenerate || generateReport.isPending || isBusy}
            >
              {generateReport.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasContent ? "Пересобрать отчёт" : "Собрать отчёт"}
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
                <CardTitle>{data.report?.title || `Отчёт: ${data.workspace.name}`}</CardTitle>
                <CardDescription className="mt-2">
                  {hasContent
                    ? "Формальный текст можно просмотреть, обновить и скачать в TXT или DOCX."
                    : "Соберите официальный отчёт по готовым материалам этого воркспейса."}
                </CardDescription>
              </div>

              {hasContent ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadTxt}>
                    <ArrowDownToLine className="mr-2 h-4 w-4" />
                    TXT
                  </Button>
                  <Button variant="outline" onClick={handleDownloadDocx}>
                    <FileBadge2 className="mr-2 h-4 w-4" />
                    DOCX
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-6">
            {hasContent ? (
              <div className="flex h-full min-h-0 flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Официальный формат</Badge>
                  <Badge variant="outline">
                    Обновлено{" "}
                    {data.report?.updatedAt
                      ? formatDistanceToNow(new Date(data.report.updatedAt), {
                          locale: ru,
                          addSuffix: true,
                        })
                      : "только что"}
                  </Badge>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/70 bg-muted/10 p-6 pr-4">
                  <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-3 prose-headings:mt-6 prose-p:leading-7 prose-li:leading-7">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {data.report?.content || ""}
                    </ReactMarkdown>
                  </article>
                </div>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию отчёта. Текущий текст остаётся на
                    экране, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : !canGenerate ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">Пока нет готовых материалов</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Загрузите документы, аудио или видео в воркспейс и дождитесь
                      обработки, чтобы собрать отчёт.
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/workspace/${id}`}>Перейти к загрузке</Link>
                  </Button>
                </div>
              </div>
            ) : !hasContent && !isBusy ? (
              <div className="flex h-full min-h-[420px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <ScrollText className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Соберите первый отчёт</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI подготовит формальный деловой отчёт с кратким резюме,
                      ключевыми тезисами, выводами и рекомендациями.
                    </p>
                  </div>
                  <Button onClick={handleGenerate} disabled={generateReport.isPending}>
                    {generateReport.isPending ? (
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
                    Собираем отчёт...
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
