import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import { PrismaService } from "../prisma/prisma.service";

const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "text/plain": "document",
  "text/markdown": "document",
  "text/x-markdown": "document",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/x-m4a": "audio",
  "audio/mp4": "audio",
  "video/mp4": "video",
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("document-processing") private readonly docQueue: Queue,
    @InjectQueue("audio-processing") private readonly audioQueue: Queue,
  ) {}

  async upload(
    workspaceId: string,
    userId: string,
    file: { originalname: string; mimetype: string; size: number; path: string },
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException("Воркспейс не найден");
    if (workspace.userId !== userId) throw new ForbiddenException("Нет доступа");

    const kind = ALLOWED_MIME[file.mimetype];
    if (!kind) throw new BadRequestException("Неподдерживаемый тип файла");

    const metadata = await this.extractMetadata(file.path, file.mimetype);

    const document = await this.prisma.document.create({
      data: {
        workspaceId,
        name: path.parse(file.originalname).name,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path,
        sourceType: kind === "document" ? "FILE" : kind === "audio" ? "AUDIO" : "VIDEO",
        status: "PENDING",
        pageCount: metadata.pageCount,
        duration: metadata.duration,
      },
    });

    if (kind === "document") {
      await this.docQueue.add(
        "process",
        { documentId: document.id },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
    } else {
      await this.audioQueue.add(
        "process",
        { documentId: document.id },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
    }

    return document;
  }

  async findByWorkspace(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException("Воркспейс не найден");
    if (workspace.userId !== userId) throw new ForbiddenException("Нет доступа");

    return this.prisma.document.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        size: true,
        sourceType: true,
        status: true,
        pageCount: true,
        duration: true,
        extractedText: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getFile(id: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { workspace: true },
    });
    if (!doc) throw new NotFoundException("Документ не найден");
    if (doc.workspace.userId !== userId) throw new ForbiddenException("Нет доступа");
    if (!fs.existsSync(doc.path)) {
      throw new NotFoundException("Файл документа не найден");
    }

    return {
      stream: fs.createReadStream(doc.path),
      mimeType: doc.mimeType,
      originalName: doc.originalName,
    };
  }

  async remove(id: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { workspace: true },
    });
    if (!doc) throw new NotFoundException("Документ не найден");
    if (doc.workspace.userId !== userId) throw new ForbiddenException("Нет доступа");

    if (fs.existsSync(doc.path)) {
      fs.unlinkSync(doc.path);
    }

    await this.prisma.document.delete({ where: { id } });
    return { message: "Документ удалён" };
  }

  private async extractMetadata(filePath: string, mimeType: string) {
    if (mimeType === "application/pdf") {
      const result = await pdfParse(fs.readFileSync(filePath));
      return { pageCount: result.numpages ?? undefined, duration: undefined };
    }

    if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
      const duration = await new Promise<number | undefined>((resolve) => {
        ffmpeg.ffprobe(filePath, (error, metadata) => {
          if (error) {
            resolve(undefined);
            return;
          }

          const seconds = metadata.format.duration;
          resolve(
            typeof seconds === "number" && Number.isFinite(seconds)
              ? Math.max(1, Math.round(seconds))
              : undefined,
          );
        });
      });

      return { pageCount: undefined, duration };
    }

    return { pageCount: undefined, duration: undefined };
  }
}
