"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Award, Sparkles, X } from "lucide-react";
import { useMarkNotificationRead, useNotifications } from "@/hooks/use-users";
import { Button } from "@/components/ui/button";

const SEEN_BADGE_PREFIX = "knova_seen_badge_";

export function BadgePopup() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);

  const nextBadgeNotification = useMemo(() => {
    if (!data?.length) {
      return null;
    }

    return data.find((item) => {
      if (item.type !== "BADGE_EARNED" || item.read) {
        return false;
      }

      if (typeof window === "undefined") {
        return false;
      }

      return !window.localStorage.getItem(`${SEEN_BADGE_PREFIX}${item.id}`);
    }) ?? null;
  }, [data]);

  useEffect(() => {
    if (nextBadgeNotification?.id && nextBadgeNotification.id !== activeNotificationId) {
      setActiveNotificationId(nextBadgeNotification.id);
    }
  }, [activeNotificationId, nextBadgeNotification]);

  const activeNotification = activeNotificationId
    ? data?.find((item) => item.id === activeNotificationId) ?? null
    : null;

  const handleClose = () => {
    if (!activeNotification) {
      setActiveNotificationId(null);
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${SEEN_BADGE_PREFIX}${activeNotification.id}`, "1");
    }

    markRead.mutate(activeNotification.id);
    setActiveNotificationId(null);
  };

  return (
    <AnimatePresence>
      {activeNotification && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="fixed bottom-5 right-5 z-[1200] w-[22rem] rounded-3xl border border-primary/20 bg-card/96 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <span className="text-xl">
                  {activeNotification.metadata?.icon ?? "🏆"}
                </span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-primary/80">
                  Новый бейдж
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {activeNotification.title}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-muted/25 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <Award className="h-4 w-4 text-primary" />
              Достижение разблокировано
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {activeNotification.message}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              XP и прогресс обновлены
            </div>
            <Button size="sm" onClick={handleClose}>
              Отлично
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
