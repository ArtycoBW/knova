import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWorkspaceDto, UpdateWorkspaceDto } from "./dto/workspace.dto";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { documents: true, chatSessions: true } },
        documents: {
          select: { status: true, mimeType: true },
        },
      },
    });

    return workspaces.map((ws) => ({
      ...ws,
      documentCount: ws._count.documents,
      chatCount: ws._count.chatSessions,
      readyCount: ws.documents.filter((d) => d.status === "READY").length,
      hasAudio: ws.documents.some((d) => d.mimeType.startsWith("audio/") || d.mimeType.startsWith("video/")),
    }));
  }

  async findOne(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        _count: { select: { chatSessions: true, mindmaps: true, podcasts: true, quizzes: true } },
      },
    });

    if (!workspace) throw new NotFoundException("Воркспейс не найден");
    if (workspace.userId !== userId) throw new ForbiddenException("Нет доступа");

    return workspace;
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    return this.prisma.workspace.create({
      data: { ...dto, userId },
    });
  }

  async update(id: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.assertOwner(id, userId);
    return this.prisma.workspace.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.workspace.delete({ where: { id } });
    return { message: "Воркспейс удалён" };
  }

  async getStats(userId: string) {
    const [workspaces, documents, chatMessages, generations] = await Promise.all([
      this.prisma.workspace.count({ where: { userId } }),
      this.prisma.document.count({
        where: { workspace: { userId }, status: "READY" },
      }),
      this.prisma.chatMessage.count({
        where: { session: { workspace: { userId } }, role: "USER" },
      }),
      Promise.all([
        this.prisma.mindmap.count({ where: { workspace: { userId } } }),
        this.prisma.podcast.count({ where: { workspace: { userId } } }),
        this.prisma.quiz.count({ where: { workspace: { userId } } }),
      ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    ]);

    return { workspaces, documents, chatMessages, generations };
  }

  private async assertOwner(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException("Воркспейс не найден");
    if (workspace.userId !== userId) throw new ForbiddenException("Нет доступа");
    return workspace;
  }
}
