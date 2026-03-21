"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertCircle,
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  CheckSquare,
  Clock,
  FileOutput,
  FileText,
  GitCompareArrows,
  GitFork,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Podcast,
  Presentation,
  RefreshCw,
  Table2,
  Trash2,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getRealtimeSocket } from "@/lib/realtime";
import type { Document } from "@/hooks/use-workspaces";
import {
  useCompareDocuments,
  useDeleteDocument,
  useDeleteWorkspace,
  useDocuments,
  useUpdateWorkspace,
  useUploadDocument,
  useWorkspace,
} from "@/hooks/use-workspaces";
import { useAuthStore } from "@/store/auth.store";

const PdfViewer = dynamic(
  () => import("@/components/ui/pdf-viewer").then((mod) => mod.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем PDF...
      </div>
    ),
  },
);

const STATUS_ICON: Record<Document["status"], React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4 animate-pulse text-current" />,
  PROCESSING: <Loader2 className="h-4 w-4 animate-spin text-current" />,
  READY: <CheckCircle2 className="h-4 w-4 text-current" />,
  ERROR: <AlertCircle className="h-4 w-4 text-current" />,
};

const STATUS_LABEL: Record<Document["status"], string> = {
  PENDING: "В очереди",
  PROCESSING: "Обрабатывается",
  READY: "Готов",
  ERROR: "Ошибка",
};

function getStatusBadgeClass(status: Document["status"]) {
  switch (status) {
    case "READY":
      return "border-transparent bg-emerald-400 text-emerald-950";
    case "PROCESSING":
      return "border-transparent bg-amber-300 text-amber-950";
    case "ERROR":
      return "border-transparent bg-rose-400 text-rose-950";
    default:
      return "border-transparent bg-zinc-300 text-zinc-900";
  }
}

