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

interface EmptyTableData {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  summary: string;
  generatedFrom: number;
}

type TableRecord = {
  id: string;
  workspaceId: string;
  title: string;
  tableData: Prisma.JsonValue;
  status: GenerationStatus;
  csvPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class TableService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.TABLE_EXTRACTION)
    private readonly tableQueue: Queue,
  ) {}

  async getWorkspaceTable(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const [tables, readyDocuments] = await Promise.all([
      this.prisma.dataExtract.findMany({
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

    const table = await this.resolveCurrentTable(workspaceId, tables);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
      },
      readyDocuments,
      table: table
        ? {
            id: table.id,
            title: table.title,
            status: table.status,
            tableData: table.tableData,
            csvPath: table.csvPath,
            createdAt: table.createdAt,
            updatedAt: table.updatedAt,
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

    const current = await this.prisma.dataExtract.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    });
    const queuedJob = await this.tableQueue.getJob(jobId);
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
        table: current,
      };
    }

    const title = `Таблица: ${workspace.name}`;
    const table = current
      ? await this.prisma.dataExtract.update({
          where: { id: current.id },
          data: {
            title,
            status: GenerationStatus.PENDING,
            csvPath: null,
          },
        })
      : await this.prisma.dataExtract.create({
          data: {
            workspaceId,
            title,
            status: GenerationStatus.PENDING,
            tableData: this.createEmptyTable(workspace.name) as unknown as Prisma.InputJsonValue,
          },
        });

    try {
      await this.tableQueue.add(
        QUEUE_NAMES.TABLE_EXTRACTION,
        {
          workspaceId,
          tableId: table.id,
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
        await this.prisma.dataExtract.update({
          where: { id: table.id },
          data: {
            title: current.title,
            status: current.status,
            tableData: current.tableData as Prisma.InputJsonValue,
            csvPath: current.csvPath,
          },
        });
      } else {
        await this.prisma.dataExtract.update({
          where: { id: table.id },
          data: { status: GenerationStatus.ERROR },
        });
      }

      throw error;
    }

    return {
      queued: true,
      table,
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

  private createEmptyTable(workspaceName: string): EmptyTableData {
    return {
      title: `Таблица: ${workspaceName}`,
      headers: [],
      rows: [],
      summary: "",
      generatedFrom: 0,
    };
  }

  private async resolveCurrentTable(
    workspaceId: string,
    tables: TableRecord[],
  ): Promise<TableRecord | null> {
    if (!tables.length) {
      return null;
    }

    const initial = tables[0];
    const current =
      (await this.prisma.dataExtract.findUnique({
        where: { id: initial.id },
      })) ?? initial;
    const isPending =
      current.status === GenerationStatus.PENDING ||
      current.status === GenerationStatus.GENERATING;

    if (!isPending) {
      return current;
    }

    const queuedJob = await this.tableQueue.getJob(this.getJobId(workspaceId));
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
      (await this.prisma.dataExtract.findUnique({
        where: { id: current.id },
      })) ?? current;

    if (
      refreshed.status === GenerationStatus.READY ||
      refreshed.status === GenerationStatus.ERROR
    ) {
      return refreshed;
    }

    if (this.hasRows(refreshed.tableData)) {
      return this.prisma.dataExtract.update({
        where: { id: refreshed.id },
        data: { status: GenerationStatus.READY },
      });
    }

    const fallbackReady = tables.find(
      (table) =>
        table.status === GenerationStatus.READY &&
        this.hasRows(table.tableData),
    );

    if (fallbackReady) {
      return fallbackReady;
    }

    return this.prisma.dataExtract.update({
      where: { id: refreshed.id },
      data: { status: GenerationStatus.ERROR },
    });
  }

  private hasRows(tableData: Prisma.JsonValue) {
    if (!tableData || typeof tableData !== "object" || Array.isArray(tableData)) {
      return false;
    }

    const rows = (tableData as { rows?: unknown }).rows;
    return Array.isArray(rows) && rows.length > 0;
  }

  private getJobId(workspaceId: string) {
    return `table-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }
}
