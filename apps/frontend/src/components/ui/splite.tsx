"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const Spline = dynamic(
  () => import("@splinetool/react-spline"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Загрузка 3D сцены...</p>
        </div>
      </div>
    ),
  },
);

interface SplineSceneProps {
  scene: string;
  className?: string;
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <Spline scene={scene} className={cn("h-full w-full", className)} />
  );
}
