"use client";

import {
  useScroll,
  useTransform,
  motion,
  useInView,
} from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TimelineEntry {
  title: string;
  content: React.ReactNode;
}

function TimelineItem({ item, index }: { item: TimelineEntry; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, margin: "-40% 0px -40% 0px" });

  return (
    <div
      ref={ref}
      key={index}
      className="flex justify-start pt-10 md:gap-10 md:pt-32"
    >
      <div className="sticky top-40 z-40 flex max-w-xs flex-col items-center self-start md:w-full md:flex-row lg:max-w-sm">
        <div className="absolute left-3 flex h-10 w-10 items-center justify-center rounded-full bg-white md:left-3 dark:bg-black">
          <div
            className={cn(
              "h-4 w-4 rounded-full border p-2 transition-all duration-500",
              isInView
                ? "border-emerald-500/50 bg-emerald-500/20"
                : "border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5",
            )}
          />
        </div>
        <h3
          className={cn(
            "hidden text-xl font-bold transition-colors duration-500 md:block md:pl-20 md:text-5xl",
            isInView
              ? "text-emerald-500"
              : "text-gray-200 dark:text-white/20",
          )}
        >
          {item.title}
        </h3>
      </div>

      <div className="relative w-full pl-20 pr-4 md:pl-4">
        <h3
          className={cn(
            "mb-4 block text-left text-2xl font-bold transition-colors duration-500 md:hidden",
            isInView
              ? "text-emerald-500"
              : "text-gray-200 dark:text-white/20",
          )}
        >
          {item.title}
        </h3>
        {item.content}
      </div>
    </div>
  );
}

export const Timeline = ({ data }: { data: TimelineEntry[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setHeight(rect.height);
    }
  }, [ref]);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 10%", "end 50%"],
  });

  const heightTransform = useTransform(scrollYProgress, [0, 1], [0, height]);
  const opacityTransform = useTransform(scrollYProgress, [0, 0.1], [0, 1]);

  return (
    <div className="w-full font-sans md:px-10" ref={containerRef}>
      <div ref={ref} className="relative mx-auto max-w-7xl pb-20">
        {data.map((item, index) => (
          <TimelineItem key={index} item={item} index={index} />
        ))}
        <div
          style={{ height: height + "px" }}
          className="absolute left-8 top-0 w-0.5 overflow-hidden bg-linear-to-b from-transparent via-gray-200 to-transparent mask-[linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)] md:left-8 dark:via-white/10"
        >
          <motion.div
            style={{
              height: heightTransform,
              opacity: opacityTransform,
            }}
            className="absolute inset-x-0 top-0 w-0.5 rounded-full bg-linear-to-t from-emerald-500 via-emerald-500/60 to-transparent from-0% via-10%"
          />
        </div>
      </div>
    </div>
  );
};
