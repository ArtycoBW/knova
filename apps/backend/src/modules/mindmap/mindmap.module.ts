import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { MindmapController } from "./mindmap.controller";
import { MindmapService } from "./mindmap.service";
import { MindmapProcessor } from "./processors/mindmap.processor";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [MindmapController],
  providers: [MindmapService, MindmapProcessor],
})
export class MindmapModule {}
