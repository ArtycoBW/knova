"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";

export interface ChatSource {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  sources?: ChatSource[] | null;
  createdAt: string;
}

export interface ChatSession {
  sessionId: string;
  workspace: {
    id: string;
    name: string;
  };
  messages: ChatMessage[];
}

export function useChatSession(workspaceId: string) {
  return useQuery<ChatSession>({
    queryKey: ["chat", workspaceId],
    queryFn: () => api.get(`/chat/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
  });
}

export function useSendChatMessage(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (content: string) =>
      api.post(`/chat/${workspaceId}/messages`, { content }).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData<ChatSession | undefined>(["chat", workspaceId], (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          messages: [...current.messages, data.userMessage, data.assistantMessage],
        };
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка чата",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useTranscribeChatAudio() {
  const toast = useToast();

  return useMutation({
    mutationFn: (blob: Blob | File) => {
      const mimeType = blob.type.split(";")[0]?.trim().toLowerCase() || "audio/webm";
      const extension =
        mimeType === "audio/mp4"
          ? "m4a"
          : mimeType === "audio/ogg"
            ? "ogg"
            : mimeType === "audio/wav" || mimeType === "audio/x-wav"
              ? "wav"
              : "webm";
      const formData = new FormData();
      formData.append("file", blob, `voice-question.${extension}`);
      return api
        .post("/chat/transcribe", formData)
        .then((response) => response.data as { text: string });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Ошибка STT",
        message: getErrorMessage(error),
      });
    },
  });
}
