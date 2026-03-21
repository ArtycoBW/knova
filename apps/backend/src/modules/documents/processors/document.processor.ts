import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { NotificationType } from "@prisma/client";
import { Job } from "bullmq";
import * as fs from "fs";
import * as mammoth from "mammoth";
import pdfParse = require("pdf-parse");
import { ChatGateway } from "../../chat/chat.gateway";
import { EmbeddingService } from "../../llm/embedding.service";
import { PrismaService } from "../../prisma/prisma.service";

@Processor("document-processing")
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>) {
    const { documentId } = job.data;
    this.logger.log(`Обработка документа ${documentId}`);

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

      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 5,
        step: "Извлекаем текст",
        status: "PROCESSING",
      });

      const text = await this.extractText(doc.path, doc.mimeType);
      const chunks = this.chunkText(text, 800, 150);

      await this.prisma.documentChunk.deleteMany({
        where: { documentId },
      });

      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 20,
        step: "Создаём векторные фрагменты",
        status: "PROCESSING",
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

        const percent = 20 + Math.round(((i + 1) / chunks.length) * 70);
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
          title: "Документ обработан",
          message: `Источник «${doc.name}» готов к использованию`,
          metadata: {
            workspaceId: doc.workspace.id,
            documentId: doc.id,
          },
        },
      });

      this.chatGateway.emitDocumentProgress(doc.workspace.userId, doc.workspace.id, {
        documentId,
        percent: 100,
        step: "Документ готов",
        status: "READY",
      });
      this.chatGateway.emitDocumentReady(doc.workspace.userId, doc.workspace.id, {
        documentId,
      });
      this.chatGateway.emitNotification(doc.workspace.userId, notification);

      this.logger.log(`Документ ${documentId} обработан, чанков: ${chunks.length}`);
    } catch (error) {
      this.logger.error(`Ошибка обработки документа ${documentId}:`, error);
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
            title: "Ошибка обработки",
            message: `Не удалось обработать документ «${doc.name}»`,
            metadata: {
              workspaceId: doc.workspace.id,
              documentId: doc.id,
            },
          },
        });

        this.chatGateway.emitDocumentError(doc.workspace.userId, doc.workspace.id, {
          documentId,
          error: "Не удалось обработать документ",
        });
        this.chatGateway.emitNotification(doc.workspace.userId, notification);
      }

      throw error;
    }
  }

  private async extractText(filePath: string, mimeType: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);

    if (mimeType === "application/pdf") {
      const result = await pdfParse(buffer);
      return result.text;
    }

    if (mimeType.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    return buffer.toString("utf-8");
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
