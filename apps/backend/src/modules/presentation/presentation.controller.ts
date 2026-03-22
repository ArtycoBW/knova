import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyReply, FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PresentationService } from "./presentation.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Presentation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("presentation")
export class PresentationController {
  constructor(private readonly presentationService: PresentationService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить презентацию воркспейса" })
  getWorkspacePresentation(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.presentationService.getWorkspacePresentation(
      workspaceId,
      req.user.id,
    );
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию презентации" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.presentationService.generate(workspaceId, req.user.id);
  }

  @Get(":workspaceId/file")
  @ApiOperation({ summary: "Скачать PPTX презентации воркспейса" })
  async download(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.presentationService.download(
      workspaceId,
      req.user.id,
    );
    const asciiFileName = file.fileName
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/_+/g, "_");
    const encodedFileName = encodeURIComponent(file.fileName);

    reply
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      )
      .header(
        "Content-Disposition",
        `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`,
      )
      .send(file.buffer);
  }
}
