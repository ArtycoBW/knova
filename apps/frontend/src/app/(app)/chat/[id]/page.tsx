"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowLeft,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
} from "lucide-react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { Textarea } from "@/components/ui/textarea";
import { useChatSession, useSendChatMessage, useTranscribeChatAudio } from "@/hooks/use-chat";
import { api, getErrorMessage } from "@/lib/api";
import { getRealtimeSocket } from "@/lib/realtime";
import { useToast } from "@/providers/toast-provider";
import { useAuthStore } from "@/store/auth.store";

function normalizeMimeType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase() || "audio/webm";
}

function getRecordingExtension(mimeType: string) {
  switch (normalizeMimeType(mimeType)) {
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    default:
      return "webm";
  }
}

function getRecorderMimeType() {
  const variants = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return variants.find((value) => MediaRecorder.isTypeSupported(value));
}

function MessageBody({
  role,
  content,
}: {
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
}) {
  if (role === "ASSISTANT") {
    return (
      <div className="prose prose-sm max-w-none text-[12.5px] leading-[1.6] prose-slate dark:prose-invert prose-p:my-2 prose-li:my-1 prose-ul:my-2 prose-ol:my-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return <p className="whitespace-pre-wrap text-[12.5px] leading-[1.6]">{content}</p>;
}

function StreamingSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-[92%]" />
      <Skeleton className="h-3.5 w-[84%]" />
      <Skeleton className="h-3.5 w-[68%]" />
    </div>
  );
}

