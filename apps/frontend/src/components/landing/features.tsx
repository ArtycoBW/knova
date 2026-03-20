"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Radar, IconContainer } from "@/components/ui/radar-effect";
import {
  HiDocumentText,
  HiDocumentReport,
} from "react-icons/hi";
import { HiMiniDocumentArrowUp } from "react-icons/hi2";
import { BsClipboardDataFill } from "react-icons/bs";
import { BiSolidReport } from "react-icons/bi";
import { RiFilePaper2Fill } from "react-icons/ri";
import {
  MessageSquare,
  Map,
  Mic,
  GraduationCap,
  BarChart3,
  FileCheck,
  Table2,
  Presentation,
  type LucideIcon,
} from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const featuresRow1: Feature[] = [
  {
    icon: MessageSquare,
    title: "Чат с источниками",
    description: "Ответы с цитатами из документов",
  },
  {
    icon: Map,
    title: "Интеллект-карты",
    description: "Mind map из любого документа",
  },
  {
    icon: Mic,
    title: "Аудио-подкасты",
    description: "Диалог двух ведущих",
  },
  {
    icon: GraduationCap,
    title: "Тесты и карточки",
    description: "Самопроверка с подсчётом XP",
  },
];

const featuresRow2: Feature[] = [
  {
    icon: BarChart3,
    title: "Инфографика",
    description: "Визуализация в графиках",
  },
  {
    icon: FileCheck,
    title: "Деловые отчёты",
    description: "Экспорт в DOCX",
  },
  {
    icon: Table2,
    title: "Таблицы данных",
    description: "Экспорт в CSV",
  },
  {
    icon: Presentation,
    title: "Презентации",
    description: "Слайды PPTX из тезисов",
  },
];

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="group mx-3 w-70 shrink-0 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition-all duration-300 hover:border-emerald-500/30 hover:bg-gray-100 dark:border-white/8 dark:bg-white/3 dark:hover:border-emerald-500/20 dark:hover:bg-white/5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500 group-hover:text-white dark:text-emerald-500 dark:group-hover:text-black">
        <feature.icon className="h-5 w-5" />
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-gray-900 dark:text-white">{feature.title}</h3>
      <p className="text-xs leading-relaxed text-gray-500 dark:text-white/40">
        {feature.description}
      </p>
    </div>
  );
}

function MarqueeRow({
  features,
  reverse = false,
  speed = 30,
}: {
  features: Feature[];
  reverse?: boolean;
  speed?: number;
}) {
  const items = [...features, ...features, ...features, ...features];
  const animationName = reverse ? "marquee-reverse" : "marquee";

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-24 bg-linear-to-r from-white to-transparent dark:from-black" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-24 bg-linear-to-l from-white to-transparent dark:from-black" />

      <div
        className="flex w-max"
        style={{
          animation: `${animationName} ${speed}s linear infinite`,
        }}
      >
        {items.map((feature, i) => (
          <FeatureCard key={`${feature.title}-${i}`} feature={feature} />
        ))}
      </div>
    </div>
  );
}

export function Features() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="features" ref={ref} className="relative py-24">
      <div className="mx-auto max-w-7xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center"
        >
          <h2
            className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl dark:text-white"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Возможности
          </h2>
          <p className="mx-auto max-w-2xl text-gray-500 dark:text-white/50">
            Один документ — восемь форматов переработки знаний
          </p>
        </motion.div>

        <div className="relative mb-16 flex w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-gray-200 bg-gray-50/80 px-4 py-16 dark:border-white/8 dark:bg-black/40">
          <div className="relative flex h-96 w-full max-w-3xl flex-col items-center justify-center space-y-4">
            <div className="mx-auto w-full max-w-3xl">
              <div className="flex w-full items-center justify-center space-x-10 md:justify-between md:space-x-0">
                <IconContainer text="Чат" delay={0.2} icon={<HiDocumentText className="h-8 w-8 text-emerald-500/60" />} />
                <IconContainer delay={0.4} text="Отчёты" icon={<BiSolidReport className="h-8 w-8 text-emerald-500/60" />} />
                <IconContainer text="Таблицы" delay={0.3} icon={<BsClipboardDataFill className="h-8 w-8 text-emerald-500/60" />} />
              </div>
            </div>
            <div className="mx-auto w-full max-w-md">
              <div className="flex w-full items-center justify-center space-x-10 md:justify-between md:space-x-0">
                <IconContainer text="Подкасты" delay={0.5} icon={<HiDocumentReport className="h-8 w-8 text-emerald-500/60" />} />
                <IconContainer text="Карты" delay={0.8} icon={<HiMiniDocumentArrowUp className="h-8 w-8 text-emerald-500/60" />} />
              </div>
            </div>
            <div className="mx-auto w-full max-w-3xl">
              <div className="flex w-full items-center justify-center space-x-10 md:justify-between md:space-x-0">
                <IconContainer delay={0.6} text="Тесты" icon={<RiFilePaper2Fill className="h-8 w-8 text-emerald-500/60" />} />
                <IconContainer delay={0.7} text="Презентации" icon={<RiFilePaper2Fill className="h-8 w-8 text-emerald-500/60" />} />
              </div>
            </div>
            <Radar className="absolute -bottom-12" />
            <div className="absolute bottom-0 z-41 h-px w-full bg-linear-to-r from-transparent via-emerald-500/30 to-transparent" />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="space-y-4"
        >
          <MarqueeRow features={featuresRow1} speed={35} />
          <MarqueeRow features={featuresRow2} reverse speed={40} />
        </motion.div>
      </div>
    </section>
  );
}
