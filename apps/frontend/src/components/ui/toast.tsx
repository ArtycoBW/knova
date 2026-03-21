"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { motion } from "framer-motion";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "error" | "warning";
type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

interface ActionButton {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline" | "ghost";
}

interface ToasterProps {
  title?: string;
  message: string;
  variant?: Variant;
  duration?: number;
  position?: Position;
  actions?: ActionButton;
  onDismiss?: () => void;
  highlightTitle?: boolean;
}

export interface ToasterRef {
  show: (props: ToasterProps) => void;
}

const variantStyles: Record<Variant, string> = {
  default: "bg-card border-border text-foreground",
  success: "bg-card border-emerald-600/50",
  error: "bg-card border-destructive/50",
  warning: "bg-card border-amber-600/50",
};

const titleColor: Record<Variant, string> = {
  default: "text-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
};

const iconColor: Record<Variant, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
};

const variantIcons: Record<
  Variant,
  React.ComponentType<{ className?: string }>
> = {
  default: Info,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
};

const toastAnimation = {
  initial: { opacity: 0, y: 50, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 50, scale: 0.95 },
};

const Toaster = forwardRef<ToasterRef, { defaultPosition?: Position }>(
  ({ defaultPosition = "bottom-right" }, ref) => {
    const toastReference = useRef<ReturnType<
      typeof sonnerToast.custom
    > | null>(null);

    useImperativeHandle(ref, () => ({
      show({
        title,
        message,
        variant = "default",
        duration = 4000,
        position = defaultPosition,
        actions,
        onDismiss,
        highlightTitle,
      }) {
        const Icon = variantIcons[variant];

        toastReference.current = sonnerToast.custom(
          (toastId) => (
            <motion.div
              variants={toastAnimation}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={cn(
                "flex w-full max-w-xs items-center gap-3 rounded-xl border p-3 shadow-md",
                variantStyles[variant],
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Icon className={cn("h-4 w-4 shrink-0", iconColor[variant])} />
                <div className="min-w-0 space-y-0.5">
                  {title && (
                    <h3
                      className={cn(
                        "text-xs font-medium leading-none",
                        highlightTitle
                          ? titleColor.success
                          : titleColor[variant],
                      )}
                    >
                      {title}
                    </h3>
                  )}
                  <p className="text-xs text-muted-foreground">{message}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 self-center">
                {actions?.label && (
                  <Button
                    variant={actions.variant || "outline"}
                    size="sm"
                    onClick={() => {
                      actions.onClick();
                      sonnerToast.dismiss(toastId);
                    }}
                    className={cn(
                      "cursor-pointer",
                      variant === "success"
                        ? "border-emerald-600 text-emerald-600 hover:bg-emerald-600/10 dark:hover:bg-emerald-400/20"
                        : variant === "error"
                          ? "border-destructive text-destructive hover:bg-destructive/10"
                          : variant === "warning"
                            ? "border-amber-600 text-amber-600 hover:bg-amber-600/10"
                            : "border-border text-foreground hover:bg-muted/10",
                    )}
                  >
                    {actions.label}
                  </Button>
                )}

                <button
                  onClick={() => {
                    sonnerToast.dismiss(toastId);
                    onDismiss?.();
                  }}
                  className="rounded-full p-1 transition-colors hover:bg-muted/50 dark:hover:bg-muted/30 focus:outline-none"
                  aria-label="Закрыть уведомление"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          ),
          { duration, position },
        );
      },
    }));

    return (
      <SonnerToaster
        position={defaultPosition}
        toastOptions={{ unstyled: true, className: "flex justify-end" }}
      />
    );
  },
);

Toaster.displayName = "Toaster";

export default Toaster;
