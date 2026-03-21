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

interface ReadyDocumentPreview {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  createdAt: Date;
}

interface EmptyMindmapData {
  title: string;
  centralTopic: string;
  nodes: [];
  edges: [];
  sources: [];
  generatedFrom: number;
}

@Injectable()
export class MindmapService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.MINDMAP_GENERATION)
    private readonly mindmapQueue: Queue,
  ) {}

  async getWorkspaceMindmap(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [mindmap, readyDocuments] = await Promise.all([
      this.prisma.mindmap.findFirst({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" },
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

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      mindmap: mindmap
        ? {
            id: mindmap.id,
            title: mindmap.title,
            status: mindmap.status,
            data: mindmap.data,
            createdAt: mindmap.createdAt,
            updatedAt: mindmap.updatedAt,
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

    const current = await this.prisma.mindmap.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.mindmapQueue.getJob(jobId);
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
        mindmap: current,
      };
    }

    const title = `Карта знаний: ${workspace.name}`;
    const placeholder = this.createEmptyData(workspace.name);

    const mindmap = current
      ? await this.prisma.mindmap.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
            data: placeholder as unknown as Prisma.InputJsonValue,
          },
        })
      : await this.prisma.mindmap.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            data: placeholder as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.mindmapQueue.add(
        QUEUE_NAMES.MINDMAP_GENERATION,
        {
          workspaceId,
          mindmapId: mindmap.id,
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
        await this.prisma.mindmap.update({
          where: { id: mindmap.id },
          data: {
            title: current.title,
            status: current.status,
            data: current.data as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        await this.prisma.mindmap.update({
          where: { id: mindmap.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      mindmap,
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

  private createEmptyData(workspaceName: string): EmptyMindmapData {
    return {
      title: `Карта знаний: ${workspaceName}`,
      centralTopic: workspaceName,
      nodes: [],
      edges: [],
      sources: [],
      generatedFrom: 0,
    };
  }

  private getJobId(workspaceId: string) {
    return `mindmap-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
