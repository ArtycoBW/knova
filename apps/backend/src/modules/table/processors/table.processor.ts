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

interface TableJobData {
  workspaceId: string;
  tableId: string;
  userId: string;
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
  size: number;
  pageCount: number | null;
  duration: number | null;
}

interface TablePayload {
  title?: unknown;
  headers?: unknown;
  rows?: unknown;
  summary?: unknown;
}

interface TableData {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  summary: string;
  generatedFrom: number;
}

@Processor(QUEUE_NAMES.TABLE_EXTRACTION)
export class TableProcessor extends WorkerHost {
  private readonly logger = new Logger(TableProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<TableJobData>) {
    const { workspaceId, tableId, userId } = job.data;
    this.logger.log(`Генерация table ${tableId} для воркспейса ${workspaceId}`);

    await this.prisma.dataExtract.update({
      where: { id: tableId },
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
              size: true,
              pageCount: true,
              duration: true,
            },
          },
        },
      });

      if (!workspace) {
        throw new Error("Воркспейс не найден");
      }

      if (!workspace.documents.length) {
        throw new Error("Нет готовых материалов для таблицы");
      }

      const table = await this.generateTable(workspace.name, workspace.documents);

      const updated = await this.prisma.dataExtract.update({
        where: { id: tableId },
        data: {
          title: table.title,
          status: GenerationStatus.READY,
          tableData: table as unknown as Prisma.InputJsonValue,
          csvPath: null,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Таблица данных готова",
          message: `Структурированная таблица для воркспейса «${workspace.name}» собрана`,
          metadata: {
            workspaceId,
            tableId,
            feature: "table",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Table ${updated.id} готова`);
    } catch (error) {
      this.logger.error(`Ошибка генерации table ${tableId}:`, error);

      await this.prisma.dataExtract.update({
        where: { id: tableId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации таблицы",
          message: "Не удалось извлечь структурированные данные из материалов воркспейса",
          metadata: {
            workspaceId,
            tableId,
            feature: "table",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateTable(
    workspaceName: string,
    documents: SourceDocument[],
  ): Promise<TableData> {
    const prompt = this.buildPrompt(workspaceName, documents);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: 0.2,
        maxTokens: 2200,
      });
      const parsed = this.extractJson(raw);
      return this.normalizeTable(parsed, workspaceName, documents);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный table JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackTable(workspaceName, documents);
    }
  }

  private buildPrompt(workspaceName: string, documents: SourceDocument[]) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2800);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          excerpt || "Текст недоступен",
        ].join("\n");
      })
      .join("\n\n");

    return [
      "Найди структурированные данные в тексте и верни только валидный JSON без markdown.",
      "Нужна компактная таблица, которую можно показать пользователю в интерфейсе.",
      "Формат ответа:",
      '{ "title": "...", "headers": ["..."], "rows": [["..."]], "summary": "..." }',
      "Если явных структурированных данных нет, всё равно попробуй собрать полезную сводную таблицу по фактам, этапам, метрикам, срокам, ролям, суммам или статусам.",
      "Ограничения:",
      "- от 3 до 8 колонок",
      "- до 12 строк",
      "- заголовки на русском",
      "- значения короткие и читаемые",
      "- без выдуманных данных вне контекста",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): TablePayload {
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

    return JSON.parse(fenced.slice(start, end + 1)) as TablePayload;
  }

  private normalizeTable(
    payload: TablePayload,
    workspaceName: string,
    documents: SourceDocument[],
  ): TableData {
    const headers = Array.isArray(payload.headers)
      ? payload.headers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      : [];

    const rows = Array.isArray(payload.rows)
      ? payload.rows
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row) =>
            row.slice(0, Math.max(headers.length, 1)).map((cell) => {
              if (typeof cell === "number") {
                return Number.isFinite(cell) ? cell : String(cell);
              }

              if (typeof cell === "string") {
                return cell.replace(/\s+/g, " ").trim();
              }

              return "";
            }),
          )
          .filter((row) => row.some((cell) => `${cell}`.trim().length > 0))
      : [];

    if (!headers.length || !rows.length) {
      return this.createFallbackTable(workspaceName, documents);
    }

    const normalizedRows = rows
      .map((row) => {
        const next = row.slice(0, headers.length);
        while (next.length < headers.length) {
          next.push("");
        }
        return next;
      })
      .slice(0, 12);

    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : `Таблица: ${workspaceName}`,
      headers: headers.slice(0, 8),
      rows: normalizedRows,
      summary:
        typeof payload.summary === "string" && payload.summary.trim()
          ? payload.summary.trim()
          : `Сводная таблица собрана по ${documents.length} источникам воркспейса.`,
      generatedFrom: documents.length,
    };
  }

  private createFallbackTable(
    workspaceName: string,
    documents: SourceDocument[],
  ): TableData {
    return {
      title: `Таблица: ${workspaceName}`,
      headers: [
        "Источник",
        "Тип",
        "Размер",
        "Страницы / длительность",
        "Краткое содержание",
      ],
      rows: documents.slice(0, 12).map((document) => [
        document.originalName,
        this.getSourceTypeLabel(document.sourceType),
        `${Math.max(1, Math.round(document.size / 1024))} КБ`,
        document.pageCount
          ? `${document.pageCount} стр.`
          : document.duration
            ? `${Math.max(1, Math.round(document.duration / 60))} мин`
            : "—",
        this.extractSummary(document.extractedText),
      ]),
      summary:
        "LLM не нашла явную табличную структуру, поэтому показана полезная сводка по готовым источникам воркспейса.",
      generatedFrom: documents.length,
    };
  }

  private extractSummary(text?: string | null) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return "Источник обработан, но текста пока недостаточно для краткого резюме.";
    }

    return clean.slice(0, 120);
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
