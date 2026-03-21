import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import {
  DocumentSource,
  GenerationStatus,
  NotificationType,
  type Prisma,
} from "@prisma/client";
import { Job } from "bullmq";
import { ChatGateway } from "../../chat/chat.gateway";
import { LlmService } from "../../llm/llm.service";
import { PrismaService } from "../../prisma/prisma.service";
import { QUEUE_NAMES } from "../../queue/queue.module";

interface MindmapJobData {
  workspaceId: string;
  mindmapId: string;
  userId: string;
}

interface SourceDocument {
  id: string;
  originalName: string;
  sourceType: DocumentSource;
  extractedText: string | null;
}

interface MindmapBranchPayload {
  label?: unknown;
  summary?: unknown;
  children?: Array<{
    label?: unknown;
    summary?: unknown;
  }> | unknown;
}

interface MindmapPayload {
  title?: unknown;
  centralTopic?: unknown;
  branches?: MindmapBranchPayload[] | unknown;
}

interface MindmapNodeData {
  id: string;
  label: string;
  summary: string;
  kind: "root" | "branch" | "leaf";
  level: number;
  groupIndex: number;
  order: number;
}

interface MindmapEdgeData {
  id: string;
  source: string;
  target: string;
}

interface MindmapGraphData {
  title: string;
  centralTopic: string;
  nodes: MindmapNodeData[];
  edges: MindmapEdgeData[];
  sources: Array<{
    id: string;
    name: string;
    sourceType: DocumentSource;
  }>;
  generatedFrom: number;
}

