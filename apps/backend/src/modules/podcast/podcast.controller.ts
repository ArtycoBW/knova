import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { GeneratePodcastDto } from "./dto/generate-podcast.dto";
import { PodcastService } from "./podcast.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Podcast")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("podcast")
export class PodcastController {
  constructor(private readonly podcastService: PodcastService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить подкаст воркспейса" })
  getWorkspacePodcast(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.podcastService.getWorkspacePodcast(workspaceId, req.user.id);
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию подкаста" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: GeneratePodcastDto,
  ) {
    return this.podcastService.generate(workspaceId, req.user.id, dto);
  }
}
