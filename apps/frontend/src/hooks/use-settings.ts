"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface LlmProviderInfo {
  provider: "centrinvest" | "gemini" | "ollama";
  model: string;
  sttAvailable: boolean;
}

export interface LlmProviderItem {
  id: "centrinvest" | "gemini" | "ollama";
  name: string;
  description: string;
  sttAvailable: boolean;
  available: boolean;
  reason: string | null;
}

export function useCurrentLlmProvider() {
  return useQuery<LlmProviderInfo>({
    queryKey: ["settings", "llm"],
    queryFn: () => api.get("/settings/llm").then((response) => response.data),
    staleTime: 30_000,
  });
}

export function useLlmProviders() {
  return useQuery<LlmProviderItem[]>({
    queryKey: ["settings", "providers"],
    queryFn: () => api.get("/settings/llm/providers").then((response) => response.data),
    staleTime: 60_000,
  });
}

export function useSwitchLlmProvider() {
  const toast = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: LlmProviderItem["id"]) =>
      api.put("/settings/llm", { provider }).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "llm"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "providers"] });
      toast.show({
        variant: "success",
        title: "Провайдер обновлён",
        message: "Новая конфигурация уже активна",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось переключить провайдер",
        message: getErrorMessage(error),
      });
    },
  });
}
