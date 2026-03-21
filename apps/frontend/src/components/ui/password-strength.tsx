"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordStrengthProps {
  password: string;
}

interface Rule {
  label: string;
  test: (p: string) => boolean;
}

const rules: Rule[] = [
  { label: "Минимум 5 символов", test: (p) => p.length >= 5 },
  { label: "Заглавная буква", test: (p) => /[A-Z]/.test(p) },
  { label: "Цифра", test: (p) => /[0-9]/.test(p) },
];

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const results = useMemo(() => rules.map((r) => r.test(password)), [password]);
  const score = results.filter(Boolean).length;

  const barColor =
    score === 0
      ? "bg-gray-700"
      : score === 1
        ? "bg-red-500"
        : score === 2
          ? "bg-yellow-500"
          : "bg-emerald-500";

  const label =
    score === 0
      ? ""
      : score === 1
        ? "Слабый"
        : score === 2
          ? "Средний"
          : "Надёжный";

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {rules.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i < score ? barColor : "bg-white/10",
            )}
          />
        ))}
      </div>
      {password.length > 0 && (
        <p className={cn("text-xs", barColor.replace("bg-", "text-"))}>
          {label}
        </p>
      )}
      <ul className="space-y-1">
        {rules.map((rule, i) => (
          <li key={i} className="flex items-center gap-1.5 text-xs">
            {results[i] ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <X className="h-3.5 w-3.5 text-white/30" />
            )}
            <span className={results[i] ? "text-white/70" : "text-white/30"}>
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function isPasswordStrong(password: string): boolean {
  return rules.every((r) => r.test(password));
}
