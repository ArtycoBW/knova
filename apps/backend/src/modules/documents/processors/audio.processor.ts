import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { NotificationType } from "@prisma/client";
import { Job } from "bullmq";
import * as fs from "fs";
import * as ffmpeg from "fluent-ffmpeg";
import * as path from "path";
import { ChatGateway } from "../../chat/chat.gateway";
import { EmbeddingService } from "../../llm/embedding.service";
import { SttService } from "../../llm/stt.service";
import { PrismaService } from "../../prisma/prisma.service";

@Processor("audio-processing")
export class AudioProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly sttService: SttService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>) {
    const { documentId } = job.data;
    this.logger.log(`Транскрипция аудио/видео ${documentId}`);

    let tempAudio: string | null = null;

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    try {
      const doc = await this.prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          workspace: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      });

      await job.updateProgress(10);
      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 10,
        step: "Подготавливаем медиа",
        status: "PROCESSING",
      });

      let audioPath = doc.path;
      let transcriptionMimeType = doc.mimeType;

      if (doc.mimeType.startsWith("video/")) {
        tempAudio = await this.extractAudio(doc.path);
        audioPath = tempAudio;
        transcriptionMimeType = "audio/mpeg";
      }

      await job.updateProgress(30);
      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 30,
        step: "Расшифровываем аудио",
        status: "PROCESSING",
      });

      const buffer = fs.readFileSync(audioPath);
      const text = await this.sttService.transcribe(buffer, transcriptionMimeType);

      await job.updateProgress(60);
      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 60,
        step: "Создаём векторные фрагменты",
        status: "PROCESSING",
      });

      if (tempAudio && fs.existsSync(tempAudio)) {
        fs.unlinkSync(tempAudio);
      }

      const chunks = this.chunkText(text, 800, 150);
      await this.prisma.documentChunk.deleteMany({
        where: { documentId },
      });

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.embeddingService.embed(chunks[i]);
        await this.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", content, "chunkIndex", embedding, "createdAt")
          VALUES (
            gen_random_uuid()::text,
            ${documentId},
            ${chunks[i]},
            ${i},
            ${`[${embedding.join(",")}]`}::vector,
            NOW()
          )
        `;

        const percent = 60 + Math.round(((i + 1) / chunks.length) * 35);
        await job.updateProgress(percent);
        this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
          documentId,
          percent,
          step: "Создаём векторные фрагменты",
          status: "PROCESSING",
        });
      }

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "READY", extractedText: text.slice(0, 5000) },
      });

      const notification = await this.prisma.notification.create({
        data: {
          userId: doc.workspace.userId,
          type: NotificationType.DOCUMENT_READY,
          title: "Транскрипция готова",
          message: `Источник «${doc.name}» расшифрован и готов`,
          metadata: {
            workspaceId: doc.workspace.id,
            documentId: doc.id,
          },
        },
      });

      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 100,
        step: "Источник готов",
        status: "READY",
      });
      this.chatGateway.emitDocumentReady(doc.workspace.userId, doc.workspace.id, {
        documentId,
      });
      this.chatGateway.emitNotification(doc.workspace.userId, notification);

      this.logger.log(`Аудио ${documentId} транскрибировано, чанков: ${chunks.length}`);
    } catch (error) {
      this.logger.error(`Ошибка обработки аудио ${documentId}:`, error);
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: {
          workspace: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      });

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "ERROR" },
      });

      if (doc?.workspace?.userId) {
        const notification = await this.prisma.notification.create({
          data: {
            userId: doc.workspace.userId,
            type: NotificationType.SYSTEM,
            title: "Ошибка транскрипции",
            message: `Не удалось обработать источник «${doc.name}»`,
            metadata: {
              workspaceId: doc.workspace.id,
              documentId: doc.id,
            },
          },
        });

        this.chatGateway.emitDocumentError(doc.workspace.userId, doc.workspace.id, {
          documentId,
          error: "Не удалось расшифровать источник",
        });
        this.chatGateway.emitNotification(doc.workspace.userId, notification);
      }

      if (tempAudio && fs.existsSync(tempAudio)) {
        fs.unlinkSync(tempAudio);
      }

      throw error;
    }
  }

  private extractAudio(videoPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(path.dirname(videoPath), `${Date.now()}-audio.mp3`);
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec("libmp3lame")
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", reject)
        .run();
    });
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    const clean = text.replace(/\s+/g, " ").trim();

    while (start < clean.length) {
      const end = Math.min(start + chunkSize, clean.length);
      chunks.push(clean.slice(start, end));
      start += chunkSize - overlap;
    }

    const normalized = chunks.filter((chunk) => chunk.trim().length > 20);
    if (normalized.length) {
      return normalized;
    }

    return clean ? [clean] : [];
  }
}
