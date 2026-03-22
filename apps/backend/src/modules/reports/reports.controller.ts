import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ReportsService } from "./reports.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить отчёт воркспейса" })
  getWorkspaceReport(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.getWorkspaceReport(workspaceId, req.user.id);
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию отчёта" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.generate(workspaceId, req.user.id);
  }
}
