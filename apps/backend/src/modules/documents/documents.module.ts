import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ChatModule } from "../chat/chat.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentProcessor } from "./processors/document.processor";
import { AudioProcessor } from "./processors/audio.processor";

@Module({
  imports: [
    ChatModule,
    BullModule.registerQueue(
      { name: "document-processing" },
      { name: "audio-processing" },
    ),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentProcessor, AudioProcessor],
})
export class DocumentsModule {}
