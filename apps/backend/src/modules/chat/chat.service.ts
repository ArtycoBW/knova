import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ChatMessage, MessageRole, Prisma } from "@prisma/client";
import { EmbeddingService } from "../llm/embedding.service";
import { LlmService } from "../llm/llm.service";
import { SttService } from "../llm/stt.service";
import { PrismaService } from "../prisma/prisma.service";

interface SourceChunk {
  documentId: string;
  originalName: string;
  chunkIndex: number;
  content: string;
  distance: number;
}

interface ChatSource {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

type ChatRole = "system" | "user" | "assistant";

interface StreamCallbacks {
  sessionId?: string;
  onUserMessage?: (payload: {
    sessionId: string;
    userMessage: {
      id: string;
      role: MessageRole;
      content: string;
      createdAt: Date;
    };
  }) => Promise<void> | void;
  onChunk?: (payload: { sessionId: string; chunk: string }) => Promise<void> | void;
  onDone?: (payload: {
    sessionId: string;
    stopped: boolean;
    assistantMessage: {
      id: string;
      role: MessageRole;
      content: string;
      sources: ChatSource[];
      createdAt: Date;
    };
  }) => Promise<void> | void;
}

@Injectable()
export class ChatService {
  private readonly stopRequests = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
    private readonly stt: SttService,
  ) {}

  async getSession(workspaceId: string, userId: string) {
    const workspace = await this.assertWorkspaceOwner(workspaceId, userId);
    const session = await this.ensureSession(workspaceId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    return {
      sessionId: session.id,
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: message.sources,
        createdAt: message.createdAt,
      })),
    };
  }

  async sendMessage(workspaceId: string, userId: string, content: string) {
    return this.streamMessage(workspaceId, userId, content);
  }

  async streamMessage(
    workspaceId: string,
    userId: string,
    content: string,
    callbacks: StreamCallbacks = {},
  ) {
    await this.assertWorkspaceOwner(workspaceId, userId);
    await this.ensureReadyDocuments(workspaceId);

    const session = await this.ensureSession(workspaceId, callbacks.sessionId);
    const previousMessages = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    const sources = await this.findRelevantChunks(workspaceId, content);
    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: MessageRole.USER,
        content,
      },
    });

    await callbacks.onUserMessage?.({
      sessionId: session.id,
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      },
    });

    const messages: Array<{ role: ChatRole; content: string }> = [
      {
        role: "system",
        content: this.buildSystemPrompt(sources),
      },
      ...this.toConversationMessages(previousMessages),
      {
        role: "user",
        content,
      },
    ];

    let assistantContent = "";
    let stopped = false;

    for await (const chunk of this.llm.chatStream(messages, {
      temperature: 0.2,
      maxTokens: 1200,
    })) {
      if (this.stopRequests.has(session.id)) {
        this.stopRequests.delete(session.id);
        stopped = true;
        break;
      }

      assistantContent += chunk;
      await callbacks.onChunk?.({
        sessionId: session.id,
        chunk,
      });
    }

    if (!assistantContent.trim()) {
      assistantContent = stopped
        ? "Генерация остановлена пользователем."
        : "Не удалось сгенерировать ответ.";
    }

    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: MessageRole.ASSISTANT,
        content: assistantContent,
        sources: sources as unknown as Prisma.InputJsonValue,
      },
    });

    if (!session.title) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { title: content.slice(0, 60) },
      });
    }

    const result = {
      sessionId: session.id,
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      },
      assistantMessage: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        sources,
        createdAt: assistantMessage.createdAt,
      },
    };

    await callbacks.onDone?.({
      sessionId: session.id,
      stopped,
      assistantMessage: result.assistantMessage,
    });

    return result;
  }

  requestStop(sessionId: string) {
    this.stopRequests.add(sessionId);
  }

  async transcribeAudio(buffer: Buffer, mimetype: string) {
    if (!this.stt.isAvailable()) {
      throw new BadRequestException("STT недоступен в этом режиме");
    }

    return { text: await this.stt.transcribe(buffer, mimetype) };
  }

  private async ensureReadyDocuments(workspaceId: string) {
    const readyDocuments = await this.prisma.document.count({
      where: { workspaceId, status: "READY" },
    });

    if (!readyDocuments) {
      throw new BadRequestException(
        "Сначала загрузите и дождитесь обработки хотя бы одного документа",
      );
    }
  }

  private async ensureSession(workspaceId: string, sessionId?: string) {
    if (sessionId) {
      const requested = await this.prisma.chatSession.findFirst({
        where: { id: sessionId, workspaceId },
      });

      if (!requested) {
        throw new NotFoundException("Чат-сессия не найдена");
      }

      return requested;
    }

    const existing = await this.prisma.chatSession.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.chatSession.create({
      data: { workspaceId },
    });
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

  private async findRelevantChunks(
    workspaceId: string,
    question: string,
  ): Promise<ChatSource[]> {
    const vector = `[${(await this.embedding.embed(question)).join(",")}]`;

    const rows = await this.prisma.$queryRawUnsafe<SourceChunk[]>(
      `
        SELECT
          d.id AS "documentId",
          d."originalName" AS "originalName",
          dc."chunkIndex" AS "chunkIndex",
          dc.content AS "content",
          (dc.embedding <=> $1::vector) AS "distance"
        FROM "DocumentChunk" dc
        JOIN "Document" d ON d.id = dc."documentId"
        WHERE d."workspaceId" = $2
          AND d.status = 'READY'
          AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> $1::vector
        LIMIT 6
      `,
      vector,
      workspaceId,
    );

    return rows.map((row) => ({
      documentId: row.documentId,
      documentName: row.originalName,
      chunkIndex: row.chunkIndex,
      excerpt: row.content.slice(0, 260),
      score: Number((1 - row.distance).toFixed(4)),
    }));
  }

  private toConversationMessages(messages: ChatMessage[]) {
    return messages.map((message) => ({
      role:
        message.role === MessageRole.ASSISTANT
          ? ("assistant" as const)
          : message.role === MessageRole.SYSTEM
            ? ("system" as const)
            : ("user" as const),
      content: message.content,
    }));
  }

  private buildSystemPrompt(sources: ChatSource[]) {
    const context = sources.length
      ? sources
          .map(
            (source, index) =>
              `[${index + 1}] ${source.documentName}, фрагмент ${source.chunkIndex + 1}, релевантность ${source.score}\n${source.excerpt}`,
          )
          .join("\n\n")
      : "Контекст не найден. Если данных недостаточно, прямо скажи об этом.";

    return [
      "Ты помощник платформы Knova. Отвечай только на русском языке.",
      "Используй контекст ниже как главный источник правды.",
      "Если в контексте недостаточно данных, прямо скажи об этом.",
      "В конце ответа дай короткий блок «Источники: [1], [2] ...».",
      `Контекст:\n${context}`,
    ].join("\n\n");
  }
}
