"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Server, Globe, WifiOff, Zap } from "lucide-react";

const providers = [
  {
    name: "Облачный LLM",
    description: "Внешний провайдер для максимальной производительности",
    services: ["LLM", "Embeddings", "STT"],
    icon: Globe,
    badge: "Основной",
    badgeColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    name: "Gemini",
    description: "Резервный облачный провайдер от Google",
    services: ["LLM", "Embeddings"],
    icon: Server,
    badge: "Резервный",
    badgeColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    name: "Ollama",
    description: "Локальный сервер, полный офлайн-режим",
    services: ["LLM", "Embeddings"],
    icon: WifiOff,
    badge: "Офлайн",
    badgeColor: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
];

export function Architecture() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="architecture" ref={ref} className="relative py-24">
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
            Архитектура
          </h2>
          <p className="mx-auto max-w-2xl text-gray-500 dark:text-white/50">
            Переключайтесь между AI-провайдерами без изменения кода.
            Данные всегда под вашим контролем.
          </p>
        </motion.div>

        <div className="flex flex-col items-center gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-8 py-4"
          >
            <Zap className="h-6 w-6 text-emerald-500" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white" style={{ fontFamily: "var(--font-syne)" }}>
                Knova Platform
              </p>
              <p className="text-sm text-gray-500 dark:text-white/50">
                Единый LLM Service — провайдер-агностик
              </p>
            </div>
          </motion.div>

          <div className="grid w-full gap-6 md:grid-cols-3">
            {providers.map((provider, index) => (
              <motion.div
                key={provider.name}
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                className="group rounded-2xl border border-gray-200 bg-gray-50 p-6 transition-all duration-300 hover:border-emerald-500/30 dark:border-white/8 dark:bg-white/3 dark:hover:border-emerald-500/20"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 transition-colors group-hover:bg-emerald-500/10 dark:bg-white/5">
                    <provider.icon className="h-5 w-5 text-gray-400 transition-colors group-hover:text-emerald-500 dark:text-white/40" />
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${provider.badgeColor}`}>
                    {provider.badge}
                  </span>
                </div>

                <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">{provider.name}</h3>
                <p className="mb-4 text-sm text-gray-500 dark:text-white/40">
                  {provider.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  {provider.services.map((service) => (
                    <span
                      key={service}
                      className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-white/5 dark:text-white/40"
                    >
                      {service}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
