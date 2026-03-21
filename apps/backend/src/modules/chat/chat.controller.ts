import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SendChatMessageDto } from "./dto/chat-message.dto";
import { ChatService } from "./chat.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Chat")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить чат воркспейса" })
  getSession(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatService.getSession(workspaceId, req.user.id);
  }

  @Post(":workspaceId/messages")
  @ApiOperation({ summary: "Отправить сообщение в чат воркспейса" })
  sendMessage(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: SendChatMessageDto,
  ): Promise<unknown> {
    return this.chatService.sendMessage(workspaceId, req.user.id, body.content);
  }

  @Post("transcribe")
  @ApiOperation({ summary: "Расшифровать голосовой вопрос" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async transcribe(@Req() req: AuthenticatedRequest) {
    const data = await req.file();
    if (!data) {
      throw new BadRequestException("Файл не найден в запросе");
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.from(chunk));
    }

    return this.chatService.transcribeAudio(
      Buffer.concat(chunks),
      data.mimetype,
    );
  }
}
