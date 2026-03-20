"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SplineScene } from "@/components/ui/splite";

export function Hero() {
  return (
    <section id="home" className="relative min-h-screen bg-gray-50 dark:bg-black">
      <div className="relative z-20 mx-auto flex min-h-screen max-w-7xl flex-col items-center gap-0 px-4 lg:flex-row">
        <div className="flex flex-1 flex-col justify-center pt-32 lg:pt-0">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 text-5xl font-bold leading-tight tracking-tight text-gray-900 sm:text-6xl lg:text-7xl dark:text-white"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Превращайте
            <br />
            документы
            <br />
            <span className="bg-linear-to-r from-emerald-500 to-emerald-700 bg-clip-text text-transparent dark:from-emerald-400 dark:to-emerald-600">
              в знания
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mb-8 max-w-md text-lg text-gray-500 dark:text-white/50"
          >
            Загрузите документ — получите подкаст, интеллект-карту, тесты,
            инфографику и многое другое за секунды.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap gap-4"
          >
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-7 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              Начать
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#features"
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-7 py-3 text-sm font-semibold text-gray-600 transition-all hover:scale-105 hover:border-gray-300 hover:text-gray-900 dark:border-white/10 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
            >
              Подробнее
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="relative hidden h-[700px] w-full flex-1 lg:flex"
        >
          <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-[140px]" />
          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="absolute inset-[-80px] z-10"
          />
        </motion.div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 h-32 bg-linear-to-t from-white to-transparent dark:from-black" />
    </section>
  );
}
