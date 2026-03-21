"use client";

import { useRef, KeyboardEvent, ClipboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: boolean;
}

export function OtpInput({
  value,
  onChange,
  length = 5,
  error = false,
}: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(length, "").split("").slice(0, length);

  const handleChange = (index: number, char: string) => {
    if (!/^\d*$/.test(char)) return;
    const arr = digits.slice();
    arr[index] = char.slice(-1);
    const next = arr.join("").replace(/\s/g, "");
    onChange(next);
    if (char && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        const arr = digits.slice();
        arr[index] = "";
        onChange(arr.join("").replace(/\s/g, ""));
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
        const arr = digits.slice();
        arr[index - 1] = "";
        onChange(arr.join("").replace(/\s/g, ""));
      }
    }
    if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, length - 1);
    inputsRef.current[focusIndex]?.focus();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="flex gap-3 justify-center"
        animate={error ? { x: [0, -8, 8, -6, 6, -4, 4, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { inputsRef.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digits[i] === " " ? "" : (digits[i] || "")}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-14 w-12 rounded-xl border text-center text-xl font-bold transition-all duration-200",
              "bg-white/5 text-white outline-none",
              "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
              error
                ? "border-red-500/70 bg-red-500/10"
                : digits[i] && digits[i] !== " "
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-white/10",
            )}
          />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
