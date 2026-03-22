import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { GenerationStatus, Prisma } from "@prisma/client";
import PptxGenJS from "pptxgenjs";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.module";

interface EmptySlides {
  title: string;
  subtitle: string;
  generatedFrom: number;
  slides: Array<{
    title: string;
    bullets: string[];
    note?: string;
  }>;
}

interface PresentationRecord {
  id: string;
  workspaceId: string;
  title: string;
  slides: Prisma.JsonValue;
  status: GenerationStatus;
  filePath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PresentationService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PRESENTATION_GENERATION)
    private readonly presentationQueue: Queue,
  ) {}

  async getWorkspacePresentation(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [presentations, readyDocuments] = await Promise.all([
      this.prisma.presentation.findMany({
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

    const presentation = await this.resolveCurrentPresentation(
      workspaceId,
      presentations,
    );

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      presentation: presentation
        ? {
            id: presentation.id,
            title: presentation.title,
            slides: presentation.slides,
            status: presentation.status,
            filePath: presentation.filePath,
            createdAt: presentation.createdAt,
            updatedAt: presentation.updatedAt,
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

    const current = await this.prisma.presentation.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.presentationQueue.getJob(jobId);
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
        presentation: current,
      };
    }

    const title = `Презентация: ${workspace.name}`;
    const presentation = current
      ? await this.prisma.presentation.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
            filePath: null,
          },
        })
      : await this.prisma.presentation.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            slides: this.createEmptySlides(workspace.name) as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.presentationQueue.add(
        QUEUE_NAMES.PRESENTATION_GENERATION,
        {
          workspaceId,
          presentationId: presentation.id,
          userId,
        },
        {
          jobId,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    } catch (error) {
      if (current) {
        await this.prisma.presentation.update({
          where: { id: presentation.id },
          data: {
            title: current.title,
            slides: current.slides as Prisma.InputJsonValue,
            status: current.status,
            filePath: current.filePath,
          },
        });
      } else {
        await this.prisma.presentation.update({
          where: { id: presentation.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      presentation,
    };
  }

  async download(workspaceId: string, userId: string) {
    await this.assertWorkspaceOwner(workspaceId, userId);

    const presentations = await this.prisma.presentation.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    const presentation = await this.resolveCurrentPresentation(
      workspaceId,
      presentations,
    );

    if (!presentation || presentation.status !== GenerationStatus.READY) {
      throw new BadRequestException("Презентация ещё не готова к скачиванию");
    }

    const slidesData = this.normalizeSlidesForExport(
      presentation.slides,
      presentation.title,
    );
    const fileName = `${presentation.title.replace(/[\\/:*?"<>|]+/g, "-")}.pptx`;

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Knova";
    pptx.company = "Knova";
    pptx.subject = slidesData.title;
    pptx.title = slidesData.title;
    pptx.theme = {
      headFontFace: "Arial",
      bodyFontFace: "Arial",
    };

    const cover = pptx.addSlide();
    cover.background = { color: "0B1117" };
    cover.addText(slidesData.title, {
      x: 0.6,
      y: 0.7,
      w: 11.6,
      h: 0.6,
      fontFace: "Arial",
      fontSize: 26,
      bold: true,
      color: "F8FAFC",
    });
    cover.addText(slidesData.subtitle || "Собрано по материалам воркспейса", {
      x: 0.6,
      y: 1.55,
      w: 11,
      h: 0.4,
      fontFace: "Arial",
      fontSize: 13,
      color: "94A3B8",
    });

    slidesData.slides.forEach((slideData, index) => {
      const slide = pptx.addSlide();
      slide.background = { color: index % 2 === 0 ? "101826" : "0F172A" };
      slide.addText(slideData.title, {
        x: 0.55,
        y: 0.45,
        w: 11.5,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 22,
        bold: true,
        color: "F8FAFC",
      });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.55,
        y: 1.15,
        w: 11.45,
        h: 4.9,
        rectRadius: 0.12,
        line: { color: "1E293B", pt: 1 },
        fill: { color: "111827", transparency: 8 },
      });
      slide.addText(
        slideData.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: { indent: 14 } },
        })),
        {
          x: 0.85,
          y: 1.5,
          w: 10.4,
          h: 3.95,
          fontFace: "Arial",
          fontSize: 18,
          color: "E5E7EB",
          breakLine: true,
          margin: 0,
          paraSpaceAfter: 12,
          valign: "top",
        },
      );

      if (slideData.note) {
        slide.addText(slideData.note, {
          x: 0.85,
          y: 5.5,
          w: 10.4,
          h: 0.35,
          fontFace: "Arial",
          fontSize: 10,
          color: "94A3B8",
          italic: true,
        });
      }
    });

    const buffer = (await pptx.write({
      outputType: "nodebuffer",
      compression: true,
    })) as Buffer;

    return { fileName, buffer };
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

  private createEmptySlides(workspaceName: string): EmptySlides {
    return {
      title: `Презентация: ${workspaceName}`,
      subtitle: "",
      generatedFrom: 0,
      slides: [],
    };
  }

  private async resolveCurrentPresentation(
    workspaceId: string,
    presentations: PresentationRecord[],
  ) {
    if (!presentations.length) {
      return null;
    }

    const initial = presentations[0];
    const current =
      (await this.prisma.presentation.findUnique({
        where: { id: initial.id },
      })) ?? initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.presentationQueue.getJob(
      this.getJobId(workspaceId),
    );
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
      (await this.prisma.presentation.findUnique({
        where: { id: current.id },
      })) ?? current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (this.hasSlides(refreshed.slides)) {
      return this.prisma.presentation.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = presentations.find(
      (presentation) =>
        presentation.status === GenerationStatus.READY &&
        this.hasSlides(presentation.slides),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.presentation.update({
      where: { id: refreshed.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private hasSlides(slides: Prisma.JsonValue) {
    if (!slides || typeof slides !== "object" || Array.isArray(slides)) {
      return false;
    }

    const items = (slides as { slides?: unknown }).slides;
    return Array.isArray(items) && items.length > 0;
  }

  private normalizeSlidesForExport(slides: Prisma.JsonValue, title: string) {
    if (!slides || typeof slides !== "object" || Array.isArray(slides)) {
      return this.createEmptySlides(title.replace(/^Презентация:\s*/, ""));
    }

    const payload = slides as Partial<EmptySlides>;
    return {
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : title,
      subtitle:
        typeof payload.subtitle === "string" ? payload.subtitle.trim() : "",
      generatedFrom:
        typeof payload.generatedFrom === "number" ? payload.generatedFrom : 0,
      slides: Array.isArray(payload.slides)
        ? payload.slides
            .filter(
              (slide): slide is EmptySlides["slides"][number] =>
                !!slide &&
                typeof slide === "object" &&
                !Array.isArray(slide) &&
                typeof slide.title === "string" &&
                Array.isArray(slide.bullets),
            )
            .map((slide) => ({
              title: slide.title,
              bullets: slide.bullets.filter((item) => typeof item === "string"),
              note: slide.note,
            }))
        : [],
    };
  }

  private getJobId(workspaceId: string) {
    return `presentation-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
