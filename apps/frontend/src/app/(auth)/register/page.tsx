"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, ArrowRight, ArrowLeft } from "lucide-react";
import { Typewriter } from "@/components/ui/typewriter-text";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/password-strength";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRegister, useRegisterVerify, useRegisterProfile } from "@/hooks/use-auth";
import { useToast } from "@/providers/toast-provider";
import { useOtpTimer } from "@/hooks/use-otp-timer";

const STEPS = ["Аккаунт", "Подтверждение", "Профиль"] as const;

const ROLES = [
  { value: "STUDENT", label: "Студент" },
  { value: "SCIENTIST", label: "Учёный / Исследователь" },
  { value: "OFFICIAL", label: "Госслужащий" },
  { value: "OTHER", label: "Другое" },
];

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

function RegisterPageContent() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [step, setStep] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [userId, setUserId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("STUDENT");

  const register = useRegister();
  const registerVerify = useRegisterVerify();
  const registerProfile = useRegisterProfile();
  const otpTimer = useOtpTimer();

  const handleStep1 = async () => {
    const data = await register.mutateAsync({ email, password }).catch(() => null);
    if (data) {
      setDevCode(data.verificationCode ?? "");
      otpTimer.restart();
      setStep(1);
    }
  };

  const handleResend = async () => {
    const data = await register.mutateAsync({ email, password }).catch(() => null);
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
    const data = await registerVerify.mutateAsync({ email, code }).catch(() => {
      setOtpError(true);
      setTimeout(() => setOtpError(false), 600);
      return null;
    });
    if (data) {
      setUserId(data.userId);
      setStep(2);
    }
  };

  const handleStep3 = async () => {
    if (!firstName || !lastName) {
      toast.show({ variant: "warning", message: "Заполните имя и фамилию" });
      return;
    }
    await registerProfile.mutateAsync({ userId, firstName, lastName, organization, role });
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
              text={["Создайте аккаунт", "Начните работу", "Присоединяйтесь"]}
              speed={80}
              loop
              delay={2000}
            />
          </h1>
          <p className="text-sm text-white/40">
            Шаг {step + 1} из {STEPS.length} — {STEPS[step]}
          </p>
          <div className="mt-3 flex justify-center gap-1.5">
            {STEPS.map((_, i) => (
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
                    onKeyDown={(e) => e.key === "Enter" && isPasswordStrong(password) && handleStep1()}
                    placeholder="Минимум 5 символов"
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
                {password && (
                  <div className="mt-3">
                    <PasswordStrength password={password} />
                  </div>
                )}
              </div>
              <Button
                onClick={handleStep1}
                disabled={register.isPending || !email || !isPasswordStrong(password)}
                className={authBtn}
              >
                {register.isPending ? "Отправка..." : "Продолжить"}
                {!register.isPending && <ArrowRight size={16} />}
              </Button>
              <p className="text-center text-xs text-white/30">
                Уже есть аккаунт?{" "}
                <Link
                  href={buildAuthHref("/login", redirect)}
                  className="text-emerald-400 hover:text-emerald-300"
                >
                  Войти
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
                disabled={registerVerify.isPending || code.length < 5}
                className={authBtn}
              >
                {registerVerify.isPending ? "Проверка..." : "Подтвердить"}
                {!registerVerify.isPending && <ArrowRight size={16} />}
              </Button>
              <div className="space-y-3 text-center">
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={register.isPending || otpTimer.isActive}
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

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Имя</Label>
                  <Input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Иван"
                    className={authInput}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Фамилия</Label>
                  <Input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Иванов"
                    className={authInput}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Организация</Label>
                <Input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Центр-Инвест"
                  className={authInput}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Роль</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-12 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white transition-all focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-zinc-900 text-white">
                    {ROLES.map((item) => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                        className="focus:bg-emerald-600/20 focus:text-white"
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleStep3}
                disabled={registerProfile.isPending || !firstName || !lastName}
                className={authBtn}
              >
                {registerProfile.isPending ? "Создание..." : "Начать работу"}
                {!registerProfile.isPending && <ArrowRight size={16} />}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md" />}>
      <RegisterPageContent />
    </Suspense>
  );
}
