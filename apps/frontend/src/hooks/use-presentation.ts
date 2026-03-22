"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface PresentationSlide {
  title: string;
  bullets: string[];
  note?: string;
}

export interface PresentationSlidesPayload {
  title: string;
  subtitle: string;
  generatedFrom: number;
  slides: PresentationSlide[];
}

export interface WorkspacePresentationResponse {
  workspace: {
    id: string;
    name: string;
    description?: string | null;
  };
  readyDocuments: Array<{
    id: string;
    originalName: string;
    sourceType: "FILE" | "AUDIO" | "VIDEO";
    createdAt: string;
  }>;
  presentation: {
    id: string;
    title: string;
    slides: PresentationSlidesPayload;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    filePath?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function usePresentation(workspaceId: string) {
  return useQuery<WorkspacePresentationResponse>({
    queryKey: ["presentation", workspaceId],
    queryFn: () =>
      api.get(`/presentation/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.presentation?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (
        query.state.data?.readyDocuments?.length &&
        !query.state.data?.presentation
      ) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGeneratePresentation(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/presentation/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["presentation", workspaceId],
        (current: WorkspacePresentationResponse | undefined) =>
          current
            ? {
                ...current,
                presentation: data?.presentation
                  ? {
                      id: data.presentation.id,
                      title: data.presentation.title,
                      slides: data.presentation.slides,
                      status: data.presentation.status,
                      filePath: data.presentation.filePath,
                      createdAt: data.presentation.createdAt,
                      updatedAt: data.presentation.updatedAt,
                    }
                  : current.presentation,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["presentation", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued
          ? "Презентация собирается"
          : "Презентация уже обновляется",
        message: data?.queued
          ? "Через несколько секунд структура слайдов появится на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать презентацию",
        message: getErrorMessage(error),
      });
    },
  });
}
