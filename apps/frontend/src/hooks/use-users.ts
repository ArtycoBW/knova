"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";
import { useAuthStore } from "@/store/auth.store";

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
  organization?: string;
  bio?: string;
  role?: "STUDENT" | "SCIENTIST" | "OFFICIAL" | "OTHER";
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface NotificationItem {
  id: string;
  type: "DOCUMENT_READY" | "GENERATION_COMPLETE" | "BADGE_EARNED" | "SYSTEM";
  title: string;
  message: string;
  read: boolean;
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    badgeId?: string;
    icon?: string;
  } | null;
  createdAt: string;
}

export interface EarnedBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  earnedAt: string;
}

export function useNotifications() {
  return useQuery<NotificationItem[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get("/users/notifications").then((response) => response.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useBadges() {
  return useQuery<EarnedBadge[]>({
    queryKey: ["badges"],
    queryFn: () => api.get("/users/badges").then((response) => response.data),
    staleTime: 60_000,
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: () =>
      api.post("/users/complete-onboarding").then((response) => response.data),
    onSuccess: (data) => {
      if (data.user) {
        setUser(data.user);
        queryClient.setQueryData(["me"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["badges"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: "Онбординг завершён",
        message: data.badge?.name
          ? `Вы получили бейдж «${data.badge.name}»`
          : "Первые шаги успешно завершены",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось завершить онбординг",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      api.put("/users/profile", payload).then((response) => response.data),
    onSuccess: (data) => {
      if (data.user) {
        setUser(data.user);
        queryClient.setQueryData(["me"], data.user);
      }
      toast.show({
        variant: "success",
        title: "Профиль обновлён",
        message: "Изменения уже сохранены в аккаунте.",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось обновить профиль",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.put("/users/avatar", formData).then((response) => response.data);
    },
    onSuccess: (data) => {
      if (user) {
        const nextUser = { ...user, avatarUrl: data.avatarUrl };
        setUser(nextUser);
        queryClient.setQueryData(["me"], nextUser);
      }
      toast.show({
        variant: "success",
        title: "Аватар обновлён",
        message: "Новый аватар уже отображается в интерфейсе.",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось загрузить аватар",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useChangePassword() {
  const toast = useToast();

  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) =>
      api.put("/users/password", payload).then((response) => response.data),
    onSuccess: () => {
      toast.show({
        variant: "success",
        title: "Пароль изменён",
        message: "Теперь можно входить с новым паролем.",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось сменить пароль",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/users/notifications/${id}/read`).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка",
        message: getErrorMessage(error),
      });
    },
  });
}
