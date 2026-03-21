"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export type PodcastTone = "scientific" | "popular";
export type PodcastLength = "short" | "medium" | "long";

export interface PodcastScriptLine {
  speaker: "A" | "B";
  text: string;
}

export interface PodcastScriptData {
  title: string;
  lines: PodcastScriptLine[];
  generatedFrom: number;
}

export interface WorkspacePodcastResponse {
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
  podcast: {
    id: string;
    title: string;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    script: PodcastScriptData;
    settings: {
      tone: PodcastTone;
      length: PodcastLength;
    } | null;
    audioUrl?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function usePodcast(workspaceId: string) {
  return useQuery<WorkspacePodcastResponse>({
    queryKey: ["podcast", workspaceId],
    queryFn: () => api.get(`/podcast/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.podcast?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (query.state.data?.readyDocuments?.length && !query.state.data?.podcast) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGeneratePodcast(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { tone: PodcastTone; length: PodcastLength }) =>
      api.post(`/podcast/${workspaceId}/generate`, dto).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["podcast", workspaceId],
        (current: WorkspacePodcastResponse | undefined) =>
          current
            ? {
                ...current,
                podcast: data?.podcast
                  ? {
                      id: data.podcast.id,
                      title: data.podcast.title,
                      status: data.podcast.status,
                      script: data.podcast.script,
                      settings: data.podcast.settings,
                      audioUrl: data.podcast.audioUrl,
                      createdAt: data.podcast.createdAt,
                      updatedAt: data.podcast.updatedAt,
                    }
                  : current.podcast,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["podcast", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Генерация запущена" : "Подкаст уже собирается",
        message: data?.queued
          ? "Через несколько секунд сценарий появится на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать подкаст",
        message: getErrorMessage(error),
      });
    },
  });
}
