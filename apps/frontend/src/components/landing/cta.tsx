"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CTA() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="relative py-24">
      <div className="mx-auto max-w-7xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl border border-gray-200 bg-gray-50 p-12 text-center sm:p-16 dark:border-white/8 dark:bg-black/60"
        >
          <div className="absolute inset-0 bg-linear-to-br from-emerald-500/10 via-transparent to-emerald-500/5" />

          <div className="relative z-10">
            <h2
              className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl dark:text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              Готовы начать?
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-lg text-gray-500 dark:text-white/50">
              Загрузите первый документ и получите подкаст, интеллект-карту и
              тест за считанные минуты.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-8 py-3.5 font-semibold text-white transition-all hover:scale-105 hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              Начать бесплатно
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
