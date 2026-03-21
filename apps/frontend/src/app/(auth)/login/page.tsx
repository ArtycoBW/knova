"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, ArrowRight, ArrowLeft } from "lucide-react";
import { Typewriter } from "@/components/ui/typewriter-text";
import { OtpInput } from "@/components/ui/otp-input";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLogin, useLoginVerify } from "@/hooks/use-auth";
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

function LoginPageContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [step, setStep] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");

  const login = useLogin();
  const loginVerify = useLoginVerify();
  const otpTimer = useOtpTimer();

  const handleStep1 = async () => {
    const data = await login.mutateAsync({ email, password }).catch(() => null);
    if (data) {
      setDevCode(data.verificationCode ?? "");
      otpTimer.restart();
      setStep(1);
    }
  };

  const handleResend = async () => {
    const data = await login.mutateAsync({ email, password }).catch(() => null);
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

    await loginVerify.mutateAsync({ email, code }).catch(() => {
      setOtpError(true);
      setTimeout(() => setOtpError(false), 600);
    });
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
            <Typewriter
              text={["Добро пожаловать", "Войдите в аккаунт", "Продолжите работу"]}
              speed={80}
              loop
              delay={2000}
            />
          </h1>
          <p className="text-sm text-white/40">
            {step === 0 ? "Введите данные для входа" : "Введите код подтверждения"}
          </p>
          <div className="mt-3 flex justify-center gap-1.5">
            {[0, 1].map((i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${i <= step ? "w-8 bg-emerald-500" : "w-4 bg-white/10"}`}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
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
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Пароль</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleStep1()}
                    placeholder="Ваш пароль"
                    className={`${authInput} pr-11`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-white/30 hover:bg-transparent hover:text-white/60"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Link
                  href={buildAuthHref("/reset-password", redirect)}
                  className="text-xs text-white/30 transition-colors hover:text-emerald-400"
                >
                  Забыли пароль?
                </Link>
              </div>
              <Button
                onClick={handleStep1}
                disabled={login.isPending || !email || !password}
                className={authBtn}
              >
                {login.isPending ? "Проверка..." : "Войти"}
                {!login.isPending && <ArrowRight size={16} />}
              </Button>
              <p className="text-center text-xs text-white/30">
                Нет аккаунта?{" "}
                <Link
                  href={buildAuthHref("/register", redirect)}
                  className="text-emerald-400 hover:text-emerald-300"
                >
                  Зарегистрироваться
                </Link>
              </p>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="space-y-2 text-center">
                <p className="text-sm text-white/50">Код отправлен на</p>
                <p className="text-sm font-medium text-emerald-400">{email}</p>
              </div>
              <OtpInput value={code} onChange={setCode} error={otpError} />
              {process.env.NODE_ENV !== "production" && devCode && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-200">
                  Код для dev: <span className="font-semibold tracking-[0.25em]">{devCode}</span>
                </div>
              )}
              <Button
                onClick={handleStep2}
                disabled={loginVerify.isPending || code.length < 5}
                className={authBtn}
              >
                {loginVerify.isPending ? "Вход..." : "Подтвердить"}
                {!loginVerify.isPending && <ArrowRight size={16} />}
              </Button>
              <div className="space-y-3 text-center">
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={login.isPending || otpTimer.isActive}
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md" />}>
      <LoginPageContent />
    </Suspense>
  );
}
