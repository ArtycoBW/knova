import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CompareDocumentsDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from "./dto/workspace.dto";

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
      hasAudio: ws.documents.some(
        (d) =>
          d.mimeType.startsWith("audio/") || d.mimeType.startsWith("video/"),
      ),
    }));
  }

  async findOne(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        _count: {
          select: {
            chatSessions: true,
            mindmaps: true,
            podcasts: true,
            quizzes: true,
          },
        },
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

  async compare(id: string, userId: string, dto: CompareDocumentsDto) {
    await this.assertOwner(id, userId);

    const documentIds = [...new Set(dto.documentIds)];
    if (documentIds.length !== 2) {
      throw new BadRequestException("Нужно выбрать ровно два документа");
    }

    const documents = await this.prisma.document.findMany({
      where: {
        workspaceId: id,
        id: { in: documentIds },
        status: "READY",
      },
      select: {
        id: true,
        name: true,
        sourceType: true,
        extractedText: true,
      },
    });

    if (documents.length !== 2) {
      throw new BadRequestException(
        "Для сравнения доступны только готовые документы из этого воркспейса",
      );
    }

    const [first, second] = documentIds.map((documentId) => {
      const document = documents.find((item) => item.id === documentId);
      if (!document) {
        throw new BadRequestException("Документ не найден");
      }
      return document;
    });

    const firstTokens = this.extractKeywords(first.extractedText);
    const secondTokens = this.extractKeywords(second.extractedText);
    const sharedTokens = firstTokens.filter((token) => secondTokens.includes(token));
    const similarity = this.calculateSimilarity(firstTokens, secondTokens);

    return {
      comparison: {
        documents: [
          {
            id: first.id,
            name: first.name,
            sourceType: first.sourceType,
            excerpt: this.createExcerpt(first.extractedText),
          },
          {
            id: second.id,
            name: second.name,
            sourceType: second.sourceType,
            excerpt: this.createExcerpt(second.extractedText),
          },
        ],
        similarity,
        commonTopics: sharedTokens.slice(0, 8),
        uniqueTopics: {
          [first.id]: firstTokens
            .filter((token) => !secondTokens.includes(token))
            .slice(0, 6),
          [second.id]: secondTokens
            .filter((token) => !firstTokens.includes(token))
            .slice(0, 6),
        },
      },
    };
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

  private extractKeywords(text?: string | null) {
    if (!text) {
      return [];
    }

    const frequencies = new Map<string, number>();
    const tokens = text
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4);

    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }

    return [...frequencies.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([token]) => token);
  }

  private calculateSimilarity(firstTokens: string[], secondTokens: string[]) {
    if (!firstTokens.length || !secondTokens.length) {
      return 0;
    }

    const firstSet = new Set(firstTokens);
    const secondSet = new Set(secondTokens);
    const intersection = [...firstSet].filter((token) => secondSet.has(token));
    const union = new Set([...firstSet, ...secondSet]);

    return Math.round((intersection.length / union.size) * 100);
  }

  private createExcerpt(text?: string | null) {
    if (!text) {
      return "Текст документа пока недоступен";
    }

    const clean = text.replace(/\s+/g, " ").trim();
    return clean.slice(0, 220);
  }
}
