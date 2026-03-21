"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useToast } from "@/providers/toast-provider";
import { useAuthStore } from "@/store/auth.store";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface QuizData {
  title: string;
  questions: QuizQuestion[];
  generatedFrom: number;
}

export interface WorkspaceQuizResponse {
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
  quiz: {
    id: string;
    title: string;
    status: "PENDING" | "GENERATING" | "READY" | "ERROR";
    questions: QuizData;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface QuizRewardBadge {
  name: string;
  description: string;
  icon: string;
  xpReward: number;
}

export interface QuizSubmitResponse {
  result: {
    score: number;
    correctAnswers: number;
    totalQuestions: number;
    answers: Array<{
      questionId: string;
      question: string;
      selectedIndex: number;
      selectedOption: string;
      correctIndex: number;
      correctOption: string;
      isCorrect: boolean;
      explanation: string;
    }>;
  };
  rewards: {
    xpAwarded: number;
    badges: QuizRewardBadge[];
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      organization: string | null;
      role: string;
      avatarUrl: string | null;
      bio?: string | null;
      xp: number;
      level: number;
      onboardingDone: boolean;
    };
  };
}

export function useQuiz(workspaceId: string) {
  return useQuery<WorkspaceQuizResponse>({
    queryKey: ["quiz", workspaceId],
    queryFn: () => api.get(`/quiz/${workspaceId}`).then((response) => response.data),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.quiz?.status;
      if (status === "PENDING" || status === "GENERATING") {
        return 2000;
      }

      if (query.state.data?.readyDocuments?.length && !query.state.data?.quiz) {
        return 4000;
      }

      return false;
    },
  });
}

export function useGenerateQuiz(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post(`/quiz/${workspaceId}/generate`).then((response) => response.data),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["quiz", workspaceId],
        (current: WorkspaceQuizResponse | undefined) =>
          current
            ? {
                ...current,
                quiz: data?.quiz
                  ? {
                      id: data.quiz.id,
                      title: data.quiz.title,
                      status: data.quiz.status,
                      questions: data.quiz.questions,
                      createdAt: data.quiz.createdAt,
                      updatedAt: data.quiz.updatedAt,
                    }
                  : current.quiz,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: ["quiz", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title: data?.queued ? "Генерация теста запущена" : "Тест уже собирается",
        message: data?.queued
          ? "Через несколько секунд вопросы появятся на экране"
          : "Дождитесь завершения текущей генерации",
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось собрать тест",
        message: getErrorMessage(error),
      });
    },
  });
}

export function useSubmitQuiz(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: (answers: number[]) =>
      api
        .post(`/quiz/${workspaceId}/submit`, { answers })
        .then((response) => response.data as QuizSubmitResponse),
    onSuccess: (data) => {
      setUser(data.rewards.user);
      queryClient.setQueryData(["me"], data.rewards.user);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.show({
        variant: "success",
        title:
          data.result.score === 100 ? "Идеальный результат" : "Тест завершён",
        message:
          data.rewards.xpAwarded > 0
            ? `Получено ${data.rewards.xpAwarded} XP`
            : `Правильных ответов: ${data.result.correctAnswers} из ${data.result.totalQuestions}`,
      });
    },
    onError: (error) => {
      toast.show({
        variant: "error",
        title: "Не удалось проверить ответы",
        message: getErrorMessage(error),
      });
    },
  });
}
