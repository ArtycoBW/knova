import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

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

    const [workspaces, documents] = await Promise.all([
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
    ]);

    return [
      ...workspaces.map((workspace) => ({
        id: workspace.id,
        type: "workspace" as const,
        title: workspace.name,
        subtitle: workspace.description || "Воркспейс",
        href: `/workspace/${workspace.id}`,
      })),
      ...documents.map((document) => ({
        id: document.id,
        type: "document" as const,
        title: document.originalName,
        subtitle:
          document.extractedText?.replace(/\s+/g, " ").trim().slice(0, 120) ||
          `Документ в «${document.workspace.name}»`,
        href: `/workspace/${document.workspaceId}?documentId=${document.id}`,
      })),
    ];
  }
}
