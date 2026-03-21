"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth.store";
import { useMe } from "@/hooks/use-auth";

function AuthInitializer() {
  const initFromStorage = useAuthStore((s) => s.initFromStorage);
  useMe();

  useEffect(() => {
    initFromStorage();
  }, [initFromStorage]);

  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isCanvasRoute =
    pathname.startsWith("/chat/") ||
    pathname.startsWith("/mindmap/") ||
    pathname.startsWith("/podcast/") ||
    pathname.startsWith("/quiz/");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AuthInitializer />
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-30 md:relative md:z-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          "transition-transform duration-200",
        )}
      >
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMobileMenuToggle={() => setMobileOpen(!mobileOpen)} />
        <main
          className={cn(
            "flex-1 p-4 md:p-6",
            isCanvasRoute ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
