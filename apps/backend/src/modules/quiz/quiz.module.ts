import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { QuizController } from "./quiz.controller";
import { QuizProcessor } from "./processors/quiz.processor";
import { QuizService } from "./quiz.service";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [QuizController],
  providers: [QuizService, QuizProcessor],
})
export class QuizModule {}
