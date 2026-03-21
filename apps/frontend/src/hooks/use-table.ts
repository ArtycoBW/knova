"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface TableDataPayload {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  summary: string;
  generatedFrom: number;
}

export interface WorkspaceTableResponse {
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
  table: {
    id: string;
    title: string;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    tableData: TableDataPayload;
    csvPath?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export function useTable(workspaceId: string) {
  return useQuery<WorkspaceTableResponse>({
    queryKey: ["table", workspaceId],
    queryFn: () => api.get(`/table/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.table?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (query.state.data?.readyDocuments?.length && !query.state.data?.table) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGenerateTable(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/table/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["table", workspaceId],
        (current: WorkspaceTableResponse | undefined) =>
          current
            ? {
                ...current,
                table: data?.table
                  ? {
                      id: data.table.id,
                      title: data.table.title,
                      status: data.table.status,
                      tableData: data.table.tableData,
                      csvPath: data.table.csvPath,
                      createdAt: data.table.createdAt,
                      updatedAt: data.table.updatedAt,
                    }
                  : current.table,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["table", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Таблица собирается" : "Таблица уже обновляется",
        message: data?.queued
          ? "Через несколько секунд новая таблица появится на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать таблицу",
        message: getErrorMessage(error),
      });
    },
  });
}
