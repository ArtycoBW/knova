import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { GenerationStatus, NotificationType, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.module";
import { SubmitQuizDto } from "./dto/submit-quiz.dto";

interface EmptyQuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface EmptyQuizData {
  title: string;
  questions: EmptyQuizQuestion[];
  generatedFrom: number;
}

interface QuizJobQuestionSeed {
  question: string;
  correctOption: string;
}

interface QuizJobData {
  workspaceId: string;
  quizId: string;
  userId: string;
  variationKey: string;
  previousQuestions: QuizJobQuestionSeed[];
}

type QuizRecord = {
  id: string;
  workspaceId: string;
  title: string;
  questions: Prisma.JsonValue;
  status: GenerationStatus;
  createdAt: Date;
  updatedAt: Date;
};

const FIRST_QUIZ_BADGE = {
  name: "Первый тест",
  description: "Прошёл первую AI-проверку знаний по материалам воркспейса",
  icon: "🧠",
  xpReward: 50,
};

const PERFECT_QUIZ_BADGE = {
  name: "Отличник",
  description: "Завершил тест без ошибок",
  icon: "🏆",
  xpReward: 150,
};

type RewardBadge = typeof FIRST_QUIZ_BADGE;

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.QUIZ_GENERATION)
    private readonly quizQueue: Queue,
  ) {}

  async getWorkspaceQuiz(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [quizzes, readyDocuments] = await Promise.all([
      this.prisma.quiz.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      this.prisma.document.findMany({
        where: { workspaceId, status: "READY" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          originalName: true,
          sourceType: true,
          createdAt: true,
        },
      }),
    ]);

    const quiz = await this.resolveCurrentQuiz(workspaceId, quizzes);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      quiz: quiz
        ? {
            id: quiz.id,
            title: quiz.title,
            status: quiz.status,
            questions: quiz.questions,
            createdAt: quiz.createdAt,
            updatedAt: quiz.updatedAt,
          }
        : null,
    };
  }

  async generate(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const jobId = this.getJobId(workspaceId);
    const readyCount = await this.prisma.document.count({
      where: { workspaceId, status: "READY" },
    });

    if (!readyCount) {
      throw new BadRequestException(
        "Сначала загрузите и дождитесь обработки хотя бы одного документа",
      );
    }

    const current = await this.prisma.quiz.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.quizQueue.getJob(jobId);
    const queuedState = queuedJob ? await queuedJob.getState() : null;
    const hasActiveQueueJob =
      queuedState === "waiting" ||
      queuedState === "active" ||
      queuedState === "delayed" ||
      queuedState === "prioritized";

    if (
      current &&
      (current.status === GenerationStatus.PENDING ||
        current.status === GenerationStatus.GENERATING) &&
      hasActiveQueueJob
    ) {
      return {
        queued: false,
        quiz: current,
      };
    }

    const title = `Тест: ${workspace.name}`;
    const quiz = current
      ? await this.prisma.quiz.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
          },
        })
      : await this.prisma.quiz.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            questions: this.createEmptyQuiz(workspace.name) as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.quizQueue.add(
        QUEUE_NAMES.QUIZ_GENERATION,
        {
          workspaceId,
          quizId: quiz.id,
          userId,
          variationKey: `${Date.now()}`,
          previousQuestions: current
            ? this.readQuizData(current.questions).questions.map((question) => ({
                question: question.question,
                correctOption: question.options[question.correctIndex] ?? "",
              }))
            : [],
        },
        {
          jobId,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    } catch (error) {
      if (current) {
        await this.prisma.quiz.update({
          where: { id: quiz.id },
          data: {
            title: current.title,
            status: current.status,
            questions: current.questions as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.quiz.update({
          where: { id: quiz.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      quiz,
    };
  }

  async submit(workspaceId: string, userId: string, dto: SubmitQuizDto) {
    await this.assertWorkspaceOwner(workspaceId, userId);

    const quiz = await this.prisma.quiz.findFirst({
      where: { workspaceId, status: GenerationStatus.READY },
      orderBy: { updatedAt: "desc" },
    });

    if (!quiz) {
      throw new BadRequestException("Готовый тест пока недоступен");
    }

    const quizData = this.readQuizData(quiz.questions);
    if (!quizData.questions.length) {
      throw new BadRequestException("В этом тесте пока нет вопросов");
    }

    if (dto.answers.length !== quizData.questions.length) {
      throw new BadRequestException("Нужно ответить на все вопросы теста");
    }

    const details = quizData.questions.map((question, index) => {
      const selectedIndex = dto.answers[index];
      const correctOption = question.options[question.correctIndex] ?? "";
      const selectedOption = question.options[selectedIndex] ?? "";
      const isCorrect = selectedIndex === question.correctIndex;

      return {
        questionId: question.id,
        question: question.question,
        selectedIndex,
        selectedOption,
        correctIndex: question.correctIndex,
        correctOption,
        isCorrect,
        explanation: question.explanation,
      };
    });

    const correctAnswers = details.filter((item) => item.isCorrect).length;
    const totalQuestions = quizData.questions.length;
    const score = Math.round((correctAnswers / totalQuestions) * 100);
    const rewards = await this.awardQuizRewards(userId, score);

    return {
      result: {
        score,
        correctAnswers,
        totalQuestions,
        answers: details,
      },
      rewards,
    };
  }

  private async awardQuizRewards(userId: string, score: number) {
    const [user, firstBadge, perfectBadge] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          organization: true,
          role: true,
          avatarUrl: true,
          bio: true,
          xp: true,
          level: true,
          onboardingDone: true,
        },
      }),
      this.prisma.badge.findFirst({
        where: { userId, name: FIRST_QUIZ_BADGE.name },
      }),
      this.prisma.badge.findFirst({
        where: { userId, name: PERFECT_QUIZ_BADGE.name },
      }),
    ]);

    if (!user) {
      throw new NotFoundException("Пользователь не найден");
    }

    const earnedBadges: RewardBadge[] = [];
    let xpAwarded = 0;

    if (!firstBadge) {
      earnedBadges.push(FIRST_QUIZ_BADGE);
      xpAwarded += FIRST_QUIZ_BADGE.xpReward;
    }

    if (score === 100 && !perfectBadge) {
      earnedBadges.push(PERFECT_QUIZ_BADGE);
      xpAwarded += PERFECT_QUIZ_BADGE.xpReward;
    }

    const updatedUser =
      xpAwarded > 0
        ? await this.prisma.$transaction(async (tx) => {
            const nextXp = user.xp + xpAwarded;
            const nextLevel = this.getLevelByXp(nextXp);

            const savedUser = await tx.user.update({
              where: { id: userId },
              data: {
                xp: nextXp,
                level: nextLevel,
              },
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                organization: true,
                role: true,
                avatarUrl: true,
                bio: true,
                xp: true,
                level: true,
                onboardingDone: true,
              },
            });

            for (const badge of earnedBadges) {
              const createdBadge = await tx.badge.create({
                data: {
                  userId,
                  name: badge.name,
                  description: badge.description,
                  icon: badge.icon,
                  xpReward: badge.xpReward,
                },
              });

              await tx.notification.create({
                data: {
                  userId,
                  type: NotificationType.BADGE_EARNED,
                  title: "Новый бейдж",
                  message: `Вы получили бейдж «${badge.name}»`,
                  metadata: {
                    badgeId: createdBadge.id,
                    icon: badge.icon,
                  },
                },
              });
            }

            return savedUser;
          })
        : user;

    return {
      xpAwarded,
      badges: earnedBadges,
      user: updatedUser,
    };
  }

  private async assertWorkspaceOwner(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException("Воркспейс не найден");
    }

    if (workspace.userId !== userId) {
      throw new ForbiddenException("Нет доступа");
    }

    return workspace;
  }

  private createEmptyQuiz(workspaceName: string): EmptyQuizData {
    return {
      title: `Тест: ${workspaceName}`,
      questions: [],
      generatedFrom: 0,
    };
  }

  private async resolveCurrentQuiz(
    workspaceId: string,
    quizzes: QuizRecord[],
  ): Promise<QuizRecord | null> {
    if (!quizzes.length) {
      return null;
    }

    const initial = quizzes[0];
    const current =
      (await this.prisma.quiz.findUnique({
        where: { id: initial.id },
      })) ?? initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.quizQueue.getJob(this.getJobId(workspaceId));
    const queuedState = queuedJob ? await queuedJob.getState() : null;
    const hasActiveQueueJob =
      queuedState === "waiting" ||
      queuedState === "active" ||
      queuedState === "delayed" ||
      queuedState === "prioritized";

    if (hasActiveQueueJob) {
      return current;
    }

    const refreshed =
      (await this.prisma.quiz.findUnique({
        where: { id: current.id },
      })) ?? current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (this.hasQuestions(refreshed.questions)) {
      return this.prisma.quiz.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = quizzes.find(
      (quiz) =>
        quiz.status === GenerationStatus.READY &&
        this.hasQuestions(quiz.questions),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.quiz.update({
      where: { id: current.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private hasQuestions(questions: Prisma.JsonValue) {
    const parsed = this.readQuizData(questions);
    return parsed.questions.length > 0;
  }

  private readQuizData(data: Prisma.JsonValue): EmptyQuizData {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { title: "Тест", questions: [], generatedFrom: 0 };
    }

    const payload = data as {
      title?: unknown;
      generatedFrom?: unknown;
      questions?: unknown;
    };

    const questions = Array.isArray(payload.questions)
      ? payload.questions
          .map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return null;
            }

            const question = item as {
              id?: unknown;
              question?: unknown;
              options?: unknown;
              correctIndex?: unknown;
              explanation?: unknown;
            };

            const options = Array.isArray(question.options)
              ? question.options.filter(
                  (option): option is string =>
                    typeof option === "string" && option.trim().length > 0,
                )
              : [];

            if (
              typeof question.question !== "string" ||
              !question.question.trim() ||
              options.length < 2 ||
              typeof question.correctIndex !== "number"
            ) {
              return null;
            }

            return {
              id:
                typeof question.id === "string" && question.id.trim()
                  ? question.id
                  : `q-${index + 1}`,
              question: question.question.trim(),
              options,
              correctIndex: question.correctIndex,
              explanation:
                typeof question.explanation === "string" && question.explanation.trim()
                  ? question.explanation.trim()
                  : "Подсказка к вопросу пока недоступна.",
            };
          })
          .filter((item): item is EmptyQuizQuestion => Boolean(item))
      : [];

    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : "Тест",
      questions,
      generatedFrom:
        typeof payload.generatedFrom === "number" ? payload.generatedFrom : 0,
    };
  }

  private getLevelByXp(xp: number) {
    if (xp >= 2000) return 5;
    if (xp >= 1000) return 4;
    if (xp >= 500) return 3;
    if (xp >= 200) return 2;
    return 1;
  }

  private getJobId(workspaceId: string) {
    return `quiz-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
