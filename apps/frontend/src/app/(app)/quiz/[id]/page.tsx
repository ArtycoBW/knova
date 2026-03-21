"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { jsPDF } from "jspdf";
import {
  ArrowDownToLine,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileBadge2,
  FileText,
  Loader2,
  Mic,
  RotateCcw,
  Sparkles,
  Video,
  WandSparkles,
  XCircle,
} from "lucide-react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QuizSubmitResponse, useGenerateQuiz, useQuiz, useSubmitQuiz } from "@/hooks/use-quiz";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";

type ViewMode = "cards" | "test" | "result";

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
      return "Собираем вопросы";
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

function buildQuizTxt(
  title: string,
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>,
) {
  return [
    title,
    "",
    ...questions.flatMap((question, index) => [
      `${index + 1}. ${question.question}`,
      ...question.options.map((option, optionIndex) => {
        const prefix = optionIndex === question.correctIndex ? "*" : "-";
        return `   ${prefix} ${option}`;
      }),
      `   Пояснение: ${question.explanation}`,
      "",
    ]),
  ].join("\n");
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

export default function QuizWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuiz(id);
  const generateQuiz = useGenerateQuiz(id);
  const submitQuiz = useSubmitQuiz(id);
  const toast = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [testIndex, setTestIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [result, setResult] = useState<QuizSubmitResponse | null>(null);

  const questions = data?.quiz?.questions?.questions ?? [];
  const hasQuestions = questions.length > 0;
  const isBusy =
    data?.quiz?.status === "PENDING" || data?.quiz?.status === "GENERATING";
  const canGenerate = (data?.readyDocuments.length ?? 0) > 0;
  const currentCard = questions[cardIndex];
  const currentQuestion = questions[testIndex];
  const selectedAnswer = answers[testIndex];
  const readyVersion =
    data?.quiz?.status === "READY" && hasQuestions
      ? `${data.quiz.id}:${data.quiz.updatedAt}`
      : null;

  useEffect(() => {
    if (!readyVersion) {
      return;
    }

    setCardIndex(0);
    setFlipped(false);
    setTestIndex(0);
    setAnswers([]);
    setShowFeedback(false);
    setResult(null);
    setViewMode("cards");
  }, [readyVersion]);

  const completionPercent = useMemo(() => {
    if (!questions.length) {
      return 0;
    }

    return Math.round(((testIndex + 1) / questions.length) * 100);
  }, [questions.length, testIndex]);

  const quizText = useMemo(() => {
    if (!data?.quiz || !questions.length) {
      return "";
    }

    return buildQuizTxt(data.quiz.title, questions);
  }, [data?.quiz, questions]);

  const getSafeFileName = () =>
    (data?.quiz?.title || `quiz-${id}`).replace(/[\\/:*?"<>|]+/g, "-");

  const handleGenerate = async () => {
    await generateQuiz.mutateAsync();
  };

  const handleDownloadTxt = () => {
    if (!quizText) {
      return;
    }

    const blob = new Blob([quizText], {
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
    if (!questions.length || !data?.quiz) {
      return;
    }

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${data.quiz.title}</title>
        </head>
        <body>
          <h1>${data.quiz.title}</h1>
          ${questions
            .map(
              (question, index) => `
                <h2>${index + 1}. ${question.question}</h2>
                <ul>
                  ${question.options
                    .map(
                      (option, optionIndex) =>
                        `<li>${optionIndex === question.correctIndex ? "<strong>" : ""}${option}${optionIndex === question.correctIndex ? "</strong>" : ""}</li>`,
                    )
                    .join("")}
                </ul>
                <p><strong>Пояснение:</strong> ${question.explanation}</p>
              `,
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
    if (!questions.length || !data?.quiz) {
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
    const lineHeight = 30;
    const titleGap = 48;
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
    const titleLines = wrapCanvasText(context, data.quiz.title, contentWidth);
    context.font = '20px Arial, "DejaVu Sans", sans-serif';

    let currentPage: string[] = [];
    let cursorY = marginY + titleLines.length * 40 + titleGap;

    for (const [questionIndex, question] of questions.entries()) {
      const blockLines = [
        ...wrapCanvasText(context, `${questionIndex + 1}. ${question.question}`, contentWidth),
        ...question.options.flatMap((option, optionIndex) =>
          wrapCanvasText(
            context,
            `${optionIndex === question.correctIndex ? "* " : "- "}${option}`,
            contentWidth - 16,
          ).map((line, lineIndex) => (lineIndex === 0 ? `  ${line}` : `    ${line}`)),
        ),
        ...wrapCanvasText(context, `Пояснение: ${question.explanation}`, contentWidth),
      ];
      const blockHeight = blockLines.length * lineHeight + paragraphGap;

      if (cursorY + blockHeight > bottomLimit && currentPage.length) {
        pages.push(currentPage);
        currentPage = [];
        cursorY = marginY;
      }

      currentPage.push(...blockLines, "__gap__");
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
      context.font = '20px Arial, "DejaVu Sans", sans-serif';
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

  const handleAnswer = (optionIndex: number) => {
    if (showFeedback) {
      return;
    }

    setAnswers((current) => {
      const next = [...current];
      next[testIndex] = optionIndex;
      return next;
    });
    setShowFeedback(true);
  };

  const handleNextQuestion = async () => {
    if (testIndex === questions.length - 1) {
      const response = await submitQuiz.mutateAsync(
        questions.map((_, index) => answers[index]),
      );
      setResult(response);
      setViewMode("result");
      return;
    }

    setTestIndex((current) => current + 1);
    setShowFeedback(false);
  };

  const resetTest = () => {
    setAnswers([]);
    setShowFeedback(false);
    setTestIndex(0);
    setResult(null);
    setViewMode("test");
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
    return <div className="p-8 text-muted-foreground">Тест недоступен</div>;
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
          <h1 className="text-3xl font-semibold">Тесты и карточки</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Воркспейс: {data.workspace.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.quiz?.status)}`}>
            <Brain className="h-3.5 w-3.5" />
            {getStatusLabel(data.quiz?.status)}
          </Badge>
          <Badge className="gap-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            Flash-карточки + XP
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col border-border/80">
          <CardHeader>
            <CardTitle>Панель проверки</CardTitle>
            <CardDescription>
              AI собирает 10 вопросов по готовым материалам воркспейса.
              Сначала можно пролистать карточки, затем пройти тест.
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
                    Пока нет готовых материалов для генерации.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Вопросов
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {questions.length || 10}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Последнее обновление
                </p>
                <p className="mt-2 text-sm font-medium">
                  {data.quiz?.updatedAt
                    ? formatDistanceToNow(new Date(data.quiz.updatedAt), {
                        locale: ru,
                        addSuffix: true,
                      })
                    : "ещё не запускали"}
                </p>
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={handleGenerate}
              disabled={!canGenerate || generateQuiz.isPending || isBusy}
            >
              {generateQuiz.isPending || isBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              {hasQuestions ? "Пересобрать вопросы" : "Собрать вопросы"}
            </Button>

            {hasQuestions ? (
              <div className="space-y-2">
                <Button
                  variant={viewMode === "cards" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setViewMode("cards")}
                >
                  Карточки
                </Button>
                <Button
                  variant={viewMode === "test" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => {
                    setViewMode("test");
                    if (!answers.length && !result) {
                      resetTest();
                    }
                  }}
                >
                  Пройти тест
                </Button>
              </div>
            ) : null}

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
                <CardTitle>{data.quiz?.title || `Тест: ${data.workspace.name}`}</CardTitle>
                <CardDescription className="mt-2">
                  {hasQuestions
                    ? `Вопросы собраны по ${
                        data.quiz?.questions.generatedFrom || data.readyDocuments.length
                      } источникам воркспейса`
                    : "Соберите карточки и тест по готовым документам, аудио и видео этого воркспейса."}
                </CardDescription>
              </div>

              {hasQuestions ? (
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

          <CardContent className="flex min-h-0 flex-1 flex-col p-6">
            {!canGenerate ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-md space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-border bg-muted/40">
                    <Brain className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Пока нет материалов</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Добавьте документы, аудио или видео в воркспейс, чтобы
                      собрать карточки и тест.
                    </p>
                  </div>
                  <Button asChild>
                    <a href={`/workspace/${id}`}>Перейти к загрузке</a>
                  </Button>
                </div>
              </div>
            ) : !hasQuestions && !isBusy ? (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="max-w-lg space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold">Соберите первый тест</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      AI подготовит 10 вопросов, flash-карточки и режим
                      прохождения с подсчётом XP.
                    </p>
                  </div>
                  <Button onClick={handleGenerate} disabled={generateQuiz.isPending}>
                    {generateQuiz.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <WandSparkles className="mr-2 h-4 w-4" />
                    )}
                    Запустить генерацию
                  </Button>
                </div>
              </div>
            ) : hasQuestions && viewMode === "cards" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      Карточка {cardIndex + 1} из {questions.length}
                    </Badge>
                    <Badge variant="outline">Нажмите по карточке, чтобы перевернуть</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex((current) =>
                          current === 0 ? questions.length - 1 : current - 1,
                        );
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex((current) =>
                          current === questions.length - 1 ? 0 : current + 1,
                        );
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setFlipped((current) => !current)}
                  className="block min-h-0 flex-1 [perspective:1600px]"
                >
                  <div
                    className={cn(
                      "relative h-full min-h-[420px] w-full rounded-[28px] border border-border bg-card shadow-lg transition-transform duration-700 [transform-style:preserve-3d]",
                      flipped && "[transform:rotateY(180deg)]",
                    )}
                  >
                    <div className="absolute inset-0 flex h-full flex-col rounded-[28px] p-8 [backface-visibility:hidden]">
                      <div className="flex items-center justify-between gap-3">
                        <Badge className="gap-2 border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
                          <Brain className="h-3.5 w-3.5" />
                          Вопрос
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {cardIndex + 1}/{questions.length}
                        </span>
                      </div>
                      <div className="flex flex-1 items-center justify-center">
                        <p className="max-w-4xl text-center text-2xl font-semibold leading-tight md:text-[2rem]">
                          {currentCard?.question}
                        </p>
                      </div>
                    </div>

                    <div className="absolute inset-0 flex h-full flex-col rounded-[28px] border border-emerald-500/20 bg-emerald-500/5 p-8 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                      <div className="flex items-center justify-between gap-3">
                        <Badge className="gap-2 border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Ответ
                        </Badge>
                        <span className="text-sm text-muted-foreground">Подсказка</span>
                      </div>

                      <div className="flex flex-1 flex-col justify-center gap-6">
                        <div className="space-y-2 text-center">
                          <p className="text-sm uppercase tracking-wide text-muted-foreground">
                            Правильный вариант
                          </p>
                          <p className="text-2xl font-semibold leading-snug">
                            {currentCard?.options[currentCard.correctIndex]}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background/70 p-4">
                          <p className="text-sm leading-7 text-muted-foreground">
                            {currentCard?.explanation}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>

                {isBusy ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 dark:text-amber-300">
                    Собираем новую версию вопросов. Текущий набор карточек
                    остаётся доступным, пока не придёт обновлённый результат.
                  </div>
                ) : null}
              </div>
            ) : hasQuestions && viewMode === "test" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline">
                      Вопрос {testIndex + 1} из {questions.length}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Прогресс {completionPercent}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${completionPercent}%` }}
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-5 rounded-3xl border border-border bg-muted/10 p-6">
                  <div className="space-y-2">
                    <p className="text-sm uppercase tracking-wide text-muted-foreground">
                      Выберите вариант
                    </p>
                    <h2 className="text-2xl font-semibold leading-tight">
                      {currentQuestion?.question}
                    </h2>
                  </div>

                  <div className="grid gap-3">
                    {currentQuestion?.options.map((option, optionIndex) => {
                      const isSelected = selectedAnswer === optionIndex;
                      const isCorrect = currentQuestion.correctIndex === optionIndex;
                      const showState = showFeedback;

                      return (
                        <button
                          key={`${currentQuestion.id}-${optionIndex}`}
                          type="button"
                          onClick={() => handleAnswer(optionIndex)}
                          disabled={showFeedback}
                          className={cn(
                            "rounded-2xl border px-4 py-4 text-left text-sm transition-colors",
                            !showState &&
                              "border-border bg-card hover:border-primary/40 hover:bg-primary/5",
                            showState &&
                              isCorrect &&
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 dark:text-emerald-200",
                            showState &&
                              isSelected &&
                              !isCorrect &&
                              "border-rose-500/30 bg-rose-500/10 text-rose-100 dark:text-rose-200",
                            showState &&
                              !isSelected &&
                              !isCorrect &&
                              "border-border bg-card opacity-70",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="leading-6">{option}</span>
                            {showState && isCorrect ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            ) : null}
                            {showState && isSelected && !isCorrect ? (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                    {showFeedback ? (
                      <div
                      className={cn(
                        "rounded-2xl border px-4 py-4",
                        selectedAnswer === currentQuestion?.correctIndex
                          ? "border-emerald-500/20 bg-emerald-500/10"
                          : "border-rose-500/20 bg-rose-500/10",
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {selectedAnswer === currentQuestion?.correctIndex ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-400" />
                        )}
                        {selectedAnswer === currentQuestion?.correctIndex
                          ? "Верно"
                          : "Есть ошибка"}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {currentQuestion?.explanation}
                      </p>
                      <div className="mt-4 flex justify-end">
                        <Button
                          onClick={handleNextQuestion}
                          disabled={submitQuiz.isPending}
                        >
                          {submitQuiz.isPending && testIndex === questions.length - 1 ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {testIndex === questions.length - 1
                            ? "Завершить тест"
                            : "Следующий вопрос"}
                        </Button>
                      </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : result ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-6">
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-wide text-emerald-300">
                        Итог
                      </p>
                      <h2 className="mt-2 text-5xl font-bold">
                        {result.result.score}%
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Правильных ответов: {result.result.correctAnswers} из{" "}
                        {result.result.totalQuestions}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        +{result.rewards.xpAwarded} XP
                      </Badge>
                      {result.rewards.badges.map((badge) => (
                        <Badge key={badge.name} variant="outline">
                          {badge.icon} {badge.name}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button onClick={resetTest}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Пройти ещё раз
                    </Button>
                    <Button variant="outline" onClick={() => setViewMode("cards")}>
                      <Brain className="mr-2 h-4 w-4" />
                      Вернуться к карточкам
                    </Button>
                  </div>
                </div>

                  <div className="space-y-3">
                  {result.result.answers.map((answer) => (
                    <div
                      key={answer.questionId}
                      className={cn(
                        "rounded-2xl border p-4",
                        answer.isCorrect
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-rose-500/20 bg-rose-500/5",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{answer.question}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Ваш ответ: {answer.selectedOption}
                          </p>
                          {!answer.isCorrect ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              Правильный ответ: {answer.correctOption}
                            </p>
                          ) : null}
                        </div>
                        {answer.isCorrect ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        ) : (
                          <XCircle className="h-5 w-5 text-rose-400" />
                        )}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {answer.explanation}
                      </p>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center">
                <div className="rounded-2xl border border-border bg-background/95 px-5 py-4 shadow-lg">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Собираем вопросы для теста...
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
