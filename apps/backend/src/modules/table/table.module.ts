import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { QueueModule } from "../queue/queue.module";
import { TableController } from "./table.controller";
import { TableProcessor } from "./processors/table.processor";
import { TableService } from "./table.service";

@Module({
  imports: [AuthModule, ChatModule, QueueModule],
  controllers: [TableController],
  providers: [TableService, TableProcessor],
})
export class TableModule {}
