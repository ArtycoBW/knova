import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { InfographicService } from "./infographic.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Infographic")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("infographic")
export class InfographicController {
  constructor(private readonly infographicService: InfographicService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить инфографику воркспейса" })
  getWorkspaceInfographic(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.infographicService.getWorkspaceInfographic(
      workspaceId,
      req.user.id,
    );
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию инфографики" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.infographicService.generate(workspaceId, req.user.id);
  }
}
