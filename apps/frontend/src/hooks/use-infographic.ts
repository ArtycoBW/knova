"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export type ChartType = "bar" | "line" | "pie" | "doughnut";

export interface InfographicDataset {
  label: string;
  data: number[];
  backgroundColor?: string[];
  borderColor?: string[];
  borderWidth?: number;
  fill?: boolean;
  tension?: number;
}

export interface InfographicDataPayload {
  title: string;
  type: ChartType;
  data: {
    labels: string[];
    datasets: InfographicDataset[];
  };
  summary: string;
  generatedFrom: number;
}

export interface WorkspaceInfographicResponse {
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
  infographic: {
    id: string;
    title: string;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    chartType: ChartType;
    chartData: InfographicDataPayload;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function useInfographic(workspaceId: string) {
  return useQuery<WorkspaceInfographicResponse>({
    queryKey: ["infographic", workspaceId],
    queryFn: () =>
      api.get(`/infographic/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.infographic?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (query.state.data?.readyDocuments?.length && !query.state.data?.infographic) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGenerateInfographic(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/infographic/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["infographic", workspaceId],
        (current: WorkspaceInfographicResponse | undefined) =>
          current
            ? {
                ...current,
                infographic: data?.infographic
                  ? {
                      id: data.infographic.id,
                      title: data.infographic.title,
                      status: data.infographic.status,
                      chartType: data.infographic.chartType,
                      chartData: data.infographic.chartData,
                      createdAt: data.infographic.createdAt,
                      updatedAt: data.infographic.updatedAt,
                    }
                  : current.infographic,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["infographic", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Инфографика собирается" : "Инфографика уже обновляется",
        message: data?.queued
          ? "Через несколько секунд визуализация появится на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать инфографику",
        message: getErrorMessage(error),
      });
    },
  });
}
