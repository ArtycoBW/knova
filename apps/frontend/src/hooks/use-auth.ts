"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { useToast } from "@/providers/toast-provider";

function getPostAuthRedirect() {
  if (typeof window === "undefined") {
    return "/dashboard";
  }

  const redirect = new URLSearchParams(window.location.search).get("redirect");
  if (!redirect || !redirect.startsWith("/")) {
    return "/dashboard";
  }

  return redirect;
}

export function useMe() {
  const initFromStorage = useAuthStore((s) => s.initFromStorage);
  const setUser = useAuthStore((s) => s.setUser);
  const accessToken = useAuthStore((s) => s.accessToken);

  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      return data.user;
    },
    enabled: !!accessToken,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRegister() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string; password: string }) =>
      api.post("/auth/register", dto).then((r) => r.data),
    onError: (error) => {
      toast.show({ variant: "error", title: "Ошибка", message: getErrorMessage(error) });
    },
  });
}

export function useRegisterVerify() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string; code: string }) =>
      api.post("/auth/register/verify", dto).then((r) => r.data),
    onError: (error) => {
      toast.show({ variant: "error", title: "Неверный код", message: getErrorMessage(error) });
    },
  });
}

export function useRegisterProfile() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: {
      userId: string;
      firstName: string;
      lastName: string;
      organization?: string;
      role?: string;
    }) => api.put("/auth/register/profile", dto).then((r) => r.data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      qc.setQueryData(["me"], data.user);
      toast.show({ variant: "success", title: "Добро пожаловать!", message: data.user.firstName || data.user.email });
      router.push(getPostAuthRedirect());
    },
    onError: (error) => {
      toast.show({ variant: "error", title: "Ошибка", message: getErrorMessage(error) });
    },
  });
}

export function useLogin() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string; password: string }) =>
      api.post("/auth/login", dto).then((r) => r.data),
    onError: (error) => {
      toast.show({ variant: "error", title: "Ошибка входа", message: getErrorMessage(error) });
    },
  });
}

export function useLoginVerify() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: { email: string; code: string }) =>
      api.post("/auth/login/verify", dto).then((r) => r.data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      qc.setQueryData(["me"], data.user);
      toast.show({ variant: "success", title: "Добро пожаловать!", message: data.user?.firstName || "" });
      router.push(getPostAuthRedirect());
    },
    onError: (error) => {
      toast.show({ variant: "error", title: "Неверный код", message: getErrorMessage(error) });
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => {
      const refreshToken = localStorage.getItem("refreshToken");
      return api.post("/auth/logout", { refreshToken }).then((r) => r.data);
    },
    onSettled: () => {
      logout();
      qc.clear();
      router.push("/login");
    },
  });
}

export function useResetPassword() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string }) =>
      api.post("/auth/reset-password", dto).then((r) => r.data),
    onError: (error) => {
      toast.show({ variant: "error", message: getErrorMessage(error) });
    },
  });
}

export function useResetPasswordConfirm() {
  const toast = useToast();
  const router = useRouter();

  return useMutation({
    mutationFn: (dto: { email: string; code: string; newPassword: string }) =>
      api.post("/auth/reset-password/confirm", dto).then((r) => r.data),
    onSuccess: () => {
      toast.show({ variant: "success", title: "Готово!", message: "Пароль изменён" });
      router.push("/login");
    },
    onError: (error) => {
      toast.show({ variant: "error", message: getErrorMessage(error) });
    },
  });
}
