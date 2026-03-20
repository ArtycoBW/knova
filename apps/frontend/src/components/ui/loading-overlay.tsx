"use client";

import type React from "react";
import { useState, useEffect, useMemo } from "react";

interface LoadingOverlayProps {
  onComplete?: () => void;
  children?: React.ReactNode;
}

function GridLines() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.03]">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 right-0 h-px bg-white"
          style={{ top: `${(i + 1) * 5}%` }}
        />
      ))}
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={`v-${i}`}
          className="absolute top-0 bottom-0 w-px bg-white"
          style={{ left: `${(i + 1) * 5}%` }}
        />
      ))}
    </div>
  );
}

function ScanLine({ percentage }: { percentage: number }) {
  return (
    <div
      className="absolute left-0 right-0 h-px transition-all duration-100"
      style={{
        top: `${100 - percentage}%`,
        background:
          "linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.4) 20%, rgba(16,185,129,0.8) 50%, rgba(16,185,129,0.4) 80%, transparent 100%)",
        boxShadow: "0 0 20px 2px rgba(16,185,129,0.3)",
      }}
    />
  );
}

const statusMessages = [
  "Инициализация платформы",
  "Подключение к AI-сервисам",
  "Загрузка моделей",
  "Подготовка интерфейса",
  "Калибровка нейросети",
  "Почти готово",
];

export function LoadingOverlay({ onComplete, children }: LoadingOverlayProps) {
  const [percentage, setPercentage] = useState(0);
  const [isClipping, setIsClipping] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  const statusIndex = useMemo(
    () => Math.min(Math.floor(percentage / 18), statusMessages.length - 1),
    [percentage],
  );

  useEffect(() => {
    const hasLoaded = sessionStorage.getItem("knova-loaded");
    if (hasLoaded) {
      setShowContent(true);
      onComplete?.();
      return;
    }

    setShouldShow(true);

    const duration = 2500;
    const startTime = Date.now();

    const animatePercentage = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentPercentage = Math.round(eased * 100);

      setPercentage(currentPercentage);

      if (progress < 1) {
        requestAnimationFrame(animatePercentage);
      } else {
        setTimeout(() => {
          setIsClipping(true);
          setTimeout(() => {
            setShowContent(true);
            sessionStorage.setItem("knova-loaded", "true");
            onComplete?.();
          }, 500);
        }, 200);
      }
    };

    requestAnimationFrame(animatePercentage);
  }, [onComplete]);

  if (!shouldShow && showContent) {
    return <>{children}</>;
  }

  return (
    <>
      {shouldShow && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            background: "hsl(0 0% 4%)",
            clipPath: isClipping ? "inset(0 0 100% 0)" : "inset(0 0 0% 0)",
            pointerEvents: isClipping ? "none" : "auto",
            transition: "clip-path 0.5s cubic-bezier(0.76, 0, 0.24, 1)",
          }}
        >
          <GridLines />
          <ScanLine percentage={percentage} />

          <div
            className="absolute font-bold text-white/80"
            style={{
              left: "clamp(1.5rem, 3vw, 4rem)",
              top: "clamp(1.5rem, 3vw, 4rem)",
              fontSize: "clamp(1.2rem, 2vw, 1.8rem)",
              fontFamily: "var(--font-syne)",
              letterSpacing: "0.05em",
            }}
          >
            KNOVA
          </div>

          <div
            className="absolute text-right"
            style={{
              right: "clamp(1.5rem, 3vw, 4rem)",
              top: "clamp(1.5rem, 3vw, 4rem)",
            }}
          >
            <div className="font-mono text-xs uppercase tracking-widest text-emerald-500/60">
              System Status
            </div>
            <div
              className="mt-1 text-sm text-white/40 transition-all duration-300"
              key={statusIndex}
            >
              {statusMessages[statusIndex]}
            </div>
          </div>

          <div
            className="absolute left-0 right-0"
            style={{
              bottom: "clamp(6rem, 12vw, 16rem)",
              padding: "0 clamp(1.5rem, 3vw, 4rem)",
            }}
          >
            <div className="h-px w-full bg-white/10">
              <div
                className="h-full bg-emerald-500/50 transition-all duration-100"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          <div
            className="font-bold text-white/90"
            style={{
              position: "absolute",
              right: "clamp(1rem, 2vw, 3rem)",
              bottom: "clamp(1rem, 2vw, 3rem)",
              fontSize: "clamp(3rem, 8vw, 12rem)",
              fontFamily: "var(--font-syne)",
              lineHeight: 1,
            }}
          >
            {percentage}%
          </div>

          <div
            className="absolute font-mono text-[10px] uppercase tracking-[0.3em] text-white/20"
            style={{
              left: "clamp(1.5rem, 3vw, 4rem)",
              bottom: "clamp(1.5rem, 3vw, 4rem)",
            }}
          >
            AI Knowledge Platform
          </div>
        </div>
      )}

      <div
        style={{
          opacity: showContent ? 1 : 0,
          transform: showContent ? "translateY(0)" : "translateY(100px)",
          transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
        }}
      >
        {children}
      </div>
    </>
  );
}
