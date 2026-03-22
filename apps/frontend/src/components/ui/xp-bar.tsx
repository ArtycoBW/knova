"use client";

import { useMemo, useState } from "react";
import { Award, Sparkles, Stars, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBadges } from "@/hooks/use-users";

interface XpBarProps {
  level: number;
  xp: number;
  onStartTour: () => void;
}

const LEVEL_STEPS = [
  { level: 1, minXp: 0, maxXp: 200 },
  { level: 2, minXp: 200, maxXp: 500 },
  { level: 3, minXp: 500, maxXp: 1000 },
  { level: 4, minXp: 1000, maxXp: 2000 },
  { level: 5, minXp: 2000, maxXp: null },
];

function getLevelMeta(xp: number) {
  const current =
    LEVEL_STEPS.find((step) => step.maxXp === null || xp < step.maxXp) ??
    LEVEL_STEPS[LEVEL_STEPS.length - 1];

  if (current.maxXp === null) {
    return {
      progress: 100,
      label: "Максимальный уровень достигнут",
    };
  }

  const currentRange = current.maxXp - current.minXp;
  const currentValue = xp - current.minXp;
  const progress = Math.max(0, Math.min(100, (currentValue / currentRange) * 100));
  const remainingXp = current.maxXp - xp;

  return {
    progress,
    label: `До уровня ${current.level + 1} осталось ${remainingXp} XP`,
  };
}

export function XpBar({ level, xp, onStartTour }: XpBarProps) {
  const { data: badges } = useBadges();
  const [open, setOpen] = useState(false);

  const levelMeta = useMemo(() => getLevelMeta(xp), [xp]);
  const recentBadges = badges?.slice(0, 3) ?? [];

  return (
    <>
      <div data-tour="xp-bar" className="mb-2 rounded-2xl border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Прогресс
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              Ур. {level}
            </p>
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {xp} XP
          </div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-linear-to-r from-primary via-emerald-400 to-cyan-400 transition-[width] duration-500 ease-out"
            style={{ width: `${levelMeta.progress}%` }}
          />
        </div>

        <p className="mt-2 text-xs text-muted-foreground">{levelMeta.label}</p>

        <div className="mt-3 flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <Award className="h-3.5 w-3.5" />
            Бейджи
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" onClick={onStartTour}>
            <Sparkles className="h-3.5 w-3.5" />
            Тур
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Бейджи и достижения</DialogTitle>
            <DialogDescription>
              Здесь собраны ваши награды за первые шаги и успехи в работе с платформой.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            {badges?.length ? (
              badges.map((badge) => (
                <div
                  key={badge.id}
                  className="rounded-2xl border border-border bg-muted/20 p-4"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-2xl">
                      {badge.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{badge.name}</p>
                      <p className="text-xs text-muted-foreground">+{badge.xpReward} XP</p>
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {badge.description}
                  </p>
                </div>
              ))
            ) : (
              <div className="col-span-full rounded-2xl border border-dashed border-border bg-muted/15 p-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Trophy className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">Бейджей пока нет</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Пройдите онбординг и тесты, чтобы открыть первые достижения.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <Stars className="h-4 w-4 text-primary" />
              Как растёт уровень
            </div>
            <p>Уровень 2: 200 XP, уровень 3: 500 XP, уровень 4: 1000 XP, уровень 5: 2000 XP.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