@Processor(QUEUE_NAMES.MINDMAP_GENERATION)
export class MindmapProcessor extends WorkerHost {
  private readonly logger = new Logger(MindmapProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<MindmapJobData>) {
    const { workspaceId, mindmapId, userId } = job.data;
    this.logger.log(`Генерация mindmap ${mindmapId} для воркспейса ${workspaceId}`);

    await this.prisma.mindmap.update({
      where: { id: mindmapId },
      data: { status: GenerationStatus.GENERATING },
    });

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          name: true,
          userId: true,
          documents: {
            where: { status: "READY" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              originalName: true,
              sourceType: true,
              extractedText: true,
            },
          },
        },
      });

      if (!workspace) {
        throw new Error("Воркспейс не найден");
      }

      if (!workspace.documents.length) {
        throw new Error("Нет готовых документов для построения карты знаний");
      }

      const graph = await this.generateGraph(workspace.name, workspace.documents);

      const updated = await this.prisma.mindmap.update({
        where: { id: mindmapId },
        data: {
          title: graph.title,
          status: GenerationStatus.READY,
          data: graph as unknown as Prisma.InputJsonValue,
        },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: workspace.userId,
          type: NotificationType.GENERATION_COMPLETE,
          title: "Карта знаний готова",
          message: `Mindmap для воркспейса «${workspace.name}» собрана и доступна для просмотра`,
          metadata: {
            workspaceId,
            mindmapId,
            feature: "mindmap",
          },
        },
      });

      this.chatGateway.emitNotification(workspace.userId, notification);
      this.logger.log(`Mindmap ${updated.id} готова`);
    } catch (error) {
      this.logger.error(`Ошибка генерации mindmap ${mindmapId}:`, error);

      await this.prisma.mindmap.update({
        where: { id: mindmapId },
        data: { status: GenerationStatus.ERROR },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: "Ошибка генерации карты знаний",
          message: "Не удалось собрать mindmap по выбранным материалам",
          metadata: {
            workspaceId,
            mindmapId,
            feature: "mindmap",
          },
        },
      });

      this.chatGateway.emitNotification(userId, notification);
      throw error;
    }
  }

  private async generateGraph(
    workspaceName: string,
    documents: SourceDocument[],
  ): Promise<MindmapGraphData> {
    const prompt = this.buildPrompt(workspaceName, documents);

    try {
      const raw = await this.llm.complete(prompt, {
        temperature: 0.2,
        maxTokens: 2200,
      });
      const parsed = this.extractJson(raw);
      return this.normalizeMindmap(parsed, workspaceName, documents);
    } catch (error) {
      this.logger.warn(
        `LLM не вернула корректный mindmap JSON, используем fallback: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return this.createFallbackMindmap(workspaceName, documents);
    }
  }

  private buildPrompt(workspaceName: string, documents: SourceDocument[]) {
    const context = documents
      .slice(0, 6)
      .map((document, index) => {
        const excerpt = (document.extractedText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3500);

        return [
          `Источник ${index + 1}: ${document.originalName} (${this.getSourceTypeLabel(
            document.sourceType,
          )})`,
          excerpt || "Текст недоступен",
        ].join("\n");
      })
      .join("\n\n");

    return [
      "Ты аналитик платформы Knova. Построй компактную карту знаний на русском языке.",
      "Нужно вернуть только валидный JSON без markdown и пояснений.",
      "Структура ответа:",
      '{',
      '  "title": "Короткий заголовок карты",',
      '  "centralTopic": "Главная тема",',
      '  "branches": [',
      "    {",
      '      "label": "Раздел",',
      '      "summary": "1-2 коротких предложения",',
      '      "children": [',
      '        { "label": "Подтема", "summary": "Короткая суть" }',
      "      ]",
      "    }",
      "  ]",
      "}",
      "Ограничения:",
      "- 4-6 основных веток",
      "- у каждой ветки 2-4 подузла",
      "- формулировки короткие, деловые, без дубликатов",
      "- summary без воды, только выводы из материалов",
      `Воркспейс: ${workspaceName}`,
      `Контекст:\n${context}`,
    ].join("\n");
  }

  private extractJson(raw: string): MindmapPayload {
    const fenced = raw
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("JSON не найден в ответе модели");
    }

    return JSON.parse(fenced.slice(start, end + 1)) as MindmapPayload;
  }

  private normalizeMindmap(
    payload: MindmapPayload,
    workspaceName: string,
    documents: SourceDocument[],
  ): MindmapGraphData {
    const title = this.normalizeText(payload.title, `Карта знаний: ${workspaceName}`);
    const centralTopic = this.normalizeText(payload.centralTopic, workspaceName);

    const branches = Array.isArray(payload.branches) ? payload.branches : [];
    const normalizedBranches = branches
      .map((branch) => ({
        label: this.normalizeText(branch?.label, ""),
        summary: this.normalizeText(branch?.summary, ""),
        children: Array.isArray(branch?.children) ? branch.children : [],
      }))
      .filter((branch) => branch.label)
      .slice(0, 6)
      .map((branch) => ({
        ...branch,
        children: branch.children
          .map((child: { label?: unknown; summary?: unknown }) => ({
            label: this.normalizeText(child?.label, ""),
            summary: this.normalizeText(child?.summary, ""),
          }))
          .filter((child: { label: string; summary: string }) => child.label)
          .slice(0, 4),
      }));

    if (!normalizedBranches.length) {
      return this.createFallbackMindmap(workspaceName, documents);
    }

    const nodes: MindmapNodeData[] = [
      {
        id: "root",
        label: centralTopic,
        summary: title,
        kind: "root",
        level: 0,
        groupIndex: 0,
        order: 0,
      },
    ];
    const edges: MindmapEdgeData[] = [];

    normalizedBranches.forEach((branch, branchIndex) => {
      const branchId = `branch-${branchIndex + 1}`;
      nodes.push({
        id: branchId,
        label: branch.label,
        summary: branch.summary,
        kind: "branch",
        level: 1,
        groupIndex: branchIndex,
        order: branchIndex,
      });
      edges.push({
        id: `edge-root-${branchId}`,
        source: "root",
        target: branchId,
      });

      branch.children.forEach(
        (child: { label: string; summary: string }, childIndex: number) => {
        const childId = `${branchId}-leaf-${childIndex + 1}`;
        nodes.push({
          id: childId,
          label: child.label,
          summary: child.summary,
          kind: "leaf",
          level: 2,
          groupIndex: branchIndex,
          order: childIndex,
        });
        edges.push({
          id: `edge-${branchId}-${childId}`,
          source: branchId,
          target: childId,
        });
        },
      );
    });

    return {
      title,
      centralTopic,
      nodes,
      edges,
      sources: documents.map((document) => ({
        id: document.id,
        name: document.originalName,
        sourceType: document.sourceType,
      })),
      generatedFrom: documents.length,
    };
  }

  private createFallbackMindmap(
    workspaceName: string,
    documents: SourceDocument[],
  ): MindmapGraphData {
    const nodes: MindmapNodeData[] = [
      {
        id: "root",
        label: workspaceName,
        summary: "Ключевые темы и выводы по материалам воркспейса",
        kind: "root",
        level: 0,
        groupIndex: 0,
        order: 0,
      },
    ];
    const edges: MindmapEdgeData[] = [];

    documents.slice(0, 5).forEach((document, index) => {
      const branchId = `branch-${index + 1}`;
      const tokens = this.extractKeywords(document.extractedText).slice(0, 3);
      nodes.push({
        id: branchId,
        label: this.trimLabel(document.originalName),
        summary: this.extractSummary(document.extractedText),
        kind: "branch",
        level: 1,
        groupIndex: index,
        order: index,
      });
      edges.push({
        id: `edge-root-${branchId}`,
        source: "root",
        target: branchId,
      });

      tokens.forEach((token, tokenIndex) => {
        const childId = `${branchId}-leaf-${tokenIndex + 1}`;
        nodes.push({
          id: childId,
          label: token,
          summary: `Тема выделена из источника ${document.originalName}`,
          kind: "leaf",
          level: 2,
          groupIndex: index,
          order: tokenIndex,
        });
        edges.push({
          id: `edge-${branchId}-${childId}`,
          source: branchId,
          target: childId,
        });
      });
    });

    return {
      title: `Карта знаний: ${workspaceName}`,
      centralTopic: workspaceName,
      nodes,
      edges,
      sources: documents.map((document) => ({
        id: document.id,
        name: document.originalName,
        sourceType: document.sourceType,
      })),
      generatedFrom: documents.length,
    };
  }

  private normalizeText(value: unknown, fallback: string) {
    if (typeof value !== "string") {
      return fallback;
    }

    const clean = value.replace(/\s+/g, " ").trim();
    return clean || fallback;
  }

  private trimLabel(value: string) {
    return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  }

  private extractSummary(text?: string | null) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return "Содержимое источника уже подготовлено для анализа";
    }

    return clean.slice(0, 180);
  }

  private extractKeywords(text?: string | null) {
    if (!text) {
      return ["Основная идея", "Ключевой вывод", "Контекст"];
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

    const keywords = [...frequencies.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([token]) => token);

    return keywords.length
      ? keywords
      : ["Основная идея", "Ключевой вывод", "Контекст"];
  }

  private getSourceTypeLabel(sourceType: DocumentSource) {
    switch (sourceType) {
      case DocumentSource.AUDIO:
        return "аудио";
      case DocumentSource.VIDEO:
        return "видео";
      default:
        return "документ";
    }
  }
}
