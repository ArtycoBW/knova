"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Upload, Mic, Video, FileText, Trash2,
  MessageSquare, GitFork, Podcast, CheckSquare,
  FileOutput, BarChart2, Table2, Presentation,
  Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw,
} from "lucide-react";
import { useWorkspace, useDocuments, useUploadDocument, useDeleteDocument, useDeleteWorkspace } from "@/hooks/use-workspaces";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { Document } from "@/hooks/use-workspaces";

const STATUS_ICON: Record<Document["status"], React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />,
  PROCESSING: <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />,
  READY: <CheckCircle2 className="h-4 w-4 text-primary" />,
  ERROR: <AlertCircle className="h-4 w-4 text-destructive" />,
};

const STATUS_LABEL: Record<Document["status"], string> = {
  PENDING: "В очереди",
  PROCESSING: "Обработка...",
  READY: "Готов",
  ERROR: "Ошибка",
};

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

const GENERATORS = [
  { href: "chat", icon: MessageSquare, label: "Чат", color: "hover:bg-primary/10 hover:border-primary/40" },
  { href: "mindmap", icon: GitFork, label: "Mindmap", color: "hover:bg-violet-500/10 hover:border-violet-500/40" },
  { href: "podcast", icon: Podcast, label: "Подкаст", color: "hover:bg-pink-500/10 hover:border-pink-500/40" },
  { href: "quiz", icon: CheckSquare, label: "Тест", color: "hover:bg-amber-500/10 hover:border-amber-500/40" },
  { href: "reports", icon: FileOutput, label: "Отчёт", color: "hover:bg-blue-500/10 hover:border-blue-500/40" },
  { href: "infographic", icon: BarChart2, label: "Инфографика", color: "hover:bg-cyan-500/10 hover:border-cyan-500/40" },
  { href: "table", icon: Table2, label: "Таблица", color: "hover:bg-green-500/10 hover:border-green-500/40" },
  { href: "presentation", icon: Presentation, label: "Презентация", color: "hover:bg-orange-500/10 hover:border-orange-500/40" },
];

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: workspace, isLoading: wsLoading } = useWorkspace(id);
  const { data: documents, isLoading: docsLoading } = useDocuments(id);
  const upload = useUploadDocument(id);
  const deleteDoc = useDeleteDocument(id);
  const deleteWs = useDeleteWorkspace();

  const [dragOver, setDragOver] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [showDeleteWs, setShowDeleteWs] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => upload.mutate(f));
  };

  const hasReadyDocs = documents?.some((d) => d.status === "READY");

  if (wsLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (!workspace) {
    return <div className="text-muted-foreground p-8">Воркспейс не найден</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold font-[Syne]">{workspace.name}</h1>
          {workspace.description && (
            <p className="text-sm text-muted-foreground">{workspace.description}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShowDeleteWs(true)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div
        data-tour="upload-documents"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.mp3,.wav,.ogg,.m4a,.mp4"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium mb-1">Перетащите файлы или</p>
        <p className="text-xs text-muted-foreground mb-4">PDF, DOCX, TXT, MD, MP3, WAV, OGG, MP4</p>
        <div className="flex justify-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Документ
          </Button>
          <Button variant="outline" size="sm" onClick={() => { if (fileRef.current) { fileRef.current.accept = ".mp3,.wav,.ogg,.m4a"; fileRef.current.click(); } }} className="hover:border-violet-500/50">
            <Mic className="h-3.5 w-3.5 mr-1.5 text-violet-400" /> Аудио
          </Button>
          <Button variant="outline" size="sm" onClick={() => { if (fileRef.current) { fileRef.current.accept = ".mp4"; fileRef.current.click(); } }} className="hover:border-blue-500/50">
            <Video className="h-3.5 w-3.5 mr-1.5 text-blue-400" /> Видео
          </Button>
        </div>
        {upload.isPending && (
          <p className="mt-3 text-xs text-primary animate-pulse">Загружаем...</p>
        )}
      </div>

      {(docsLoading || documents?.length) ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Источники</h2>
          {docsLoading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : (
            documents?.map((doc) => (
              <motion.div
                key={doc.id}
                layout
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {getDocIcon(doc)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(doc.size)}
                    {doc.duration && ` · ${formatDuration(doc.duration)}`}
                    {doc.pageCount && ` · ${doc.pageCount} стр.`}
                    {" · "}
                    {formatDistanceToNow(new Date(doc.createdAt), { locale: ru, addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={doc.status === "READY" ? "default" : doc.status === "ERROR" ? "destructive" : "secondary"} className="gap-1 text-xs">
                    {STATUS_ICON[doc.status]}
                    <span className="hidden sm:inline">{STATUS_LABEL[doc.status]}</span>
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteDocId(doc.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Создать</h2>
        {!hasReadyDocs && (
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Загрузите хотя бы один документ, чтобы начать генерацию
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {GENERATORS.map((g) => (
            <Link
              key={g.href}
              href={hasReadyDocs ? `/${g.href}/${id}` : "#"}
              className={`flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-all ${
                hasReadyDocs
                  ? `cursor-pointer ${g.color}`
                  : "opacity-50 cursor-not-allowed"
              }`}
              onClick={(e) => !hasReadyDocs && e.preventDefault()}
            >
              <g.icon className="h-5 w-5" />
              <span className="text-xs font-medium">{g.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <Dialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить документ?</DialogTitle>
            <DialogDescription>
              Документ и все связанные данные будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocId(null)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={deleteDoc.isPending}
              onClick={() => {
                const docId = deleteDocId!;
                setDeleteDocId(null);
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
              Воркспейс «{workspace.name}» и все его документы будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteWs(false)}>Отмена</Button>
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
    </div>
  );
}
