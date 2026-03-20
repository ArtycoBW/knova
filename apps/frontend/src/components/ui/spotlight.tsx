"use client";

import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SpotlightProps {
  className?: string;
  fill?: string;
  size?: number;
}

export function Spotlight({
  className,
  fill = "white",
  size = 400,
}: SpotlightProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn(
        "pointer-events-auto absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <motion.div
        className="pointer-events-none absolute rounded-full"
        animate={{
          x: position.x - size / 2,
          y: position.y - size / 2,
          opacity,
        }}
        transition={{ type: "spring", damping: 30, stiffness: 200 }}
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle, ${fill} 0%, transparent 70%)`,
          opacity: 0.15,
        }}
      />
    </div>
  );
}
