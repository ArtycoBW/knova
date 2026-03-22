import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { GenerationStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.module";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.REPORT_GENERATION)
    private readonly reportQueue: Queue,
  ) {}

  async getWorkspaceReport(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [reports, readyDocuments] = await Promise.all([
      this.prisma.report.findMany({
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

    const report = await this.resolveCurrentReport(workspaceId, reports);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      report: report
        ? {
            id: report.id,
            title: report.title,
            content: report.content,
            template: report.template,
            status: report.status,
            filePath: report.filePath,
            createdAt: report.createdAt,
            updatedAt: report.updatedAt,
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

    const current = await this.prisma.report.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.reportQueue.getJob(jobId);
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
        report: current,
      };
    }

    const title = `Отчёт: ${workspace.name}`;
    const report = current
      ? await this.prisma.report.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
            template: "official",
            filePath: null,
          },
        })
      : await this.prisma.report.create({
          data: {
            workspaceId,
            title,
            content: "",
            template: "official",
            status: GenerationStatus.PENDING,
          },
        });

    try {
      await this.reportQueue.add(
        QUEUE_NAMES.REPORT_GENERATION,
        {
          workspaceId,
          reportId: report.id,
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
        await this.prisma.report.update({
          where: { id: report.id },
          data: {
            title: current.title,
            content: current.content,
            template: current.template,
            status: current.status,
            filePath: current.filePath,
          },
        });
      } else {
        await this.prisma.report.update({
          where: { id: report.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      report,
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

  private async resolveCurrentReport(
    workspaceId: string,
    reports: Array<{
      id: string;
      workspaceId: string;
      title: string;
      content: string;
      template: string | null;
      status: GenerationStatus;
      filePath: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    if (!reports.length) {
      return null;
    }

    const initial = reports[0];
    const current =
      (await this.prisma.report.findUnique({ where: { id: initial.id } })) ??
      initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.reportQueue.getJob(this.getJobId(workspaceId));
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
      (await this.prisma.report.findUnique({ where: { id: current.id } })) ??
      current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (refreshed.content.trim()) {
      return this.prisma.report.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = reports.find(
      (report) =>
        report.status === GenerationStatus.READY && report.content.trim(),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.report.update({
      where: { id: refreshed.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private getJobId(workspaceId: string) {
    return `report-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
