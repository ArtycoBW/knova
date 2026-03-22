"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";
import { useAuthStore } from "@/store/auth.store";

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

function getCodeMessage(prefix: string, code?: string, fallback?: string) {
  if (code) {
    return `${prefix}: ${code}`;
  }

  return fallback ?? "Код подтверждения отправлен.";
}

export function useMe() {
  const setUser = useAuthStore((state) => state.setUser);
  const accessToken = useAuthStore((state) => state.accessToken);

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
      api.post("/auth/register", dto).then((response) => response.data),
    onSuccess: (data) => {
      toast.show({
        variant: "success",
        title: "Код подтверждения",
        message: getCodeMessage(
          "Код для регистрации",
          data?.verificationCode,
          data?.message,
        ),
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка регистрации",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useRegisterVerify() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string; code: string }) =>
      api.post("/auth/register/verify", dto).then((response) => response.data),
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Неверный код",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useRegisterProfile() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: {
      userId: string;
      firstName: string;
      lastName: string;
      organization?: string;
      role?: string;
    }) => api.put("/auth/register/profile", dto).then((response) => response.data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      queryClient.setQueryData(["me"], data.user);
      toast.show({
        variant: "success",
        title: "Добро пожаловать!",
        message: data.user.firstName || data.user.email,
      });
      router.push(getPostAuthRedirect());
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка профиля",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useLogin() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string; password: string }) =>
      api.post("/auth/login", dto).then((response) => response.data),
    onSuccess: (data) => {
      toast.show({
        variant: "success",
        title: "Код входа",
        message: getCodeMessage(
          "Код для входа",
          data?.verificationCode,
          data?.message,
        ),
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка входа",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useLoginVerify() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: { email: string; code: string }) =>
      api.post("/auth/login/verify", dto).then((response) => response.data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      queryClient.setQueryData(["me"], data.user);
      toast.show({
        variant: "success",
        title: "Вход выполнен",
        message: data.user?.firstName || data.user?.email || "",
      });
      router.push(getPostAuthRedirect());
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Неверный код",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      const refreshToken = localStorage.getItem("refreshToken");
      return api.post("/auth/logout", { refreshToken }).then((response) => response.data);
    },
    onSettled: () => {
      logout();
      queryClient.clear();
      router.push("/login");
    },
  });
}

export function useResetPassword() {
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { email: string }) =>
      api.post("/auth/reset-password", dto).then((response) => response.data),
    onSuccess: (data) => {
      toast.show({
        variant: "success",
        title: data?.verificationCode ? "Код сброса" : "Проверьте данные",
        message: data?.verificationCode
          ? `Код для сброса пароля: ${data.verificationCode}`
          : data?.message ?? "Если email зарегистрирован, код будет отправлен.",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка восстановления",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useResetPasswordConfirm() {
  const toast = useToast();
  const router = useRouter();

  return useMutation({
    mutationFn: (dto: {
      email: string;
      code: string;
      newPassword: string;
    }) =>
      api
        .post("/auth/reset-password/confirm", dto)
        .then((response) => response.data),
    onSuccess: () => {
      toast.show({
        variant: "success",
        title: "Готово!",
        message: "Пароль изменён.",
      });
      router.push("/login");
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка восстановления",
        message: getErrorMessage(error),
      });
    },
  });
}
