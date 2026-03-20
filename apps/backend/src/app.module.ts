import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { QueueModule } from "./modules/queue/queue.module";
import { LlmModule } from "./modules/llm/llm.module";
import { BullBoardPlugin } from "./modules/queue/bull-board.plugin";

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
  ],
  controllers: [],
  providers: [BullBoardPlugin],
})
export class AppModule {}
