import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EmbeddingService } from "../llm/embedding.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(userId: string, query: string, type?: string) {
    const q = query.trim();
    if (!q) {
      return [];
    }

    const normalizedType = type?.toLowerCase();
    const searchWorkspaces =
      !normalizedType || normalizedType === "all" || normalizedType === "workspace";
    const searchDocuments =
      !normalizedType || normalizedType === "all" || normalizedType === "document";

    const semanticResultsPromise =
      searchDocuments && q.length > 2 ? this.semanticSearch(userId, q) : Promise.resolve([]);

    const [workspaces, documents, semanticResults] = await Promise.all([
      searchWorkspaces
        ? this.prisma.workspace.findMany({
            where: {
              userId,
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            orderBy: { updatedAt: "desc" },
            take: 8,
            select: {
              id: true,
              name: true,
              description: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      searchDocuments
        ? this.prisma.document.findMany({
            where: {
              workspace: { userId },
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { originalName: { contains: q, mode: "insensitive" } },
                { extractedText: { contains: q, mode: "insensitive" } },
              ],
            },
            orderBy: { updatedAt: "desc" },
            take: 12,
            select: {
              id: true,
              name: true,
              originalName: true,
              extractedText: true,
              workspaceId: true,
              workspace: {
                select: {
                  name: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      semanticResultsPromise,
    ]);

    const lexicalDocuments = documents.map((document) => ({
      id: document.id,
      type: "document" as const,
      title: document.originalName,
      subtitle:
        document.extractedText?.replace(/\s+/g, " ").trim().slice(0, 120) ||
        `Документ в «${document.workspace.name}»`,
      href: `/workspace/${document.workspaceId}?documentId=${document.id}`,
    }));

    const mergedDocuments = [
      ...lexicalDocuments,
      ...semanticResults.filter(
        (semantic) => !lexicalDocuments.some((lexical) => lexical.id === semantic.id),
      ),
    ].slice(0, 12);

    return [
      ...workspaces.map((workspace) => ({
        id: workspace.id,
        type: "workspace" as const,
        title: workspace.name,
        subtitle: workspace.description || "Воркспейс",
        href: `/workspace/${workspace.id}`,
      })),
      ...mergedDocuments,
    ];
  }

  private async semanticSearch(userId: string, query: string) {
    try {
      const embedding = await this.embeddingService.embed(query);
      const vector = `[${embedding.join(",")}]`;

      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          originalName: string;
          workspaceId: string;
          workspaceName: string;
          excerpt: string;
          distance: number;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (d.id)
          d.id,
          d."originalName",
          d."workspaceId",
          w.name AS "workspaceName",
          LEFT(REPLACE(COALESCE(dc.content, ''), E'\n', ' '), 140) AS excerpt,
          (dc.embedding <=> ${vector}::vector) AS distance
        FROM "DocumentChunk" dc
        JOIN "Document" d ON d.id = dc."documentId"
        JOIN "Workspace" w ON w.id = d."workspaceId"
        WHERE w."userId" = ${userId}
          AND d.status = 'READY'
          AND dc.embedding IS NOT NULL
        ORDER BY d.id, distance ASC
        LIMIT 8
      `);

      return rows.map((row) => ({
        id: row.id,
        type: "document" as const,
        title: row.originalName,
        subtitle:
          row.excerpt?.trim() || `Семантическое совпадение в «${row.workspaceName}»`,
        href: `/workspace/${row.workspaceId}?documentId=${row.id}`,
      }));
    } catch {
      return [];
    }
  }
}
