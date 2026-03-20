"use client";

import { Timeline } from "@/components/ui/timeline";
import { Upload, Cpu, Sparkles } from "lucide-react";

const timelineData = [
  {
    title: "Загрузите",
    content: (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-white/8 dark:bg-white/3">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
          <Upload className="h-6 w-6 text-emerald-500" />
        </div>
        <h4 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          Загрузите документ
        </h4>
        <p className="text-sm leading-relaxed text-gray-500 dark:text-white/40">
          PDF, DOCX, TXT или аудио — платформа автоматически распознает формат
          и извлечёт содержимое. Просто перетащите файл в окно.
        </p>
      </div>
    ),
  },
  {
    title: "Анализ",
    content: (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-white/8 dark:bg-white/3">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
          <Cpu className="h-6 w-6 text-emerald-500" />
        </div>
        <h4 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          AI анализирует
        </h4>
        <p className="text-sm leading-relaxed text-gray-500 dark:text-white/40">
          Документ разбивается на смысловые блоки, создаётся векторная база
          для точного семантического поиска по содержимому.
        </p>
      </div>
    ),
  },
  {
    title: "Результат",
    content: (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-white/8 dark:bg-white/3">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
          <Sparkles className="h-6 w-6 text-emerald-500" />
        </div>
        <h4 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          Получите результат
        </h4>
        <p className="text-sm leading-relaxed text-gray-500 dark:text-white/40">
          Подкаст, интеллект-карта, тест, отчёт — выберите нужный формат
          или создайте все восемь сразу.
        </p>
      </div>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-8 text-center">
          <h2
            className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl dark:text-white"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Как это работает
          </h2>
          <p className="mx-auto max-w-2xl text-gray-500 dark:text-white/50">
            Три простых шага от документа до готового контента
          </p>
        </div>
        <Timeline data={timelineData} />
      </div>
    </section>
  );
}
