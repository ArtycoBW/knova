import {
  Controller, Post, Get, Delete,
  Param, UseGuards, Req, HttpCode, HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DocumentsService } from "./documents.service";
import { FastifyRequest } from "fastify";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

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
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } })
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const uploadDir = process.env.UPLOAD_DIR || "./uploads";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const data = await req.file();
    if (!data) {
      throw new Error("Файл не найден в запросе");
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

  @Delete("documents/:id")
  @ApiOperation({ summary: "Удалить документ" })
  remove(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.remove(id, req.user.id);
  }
}
