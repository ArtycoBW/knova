"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Typewriter } from "@/components/ui/typewriter-text";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/password-strength";
import { useResetPassword, useResetPasswordConfirm } from "@/hooks/use-auth";
import { useToast } from "@/providers/toast-provider";

export default function ResetPasswordPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const resetPassword = useResetPassword();
  const resetConfirm = useResetPasswordConfirm();

  const handleStep1 = async () => {
    const data = await resetPassword.mutateAsync({ email }).catch(() => null);
    if (data) {
      toast.show({ variant: "success", title: "Код отправлен", message: data.verificationCode ? `Код: ${data.verificationCode}` : "Проверьте email" });
      setStep(1);
    }
  };

  const handleStep2 = async () => {
    if (code.length < 5) { setOtpError(true); setTimeout(() => setOtpError(false), 600); return; }
    if (!isPasswordStrong(newPassword)) { toast.show({ variant: "warning", message: "Пароль не соответствует требованиям" }); return; }
    const data = await resetConfirm.mutateAsync({ email, code, newPassword }).catch(() => {
      setOtpError(true);
      setTimeout(() => setOtpError(false), 600);
      return null;
    });
    if (data) setDone(true);
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
            {done ? "Готово!" : <Typewriter text={["Сброс пароля", "Восстановление"]} speed={80} loop delay={2000} />}
          </h1>
          <p className="text-sm text-white/40">
            {done ? "Пароль успешно изменён" : step === 0 ? "Укажите email аккаунта" : "Введите код и новый пароль"}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-3xl">✓</div>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-all">
                Войти <ArrowRight size={16} />
              </Link>
            </motion.div>
          ) : step === 0 ? (
            <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStep1()} placeholder="you@example.com" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all" />
              </div>
              <button onClick={handleStep1} disabled={resetPassword.isPending || !email} className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">
                {resetPassword.isPending ? "Отправка..." : "Получить код"} {!resetPassword.isPending && <ArrowRight size={16} />}
              </button>
              <p className="text-center text-xs text-white/30"><Link href="/login" className="text-emerald-400 hover:text-emerald-300">← Назад к входу</Link></p>
            </motion.div>
          ) : (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <div className="text-center">
                <p className="text-sm text-white/50">Код отправлен на <span className="text-emerald-400">{email}</span></p>
              </div>
              <OtpInput value={code} onChange={setCode} error={otpError} />
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Новый пароль</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Минимум 5 символов" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all" />
                {newPassword && <div className="mt-3"><PasswordStrength password={newPassword} /></div>}
              </div>
              <button onClick={handleStep2} disabled={resetConfirm.isPending || code.length < 5 || !isPasswordStrong(newPassword)} className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">
                {resetConfirm.isPending ? "Сохранение..." : "Изменить пароль"} {!resetConfirm.isPending && <ArrowRight size={16} />}
              </button>
              <button onClick={() => setStep(0)} className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors mx-auto">
                <ArrowLeft size={12} /> Назад
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
