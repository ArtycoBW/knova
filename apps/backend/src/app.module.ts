import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { QueueModule } from "./modules/queue/queue.module";
import { LlmModule } from "./modules/llm/llm.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { ChatModule } from "./modules/chat/chat.module";
import { MindmapModule } from "./modules/mindmap/mindmap.module";
import { PodcastModule } from "./modules/podcast/podcast.module";
import { QuizModule } from "./modules/quiz/quiz.module";
import { TableModule } from "./modules/table/table.module";
import { InfographicModule } from "./modules/infographic/infographic.module";
import { SearchModule } from "./modules/search/search.module";
import { BullBoardPlugin } from "./modules/queue/bull-board.plugin";
import { SettingsController } from "./modules/auth/settings.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    PrismaModule,
    QueueModule,
    LlmModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DocumentsModule,
    ChatModule,
    MindmapModule,
    PodcastModule,
    QuizModule,
    TableModule,
    InfographicModule,
    SearchModule,
  ],
  controllers: [SettingsController],
  providers: [
    BullBoardPlugin,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
