"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface MindmapGraphNode {
  id: string;
  label: string;
  summary: string;
  kind: "root" | "branch" | "leaf";
  level: number;
  groupIndex: number;
  order: number;
}

export interface MindmapGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface MindmapGraphData {
  title: string;
  centralTopic: string;
  nodes: MindmapGraphNode[];
  edges: MindmapGraphEdge[];
  sources: Array<{
    id: string;
    name: string;
    sourceType: "FILE" | "AUDIO" | "VIDEO";
  }>;
  generatedFrom: number;
}

export interface WorkspaceMindmapResponse {
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
  mindmap: {
    id: string;
    title: string;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    data: MindmapGraphData;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function useMindmap(workspaceId: string) {
  return useQuery<WorkspaceMindmapResponse>({
    queryKey: ["mindmap", workspaceId],
    queryFn: () => api.get(`/mindmap/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const status = query.state.data?.mindmap?.status;
      return status === "PENDING" || status === "GENERATING" ? 2500 : false;
    },
  });
}

export function useGenerateMindmap(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/mindmap/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mindmap", workspaceId] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Генерация запущена" : "Mindmap уже собирается",
        message: data?.queued
          ? "Через несколько секунд карта знаний появится на экране"
          : "Подождите завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать mindmap",
        message: getErrorMessage(error),
      });
    },
  });
}
