import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { PresentationController } from "./presentation.controller";
import { PresentationService } from "./presentation.service";
import { PresentationProcessor } from "./processors/presentation.processor";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [PresentationController],
  providers: [PresentationService, PresentationProcessor],
})
export class PresentationModule {}
