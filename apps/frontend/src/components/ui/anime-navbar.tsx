"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { LucideIcon, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface NavItem {
  name: string;
  url: string;
  icon: LucideIcon;
}

interface NavBarProps {
  items: NavItem[];
  className?: string;
  defaultActive?: string;
}

export function AnimeNavBar({
  items,
  className,
  defaultActive = "Home",
}: NavBarProps) {
  const [mounted, setMounted] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(defaultActive);
  const { setTheme, resolvedTheme } = useTheme();
  const lastScrollActive = useRef<string>(defaultActive);
  const isClickScrolling = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateActiveFromScroll = useCallback(() => {
    if (isClickScrolling.current) return;

    const hashItems = items.filter((item) => item.url.startsWith("#"));
    const scrollY = window.scrollY + window.innerHeight / 3;

    let current = hashItems[0]?.name ?? defaultActive;

    for (const item of hashItems) {
      const el = document.querySelector(item.url);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (scrollY >= top) {
          current = item.name;
        }
      }
    }

    if (current !== lastScrollActive.current) {
      lastScrollActive.current = current;
      setActiveTab(current);
    }
  }, [items, defaultActive]);

  useEffect(() => {
    if (!mounted) return;

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateActiveFromScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    updateActiveFromScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mounted, updateActiveFromScroll]);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  const handleClick = (e: React.MouseEvent, item: NavItem) => {
    if (item.url.startsWith("#")) {
      e.preventDefault();
      isClickScrolling.current = true;
      setActiveTab(item.name);
      lastScrollActive.current = item.name;

      const el = document.querySelector(item.url);
      el?.scrollIntoView({ behavior: "smooth" });

      setTimeout(() => {
        isClickScrolling.current = false;
      }, 1000);
    } else {
      setActiveTab(item.name);
    }
  };

  return (
    <div className="fixed left-0 right-0 top-5 z-9999">
      <div className="flex justify-center pt-6">
        <motion.div
          className={cn(
            "relative flex items-center gap-1 rounded-full border px-2 py-2 shadow-lg backdrop-blur-lg sm:gap-3",
            isDark
              ? "border-white/10 bg-black/50"
              : "border-black/10 bg-white/80",
          )}
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 20,
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.name;
            const isHovered = hoveredTab === item.name;

            return (
              <Link
                key={item.name}
                href={item.url}
                onClick={(e) => handleClick(e, item)}
                onMouseEnter={() => setHoveredTab(item.name)}
                onMouseLeave={() => setHoveredTab(null)}
                className={cn(
                  "relative cursor-pointer rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-300 sm:px-6 sm:py-3",
                  isDark
                    ? "text-white/70 hover:text-white"
                    : "text-black/50 hover:text-black",
                  isActive && (isDark ? "text-white" : "text-black"),
                )}
              >
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="active-pill"
                      className="absolute inset-0 -z-10 rounded-full"
                      initial={false}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 350,
                        damping: 30,
                      }}
                    >
                      <div
                        className={cn(
                          "absolute inset-0 rounded-full",
                          isDark ? "bg-emerald-500/20" : "bg-emerald-500/12",
                        )}
                      />
                      <div
                        className={cn(
                          "absolute -inset-1 rounded-full blur-md",
                          isDark ? "bg-emerald-500/12" : "bg-emerald-500/8",
                        )}
                      />
                      <div
                        className={cn(
                          "absolute -inset-2 rounded-full blur-xl",
                          isDark ? "bg-emerald-500/8" : "bg-emerald-500/5",
                        )}
                      />

                      <div
                        className="absolute inset-0 overflow-hidden rounded-full"
                      >
                        <div
                          className="absolute inset-0 bg-linear-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0"
                          style={{
                            animation: "shine 3s ease-in-out infinite",
                          }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <span className="relative z-10 hidden md:inline">
                  {item.name}
                </span>
                <span className="relative z-10 md:hidden">
                  <Icon size={18} strokeWidth={2.5} />
                </span>

                <AnimatePresence>
                  {isHovered && !isActive && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className={cn(
                        "absolute inset-0 -z-10 rounded-full",
                        isDark ? "bg-white/10" : "bg-black/5",
                      )}
                    />
                  )}
                </AnimatePresence>
              </Link>
            );
          })}

          <div
            className={cn(
              "mx-1 h-6 w-px",
              isDark ? "bg-white/10" : "bg-black/10",
            )}
          />

          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300",
              isDark
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-black/50 hover:bg-black/5 hover:text-black",
            )}
            aria-label="Переключить тему"
          >
            <AnimatePresence mode="wait">
              {isDark ? (
                <motion.div
                  key="sun"
                  initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.2 }}
                >
                  <Sun size={16} strokeWidth={2.5} />
                </motion.div>
              ) : (
                <motion.div
                  key="moon"
                  initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.2 }}
                >
                  <Moon size={16} strokeWidth={2.5} />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
