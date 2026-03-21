"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

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

export function useNotifications() {
  return useQuery<NotificationItem[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get("/users/notifications").then((response) => response.data),
    staleTime: 15_000,
    refetchInterval: 10_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.post(`/users/notifications/${id}/read`).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => {
      toast.show({ variant: "error", title: "Ошибка", message: getErrorMessage(error) });
    },
  });
}
