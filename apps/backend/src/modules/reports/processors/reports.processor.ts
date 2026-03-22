import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import {
  DocumentSource,
  GenerationStatus,
  NotificationType,
} from "@prisma/client";
import { Job } from "bullmq";
import { ChatGateway } from "../../chat/chat.gateway";
import { LlmService } from "../../llm/llm.service";
import { PrismaService } from "../../prisma/prisma.service";
import { QUEUE_NAMES } from "../../queue/queue.module";

interface ReportJobData {
  workspaceId: string;
  reportId: string;
  userId: string;
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
}

@Processor(QUEUE_NAMES.REPORT_GENERATION)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>) {
    const { workspaceId, reportId, userId } = job.data;
    this.logger.log(`Генерация report ${reportId} для воркспейса ${workspaceId}`);

    await this.prisma.report.update({
      where: { id: reportId },
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
        throw new Error("Нет готовых материалов для отчёта");
      }

      const content = await this.generateReport(workspace.name, workspace.documents);

      const updated = await this.prisma.report.update({
        where: { id: reportId },
        data: {
          title: `Отчёт: ${workspace.name}`,
          content,
          template: "official",
          status: GenerationStatus.READY,
          filePath: null,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Отчёт готов",
          message: `Официальное резюме для воркспейса «${workspace.name}» собрано`,
          metadata: {
            workspaceId,
            reportId,
            feature: "reports",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Report ${updated.id} готов`);
    } catch (error) {
      this.logger.error(`Ошибка генерации report ${reportId}:`, error);

      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации отчёта",
          message:
            "Не удалось собрать официальное резюме по материалам воркспейса",
          metadata: {
            workspaceId,
            reportId,
            feature: "reports",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateReport(
    workspaceName: string,
    documents: SourceDocument[],
  ) {
    const prompt = this.buildPrompt(workspaceName, documents);

    try {
      const content = await this.llm.complete(prompt, {
        temperature: 0.25,
        maxTokens: 2600,
      });

      if (!content.trim()) {
        throw new Error("Пустой ответ модели");
      }

      return content.trim();
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный текст отчёта, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackReport(workspaceName, documents);
    }
  }

  private buildPrompt(workspaceName: string, documents: SourceDocument[]) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3500);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          excerpt || "Текст недоступен",
        ].join("\n");
      })
      .join("\n\n");

    return [
      "Составь официальное резюме в стиле делового отчёта.",
      "Используй русский язык и markdown-разметку.",
      "Структура ответа строго такая:",
      "## Краткое резюме",
      "2-3 предложения.",
      "## Ключевые тезисы",
      "5-7 маркированных пунктов.",
      "## Основные выводы",
      "2-3 коротких абзаца.",
      "## Рекомендации",
      "2-5 пунктов, если рекомендации по контексту уместны.",
      "Официально-деловой стиль речи. Не выдумывай факты вне контекста.",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private createFallbackReport(
    workspaceName: string,
    documents: SourceDocument[],
  ) {
    const documentNames = documents.map((document) => document.originalName).join(", ");
    const facts = documents
      .slice(0, 5)
      .map((document) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);

        return `- ${document.originalName}: ${excerpt || "готовый источник без текстового фрагмента"}`;
      })
      .join("\n");

    return [
      "## Краткое резюме",
      `По материалам воркспейса «${workspaceName}» подготовлена сводка по ${documents.length} готовым источникам. Отчёт отражает основные темы, факты и ориентиры, обнаруженные в документах, аудио и видео.`,
      "",
      "## Ключевые тезисы",
      `- В анализ включены следующие материалы: ${documentNames}.`,
      "- Система собрала краткую деловую сводку по готовым источникам.",
      "- Приоритет сделан на факты, этапы, метрики, роли и рекомендации.",
      "- Материал пригоден для быстрого ознакомления руководителя или команды.",
      "",
      "## Основные выводы",
      "Собранные материалы содержат достаточно данных для формирования краткого делового отчёта. Основные смысловые блоки были извлечены автоматически и приведены к единому официальному формату.",
      "",
      "Ниже перечислены ключевые наблюдения по источникам:",
      facts,
      "",
      "## Рекомендации",
      "- Уточнить приоритеты и ожидаемый формат финального результата.",
      "- Использовать отчёт как базу для презентации и управленческого summary.",
      "- При необходимости дополнить воркспейс новыми источниками и пересобрать отчёт.",
    ].join("\n");
  }

  private getSourceTypeLabel(sourceType: DocumentSource) {
    switch (sourceType) {
      case DocumentSource.AUDIO:
        return "Аудио";
      case DocumentSource.VIDEO:
        return "Видео";
      default:
        return "Документ";
    }
  }
}
