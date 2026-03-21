import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import * as fs from "fs";
import * as pdfParse from "pdf-parse";
import * as mammoth from "mammoth";
import { PrismaService } from "../../prisma/prisma.service";
import { EmbeddingService } from "../../llm/embedding.service";

@Processor("document-processing")
export class DocumentProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
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
      const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      const text = await this.extractText(doc.path, doc.mimeType);

      const chunks = this.chunkText(text, 800, 150);

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
        await job.updateProgress(Math.round((i / chunks.length) * 90));
      }

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "READY", extractedText: text.slice(0, 5000) },
      });

      this.logger.log(`Документ ${documentId} обработан, чанков: ${chunks.length}`);
    } catch (error) {
      this.logger.error(`Ошибка обработки документа ${documentId}:`, error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "ERROR" },
      });
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

    return chunks.filter((c) => c.trim().length > 20);
  }
}
