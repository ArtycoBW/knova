"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface WorkspaceReportResponse {
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
  report: {
    id: string;
    title: string;
    content: string;
    template?: string | null;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    filePath?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function useReport(workspaceId: string) {
  return useQuery<WorkspaceReportResponse>({
    queryKey: ["report", workspaceId],
    queryFn: () => api.get(`/reports/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.report?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (query.state.data?.readyDocuments?.length && !query.state.data?.report) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGenerateReport(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/reports/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["report", workspaceId],
        (current: WorkspaceReportResponse | undefined) =>
          current
            ? {
                ...current,
                report: data?.report
                  ? {
                      id: data.report.id,
                      title: data.report.title,
                      content: data.report.content,
                      template: data.report.template,
                      status: data.report.status,
                      filePath: data.report.filePath,
                      createdAt: data.report.createdAt,
                      updatedAt: data.report.updatedAt,
                    }
                  : current.report,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["report", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Отчёт собирается" : "Отчёт уже обновляется",
        message: data?.queued
          ? "Через несколько секунд обновлённый отчёт появится на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать отчёт",
        message: getErrorMessage(error),
      });
    },
  });
}
