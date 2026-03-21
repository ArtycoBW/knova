"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  chatCount: number;
  readyCount: number;
  hasAudio: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  sourceType: "FILE" | "AUDIO" | "VIDEO";
  status: "PENDING" | "PROCESSING" | "READY" | "ERROR";
  pageCount?: number;
  duration?: number;
  extractedText?: string | null;
  createdAt: string;
}

export interface WorkspaceComparison {
  comparison: {
    documents: Array<{
      id: string;
      name: string;
      sourceType: "FILE" | "AUDIO" | "VIDEO";
      excerpt: string;
    }>;
    similarity: number;
    commonTopics: string[];
    uniqueTopics: Record<string, string[]>;
  };
}

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => api.get("/workspaces").then((r) => r.data),
    staleTime: 30_000,
  });
}

export function useWorkspace(id: string) {
  return useQuery({
    queryKey: ["workspace", id],
    queryFn: () => api.get(`/workspaces/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useWorkspaceStats() {
  return useQuery({
    queryKey: ["workspace-stats"],
    queryFn: () => api.get("/workspaces/stats").then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();

  return useMutation({
    mutationFn: (dto: { name: string; description?: string }) =>
      api.post("/workspaces", dto).then((r) => r.data),
    onSuccess: (workspace) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace-stats"] });
      toast.show({
        variant: "success",
        title: "Воркспейс создан",
        message: workspace.name,
      });
      router.push(`/workspace/${workspace.id}`);
    },
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Ошибка",
        message: getErrorMessage(err),
      }),
  });
}

export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (dto: { name?: string; description?: string }) =>
      api.put(`/workspaces/${id}`, dto).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", id] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.show({
        variant: "success",
        title: "Сохранено",
        message: "",
      });
    },
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Ошибка",
        message: getErrorMessage(err),
      }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/${id}`).then((r) => r.data),
    onSuccess: async (_, deletedWorkspaceId) => {
      qc.removeQueries({ queryKey: ["workspace", deletedWorkspaceId] });
      qc.removeQueries({ queryKey: ["documents", deletedWorkspaceId] });
      qc.removeQueries({ queryKey: ["chat", deletedWorkspaceId] });
      qc.removeQueries({ queryKey: ["mindmap", deletedWorkspaceId] });
      qc.removeQueries({ queryKey: ["podcast", deletedWorkspaceId] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["workspaces"] }),
        qc.invalidateQueries({ queryKey: ["workspace-stats"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      toast.show({
        variant: "success",
        title: "Воркспейс удалён",
        message: "",
      });
      router.replace("/dashboard");
      router.refresh();
    },
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Ошибка",
        message: getErrorMessage(err),
      }),
  });
}

export function useDocuments(workspaceId: string) {
  return useQuery<Document[]>({
    queryKey: ["documents", workspaceId],
    queryFn: () => api.get(`/workspaces/${workspaceId}/documents`).then((r) => r.data),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some((d: Document) => d.status === "PENDING" || d.status === "PROCESSING")) {
        return 3000;
      }
      return false;
    },
  });
}

export function useUploadDocument(workspaceId: string) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api
        .post(`/workspaces/${workspaceId}/documents`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents", workspaceId] });
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      toast.show({
        variant: "success",
        title: "Файл загружен",
        message: doc.name,
      });
    },
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Ошибка загрузки",
        message: getErrorMessage(err),
      }),
  });
}

export function useDeleteDocument(workspaceId: string) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", workspaceId] });
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      toast.show({
        variant: "success",
        title: "Документ удалён",
        message: "",
      });
    },
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Ошибка",
        message: getErrorMessage(err),
      }),
  });
}

export function useCompareDocuments(workspaceId: string) {
  const toast = useToast();

  return useMutation<WorkspaceComparison, Error, string[]>({
    mutationFn: (documentIds: string[]) =>
      api.post(`/workspaces/${workspaceId}/compare`, { documentIds }).then((r) => r.data),
    onError: (err) =>
      toast.show({
        variant: "error",
        title: "Не удалось сравнить",
        message: getErrorMessage(err),
      }),
  });
}
