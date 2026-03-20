"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import { AnimeNavBar } from "@/components/ui/anime-navbar";
import { Spotlight } from "@/components/ui/spotlight";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Architecture } from "@/components/landing/architecture";
import { CTA } from "@/components/landing/cta";
import { Home, Layers, Route, Server, Rocket } from "lucide-react";

const navItems = [
  { name: "Главная", url: "#home", icon: Home },
  { name: "Возможности", url: "#features", icon: Layers },
  { name: "Как работает", url: "#how-it-works", icon: Route },
  { name: "Архитектура", url: "#architecture", icon: Server },
  { name: "Начать", url: "/register", icon: Rocket },
];

function ScrollMouse() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2, duration: 0.6 }}
      className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-emerald-500/30 p-1.5">
          <div
            className="h-1.5 w-1 rounded-full bg-emerald-500/70"
            style={{ animation: "scroll-bounce 1.5s ease-in-out infinite" }}
          />
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-500/40">
          Scroll
        </span>
      </div>
    </motion.div>
  );
}

function ParallaxSection({
  children,
  offset = 40,
}: {
  children: React.ReactNode;
  offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset]);

  return (
    <div ref={ref}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

export default function HomePage() {
  return (
    <LoadingOverlay>
      <AnimeNavBar items={navItems} defaultActive="Главная" />
      <ScrollMouse />
      <main className="relative bg-white dark:bg-black">
        <div className="relative">
          <Spotlight
            className="pointer-events-auto hidden dark:block"
            fill="rgba(16, 185, 129, 0.6)"
            size={500}
          />
          <Hero />
          <ParallaxSection offset={50}>
            <Features />
          </ParallaxSection>
          <ParallaxSection offset={30}>
            <HowItWorks />
          </ParallaxSection>
          <ParallaxSection offset={40}>
            <Architecture />
          </ParallaxSection>
        </div>
        <CTA />
      </main>
    </LoadingOverlay>
  );
}
