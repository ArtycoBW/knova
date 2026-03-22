import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingService } from "../llm/embedding.service";
import { LlmService } from "../llm/llm.service";
import {
  CompareDocumentsDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from "./dto/workspace.dto";

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly embeddingService: EmbeddingService,
  ) {}

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
    const keywordSimilarity = this.calculateSimilarity(firstTokens, secondTokens);
    const semanticSimilarity = await this.calculateSemanticSimilarity(
      first.extractedText,
      second.extractedText,
    );
    const insight = await this.generateComparisonInsight(first, second);

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
        similarity: semanticSimilarity || keywordSimilarity,
        commonTopics:
          insight.commonTopics.length > 0
            ? insight.commonTopics
            : sharedTokens.slice(0, 8),
        uniqueTopics: {
          [first.id]:
            insight.uniqueTopics[first.id]?.length > 0
              ? insight.uniqueTopics[first.id]
              : firstTokens.filter((token) => !secondTokens.includes(token)).slice(0, 6),
          [second.id]:
            insight.uniqueTopics[second.id]?.length > 0
              ? insight.uniqueTopics[second.id]
              : secondTokens.filter((token) => !firstTokens.includes(token)).slice(0, 6),
        },
        overview: insight.overview,
        keyDifferences: insight.keyDifferences,
        recommendedFocus: insight.recommendedFocus,
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

  private async calculateSemanticSimilarity(
    firstText?: string | null,
    secondText?: string | null,
  ) {
    const left = (firstText || "").replace(/\s+/g, " ").trim().slice(0, 6000);
    const right = (secondText || "").replace(/\s+/g, " ").trim().slice(0, 6000);

    if (!left || !right) {
      return 0;
    }

    try {
      const [firstEmbedding, secondEmbedding] =
        await this.embeddingService.embedBatch([left, right]);

      const dot = firstEmbedding.reduce(
        (sum, value, index) => sum + value * (secondEmbedding[index] ?? 0),
        0,
      );
      const leftNorm = Math.sqrt(firstEmbedding.reduce((sum, value) => sum + value * value, 0));
      const rightNorm = Math.sqrt(secondEmbedding.reduce((sum, value) => sum + value * value, 0));

      if (!leftNorm || !rightNorm) {
        return 0;
      }

      const cosine = dot / (leftNorm * rightNorm);
      return Math.max(0, Math.min(100, Math.round(cosine * 100)));
    } catch {
      return 0;
    }
  }

  private async generateComparisonInsight(
    first: {
      id: string;
      name: string;
      extractedText: string | null;
    },
    second: {
      id: string;
      name: string;
      extractedText: string | null;
    },
  ) {
    const fallback = {
      overview: "Документы сопоставлены по темам и ключевым формулировкам.",
      keyDifferences: [
        `У документа «${first.name}» свой акцент по содержанию.`,
        `У документа «${second.name}» выделяются отдельные темы и детали.`,
      ],
      recommendedFocus: "Используйте общие темы как основу, а различия — как материал для уточнения позиции.",
      commonTopics: [] as string[],
      uniqueTopics: {
        [first.id]: [] as string[],
        [second.id]: [] as string[],
      },
    };

    try {
      const prompt = [
        "Сравни два документа и верни только JSON без markdown.",
        "Формат ответа:",
        `{ "overview": "...", "keyDifferences": ["...", "..."], "recommendedFocus": "...", "commonTopics": ["...", "..."], "uniqueTopics": { "${first.id}": ["...", "..."], "${second.id}": ["...", "..."] } }`,
        "Требования:",
        "- пиши по-русски",
        "- не более 3 общих тем",
        "- не более 3 уникальных тем на документ",
        "- не выдумывай факты вне контекста",
        `Документ A: ${first.name}`,
        this.createExcerpt(first.extractedText),
        `Документ B: ${second.name}`,
        this.createExcerpt(second.extractedText),
      ].join("\n");

      const raw = await this.llm.complete(prompt, {
        temperature: 0.2,
        maxTokens: 900,
      });
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) {
        return fallback;
      }

      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        overview?: string;
        keyDifferences?: unknown;
        recommendedFocus?: string;
        commonTopics?: unknown;
        uniqueTopics?: Record<string, unknown>;
      };

      return {
        overview:
          typeof parsed.overview === "string" && parsed.overview.trim()
            ? parsed.overview.trim()
            : fallback.overview,
        keyDifferences: Array.isArray(parsed.keyDifferences)
          ? parsed.keyDifferences
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 3)
          : fallback.keyDifferences,
        recommendedFocus:
          typeof parsed.recommendedFocus === "string" &&
          parsed.recommendedFocus.trim()
            ? parsed.recommendedFocus.trim()
            : fallback.recommendedFocus,
        commonTopics: Array.isArray(parsed.commonTopics)
          ? parsed.commonTopics
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 3)
          : fallback.commonTopics,
        uniqueTopics: {
          [first.id]: Array.isArray(parsed.uniqueTopics?.[first.id])
            ? (parsed.uniqueTopics[first.id] as unknown[])
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 3)
            : fallback.uniqueTopics[first.id],
          [second.id]: Array.isArray(parsed.uniqueTopics?.[second.id])
            ? (parsed.uniqueTopics[second.id] as unknown[])
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 3)
            : fallback.uniqueTopics[second.id],
        },
      };
    } catch {
      return fallback;
    }
  }
}
