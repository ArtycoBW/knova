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

type SupportedChartType = "bar" | "line" | "pie" | "doughnut";

interface InfographicJobData {
  workspaceId: string;
  infographicId: string;
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

interface ChartDatasetPayload {
  label?: unknown;
  data?: unknown;
}

interface ChartDataPayload {
  labels?: unknown;
  datasets?: unknown;
}

interface InfographicPayload {
  title?: unknown;
  type?: unknown;
  summary?: unknown;
  data?: unknown;
}

interface NormalizedChartData {
  title: string;
  type: SupportedChartType;
  data: {
    labels: string[];
    datasets: NormalizedDataset[];
  };
  summary: string;
  generatedFrom: number;
}

interface NormalizedDataset {
  label: string;
  data: number[];
  backgroundColor: string[];
  borderColor: string[];
  borderWidth: number;
  fill: boolean;
  tension: number;
}

@Processor(QUEUE_NAMES.INFOGRAPHIC_GENERATION)
export class InfographicProcessor extends WorkerHost {
  private readonly logger = new Logger(InfographicProcessor.name);
  private readonly palette = [
    "#22c55e",
    "#06b6d4",
    "#8b5cf6",
    "#f59e0b",
    "#ef4444",
    "#10b981",
    "#3b82f6",
    "#ec4899",
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<InfographicJobData>) {
    const { workspaceId, infographicId, userId } = job.data;
    this.logger.log(
      `Генерация infographic ${infographicId} для воркспейса ${workspaceId}`,
    );

    await this.prisma.infographic.update({
      where: { id: infographicId },
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
        throw new Error("Нет готовых материалов для инфографики");
      }

      const infographic = await this.generateInfographic(
        workspace.name,
        workspace.documents,
      );

      const updated = await this.prisma.infographic.update({
        where: { id: infographicId },
        data: {
          title: infographic.title,
          chartType: infographic.type,
          chartData: infographic as unknown as Prisma.InputJsonValue,
          status: GenerationStatus.READY,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Инфографика готова",
          message: `Воркспейс «${workspace.name}» получил новую инфографику`,
          metadata: {
            workspaceId,
            infographicId,
            feature: "infographic",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Infographic ${updated.id} готова`);
    } catch (error) {
      this.logger.error(
        `Ошибка генерации infographic ${infographicId}:`,
        error,
      );

      await this.prisma.infographic.update({
        where: { id: infographicId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации инфографики",
          message: "Не удалось собрать визуализацию по материалам воркспейса",
          metadata: {
            workspaceId,
            infographicId,
            feature: "infographic",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateInfographic(
    workspaceName: string,
    documents: SourceDocument[],
  ): Promise<NormalizedChartData> {
    const prompt = this.buildPrompt(workspaceName, documents);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: 0.45,
        maxTokens: 2200,
      });
      const parsed = this.extractJson(raw);
      return this.normalizeInfographic(parsed, workspaceName, documents);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный infographic JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackInfographic(workspaceName, documents);
    }
  }

  private buildPrompt(workspaceName: string, documents: SourceDocument[]) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1800);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          `Размер: ${document.size} байт`,
          document.pageCount ? `Страницы: ${document.pageCount}` : null,
          document.duration ? `Длительность: ${document.duration} сек.` : null,
          excerpt || "Текст недоступен",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    return [
      "Собери инфографику по материалам воркспейса на русском языке.",
      "Нужно вернуть только валидный JSON без markdown.",
      "Выбери один тип графика: bar, line, pie или doughnut.",
      "Используй только числовые данные, которые можно достоверно извлечь из контекста.",
      "Если явных чисел мало, можно использовать метаданные источников: размер, страницы, длительность.",
      "JSON должен быть строго такого вида:",
      "{",
      '  "title": "Короткий заголовок",',
      '  "type": "bar",',
      '  "summary": "Краткое объяснение, что показывает график",',
      '  "data": {',
      '    "labels": ["Метка 1", "Метка 2"],',
      '    "datasets": [',
      "      {",
      '        "label": "Серия 1",',
      '        "data": [10, 20]',
      "      }",
      "    ]",
      "  }",
      "}",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): InfographicPayload {
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

    return JSON.parse(fenced.slice(start, end + 1)) as InfographicPayload;
  }

  private normalizeInfographic(
    payload: InfographicPayload,
    workspaceName: string,
    documents: SourceDocument[],
  ): NormalizedChartData {
    const chartType = this.normalizeChartType(payload.type);
    const rawData =
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as ChartDataPayload)
        : null;
    const labels = Array.isArray(rawData?.labels)
      ? rawData.labels
          .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
          .map((label) => label.trim())
          .slice(0, 8)
      : [];
    const datasets = Array.isArray(rawData?.datasets)
      ? rawData.datasets
          .map((dataset, index) => this.normalizeDataset(dataset, labels.length, index))
          .filter((dataset): dataset is NormalizedDataset => dataset !== null)
      : [];

    if (!labels.length || !datasets.length) {
      throw new Error("Недостаточно данных для построения инфографики");
    }

    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : `Инфографика: ${workspaceName}`,
      type: chartType,
      summary:
        typeof payload.summary === "string" && payload.summary.trim()
          ? payload.summary.replace(/\s+/g, " ").trim()
          : "Инфографика собрана по числовым данным и метаданным готовых источников.",
      data: {
        labels,
        datasets,
      },
      generatedFrom: documents.length,
    };
  }

  private normalizeDataset(
    dataset: unknown,
    labelCount: number,
    index: number,
  ): NormalizedDataset | null {
    if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
      return null;
    }

    const payload = dataset as ChartDatasetPayload;
    const rawData = Array.isArray(payload.data)
      ? payload.data
          .map((value) => this.toNumber(value))
          .filter((value): value is number => Number.isFinite(value))
          .slice(0, labelCount)
      : [];

    if (!rawData.length || rawData.length !== labelCount) {
      return null;
    }

    const colors = Array.from({ length: labelCount }, (_, colorIndex) =>
      this.palette[(index + colorIndex) % this.palette.length],
    );

    return {
      label:
        typeof payload.label === "string" && payload.label.trim()
          ? payload.label.trim()
          : `Серия ${index + 1}`,
      data: rawData,
      backgroundColor: colors.map((color) => `${color}CC`),
      borderColor: colors,
      borderWidth: 2,
      fill: false,
      tension: 0.35,
    };
  }

  private createFallbackInfographic(
    workspaceName: string,
    documents: SourceDocument[],
  ): NormalizedChartData {
    const labels = documents.slice(0, 8).map((document) =>
      document.originalName.length > 28
        ? `${document.originalName.slice(0, 28)}...`
        : document.originalName,
    );
    const values = documents.slice(0, 8).map((document) => {
      if (document.pageCount && document.pageCount > 0) {
        return document.pageCount;
      }

      if (document.duration && document.duration > 0) {
        return Math.max(1, Math.round(document.duration / 60));
      }

      return Math.max(1, Math.round(document.size / 1024));
    });

    return {
      title: `Инфографика: ${workspaceName}`,
      type: "bar",
      summary:
        "Явных числовых рядов оказалось мало, поэтому график собран по метаданным источников: страницам, длительности или размеру файлов.",
      data: {
        labels,
        datasets: [
          {
            label: "Сравнение источников",
            data: values,
            backgroundColor: labels.map(
              (_, index) => `${this.palette[index % this.palette.length]}CC`,
            ),
            borderColor: labels.map(
              (_, index) => this.palette[index % this.palette.length],
            ),
            borderWidth: 2,
            fill: false,
            tension: 0.35,
          },
        ],
      },
      generatedFrom: documents.length,
    };
  }

  private normalizeChartType(type: unknown): SupportedChartType {
    if (
      type === "bar" ||
      type === "line" ||
      type === "pie" ||
      type === "doughnut"
    ) {
      return type;
    }

    return "bar";
  }

  private toNumber(value: unknown) {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(normalized) ? normalized : NaN;
    }

    return NaN;
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
