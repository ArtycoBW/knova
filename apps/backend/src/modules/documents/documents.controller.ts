import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FastifyReply, FastifyRequest } from "fastify";
import * as crypto from "crypto";
import * as fs from "fs";
import { createWriteStream } from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DocumentsService } from "./documents.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Documents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post("workspaces/:workspaceId/documents")
  @ApiOperation({ summary: "Загрузить файл (PDF/DOCX/TXT/MP3/WAV/OGG/MP4)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const uploadDir = process.env.UPLOAD_DIR || "./uploads";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const data = await req.file();
    if (!data) {
      throw new BadRequestException("Файл не найден в запросе");
    }

    const ext = path.extname(data.filename) || "";
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    const filePath = path.join(uploadDir, uniqueName);

    await pipeline(data.file, createWriteStream(filePath));

    const stats = fs.statSync(filePath);

    return this.documentsService.upload(workspaceId, req.user.id, {
      originalname: data.filename,
      mimetype: data.mimetype,
      size: stats.size,
      path: filePath,
    });
  }

  @Get("workspaces/:workspaceId/documents")
  @ApiOperation({ summary: "Документы воркспейса" })
  findByWorkspace(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documentsService.findByWorkspace(workspaceId, req.user.id);
  }

  @Get("documents/:id/file")
  @ApiOperation({ summary: "Получить файл документа" })
  async getFile(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.documentsService.getFile(id, req.user.id);
    reply.type(file.mimeType);
    reply.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    return reply.send(file.stream);
  }

  @Delete("documents/:id")
  @ApiOperation({ summary: "Удалить документ" })
  remove(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.remove(id, req.user.id);
  }
}
