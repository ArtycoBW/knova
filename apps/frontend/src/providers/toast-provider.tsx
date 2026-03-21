"use client";

import { createContext, useContext, useRef } from "react";
import Toaster, { ToasterRef } from "@/components/ui/toast";

const ToastContext = createContext<ToasterRef | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toasterRef = useRef<ToasterRef>(null);

  return (
    <ToastContext.Provider
      value={{
        show: (props) => toasterRef.current?.show(props),
      }}
    >
      {children}
      <Toaster ref={toasterRef} defaultPosition="bottom-right" />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
