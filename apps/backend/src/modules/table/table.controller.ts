import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TableService } from "./table.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Table")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("table")
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить таблицу данных воркспейса" })
  getWorkspaceTable(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tableService.getWorkspaceTable(workspaceId, req.user.id);
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить извлечение таблицы данных" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tableService.generate(workspaceId, req.user.id);
  }
}
