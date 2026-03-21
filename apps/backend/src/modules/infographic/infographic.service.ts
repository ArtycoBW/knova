import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { GenerationStatus, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.module";

interface EmptyInfographicData {
  title: string;
  type: "bar" | "line" | "pie" | "doughnut";
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
    }>;
  };
  summary: string;
  generatedFrom: number;
}

type InfographicRecord = {
  id: string;
  workspaceId: string;
  title: string;
  chartData: Prisma.JsonValue;
  chartType: string;
  status: GenerationStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class InfographicService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.INFOGRAPHIC_GENERATION)
    private readonly infographicQueue: Queue,
  ) {}

  async getWorkspaceInfographic(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [infographics, readyDocuments] = await Promise.all([
      this.prisma.infographic.findMany({
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

    const infographic = await this.resolveCurrentInfographic(
      workspaceId,
      infographics,
    );

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      infographic: infographic
        ? {
            id: infographic.id,
            title: infographic.title,
            status: infographic.status,
            chartData: infographic.chartData,
            chartType: infographic.chartType,
            createdAt: infographic.createdAt,
            updatedAt: infographic.updatedAt,
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

    const current = await this.prisma.infographic.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.infographicQueue.getJob(jobId);
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
        infographic: current,
      };
    }

    const title = `Инфографика: ${workspace.name}`;
    const infographic = current
      ? await this.prisma.infographic.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
          },
        })
      : await this.prisma.infographic.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            chartType: "bar",
            chartData: this.createEmptyChart(workspace.name) as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.infographicQueue.add(
        QUEUE_NAMES.INFOGRAPHIC_GENERATION,
        {
          workspaceId,
          infographicId: infographic.id,
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
        await this.prisma.infographic.update({
          where: { id: infographic.id },
          data: {
            title: current.title,
            status: current.status,
            chartType: current.chartType,
            chartData: current.chartData as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.infographic.update({
          where: { id: infographic.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      infographic,
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

  private createEmptyChart(workspaceName: string): EmptyInfographicData {
    return {
      title: `Инфографика: ${workspaceName}`,
      type: "bar",
      data: {
        labels: [],
        datasets: [],
      },
      summary: "",
      generatedFrom: 0,
    };
  }

  private async resolveCurrentInfographic(
    workspaceId: string,
    infographics: InfographicRecord[],
  ): Promise<InfographicRecord | null> {
    if (!infographics.length) {
      return null;
    }

    const initial = infographics[0];
    const current =
      (await this.prisma.infographic.findUnique({
        where: { id: initial.id },
      })) ?? initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.infographicQueue.getJob(this.getJobId(workspaceId));
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
      (await this.prisma.infographic.findUnique({
        where: { id: current.id },
      })) ?? current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (this.hasChartData(refreshed.chartData)) {
      return this.prisma.infographic.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = infographics.find(
      (infographic) =>
        infographic.status === GenerationStatus.READY &&
        this.hasChartData(infographic.chartData),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.infographic.update({
      where: { id: refreshed.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private hasChartData(chartData: Prisma.JsonValue) {
    if (!chartData || typeof chartData !== "object" || Array.isArray(chartData)) {
      return false;
    }

    const data = (chartData as { data?: unknown }).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }

    const labels = (data as { labels?: unknown }).labels;
    return Array.isArray(labels) && labels.length > 0;
  }

  private getJobId(workspaceId: string) {
    return `infographic-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
