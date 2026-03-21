"use client";

import { useState } from "react";
import Link from "next/link";
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

const STEPS = ["Аккаунт", "Подтверждение", "Профиль"] as const;

const ROLES = [
  { value: "STUDENT", label: "Студент" },
  { value: "SCIENTIST", label: "Учёный / Исследователь" },
  { value: "OFFICIAL", label: "Госслужащий" },
  { value: "OTHER", label: "Другое" },
];

const authInput = "bg-white/5 border-white/10 text-white placeholder:text-white/20 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/50 rounded-xl h-12";
const authBtn = "w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 h-12";

export default function RegisterPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [otpError, setOtpError] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [userId, setUserId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("STUDENT");

  const register = useRegister();
  const registerVerify = useRegisterVerify();
  const registerProfile = useRegisterProfile();

  const handleStep1 = async () => {
    const data = await register.mutateAsync({ email, password }).catch(() => null);
    if (data) {
      toast.show({ variant: "success", title: "Код отправлен", message: `Код: ${data.verificationCode}` });
      setStep(1);
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
    if (data) { setUserId(data.userId); setStep(2); }
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
        className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl p-8 shadow-2xl"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block mb-6">
            <span className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-syne)" }}>Knova</span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: "var(--font-syne)" }}>
            <Typewriter text={["Создайте аккаунт", "Начните работу", "Присоединяйтесь"]} speed={80} loop delay={2000} />
          </h1>
          <p className="text-sm text-white/40">Шаг {step + 1} из {STEPS.length} — {STEPS[step]}</p>
          <div className="flex gap-1.5 mt-3 justify-center">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i <= step ? "bg-emerald-500 w-8" : "bg-white/10 w-4"}`} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={authInput} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Пароль</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Минимум 5 символов"
                    className={`${authInput} pr-11`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-white/30 hover:text-white/60 hover:bg-transparent"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {password && <div className="mt-3"><PasswordStrength password={password} /></div>}
              </div>
              <Button onClick={handleStep1} disabled={register.isPending || !email || !isPasswordStrong(password)} className={authBtn}>
                {register.isPending ? "Отправка..." : "Продолжить"} {!register.isPending && <ArrowRight size={16} />}
              </Button>
              <p className="text-center text-xs text-white/30">Уже есть аккаунт?{" "}<Link href="/login" className="text-emerald-400 hover:text-emerald-300">Войти</Link></p>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-sm text-white/50">Код отправлен на</p>
                <p className="text-sm font-medium text-emerald-400">{email}</p>
              </div>
              <OtpInput value={code} onChange={setCode} error={otpError} />
              <Button onClick={handleStep2} disabled={registerVerify.isPending || code.length < 5} className={authBtn}>
                {registerVerify.isPending ? "Проверка..." : "Подтвердить"} {!registerVerify.isPending && <ArrowRight size={16} />}
              </Button>
              <Button variant="ghost" onClick={() => setStep(0)} className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 hover:bg-transparent mx-auto">
                <ArrowLeft size={12} /> Назад
              </Button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Имя</Label>
                  <Input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Иван" className={authInput} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/50">Фамилия</Label>
                  <Input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Иванов" className={authInput} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Организация (необязательно)</Label>
                <Input type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Центр-Инвест" className={authInput} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/50">Роль</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white">
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="focus:bg-emerald-600/20 focus:text-white">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleStep3} disabled={registerProfile.isPending || !firstName || !lastName} className={authBtn}>
                {registerProfile.isPending ? "Создание..." : "Начать работу"} {!registerProfile.isPending && <ArrowRight size={16} />}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