export default function ChatWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data, isLoading } = useChatSession(id);
  const sendMessage = useSendChatMessage(id);
  const transcribeAudio = useTranscribeChatAudio();

  const providerInfo = useQuery<{ sttAvailable: boolean }>({
    queryKey: ["settings", "llm"],
    queryFn: () => api.get("/settings/llm").then((response) => response.data),
    staleTime: 30_000,
  });

  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const responseTimeoutRef = useRef<number | null>(null);

  const clearResponseTimeout = () => {
    if (responseTimeoutRef.current) {
      window.clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
  };

  const scheduleResponseTimeout = () => {
    clearResponseTimeout();
    responseTimeoutRef.current = window.setTimeout(() => {
      setIsStreaming(false);
      setStreamText("");
      setPendingQuestion("");
      toast.show({
        variant: "error",
        title: "Провайдер не ответил",
        message: "Модель слишком долго не отвечает. Проверьте активный AI-провайдер.",
      });
    }, 20000);
  };

  useEffect(() => {
    return () => {
      clearResponseTimeout();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!socket || !id || !accessToken) {
      return;
    }

    const joinRooms = () => {
      socket.emit("workspace:join", { workspaceId: id });
      socket.emit("chat:join", { workspaceId: id, sessionId: data?.sessionId });
    };

    const appendMessage = (message: {
      id: string;
      role: "USER" | "ASSISTANT" | "SYSTEM";
      content: string;
      createdAt: string | Date;
      sources?: unknown;
    }) => {
      queryClient.setQueryData(["chat", id], (current: any) => {
        if (!current) {
          return current;
        }

        if (current.messages.some((item: { id: string }) => item.id === message.id)) {
          return current;
        }

        return {
          ...current,
          messages: [
            ...current.messages,
            {
              ...message,
              createdAt:
                message.createdAt instanceof Date
                  ? message.createdAt.toISOString()
                  : message.createdAt,
            },
          ],
        };
      });
    };

    const handleUserMessage = (event: {
      workspaceId: string;
      sessionId: string;
      message: {
        id: string;
        role: "USER";
        content: string;
        createdAt: string;
      };
    }) => {
      if (event.workspaceId !== id) {
        return;
      }

      clearResponseTimeout();
      setPendingQuestion("");
      setActiveSessionId(event.sessionId);
      appendMessage(event.message);
    };

    const handleChunk = (event: {
      workspaceId: string;
      sessionId: string;
      chunk: string;
    }) => {
      if (event.workspaceId !== id) {
        return;
      }

      clearResponseTimeout();
      setActiveSessionId(event.sessionId);
      setIsStreaming(true);
      setStreamText((current) => current + event.chunk);
    };

    const handleDone = (event: {
      workspaceId: string;
      sessionId: string;
      message: {
        id: string;
        role: "ASSISTANT";
        content: string;
        sources?: unknown;
        createdAt: string;
      };
    }) => {
      if (event.workspaceId !== id) {
        return;
      }

      clearResponseTimeout();
      appendMessage(event.message);
      setIsStreaming(false);
      setStreamText("");
      setPendingQuestion("");
      setActiveSessionId(event.sessionId);
      queryClient.invalidateQueries({ queryKey: ["chat", id] });
    };

    const handleError = (event: {
      workspaceId?: string;
      error: string;
    }) => {
      if (event.workspaceId && event.workspaceId !== id) {
        return;
      }

      clearResponseTimeout();
      setIsStreaming(false);
      setStreamText("");
      setPendingQuestion("");
      toast.show({
        variant: "error",
        title: "Ошибка чата",
        message: event.error || "Не удалось получить ответ",
      });
    };

    if (socket.connected) {
      joinRooms();
    } else {
      socket.on("connect", joinRooms);
      socket.connect();
    }

    socket.on("chat:user_message", handleUserMessage);
    socket.on("chat:chunk", handleChunk);
    socket.on("chat:done", handleDone);
    socket.on("chat:error", handleError);

    return () => {
      socket.emit("workspace:leave", { workspaceId: id });
      socket.off("connect", joinRooms);
      socket.off("chat:user_message", handleUserMessage);
      socket.off("chat:chunk", handleChunk);
      socket.off("chat:done", handleDone);
      socket.off("chat:error", handleError);
    };
  }, [accessToken, data?.sessionId, id, queryClient, toast]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sendMessage.isPending || isStreaming) {
      return;
    }

    setPendingQuestion(content);
    setInput("");

    const socket = getRealtimeSocket();
    if (socket) {
      setStreamText("");
      setIsStreaming(true);
      scheduleResponseTimeout();
      socket.emit("chat:message", {
        workspaceId: id,
        sessionId: activeSessionId || data?.sessionId,
        content,
      });
      return;
    }

    try {
      await sendMessage.mutateAsync(content);
    } catch (error) {
      toast.show({
        variant: "error",
        title: "Ошибка чата",
        message: getErrorMessage(error),
      });
    } finally {
      clearResponseTimeout();
      setPendingQuestion("");
      setIsStreaming(false);
    }
  };

  const startRecording = async () => {
    if (!providerInfo.data?.sttAvailable) {
      toast.show({
        variant: "error",
        title: "Голосовой ввод недоступен",
        message: "STT работает только в режиме Центр-Инвест",
      });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.show({
        variant: "error",
        title: "Микрофон недоступен",
        message: "Ваш браузер не поддерживает запись аудио",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const mimeType = normalizeMimeType(
          recorder.mimeType || chunksRef.current[0]?.type || "audio/webm",
        );
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const extension = getRecordingExtension(mimeType);
        const file = new File([blob], `voice-question.${extension}`, {
          type: mimeType,
        });

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);

        if (!file.size) {
          return;
        }

        const result = await transcribeAudio.mutateAsync(file).catch(() => null);
        if (result?.text) {
          setInput((current) => (current ? `${current}\n${result.text}` : result.text));
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      toast.show({
        variant: "error",
        title: "Нет доступа к микрофону",
        message: "Разрешите доступ к микрофону и попробуйте ещё раз",
      });
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const stopStreaming = () => {
    const socket = getRealtimeSocket();
    if (!socket || !activeSessionId) {
      return;
    }

    socket.emit("chat:stop", { sessionId: activeSessionId });
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Чат недоступен</div>;
  }

  const sttAvailable = providerInfo.data?.sttAvailable ?? true;

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-4 px-1">
        <div>
          <a
            href={`/workspace/${id}`}
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться к воркспейсу
          </a>
          <h1 className="font-[Syne] text-3xl font-bold">Чат с источниками</h1>
          <p className="mt-1 text-sm text-muted-foreground">Воркспейс: {data.workspace.name}</p>
        </div>
        <Badge className="gap-2 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/20">
          <Sparkles className="h-3.5 w-3.5" />
          RAG по документам
        </Badge>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/80 bg-white/90 shadow-sm dark:bg-card dark:shadow-none">
        <CardHeader className="shrink-0 space-y-1 border-b border-border/70 px-6 py-5">
          <CardTitle>Диалог</CardTitle>
          <CardDescription>
            Ответы строятся по загруженным и готовым документам текущего воркспейса.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-5">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5 md:p-4 dark:border-border dark:bg-muted/10">
            {!data.messages.length && !pendingQuestion && !streamText && (
              <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
                Задайте первый вопрос по документам этого воркспейса.
              </div>
            )}

            {data.messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "USER"
                    ? "ml-auto max-w-[72%] rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-slate-900 dark:border-primary/30 dark:bg-primary/10 dark:text-foreground"
                    : "w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-slate-900 dark:border-border dark:bg-card dark:text-foreground"
                }
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">
                    {message.role === "USER" ? "Вы" : "Knova AI"}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-muted-foreground">
                    {formatDistanceToNow(new Date(message.createdAt), {
                      addSuffix: true,
                      locale: ru,
                    })}
                  </span>
                </div>

                <MessageBody role={message.role} content={message.content} />

                {message.role === "ASSISTANT" && !!message.sources?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.sources.map((source, index) => (
                      <a
                        key={`${message.id}-${source.documentId}-${source.chunkIndex}-${index}`}
                        href={`/workspace/${id}?documentId=${source.documentId}`}
                        className="inline-flex"
                      >
                        <Badge
                          variant="outline"
                          className="cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:border-emerald-500/35 dark:hover:bg-emerald-500/15"
                        >
                          [{index + 1}] {source.documentName}
                        </Badge>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {pendingQuestion && (
              <div className="ml-auto max-w-[72%] rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-slate-900 dark:border-primary/30 dark:bg-primary/10 dark:text-foreground">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">
                  Вы
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] leading-[1.6]">{pendingQuestion}</p>
              </div>
            )}

            {(isStreaming || streamText) && (
              <div className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-slate-900 dark:border-border dark:bg-card dark:text-foreground">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Knova AI
                </div>

                {streamText ? (
                  <>
                    <MessageBody role="ASSISTANT" content={streamText} />
                    {isStreaming && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Формирую ответ...
                      </div>
                    )}
                  </>
                ) : (
                  <StreamingSkeleton />
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-3 rounded-2xl border border-border bg-card p-4">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Например: выдели ключевые идеи, риски и рекомендации по этим материалам"
              className="min-h-[5.75rem] resize-none border-slate-200 bg-white text-[12.5px] leading-[1.6] dark:border-border/70 dark:bg-background/60"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Enter отправляет сообщение, Shift + Enter добавляет новую строку.
                </p>
                {!sttAvailable && (
                  <p className="text-xs text-amber-400">
                    Голосовой ввод доступен только в режиме Центр-Инвест.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={isRecording ? "destructive" : "outline"}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={transcribeAudio.isPending || !sttAvailable}
                >
                  {transcribeAudio.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Расшифровка...
                    </>
                  ) : isRecording ? (
                    <>
                      <Square className="mr-2 h-4 w-4" />
                      Остановить запись
                    </>
                  ) : (
                    <>
                      <Mic className="mr-2 h-4 w-4" />
                      Голосовой ввод
                    </>
                  )}
                </Button>

                {isStreaming ? (
                  <Button variant="outline" onClick={stopStreaming}>
                    <Square className="mr-2 h-4 w-4" />
                    Стоп
                  </Button>
                ) : (
                  <Button onClick={handleSend} disabled={!input.trim() || sendMessage.isPending}>
                    {sendMessage.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Отправить
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
