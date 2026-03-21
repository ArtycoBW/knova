"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Typewriter } from "@/components/ui/typewriter-text";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/password-strength";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useResetPassword, useResetPasswordConfirm } from "@/hooks/use-auth";
import { useToast } from "@/providers/toast-provider";
import { useOtpTimer } from "@/hooks/use-otp-timer";

const authInput =
  "bg-white/5 border-white/10 text-white placeholder:text-white/20 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/50 rounded-xl h-12";
const authBtn =
  "w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 h-12";

function buildAuthHref(pathname: string, redirect?: string | null) {
  if (!redirect) {
    return pathname;
  }

  return `${pathname}?redirect=${encodeURIComponent(redirect)}`;
}

function ResetPasswordPageContent() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [step, setStep] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const resetPassword = useResetPassword();
  const resetConfirm = useResetPasswordConfirm();
  const otpTimer = useOtpTimer();

  const handleStep1 = async () => {
    const data = await resetPassword.mutateAsync({ email }).catch(() => null);
    if (data) {
      setDevCode(data.verificationCode ?? "");
      otpTimer.restart();
      setStep(1);
    }
  };

  const handleResend = async () => {
    const data = await resetPassword.mutateAsync({ email }).catch(() => null);
    if (data) {
      setDevCode(data.verificationCode ?? "");
      otpTimer.restart();
      setCode("");
    }
  };

  const handleStep2 = async () => {
    if (code.length < 5) {
      setOtpError(true);
      setTimeout(() => setOtpError(false), 600);
      return;
    }
    if (!isPasswordStrong(newPassword)) {
      toast.show({ variant: "warning", message: "Пароль не соответствует требованиям" });
      return;
    }
    const data = await resetConfirm.mutateAsync({ email, code, newPassword }).catch(() => {
      setOtpError(true);
      setTimeout(() => setOtpError(false), 600);
      return null;
    });
    if (data) {
      setDone(true);
    }
  };

  return (
    <div className="w-full max-w-md">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-2xl border border-white/10 bg-black/60 p-8 shadow-2xl backdrop-blur-xl"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="mb-6 inline-block">
            <span className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-syne)" }}>
              Knova
            </span>
          </Link>
          <h1 className="mb-1 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-syne)" }}>
            {done ? "Готово!" : <Typewriter text={["Сброс пароля", "Восстановление"]} speed={80} loop delay={2000} />}
          </h1>
          <p className="text-sm text-white/40">
            {done ? "Пароль успешно изменён" : step === 0 ? "Укажите email аккаунта" : "Введите код и новый пароль"}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4 text-center"
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-3xl">
                ✓
              </div>
              <Link
                href={buildAuthHref("/login", redirect)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500"
              >
                Войти <ArrowRight size={16} />
              </Link>
            </motion.div>
          ) : step === 0 ? (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStep1()}
                  placeholder="you@example.com"
                  className={authInput}
                />
              </div>
              <Button onClick={handleStep1} disabled={resetPassword.isPending || !email} className={authBtn}>
                {resetPassword.isPending ? "Отправка..." : "Получить код"}
                {!resetPassword.isPending && <ArrowRight size={16} />}
              </Button>
              <p className="text-center text-xs text-white/30">
                <Link href={buildAuthHref("/login", redirect)} className="text-emerald-400 hover:text-emerald-300">
                  ← Назад ко входу
                </Link>
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5"
            >
              <div className="text-center">
                <p className="text-sm text-white/50">
                  Код отправлен на <span className="text-emerald-400">{email}</span>
                </p>
              </div>
              <OtpInput value={code} onChange={setCode} error={otpError} />
              {process.env.NODE_ENV !== "production" && devCode && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-200">
                  Код для dev: <span className="font-semibold tracking-[0.25em]">{devCode}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Новый пароль</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 5 символов"
                  className={authInput}
                />
                {newPassword && (
                  <div className="mt-3">
                    <PasswordStrength password={newPassword} />
                  </div>
                )}
              </div>
              <Button
                onClick={handleStep2}
                disabled={resetConfirm.isPending || code.length < 5 || !isPasswordStrong(newPassword)}
                className={authBtn}
              >
                {resetConfirm.isPending ? "Сохранение..." : "Изменить пароль"}
                {!resetConfirm.isPending && <ArrowRight size={16} />}
              </Button>
              <div className="space-y-3 text-center">
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={resetPassword.isPending || otpTimer.isActive}
                  className="mx-auto text-xs text-white/40 hover:bg-transparent hover:text-emerald-300"
                >
                  {otpTimer.isActive
                    ? `Отправить код снова через ${otpTimer.secondsLeft} сек.`
                    : "Отправить код снова"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="mx-auto flex items-center gap-1 text-xs text-white/30 hover:bg-transparent hover:text-white/60"
                >
                  <ArrowLeft size={12} /> Назад
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md" />}>
      <ResetPasswordPageContent />
    </Suspense>
  );
}
