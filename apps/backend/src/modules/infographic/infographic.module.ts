import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { InfographicController } from "./infographic.controller";
import { InfographicProcessor } from "./processors/infographic.processor";
import { InfographicService } from "./infographic.service";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [InfographicController],
  providers: [InfographicService, InfographicProcessor],
})
export class InfographicModule {}
