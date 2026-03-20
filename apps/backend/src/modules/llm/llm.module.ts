import { Global, Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { EmbeddingService } from "./embedding.service";
import { SttService } from "./stt.service";

@Global()
@Module({
  providers: [LlmService, EmbeddingService, SttService],
  exports: [LlmService, EmbeddingService, SttService],
})
export class LlmModule {}
