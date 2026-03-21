import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import {
  DocumentSource,
  GenerationStatus,
  NotificationType,
  type Prisma,
} from "@prisma/client";
import { Job } from "bullmq";
import { ChatGateway } from "../../chat/chat.gateway";
import { LlmService } from "../../llm/llm.service";
import { PrismaService } from "../../prisma/prisma.service";
import { QUEUE_NAMES } from "../../queue/queue.module";

interface QuizJobData {
  workspaceId: string;
  quizId: string;
  userId: string;
  variationKey: string;
  previousQuestions: Array<{
    question: string;
    correctOption: string;
  }>;
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
}

interface QuizQuestionPayload {
  id?: unknown;
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
}

interface QuizPayload {
  title?: unknown;
  questions?: unknown;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizData {
  title: string;
  questions: QuizQuestion[];
  generatedFrom: number;
}

@Processor(QUEUE_NAMES.QUIZ_GENERATION)
export class QuizProcessor extends WorkerHost {
  private readonly logger = new Logger(QuizProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<QuizJobData>) {
    const { workspaceId, quizId, userId, variationKey, previousQuestions } = job.data;
    this.logger.log(`Генерация quiz ${quizId} для воркспейса ${workspaceId}`);

    await this.prisma.quiz.update({
      where: { id: quizId },
      data: { status: GenerationStatus.GENERATING },
    });

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          name: true,
          userId: true,
          documents: {
            where: { status: "READY" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              originalName: true,
              sourceType: true,
              extractedText: true,
            },
          },
        },
      });

      if (!workspace) {
        throw new Error("Воркспейс не найден");
      }

      if (!workspace.documents.length) {
        throw new Error("Нет готовых материалов для теста");
      }

      const quiz = await this.generateQuiz(
        workspace.name,
        workspace.documents,
        variationKey,
        previousQuestions,
      );

      const updated = await this.prisma.quiz.update({
        where: { id: quizId },
        data: {
          title: quiz.title,
          status: GenerationStatus.READY,
          questions: quiz as unknown as Prisma.InputJsonValue,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Тест готов",
          message: `Воркспейс «${workspace.name}» получил новый набор вопросов`,
          metadata: {
            workspaceId,
            quizId,
            feature: "quiz",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Quiz ${updated.id} готов`);
    } catch (error) {
      this.logger.error(`Ошибка генерации quiz ${quizId}:`, error);

      await this.prisma.quiz.update({
        where: { id: quizId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации теста",
          message: "Не удалось собрать вопросы по материалам воркспейса",
          metadata: {
            workspaceId,
            quizId,
            feature: "quiz",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateQuiz(
    workspaceName: string,
    documents: SourceDocument[],
    variationKey: string,
    previousQuestions: Array<{ question: string; correctOption: string }>,
  ): Promise<QuizData> {
    const prompt = this.buildPrompt(
      workspaceName,
      documents,
      variationKey,
      previousQuestions,
    );

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: previousQuestions.length ? 0.65 : 0.4,
        maxTokens: 2600,
      });
      const parsed = this.extractJson(raw);
      return this.normalizeQuiz(parsed, workspaceName, documents, variationKey);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный quiz JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackQuiz(workspaceName, documents, variationKey);
    }
  }

  private buildPrompt(
    workspaceName: string,
    documents: SourceDocument[],
    variationKey: string,
    previousQuestions: Array<{ question: string; correctOption: string }>,
  ) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2600);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          excerpt || "Текст недоступен",
        ].join("\n");
      })
      .join("\n\n");

    const previousBlock = previousQuestions.length
      ? [
          "Это пересборка теста.",
          "Нельзя повторять дословно или почти дословно прежние вопросы, правильные ответы и их порядок.",
          "Сделай новый набор вопросов по тем же материалам, но с другими углами проверки: факты, понимание, выводы, сравнение и применение.",
          "Предыдущие вопросы и правильные ответы:",
          ...previousQuestions.slice(0, 10).map(
            (item, index) =>
              `${index + 1}. Вопрос: ${item.question}\n   Правильный ответ: ${item.correctOption}`,
          ),
        ].join("\n")
      : "Это первая сборка теста по материалам.";

    return [
      "Собери тест на русском языке по материалам воркспейса.",
      "Нужно ровно 10 вопросов с 4 вариантами ответа.",
      "У каждого вопроса должен быть один правильный вариант и короткое объяснение.",
      "Формулировки делай ясными и без двусмысленности.",
      "Не выдумывай факты вне контекста.",
      "Сделай вопросы разнообразными по типу проверки: факты, понимание, выводы, сравнение, применение.",
      previousBlock,
      `Ключ вариативности: ${variationKey}`,
      "Верни только валидный JSON без markdown:",
      "{",
      '  "title": "Короткое название теста",',
      '  "questions": [',
      "    {",
      '      "id": "q-1",',
      '      "question": "Текст вопроса",',
      '      "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],',
      '      "correctIndex": 0,',
      '      "explanation": "Почему ответ правильный"',
      "    }",
      "  ]",
      "}",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): QuizPayload {
    const fenced = raw
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("JSON не найден в ответе модели");
    }

    return JSON.parse(fenced.slice(start, end + 1)) as QuizPayload;
  }

  private normalizeQuiz(
    payload: QuizPayload,
    workspaceName: string,
    documents: SourceDocument[],
    variationKey: string,
  ): QuizData {
    const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
    const normalized = rawQuestions
      .map((question, index) => this.normalizeQuestion(question, index))
      .filter((question): question is QuizQuestion => Boolean(question));

    if (normalized.length < 6) {
      throw new Error("В ответе модели недостаточно валидных вопросов");
    }

    const questions = this.fillQuestions(
      normalized,
      workspaceName,
      documents,
      variationKey,
    ).slice(0, 10);

    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : `Тест: ${workspaceName}`,
      questions,
      generatedFrom: documents.length,
    };
  }

  private normalizeQuestion(question: unknown, index: number): QuizQuestion | null {
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      return null;
    }

    const payload = question as QuizQuestionPayload;
    const prompt =
      typeof payload.question === "string" ? payload.question.replace(/\s+/g, " ").trim() : "";
    const rawOptions = Array.isArray(payload.options)
      ? payload.options.filter(
          (option): option is string => typeof option === "string" && option.trim().length > 0,
        )
      : [];

    if (!prompt || rawOptions.length < 2) {
      return null;
    }

    const options = [...new Set(rawOptions.map((option) => option.replace(/\s+/g, " ").trim()))];
    const normalizedOptions = this.ensureOptionCount(options, index);
    const safeIndex =
      typeof payload.correctIndex === "number" &&
      payload.correctIndex >= 0 &&
      payload.correctIndex < normalizedOptions.length
        ? payload.correctIndex
        : 0;

    return {
      id:
        typeof payload.id === "string" && payload.id.trim()
          ? payload.id.trim()
          : `q-${index + 1}`,
      question: prompt,
      options: normalizedOptions,
      correctIndex: safeIndex,
      explanation:
        typeof payload.explanation === "string" && payload.explanation.trim()
          ? payload.explanation.replace(/\s+/g, " ").trim()
          : "Правильный вариант следует из исходных материалов.",
    };
  }

  private ensureOptionCount(options: string[], seed: number) {
    const result = [...options];
    const distractors = [
      "Материалы этого не подтверждают",
      "Источники описывают другую тему",
      "В документах нет такого вывода",
      "Этот вариант не опирается на контекст",
    ];

    let cursor = seed;
    while (result.length < 4) {
      result.push(distractors[cursor % distractors.length]);
      cursor += 1;
    }

    return result.slice(0, 4);
  }

  private fillQuestions(
    questions: QuizQuestion[],
    workspaceName: string,
    documents: SourceDocument[],
    variationKey: string,
  ) {
    if (questions.length >= 10) {
      return questions.slice(0, 10).map((question, index) => ({
        ...question,
        id: `q-${index + 1}`,
      }));
    }

    const fallback = this.createFallbackQuiz(workspaceName, documents, variationKey).questions;
    const result = [...questions];
    let index = 0;

    while (result.length < 10) {
      result.push(fallback[index % fallback.length]);
      index += 1;
    }

    return result.slice(0, 10).map((question, questionIndex) => ({
      ...question,
      id: `q-${questionIndex + 1}`,
    }));
  }

  private createFallbackQuiz(
    workspaceName: string,
    documents: SourceDocument[],
    variationKey: string,
  ): QuizData {
    const summaries = documents.map((document) => ({
      originalName: document.originalName,
      summary: this.extractSummary(document.extractedText),
    }));
    const rotationSeed = variationKey
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);

    const templates = [
      "Какой тезис лучше всего отражает содержание источника?",
      "Что можно считать одним из ключевых выводов материалов?",
      "Какой вариант соответствует фактам из воркспейса?",
      "Что действительно упоминается в источниках по теме?",
      "Какой ответ лучше всего передаёт суть одного из документов?",
    ];

    const questions = Array.from({ length: 10 }, (_, index) => {
      const shiftedIndex = index + rotationSeed;
      const source = summaries[shiftedIndex % summaries.length];
      const correctText = source.summary.slice(0, 110);
      const distractors = [
        "Материалы посвящены только внешней погодной аналитике",
        "Источники описывают исключительно настройку локального принтера",
        "Документы говорят только о спортивной статистике без связи с проектом",
      ];
      const correctIndex = shiftedIndex % 4;
      const options = [...distractors];
      options.splice(correctIndex, 0, correctText);

      return {
        id: `q-${index + 1}`,
        question: `${templates[shiftedIndex % templates.length]} «${source.originalName}»`,
        options,
        correctIndex,
        explanation: `Правильный ответ опирается на содержание источника «${source.originalName}».`,
      };
    });

    return {
      title: `Тест: ${workspaceName}`,
      questions,
      generatedFrom: documents.length,
    };
  }

  private extractSummary(text?: string | null) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return "Источник обработан, но в нём недостаточно текста для подробного пересказа.";
    }

    return clean.slice(0, 140);
  }

  private getSourceTypeLabel(sourceType: DocumentSource) {
    switch (sourceType) {
      case DocumentSource.AUDIO:
        return "аудио";
      case DocumentSource.VIDEO:
        return "видео";
      default:
        return "документ";
    }
  }
}
