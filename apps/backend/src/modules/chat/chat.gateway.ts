import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "./chat.service";

interface JwtPayload {
  sub: string;
  email: string;
}

interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: string;
      email: string;
    };
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        throw new Error("Требуется авторизация");
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>("JWT_SECRET"),
      });

      client.data.user = {
        id: payload.sub,
        email: payload.email,
      };

      await client.join(this.getUserRoom(payload.sub));
    } catch (error) {
      client.emit("chat:error", {
        error: this.getErrorMessage(error),
      });
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.id;
    if (userId) {
      this.logger.debug(`Realtime client disconnected: ${userId}`);
    }
  }

  @SubscribeMessage("workspace:join")
  async handleWorkspaceJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { workspaceId?: string },
  ) {
    const userId = client.data.user?.id;
    const workspaceId = body?.workspaceId;

    if (!userId || !workspaceId) {
      return { ok: false };
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { userId: true },
    });

    if (!workspace || workspace.userId !== userId) {
      return { ok: false };
    }

    await client.join(this.getWorkspaceRoom(workspaceId));
    return { ok: true };
  }

  @SubscribeMessage("workspace:leave")
  async handleWorkspaceLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { workspaceId?: string },
  ) {
    const workspaceId = body?.workspaceId;
    if (!workspaceId) {
      return { ok: false };
    }

    await client.leave(this.getWorkspaceRoom(workspaceId));
    return { ok: true };
  }

  @SubscribeMessage("chat:join")
  async handleChatJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { workspaceId?: string; sessionId?: string },
  ) {
    const userId = client.data.user?.id;
    const workspaceId = body?.workspaceId;

    if (!userId || !workspaceId) {
      return { ok: false };
    }

    const session = await this.chatService.getSession(workspaceId, userId);
    await client.join(this.getSessionRoom(session.sessionId));

    return {
      ok: true,
      sessionId: session.sessionId,
    };
  }

  @SubscribeMessage("chat:message")
  async handleChatMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    body: { workspaceId?: string; sessionId?: string; content?: string },
  ) {
    const userId = client.data.user?.id;
    const workspaceId = body?.workspaceId;
    const content = body?.content?.trim();

    if (!userId || !workspaceId || !content) {
      client.emit("chat:error", {
        workspaceId,
        sessionId: body?.sessionId,
        error: "Введите текст сообщения",
      });
      return { ok: false };
    }

    try {
      await this.chatService.streamMessage(workspaceId, userId, content, {
        sessionId: body.sessionId,
        onUserMessage: async ({ sessionId, userMessage }) => {
          await client.join(this.getSessionRoom(sessionId));
          this.server.to(this.getSessionRoom(sessionId)).emit("chat:user_message", {
            workspaceId,
            sessionId,
            message: userMessage,
          });
        },
        onChunk: ({ sessionId, chunk }) => {
          this.server.to(this.getSessionRoom(sessionId)).emit("chat:chunk", {
            workspaceId,
            sessionId,
            chunk,
          });
        },
        onDone: ({ sessionId, assistantMessage, stopped }) => {
          this.server.to(this.getSessionRoom(sessionId)).emit("chat:done", {
            workspaceId,
            sessionId,
            stopped,
            messageId: assistantMessage.id,
            sources: assistantMessage.sources,
            message: assistantMessage,
          });
        },
      });

      return { ok: true };
    } catch (error) {
      client.emit("chat:error", {
        workspaceId,
        sessionId: body.sessionId,
        error: this.getErrorMessage(error),
      });
      return { ok: false };
    }
  }

  @SubscribeMessage("chat:stop")
  handleChatStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { sessionId?: string },
  ) {
    const sessionId = body?.sessionId;
    if (!client.data.user?.id || !sessionId) {
      return { ok: false };
    }

    this.chatService.requestStop(sessionId);
    return { ok: true };
  }

  emitNotification(
    userId: string,
    notification: {
      id: string;
      type: string;
      title: string;
      message: string;
      read: boolean;
      metadata: unknown;
      createdAt: Date;
    },
  ) {
    this.server.to(this.getUserRoom(userId)).emit("notification", {
      notification,
    });
  }

  emitDocumentProgress(
    userId: string,
    workspaceId: string,
    payload: {
      documentId: string;
      percent: number;
      step: string;
      status?: "PENDING" | "PROCESSING" | "READY" | "ERROR";
    },
  ) {
    const event = {
      workspaceId,
      ...payload,
    };

    this.server.to(this.getUserRoom(userId)).emit("doc:progress", event);
    this.server.to(this.getWorkspaceRoom(workspaceId)).emit("doc:progress", event);
  }

  emitDocumentReady(
    userId: string,
    workspaceId: string,
    payload: { documentId: string },
  ) {
    const event = {
      workspaceId,
      ...payload,
    };

    this.server.to(this.getUserRoom(userId)).emit("doc:ready", event);
    this.server.to(this.getWorkspaceRoom(workspaceId)).emit("doc:ready", event);
  }

  emitDocumentError(
    userId: string,
    workspaceId: string,
    payload: { documentId: string; error: string },
  ) {
    const event = {
      workspaceId,
      ...payload,
    };

    this.server.to(this.getUserRoom(userId)).emit("doc:error", event);
    this.server.to(this.getWorkspaceRoom(workspaceId)).emit("doc:error", event);
  }

  private extractToken(client: AuthenticatedSocket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string" && authToken.trim()) {
      return authToken;
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice(7);
    }

    return null;
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private getWorkspaceRoom(workspaceId: string) {
    return `workspace:${workspaceId}`;
  }

  private getSessionRoom(sessionId: string) {
    return `chat:${sessionId}`;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return "Не удалось выполнить realtime-запрос";
  }
}
