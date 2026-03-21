"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, FolderOpen, FileText, MessageSquare, Zap,
  BookOpen, Mic,
} from "lucide-react";
import { useWorkspaces, useWorkspaceStats, useCreateWorkspace } from "@/hooks/use-workspaces";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const create = useCreateWorkspace();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый воркспейс</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Название *</Label>
            <Input
              id="ws-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate({ name, description: desc })}
              placeholder="Диплом по ИИ..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc">Описание (необязательно)</Label>
            <Textarea
              id="ws-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="Материалы по теме..."
            />
          </div>
          <Button
            className="w-full"
            onClick={() => create.mutate({ name, description: desc })}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? "Создаём..." : "Создать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const { data: stats } = useWorkspaceStats();
  const [showCreate, setShowCreate] = useState(false);

  const STATS = [
    { label: "Воркспейсов", value: stats?.workspaces ?? 0, icon: FolderOpen, color: "text-primary" },
    { label: "Документов", value: stats?.documents ?? 0, icon: FileText, color: "text-blue-400" },
    { label: "Сообщений в чате", value: stats?.chatMessages ?? 0, icon: MessageSquare, color: "text-violet-400" },
    { label: "Генераций", value: stats?.generations ?? 0, icon: Zap, color: "text-amber-400" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-[Syne]">Главная</h1>
          <p className="text-muted-foreground text-sm mt-1">Управляйте своей базой знаний</p>
        </div>
        <Button
          data-tour="create-workspace"
          onClick={() => setShowCreate(true)}
          className="gap-2 shadow-md shadow-primary/20"
        >
          <Plus className="h-4 w-4" />
          Новый воркспейс
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card>
              <CardContent className="p-4">
                <s.icon className={`h-5 w-5 mb-2 ${s.color}`} />
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Воркспейсы</h2>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </div>
        ) : !workspaces?.length ? (
          <Card className="border-dashed">
            <CardContent className="p-12 text-center">
              <FolderOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">Создайте первый воркспейс</p>
              <Button variant="link" onClick={() => setShowCreate(true)} className="mt-2">
                + Создать
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workspaces.map((ws, i) => (
              <motion.div
                key={ws.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link href={`/workspace/${ws.id}`}>
                  <Card className="group hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 transition-all cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                          <FolderOpen className="h-5 w-5 text-primary" />
                        </div>
                        {ws.hasAudio && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mic className="h-3 w-3" /> аудио
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-sm mb-1 truncate">{ws.name}</h3>
                      {ws.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{ws.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <BookOpen className="h-3 w-3" />
                          {ws.readyCount}/{ws.documentCount} готово
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {ws.chatCount}
                        </span>
                        <span className="ml-auto">
                          {formatDistanceToNow(new Date(ws.updatedAt), { locale: ru, addSuffix: true })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  );
}
