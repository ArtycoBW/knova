import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../../prisma/prisma.service";
import { EmbeddingService } from "../../llm/embedding.service";
import { SttService } from "../../llm/stt.service";

@Processor("audio-processing")
export class AudioProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly sttService: SttService,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>) {
    const { documentId } = job.data;
    this.logger.log(`Транскрипция аудио/видео ${documentId}`);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    try {
      const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });

      await job.updateProgress(10);

      let audioPath = doc.path;
      let tempAudio: string | null = null;

      if (doc.mimeType === "video/mp4") {
        tempAudio = await this.extractAudio(doc.path);
        audioPath = tempAudio;
      }

      await job.updateProgress(30);

      const buffer = fs.readFileSync(audioPath);
      const text = await this.sttService.transcribe(buffer, doc.mimeType);

      await job.updateProgress(60);

      if (tempAudio && fs.existsSync(tempAudio)) {
        fs.unlinkSync(tempAudio);
      }

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
        await job.updateProgress(60 + Math.round((i / chunks.length) * 35));
      }

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "READY", extractedText: text.slice(0, 5000) },
      });

      this.logger.log(`Аудио ${documentId} транскрибировано, чанков: ${chunks.length}`);
    } catch (error) {
      this.logger.error(`Ошибка обработки аудио ${documentId}:`, error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "ERROR" },
      });
      throw error;
    }
  }

  private extractAudio(videoPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpeg = require("fluent-ffmpeg");
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

    return chunks.filter((c) => c.trim().length > 20);
  }
}
