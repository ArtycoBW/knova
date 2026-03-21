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
import {
  PodcastLength,
  PodcastTone,
} from "../dto/generate-podcast.dto";

interface PodcastJobData {
  workspaceId: string;
  podcastId: string;
  userId: string;
  settings: {
    tone: PodcastTone;
    length: PodcastLength;
  };
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
}

interface PodcastScriptLinePayload {
  speaker?: unknown;
  text?: unknown;
}

interface PodcastScriptPayload {
  title?: unknown;
  lines?: PodcastScriptLinePayload[] | unknown;
}

interface PodcastScriptLine {
  speaker: "A" | "B";
  text: string;
}

interface PodcastScriptData {
  title: string;
  lines: PodcastScriptLine[];
  generatedFrom: number;
}

@Processor(QUEUE_NAMES.PODCAST_GENERATION)
export class PodcastProcessor extends WorkerHost {
  private readonly logger = new Logger(PodcastProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<PodcastJobData>) {
    const { workspaceId, podcastId, userId, settings } = job.data;
    this.logger.log(`Генерация podcast ${podcastId} для воркспейса ${workspaceId}`);

    await this.prisma.podcast.update({
      where: { id: podcastId },
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
        throw new Error("Нет готовых материалов для подкаста");
      }

      const script = await this.generateScript(
        workspace.name,
        workspace.documents,
        settings,
      );

      const updated = await this.prisma.podcast.update({
        where: { id: podcastId },
        data: {
          title: script.title,
          status: GenerationStatus.READY,
          script: script as unknown as Prisma.InputJsonValue,
          settings: settings as unknown as Prisma.InputJsonValue,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Подкаст готов",
          message: `Сценарий подкаста для воркспейса «${workspace.name}» собран`,
          metadata: {
            workspaceId,
            podcastId,
            feature: "podcast",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Podcast ${updated.id} готов`);
    } catch (error) {
      this.logger.error(`Ошибка генерации podcast ${podcastId}:`, error);

      await this.prisma.podcast.update({
        where: { id: podcastId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации подкаста",
          message: "Не удалось собрать сценарий диалога по выбранным материалам",
          metadata: {
            workspaceId,
            podcastId,
            feature: "podcast",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateScript(
    workspaceName: string,
    documents: SourceDocument[],
    settings: { tone: PodcastTone; length: PodcastLength },
  ): Promise<PodcastScriptData> {
    const prompt = this.buildPrompt(workspaceName, documents, settings);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: settings.tone === PodcastTone.POPULAR ? 0.7 : 0.35,
        maxTokens: this.getMaxTokens(settings.length),
      });
      const parsed = this.extractJson(raw);
      return this.normalizeScript(parsed, workspaceName, documents);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный podcast JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackScript(workspaceName, documents, settings);
    }
  }

  private buildPrompt(
    workspaceName: string,
    documents: SourceDocument[],
    settings: { tone: PodcastTone; length: PodcastLength },
  ) {
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
      "Создай диалог подкаста на русском языке на основе материалов воркспейса.",
      "Ведущий А ведет разговор, задает вопросы, связывает темы.",
      "Ведущий Б отвечает как эксперт, объясняет выводы и нюансы.",
      `Тональность: ${settings.tone}`,
      `Примерная длина: ${settings.length}`,
      "Требования:",
      "- только факты и выводы из контекста, без выдуманных деталей",
      "- реплики живые, но деловые и чистые по стилю",
      "- 2 ведущих должны чередоваться",
      "- каждая реплика 1-3 предложения",
      "- без markdown и пояснений вне JSON",
      "Верни только валидный JSON:",
      '{',
      '  "title": "Короткий заголовок выпуска",',
      '  "lines": [',
      '    { "speaker": "A", "text": "..." },',
      '    { "speaker": "B", "text": "..." }',
      "  ]",
      "}",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): PodcastScriptPayload {
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

    return JSON.parse(fenced.slice(start, end + 1)) as PodcastScriptPayload;
  }

  private normalizeScript(
    payload: PodcastScriptPayload,
    workspaceName: string,
    documents: SourceDocument[],
  ): PodcastScriptData {
    const lines: PodcastScriptLine[] = (Array.isArray(payload.lines) ? payload.lines : [])
      .map((line, index) => {
        const speaker: "A" | "B" = line?.speaker === "B" ? "B" : "A";
        const text = this.normalizeText(line?.text, "");
        return {
          speaker: index === 0 ? "A" : speaker,
          text,
        };
      })
      .filter((line) => line.text)
      .slice(0, 28);

    if (!lines.length) {
      throw new Error("В ответе модели нет реплик");
    }

    return {
      title: this.normalizeText(payload.title, `Подкаст: ${workspaceName}`),
      lines: this.ensureAlternating(lines),
      generatedFrom: documents.length,
    };
  }

  private createFallbackScript(
    workspaceName: string,
    documents: SourceDocument[],
    settings: { tone: PodcastTone; length: PodcastLength },
  ): PodcastScriptData {
    const summaries = documents
      .slice(0, this.getFallbackSourceCount(settings.length))
      .map((document) => ({
        name: document.originalName,
        summary: this.extractSummary(document.extractedText),
      }));

    const lines: PodcastScriptLine[] = [];
    const intro =
      settings.tone === PodcastTone.SCIENTIFIC
        ? `Сегодня разбираем материалы воркспейса ${workspaceName} и выделим ключевые выводы.`
        : `Сегодня коротко и живо пройдемся по материалам воркспейса ${workspaceName} и соберем главное.`;
    const introAnswer =
      settings.tone === PodcastTone.SCIENTIFIC
        ? "Сфокусируемся на сути, структуре и практических выводах без лишних деталей."
        : "Сделаем это понятным языком и быстро соберем главное по каждому источнику.";

    lines.push({ speaker: "A", text: intro });
    lines.push({ speaker: "B", text: introAnswer });

    summaries.forEach((item, index) => {
      lines.push({
        speaker: "A",
        text: `Что важно в источнике ${index + 1} — ${item.name}?`,
      });
      lines.push({
        speaker: "B",
        text: item.summary,
      });
    });

    lines.push({
      speaker: "A",
      text: "Какой общий вывод можно взять в работу по этим материалам?",
    });
    lines.push({
      speaker: "B",
      text:
        settings.tone === PodcastTone.SCIENTIFIC
          ? "Материалы стоит использовать как единую базу знаний: они хорошо раскрывают предметную область, структуру задач и практические шаги."
          : "Если собрать эти материалы вместе, получается понятная и полезная база, от которой уже удобно идти к решениям и действиям.",
    });

    return {
      title: `Подкаст: ${workspaceName}`,
      lines,
      generatedFrom: documents.length,
    };
  }

  private normalizeText(value: unknown, fallback: string) {
    if (typeof value !== "string") {
      return fallback;
    }

    const clean = value.replace(/\s+/g, " ").trim();
    return clean || fallback;
  }

  private ensureAlternating(lines: PodcastScriptLine[]) {
    return lines.map((line, index) => ({
      speaker: (index % 2 === 0 ? "A" : "B") as "A" | "B",
      text: line.text,
    }));
  }

  private extractSummary(text?: string | null) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return "Источник уже обработан и готов, но текста недостаточно для подробного пересказа.";
    }

    return clean.slice(0, 260);
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

  private getMaxTokens(length: PodcastLength) {
    switch (length) {
      case PodcastLength.SHORT:
        return 1200;
      case PodcastLength.LONG:
        return 2800;
      default:
        return 1900;
    }
  }

  private getFallbackSourceCount(length: PodcastLength) {
    switch (length) {
      case PodcastLength.SHORT:
        return 2;
      case PodcastLength.LONG:
        return 5;
      default:
        return 3;
    }
  }
}
