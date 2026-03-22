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

interface PresentationJobData {
  workspaceId: string;
  presentationId: string;
  userId: string;
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
}

interface PresentationPayload {
  title?: unknown;
  subtitle?: unknown;
  slides?: unknown;
}

interface SlideItem {
  title: string;
  bullets: string[];
  note?: string;
}

interface SlidesData {
  title: string;
  subtitle: string;
  generatedFrom: number;
  slides: SlideItem[];
}

@Processor(QUEUE_NAMES.PRESENTATION_GENERATION)
export class PresentationProcessor extends WorkerHost {
  private readonly logger = new Logger(PresentationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<PresentationJobData>) {
    const { workspaceId, presentationId, userId } = job.data;
    this.logger.log(
      `Генерация presentation ${presentationId} для воркспейса ${workspaceId}`,
    );

    await this.prisma.presentation.update({
      where: { id: presentationId },
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
        throw new Error("Нет готовых материалов для презентации");
      }

      const slides = await this.generateSlides(workspace.name, workspace.documents);

      const updated = await this.prisma.presentation.update({
        where: { id: presentationId },
        data: {
          title: slides.title,
          slides: slides as unknown as Prisma.InputJsonValue,
          status: GenerationStatus.READY,
          filePath: null,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Презентация готова",
          message: `Структура презентации для воркспейса «${workspace.name}» собрана`,
          metadata: {
            workspaceId,
            presentationId,
            feature: "presentation",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Presentation ${updated.id} готова`);
    } catch (error) {
      this.logger.error(
        `Ошибка генерации presentation ${presentationId}:`,
        error,
      );

      await this.prisma.presentation.update({
        where: { id: presentationId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации презентации",
          message:
            "Не удалось собрать структуру слайдов по материалам воркспейса",
          metadata: {
            workspaceId,
            presentationId,
            feature: "presentation",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateSlides(
    workspaceName: string,
    documents: SourceDocument[],
  ): Promise<SlidesData> {
    const prompt = this.buildPrompt(workspaceName, documents);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: 0.25,
        maxTokens: 2600,
      });
      const parsed = this.extractJson(raw);
      return this.normalizeSlides(parsed, workspaceName, documents);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный presentation JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackSlides(workspaceName, documents);
    }
  }

  private buildPrompt(workspaceName: string, documents: SourceDocument[]) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = this.prepareContext(document.extractedText);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          excerpt || "Текст недоступен",
        ].join("\n");
      })
      .join("\n\n");

    return [
      "Собери структуру содержательной презентации на русском языке.",
      "Верни только валидный JSON без markdown и пояснений.",
      "Презентация должна подходить для краткого выступления или защиты проекта.",
      "Не включай OCR-мусор, номера страниц, случайные символы и длинные цитаты.",
      "Не повторяй название файла в каждом тезисе.",
      "Каждый тезис должен быть коротким, понятным и пригодным для одного слайда.",
      "Если контекст шумный, лучше дать аккуратное обобщение, чем копировать текст как есть.",
      "Формат ответа:",
      '{ "title": "...", "subtitle": "...", "slides": [{ "title": "...", "bullets": ["...", "..."], "note": "..." }] }',
      "Требования:",
      "- от 5 до 7 слайдов",
      "- каждый слайд содержит 3-5 тезисов",
      "- каждый тезис короче 120 символов",
      "- логика структуры: контекст, ключевые идеи, факты, выводы, рекомендации",
      "- note: короткая подсказка спикеру, не более одного предложения",
      "- не выдумывать факты вне контекста",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): PresentationPayload {
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

    return JSON.parse(fenced.slice(start, end + 1)) as PresentationPayload;
  }

  private normalizeSlides(
    payload: PresentationPayload,
    workspaceName: string,
    documents: SourceDocument[],
  ): SlidesData {
    const slides = Array.isArray(payload.slides)
      ? payload.slides
          .filter(
            (slide): slide is Record<string, unknown> =>
              !!slide && typeof slide === "object" && !Array.isArray(slide),
          )
          .map((slide) => {
            const bullets = Array.isArray(slide.bullets)
              ? slide.bullets
                  .filter((item): item is string => typeof item === "string")
                  .map((item) => item.replace(/\s+/g, " ").trim())
                  .filter((item) => this.isUsefulLine(item))
                  .slice(0, 5)
              : [];

            return {
              title:
                typeof slide.title === "string" && slide.title.trim()
                  ? slide.title.trim()
                  : "Слайд",
              bullets,
              note:
                typeof slide.note === "string" && slide.note.trim()
                  ? slide.note.replace(/\s+/g, " ").trim()
                  : undefined,
            };
          })
          .filter((slide) => slide.bullets.length > 0)
          .slice(0, 7)
      : [];

    if (!slides.length) {
      return this.createFallbackSlides(workspaceName, documents);
    }

    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : `Презентация: ${workspaceName}`,
      subtitle:
        typeof payload.subtitle === "string" && payload.subtitle.trim()
          ? payload.subtitle.trim()
          : `Собрано по ${documents.length} готовым источникам`,
      generatedFrom: documents.length,
      slides,
    };
  }

  private createFallbackSlides(
    workspaceName: string,
    documents: SourceDocument[],
  ): SlidesData {
    const names = documents.map((document) => document.originalName);
    const summaries = documents
      .slice(0, 4)
      .map((document) => this.extractSummary(document.extractedText))
      .filter(Boolean)
      .slice(0, 4);

    return {
      title: `Презентация: ${workspaceName}`,
      subtitle: `Собрано по ${documents.length} готовым источникам`,
      generatedFrom: documents.length,
      slides: [
        {
          title: "Контекст и материалы",
          bullets: [
            `Воркспейс: ${workspaceName}`,
            `Источников в анализе: ${documents.length}`,
            `Ключевые материалы: ${names.slice(0, 3).join(", ")}`,
          ],
          note: "Коротко обозначьте объём и состав исходных материалов.",
        },
        {
          title: "Основные темы",
          bullets: summaries.length
            ? summaries
            : ["Материалы собраны и готовы для обзорной презентации."],
          note: "Покажите, какие темы и блоки встречаются чаще всего.",
        },
        {
          title: "Ключевые выводы",
          bullets: [
            "Материалы уже структурированы и пригодны для краткого выступления.",
            "Основные факты собраны в короткие тезисы для быстрого чтения.",
            "Полученную структуру можно использовать как основу для доклада.",
          ],
          note: "Сделайте акцент на том, что уже удалось собрать и понять.",
        },
        {
          title: "Практическая ценность",
          bullets: [
            "Презентация сокращает время на подготовку к выступлению.",
            "Тезисы помогают быстро выделить главное из большого массива данных.",
            "Структуру можно доработать под конкретную аудиторию.",
          ],
          note: "Подчеркните пользу результата для пользователя.",
        },
        {
          title: "Рекомендации",
          bullets: [
            "Уточнить целевую аудиторию презентации.",
            "Выбрать приоритетные блоки для финального выступления.",
            "При необходимости дополнить воркспейс новыми источниками и пересобрать слайды.",
          ],
          note: "Завершите блоком с понятными следующими шагами.",
        },
      ],
    };
  }

  private extractSummary(text?: string | null) {
    const clean = this.prepareContext(text)
      .split(/(?<=[.!?])\s+/)
      .find(Boolean)
      ?.trim();
    return clean ? clean.slice(0, 140) : "Источник обработан и включён в общий контекст.";
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

  private prepareContext(text?: string | null) {
    const raw = (text || "").replace(/\s+/g, " ").trim();
    if (!raw) {
      return "";
    }

    return raw
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter((line) => this.isUsefulLine(line))
      .slice(0, 18)
      .join(" ")
      .slice(0, 3200);
  }

  private isUsefulLine(value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();

    if (normalized.length < 12 || normalized.length > 180) {
      return false;
    }

    const letters = normalized.match(/[A-Za-zА-Яа-яЁё]/g)?.length ?? 0;
    const digits = normalized.match(/\d/g)?.length ?? 0;

    if (letters < 8) {
      return false;
    }

    if (digits > letters) {
      return false;
    }

    if (/^[^A-Za-zА-Яа-яЁё]+$/.test(normalized)) {
      return false;
    }

    return true;
  }
}