const GENERATORS = [
  {
    href: "chat",
    icon: MessageSquare,
    label: "Чат",
    color: "hover:border-primary/40 hover:bg-primary/10",
  },
  {
    href: "mindmap",
    icon: GitFork,
    label: "Карта знаний",
    color: "hover:border-violet-500/40 hover:bg-violet-500/10",
  },
  {
    href: "podcast",
    icon: Podcast,
    label: "Подкаст",
    color: "hover:border-pink-500/40 hover:bg-pink-500/10",
  },
  {
    href: "quiz",
    icon: CheckSquare,
    label: "Тест",
    color: "hover:border-amber-500/40 hover:bg-amber-500/10",
  },
  {
    href: "reports",
    icon: FileOutput,
    label: "Отчёт",
    color: "hover:border-blue-500/40 hover:bg-blue-500/10",
  },
  {
    href: "infographic",
    icon: BarChart2,
    label: "Инфографика",
    color: "hover:border-cyan-500/40 hover:bg-cyan-500/10",
  },
  {
    href: "table",
    icon: Table2,
    label: "Таблица",
    color: "hover:border-green-500/40 hover:bg-green-500/10",
  },
  {
    href: "presentation",
    icon: Presentation,
    label: "Презентация",
    color: "hover:border-orange-500/40 hover:bg-orange-500/10",
  },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatDuration(secs?: number) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getDocIcon(doc: Document) {
  if (doc.sourceType === "AUDIO") return <Mic className="h-5 w-5 text-violet-400" />;
  if (doc.sourceType === "VIDEO") return <Video className="h-5 w-5 text-blue-400" />;
  return <FileText className="h-5 w-5 text-primary" />;
}

function getDocumentExcerpt(doc: Document) {
  return doc.extractedText?.replace(/\s+/g, " ").trim().slice(0, 180);
}

function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: { id: string; name: string; description?: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateWorkspace = useUpdateWorkspace(workspace.id);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");

  useEffect(() => {
    setName(workspace.name);
    setDescription(workspace.description ?? "");
  }, [workspace.description, workspace.name]);

  const handleSave = async () => {
    await updateWorkspace.mutateAsync({
      name,
      description,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактировать воркспейс</DialogTitle>
          <DialogDescription>
            Обновите название и описание, чтобы быстрее ориентироваться в
            материалах.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Название</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Новый воркспейс"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="workspace-description">Описание</Label>
            <Textarea
              id="workspace-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Кратко опишите, что хранится в этом воркспейсе"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateWorkspace.isPending || !name.trim()}
          >
            {updateWorkspace.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompareDialog({
  open,
  onOpenChange,
  workspaceId,
  documents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  documents: Document[];
}) {
  const compare = useCompareDocuments(workspaceId);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      compare.reset();
    }
  }, [compare, open]);

  const toggleDocument = (documentId: string) => {
    setSelected((current) => {
      if (current.includes(documentId)) {
        return current.filter((id) => id !== documentId);
      }

      if (current.length === 2) {
        return [current[1], documentId];
      }

      return [...current, documentId];
    });
  };

  const readyDocuments = documents.filter((document) => document.status === "READY");
  const comparison = compare.data?.comparison;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Сравнить документы</DialogTitle>
          <DialogDescription>
            Выберите два готовых источника и получите краткое сравнение по
            темам.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="space-y-2">
            {readyDocuments.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => toggleDocument(document.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  selected.includes(document.id)
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  {getDocIcon(document)}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {document.originalName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {document.pageCount
                        ? `${document.pageCount} стр.`
                        : formatDuration(document.duration) || "Готов к сравнению"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            {!comparison ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Выберите два документа и запустите сравнение.
                </p>
                <Button
                  onClick={() => compare.mutate(selected)}
                  disabled={selected.length !== 2 || compare.isPending}
                >
                  {compare.isPending ? "Сравниваем..." : "Запустить сравнение"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Совпадение тем
                    </p>
                    <p className="text-3xl font-bold text-primary">
                      {comparison.similarity}%
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => compare.mutate(selected)}
                    disabled={compare.isPending}
                  >
                    Пересчитать
                  </Button>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Общие темы</p>
                  <div className="flex flex-wrap gap-2">
                    {comparison.commonTopics.length ? (
                      comparison.commonTopics.map((topic) => (
                        <Badge key={topic} variant="secondary">
                          {topic}
                        </Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Сильных пересечений не найдено.
                      </p>
                    )}
                  </div>
                </div>

                {comparison.documents.map((document) => (
                  <div
                    key={document.id}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <p className="text-sm font-semibold">{document.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {document.excerpt}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(comparison.uniqueTopics[document.id] || []).map((topic) => (
                        <Badge key={topic} variant="outline">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPreviewDialog({
  document,
  open,
  onOpenChange,
}: {
  document: Document | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{document?.originalName ?? "Предпросмотр"}</DialogTitle>
          <DialogDescription>
            {document
              ? `${formatSize(document.size)}${
                  document.pageCount ? ` / ${document.pageCount} стр.` : ""
                }${document.duration ? ` / ${formatDuration(document.duration)}` : ""}`
              : "Документ недоступен"}
          </DialogDescription>
        </DialogHeader>

        {document?.mimeType === "application/pdf" ? (
          <PdfViewer documentId={document.id} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="mb-2 text-sm font-medium">Краткое содержание</p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {document?.extractedText?.trim() || "Текст документа пока недоступен."}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkspacePageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: workspace, isLoading: wsLoading } = useWorkspace(id);
  const { data: documents, isLoading: docsLoading } = useDocuments(id);
  const upload = useUploadDocument(id);
  const deleteDoc = useDeleteDocument(id);
  const deleteWs = useDeleteWorkspace();

  const [dragOver, setDragOver] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [showDeleteWs, setShowDeleteWs] = useState(false);
  const [showEditWs, setShowEditWs] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [progressByDocument, setProgressByDocument] = useState<
    Record<string, { percent: number; step: string }>
  >({});

  const readyDocuments = documents?.filter((document) => document.status === "READY") ?? [];
  const hasReadyDocs = readyDocuments.length > 0;
  const canCompare = readyDocuments.length >= 2;

  const updateDocumentQuery = (documentId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (documentId) {
      params.set("documentId", documentId);
    } else {
      params.delete("documentId");
    }

    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => upload.mutate(file));
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const handlePickFiles = (
    accept = ".pdf,.docx,.txt,.md,.mp3,.wav,.ogg,.m4a,.webm,.mp4,.mov",
  ) => {
    if (!fileRef.current) return;
    fileRef.current.accept = accept;
    fileRef.current.click();
  };

  useEffect(() => {
    const documentId = searchParams.get("documentId");
    if (!documentId || !documents?.length) {
      return;
    }

    const nextDocument = documents.find((document) => document.id === documentId);
    if (nextDocument && nextDocument.status === "READY") {
      setSelectedDocument((current) =>
        current?.id === nextDocument.id ? current : nextDocument,
      );
    }
  }, [documents, searchParams]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!socket || !id || !accessToken) {
      return;
    }

    const joinWorkspace = () => {
      socket.emit("workspace:join", { workspaceId: id });
    };

    const clearProgress = (documentId: string) => {
      setProgressByDocument((current) => {
        if (!current[documentId]) {
          return current;
        }

        const next = { ...current };
        delete next[documentId];
        return next;
      });
    };

    const handleProgress = (event: {
      workspaceId: string;
      documentId: string;
      percent: number;
      step: string;
    }) => {
      if (event.workspaceId !== id) {
        return;
      }

      setProgressByDocument((current) => ({
        ...current,
        [event.documentId]: {
          percent: event.percent,
          step: event.step,
        },
      }));
    };

    const handleReady = (event: { workspaceId: string; documentId: string }) => {
      if (event.workspaceId !== id) {
        return;
      }

      clearProgress(event.documentId);
      queryClient.invalidateQueries({ queryKey: ["documents", id] });
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    const handleError = (event: { workspaceId: string; documentId: string }) => {
      if (event.workspaceId !== id) {
        return;
      }

      clearProgress(event.documentId);
      queryClient.invalidateQueries({ queryKey: ["documents", id] });
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    if (socket.connected) {
      joinWorkspace();
    } else {
      socket.on("connect", joinWorkspace);
      socket.connect();
    }

    socket.on("doc:progress", handleProgress);
    socket.on("doc:ready", handleReady);
    socket.on("doc:error", handleError);

    return () => {
      socket.emit("workspace:leave", { workspaceId: id });
      socket.off("connect", joinWorkspace);
      socket.off("doc:progress", handleProgress);
      socket.off("doc:ready", handleReady);
      socket.off("doc:error", handleError);
    };
  }, [accessToken, id, queryClient]);

  if (wsLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!workspace) {
    return <div className="p-8 text-muted-foreground">Воркспейс не найден</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-[Syne] text-xl font-bold">{workspace.name}</h1>
          {workspace.description && (
            <p className="text-sm text-muted-foreground">{workspace.description}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShowEditWs(true)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDeleteWs(true)}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div
        data-tour="upload-documents"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.mp3,.wav,.ogg,.m4a,.webm,.mp4,.mov"
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="mb-1 text-sm font-medium">Добавьте новые источники</p>
        <p className="mb-4 text-xs text-muted-foreground">
          Поддерживаются PDF, DOCX, TXT, MP3, WAV, OGG, M4A и MP4
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handlePickFiles(".pdf,.docx,.txt,.md")}>
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Документ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePickFiles(".mp3,.wav,.ogg,.m4a,.webm")}
            className="hover:border-violet-500/50"
          >
            <Mic className="mr-1.5 h-3.5 w-3.5 text-violet-400" /> Аудио
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePickFiles(".mp4,.webm,.mov")}
            className="hover:border-blue-500/50"
          >
            <Video className="mr-1.5 h-3.5 w-3.5 text-blue-400" /> Видео
          </Button>
        </div>
        {upload.isPending && (
          <p className="mt-3 animate-pulse text-xs text-primary">
            Загружаем источник...
          </p>
        )}
      </div>

      {(docsLoading || documents?.length) ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Источники
            </h2>
            {documents?.length ? (
              <p className="text-xs text-muted-foreground">
                {readyDocuments.length} из {documents.length} готовы
              </p>
            ) : null}
          </div>

          {docsLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))
          ) : (
            documents?.map((document) => {
              const excerpt = getDocumentExcerpt(document);
              const progress = progressByDocument[document.id];

              return (
                <motion.div
                  key={document.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => {
                    if (document.status !== "READY") return;
                    setSelectedDocument(document);
                    updateDocumentQuery(document.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (document.status !== "READY") return;
                      setSelectedDocument(document);
                      updateDocumentQuery(document.id);
                    }
                  }}
                  role="button"
                  tabIndex={document.status === "READY" ? 0 : -1}
                  className={`w-full rounded-xl border bg-card p-4 text-left transition-colors ${
                    document.status === "READY"
                      ? "border-border hover:border-primary/40 hover:bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getDocIcon(document)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {document.originalName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatSize(document.size)}
                            {document.duration
                              ? ` / ${formatDuration(document.duration)}`
                              : ""}
                            {document.pageCount
                              ? ` / ${document.pageCount} стр.`
                              : ""}
                            {" / "}
                            {formatDistanceToNow(new Date(document.createdAt), {
                              locale: ru,
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={`gap-1 text-xs ${getStatusBadgeClass(document.status)}`}
                          >
                            {STATUS_ICON[document.status]}
                            <span>{STATUS_LABEL[document.status]}</span>
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteDocId(document.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {excerpt && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {excerpt}
                        </p>
                      )}

                      {progress && document.status !== "READY" && (
                        <p className="mt-2 text-xs text-amber-300">
                          {progress.step} / {progress.percent}%
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Создать
          </h2>
          {!hasReadyDocs && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
              Загрузите хотя бы один готовый документ
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GENERATORS.map((generator) => {
            const href = `/${generator.href}/${id}`;
            const className = `flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border p-4 text-center transition-all ${
              hasReadyDocs ? `cursor-pointer ${generator.color}` : "cursor-not-allowed opacity-50"
            }`;

            if (
              generator.href === "chat" ||
              generator.href === "mindmap" ||
              generator.href === "podcast" ||
              generator.href === "quiz" ||
              generator.href === "table" ||
              generator.href === "infographic"
            ) {
              return (
                <a
                  key={generator.href}
                  href={hasReadyDocs ? href : "#"}
                  className={className}
                  onClick={(event) => !hasReadyDocs && event.preventDefault()}
                >
                  <generator.icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{generator.label}</span>
                </a>
              );
            }

            return (
              <Link
                key={generator.href}
                href={hasReadyDocs ? href : "#"}
                className={className}
                onClick={(event) => !hasReadyDocs && event.preventDefault()}
              >
                <generator.icon className="h-5 w-5" />
                <span className="text-xs font-medium">{generator.label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setShowCompare(true)}
            disabled={!canCompare}
            className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border p-4 text-center transition-all ${
              canCompare
                ? "hover:border-emerald-500/40 hover:bg-emerald-500/10"
                : "cursor-not-allowed opacity-50"
            }`}
          >
            <GitCompareArrows className="h-5 w-5" />
            <span className="text-xs font-medium">Сравнить документы</span>
          </button>
        </div>
      </div>

      <Dialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить документ?</DialogTitle>
            <DialogDescription>
              Документ и все связанные данные будут удалены без возможности
              восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocId(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteDoc.isPending}
              onClick={() => {
                const docId = deleteDocId!;
                setDeleteDocId(null);
                if (selectedDocument?.id === docId) {
                  setSelectedDocument(null);
                  updateDocumentQuery(undefined);
                }
                deleteDoc.mutate(docId);
              }}
            >
              {deleteDoc.isPending ? "Удаляем..." : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteWs} onOpenChange={setShowDeleteWs}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить воркспейс?</DialogTitle>
            <DialogDescription>
              Воркспейс «{workspace.name}» и все его документы будут удалены без
              возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteWs(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteWs.isPending}
              onClick={() => {
                setShowDeleteWs(false);
                deleteWs.mutate(id);
              }}
            >
              {deleteWs.isPending ? "Удаляем..." : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditWorkspaceDialog
        workspace={workspace}
        open={showEditWs}
        onOpenChange={setShowEditWs}
      />

      <CompareDialog
        open={showCompare}
        onOpenChange={setShowCompare}
        workspaceId={id}
        documents={documents ?? []}
      />

      <DocumentPreviewDialog
        document={selectedDocument}
        open={!!selectedDocument}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDocument(null);
            updateDocumentQuery(undefined);
          }
        }}
      />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl space-y-6" />}>
      <WorkspacePageContent />
    </Suspense>
  );
}
