import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { DocumentSource, GenerationStatus, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.module";
import { GeneratePodcastDto } from "./dto/generate-podcast.dto";

interface EmptyPodcastScriptLine {
  speaker: "A" | "B";
  text: string;
}

interface EmptyPodcastData {
  title: string;
  lines: EmptyPodcastScriptLine[];
  generatedFrom: number;
}

type PodcastRecord = {
  id: string;
  workspaceId: string;
  title: string;
  script: Prisma.JsonValue;
  audioUrl: string | null;
  status: GenerationStatus;
  settings: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PodcastService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PODCAST_GENERATION)
    private readonly podcastQueue: Queue,
  ) {}

  async getWorkspacePodcast(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [podcasts, readyDocuments] = await Promise.all([
      this.prisma.podcast.findMany({
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

    const podcast = await this.resolveCurrentPodcast(workspaceId, podcasts);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      podcast: podcast
        ? {
            id: podcast.id,
            title: podcast.title,
            status: podcast.status,
            script: podcast.script,
            settings: podcast.settings,
            audioUrl: podcast.audioUrl,
            createdAt: podcast.createdAt,
            updatedAt: podcast.updatedAt,
          }
        : null,
    };
  }

  async generate(workspaceId: string, userId: string, dto: GeneratePodcastDto) {
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

    const current = await this.prisma.podcast.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.podcastQueue.getJob(jobId);
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
        podcast: current,
      };
    }

    const title = `Подкаст: ${workspace.name}`;
    const settings = {
      tone: dto.tone,
      length: dto.length,
    };

    const podcast = current
      ? await this.prisma.podcast.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
            settings: settings as unknown as Prisma.InputJsonValue,
          },
        })
      : await this.prisma.podcast.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            script: this.createEmptyScript(workspace.name) as unknown as Prisma.InputJsonValue,
            settings: settings as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.podcastQueue.add(
        QUEUE_NAMES.PODCAST_GENERATION,
        {
          workspaceId,
          podcastId: podcast.id,
          userId,
          settings,
        },
        {
          jobId,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    } catch (error) {
      if (current) {
        await this.prisma.podcast.update({
          where: { id: podcast.id },
          data: {
            title: current.title,
            status: current.status,
            script: current.script as Prisma.InputJsonValue,
            settings: current.settings as Prisma.InputJsonValue | undefined,
          },
        });
      } else {
        await this.prisma.podcast.update({
          where: { id: podcast.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      podcast,
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

  private createEmptyScript(workspaceName: string): EmptyPodcastData {
    return {
      title: `Подкаст: ${workspaceName}`,
      lines: [],
      generatedFrom: 0,
    };
  }

  private async resolveCurrentPodcast(
    workspaceId: string,
    podcasts: PodcastRecord[],
  ): Promise<PodcastRecord | null> {
    if (!podcasts.length) {
      return null;
    }

    const initial = podcasts[0];
    const current =
      (await this.prisma.podcast.findUnique({
        where: { id: initial.id },
      })) ?? initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.podcastQueue.getJob(this.getJobId(workspaceId));
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
      (await this.prisma.podcast.findUnique({
        where: { id: current.id },
      })) ?? current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (this.hasScriptLines(refreshed.script)) {
      return this.prisma.podcast.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = podcasts.find(
      (podcast) =>
        podcast.status === GenerationStatus.READY &&
        this.hasScriptLines(podcast.script),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.podcast.update({
      where: { id: current.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private hasScriptLines(script: Prisma.JsonValue) {
    if (!script || typeof script !== "object" || Array.isArray(script)) {
      return false;
    }

    const lines = (script as { lines?: unknown }).lines;
    return Array.isArray(lines) && lines.length > 0;
  }

  private getJobId(workspaceId: string) {
    return `podcast-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
