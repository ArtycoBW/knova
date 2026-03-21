import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { PodcastController } from "./podcast.controller";
import { PodcastProcessor } from "./processors/podcast.processor";
import { PodcastService } from "./podcast.service";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [PodcastController],
  providers: [PodcastService, PodcastProcessor],
})
export class PodcastModule {}
