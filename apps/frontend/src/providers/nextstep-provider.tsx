"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  NextStep,
  NextStepProvider,
  type CardComponentProps,
  type Step,
  type Tour,
  useNextStep,
} from "nextstepjs";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BadgePopup } from "@/components/ui/badge-popup";
import { useCompleteOnboarding } from "@/hooks/use-users";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useAuthStore } from "@/store/auth.store";

const TOUR_SESSION_KEY = "knova_onboarding_session_v4";
const TOUR_PENDING_KEY = "knova_pending_tour_v3";

type OnboardingContextValue = {
  startBestTour: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function useOnboardingContext() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboardingContext must be used within NextStepAppProvider");
  }
  return context;
}

function TourCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
}: CardComponentProps) {
  const isLastStep = currentStep === totalSteps - 1;

  return (
    <div className="max-h-[calc(100vh-2rem)] w-[min(22rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-3xl border border-border bg-card p-4 shadow-2xl shadow-black/25 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge className="mb-2 gap-1.5 border-primary/15 bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Онбординг
          </Badge>
          <h3 className="text-lg font-semibold leading-tight text-foreground">
            {step.title}
          </h3>
        </div>
        {step.icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-xl">
            {typeof step.icon === "string" ? step.icon : step.icon}
          </div>
        ) : null}
      </div>

      <div className="text-sm leading-6 text-muted-foreground">{step.content}</div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Шаг {currentStep + 1}</span>
          <span>из {totalSteps}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-linear-to-r from-primary via-emerald-400 to-cyan-400 transition-[width] duration-300"
            style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={prevStep}
          disabled={currentStep === 0}
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>
        <Button type="button" className="flex-1 gap-1.5" onClick={nextStep}>
          {isLastStep ? "Завершить" : "Дальше"}
          {!isLastStep && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>

      {!isLastStep && skipTour ? (
        <button
          type="button"
          onClick={skipTour}
          className="mt-3 w-full rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Пропустить пока
        </button>
      ) : null}
    </div>
  );
}

function NextStepShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const completeOnboarding = useCompleteOnboarding();
  const { data: workspaces } = useWorkspaces();
  const { startNextStep } = useNextStep();

  const firstWorkspaceId = workspaces?.[0]?.id;

  const tours = useMemo<Tour[]>(() => {
    const emptyTour: Tour = {
      tour: "dashboard-onboarding-empty",
      steps: [
        {
          icon: "🚀",
          title: "Создайте первый воркспейс",
          content:
            "Начните с воркспейса: в нём будут храниться документы, чаты, карты знаний, презентации и все AI-результаты.",
          selector: "[data-tour='create-workspace']",
          side: "bottom-right",
          showControls: true,
          showSkip: true,
        },
      ],
    };

    if (!firstWorkspaceId) {
      return [emptyTour];
    }

    const workspaceTail: Step[] = [
      {
        icon: "💬",
        title: "Общайтесь с источниками",
        content:
          "Через чат можно задавать вопросы по загруженным материалам и получать ответы со ссылками на источники.",
        selector: "[data-tour='chat-button']",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
      },
      {
        icon: "🗺️",
        title: "Стройте карты знаний",
        content:
          "Mindmap быстро превращает длинные документы в понятную структуру тем, подтем и связей.",
        selector: "[data-tour='mindmap-button']",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
      },
      {
        icon: "🎙️",
        title: "Слушайте подкасты",
        content:
          "Подкасты превращают материалы в сценарий диалога, который удобно читать и экспортировать.",
        selector: "[data-tour='podcast-button']",
        side: "right-bottom",
        showControls: true,
        showSkip: true,
      },
      {
        icon: "⭐",
        title: "Зарабатывайте XP и бейджи",
        content:
          "Проходите онбординг, тесты и генерации, чтобы накапливать опыт, расти по уровням и открывать достижения.",
        selector: "[data-tour='xp-bar']",
        side: "right-top",
        showControls: true,
        showSkip: true,
        nextRoute: "/dashboard",
      },
    ];

    return [
      emptyTour,
      {
        tour: "dashboard-onboarding",
        steps: [
          {
            icon: "🚀",
            title: "Создавайте новые воркспейсы",
            content:
              "Каждый воркспейс — это отдельная база знаний. Здесь удобно разделять проекты, исследования и рабочие направления.",
            selector: "[data-tour='create-workspace']",
            side: "bottom-right",
            showControls: true,
            showSkip: true,
            nextRoute: `/workspace/${firstWorkspaceId}`,
          },
          {
            icon: "📄",
            title: "Загружайте документы и медиа",
            content:
              "Добавьте PDF, DOCX, TXT, аудио или видео. После обработки эти материалы станут основой для поиска и генераций.",
            selector: "[data-tour='upload-documents']",
            side: "top-right",
            showControls: true,
            showSkip: true,
            prevRoute: "/dashboard",
          },
          ...workspaceTail,
        ],
      },
      {
        tour: "workspace-onboarding",
        steps: [
          {
            icon: "📄",
            title: "Загружайте документы и медиа",
            content:
              "Добавьте материалы в текущий воркспейс, чтобы чат, mindmap и другие AI-инструменты работали на реальном контенте.",
            selector: "[data-tour='upload-documents']",
            side: "top-right",
            showControls: true,
            showSkip: true,
          },
          ...workspaceTail,
        ],
      },
    ];
  }, [firstWorkspaceId]);

  const getPreferredTour = useCallback(() => {
    if (pathname.startsWith("/workspace/")) {
      return "workspace-onboarding";
    }

    if (pathname === "/dashboard") {
      return firstWorkspaceId
        ? "dashboard-onboarding"
        : "dashboard-onboarding-empty";
    }

    return firstWorkspaceId
      ? "dashboard-onboarding"
      : "dashboard-onboarding-empty";
  }, [firstWorkspaceId, pathname]);

  const startBestTour = useCallback(() => {
    const nextTour = getPreferredTour();

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(TOUR_SESSION_KEY, nextTour);
    }

    if (pathname.startsWith("/workspace/")) {
      startNextStep("workspace-onboarding");
      return;
    }

    if (pathname === "/dashboard") {
      startNextStep(firstWorkspaceId ? "dashboard-onboarding" : "dashboard-onboarding-empty");
      return;
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(TOUR_PENDING_KEY, nextTour);
    }
    router.push("/dashboard");
  }, [getPreferredTour, pathname, router, startNextStep]);

  useEffect(() => {
    if (!user || user.onboardingDone) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const shouldAutoStart =
      pathname === "/dashboard" || pathname.startsWith("/workspace/");
    if (!shouldAutoStart) {
      return;
    }

    const desiredTour = getPreferredTour();
    if (window.sessionStorage.getItem(TOUR_SESSION_KEY) === desiredTour) {
      return;
    }

    startBestTour();
  }, [getPreferredTour, pathname, startBestTour, user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const pendingTour = window.sessionStorage.getItem(TOUR_PENDING_KEY);
    if (!pendingTour) {
      return;
    }

    const canStartDashboardTour =
      pathname === "/dashboard" &&
      (pendingTour === "dashboard-onboarding" ||
        pendingTour === "dashboard-onboarding-empty");
    const canStartWorkspaceTour =
      pathname.startsWith("/workspace/") && pendingTour === "workspace-onboarding";

    if (!canStartDashboardTour && !canStartWorkspaceTour) {
      return;
    }

    window.sessionStorage.removeItem(TOUR_PENDING_KEY);
    const timeout = window.setTimeout(() => {
      startNextStep(pendingTour);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [pathname, startNextStep]);

  const handleComplete = useCallback((tourName: string | null) => {
    if (tourName === "dashboard-onboarding-empty") {
      return;
    }

    if (!user || user.onboardingDone || completeOnboarding.isPending) {
      return;
    }

    completeOnboarding.mutate();
  }, [completeOnboarding, user]);

  return (
    <OnboardingContext.Provider value={{ startBestTour }}>
      <NextStep
        steps={tours}
        cardComponent={TourCard}
        shadowRgb="15, 23, 42"
        shadowOpacity="0.55"
        overlayZIndex={1000}
        onComplete={handleComplete}
        disableConsoleLogs
        noInViewScroll={false}
        displayArrow={false}
      >
        {children}
        <BadgePopup />
      </NextStep>
    </OnboardingContext.Provider>
  );
}

export function NextStepAppProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextStepProvider>
      <NextStepShell>{children}</NextStepShell>
    </NextStepProvider>
  );
}

export function useKnovaOnboarding() {
  return useOnboardingContext();
}
