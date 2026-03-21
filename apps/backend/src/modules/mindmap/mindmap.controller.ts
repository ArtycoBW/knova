import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MindmapService } from "./mindmap.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Mindmap")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("mindmap")
export class MindmapController {
  constructor(private readonly mindmapService: MindmapService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить карту знаний воркспейса" })
  getWorkspaceMindmap(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mindmapService.getWorkspaceMindmap(workspaceId, req.user.id);
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию карты знаний" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mindmapService.generate(workspaceId, req.user.id);
  }
}
