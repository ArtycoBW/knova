"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Bell, BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMarkNotificationRead, useNotifications } from "@/hooks/use-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();

  const unreadCount = data?.filter((item) => !item.read).length ?? 0;

  const openTarget = async (
    notificationId: string,
    workspaceId?: string,
    documentId?: string,
  ) => {
    await markRead.mutateAsync(notificationId);
    setOpen(false);

    if (workspaceId) {
      const suffix = documentId ? `?documentId=${documentId}` : "";
      router.push(`/workspace/${workspaceId}${suffix}`);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setOpen(true)}
      >
        {unreadCount > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Уведомления</DialogTitle>
            <DialogDescription>
              Все важные события по вашим документам и генерациям.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {isLoading && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                Загружаем уведомления...
              </div>
            )}

            {!isLoading && !data?.length && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                Пока уведомлений нет.
              </div>
            )}

            {data?.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  openTarget(
                    item.id,
                    item.metadata?.workspaceId,
                    item.metadata?.documentId,
                  )
                }
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  item.read
                    ? "border-border bg-card hover:bg-muted/40"
                    : "border-primary/30 bg-primary/5 hover:bg-primary/10"
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  </div>
                  {!item.read && <Badge className="shrink-0">Новое</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(item.createdAt), {
                    addSuffix: true,
                    locale: ru,
                  })}
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
