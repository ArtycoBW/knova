import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";

export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
  AUDIO_PROCESSING: "audio-processing",
  MINDMAP_GENERATION: "mindmap-generation",
  PODCAST_GENERATION: "podcast-generation",
  QUIZ_GENERATION: "quiz-generation",
  REPORT_GENERATION: "report-generation",
  INFOGRAPHIC_GENERATION: "infographic-generation",
  TABLE_EXTRACTION: "table-extraction",
  PRESENTATION_GENERATION: "presentation-generation",
} as const;

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get("REDIS_HOST", "localhost"),
          port: config.get<number>("REDIS_PORT", 6379),
          password: config.get("REDIS_PASSWORD") || undefined,
        },
      }),
    }),
    ...Object.values(QUEUE_NAMES).map((name) =>
      BullModule.registerQueue({ name }),
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
