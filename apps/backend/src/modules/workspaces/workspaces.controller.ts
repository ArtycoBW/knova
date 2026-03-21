import {
  Controller, Get, Post, Put, Delete,
  Body, Param, UseGuards, Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { WorkspacesService } from "./workspaces.service";
import {
  CompareDocumentsDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from "./dto/workspace.dto";

@ApiTags("Workspaces")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: "Все воркспейсы пользователя" })
  findAll(@Req() req: { user: { id: string } }) {
    return this.workspacesService.findAll(req.user.id);
  }

  @Get("stats")
  @ApiOperation({ summary: "Статистика пользователя" })
  getStats(@Req() req: { user: { id: string } }) {
    return this.workspacesService.getStats(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Воркспейс с документами" })
  findOne(@Param("id") id: string, @Req() req: { user: { id: string } }) {
    return this.workspacesService.findOne(id, req.user.id);
  }

  @Post()
  @ApiOperation({ summary: "Создать воркспейс" })
  create(@Req() req: { user: { id: string } }, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(req.user.id, dto);
  }

  @Put(":id")
  @ApiOperation({ summary: "Обновить воркспейс" })
  update(
    @Param("id") id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(id, req.user.id, dto);
  }

  @Post(":id/compare")
  @ApiOperation({ summary: "Сравнить два документа внутри воркспейса" })
  compare(
    @Param("id") id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: CompareDocumentsDto,
  ) {
    return this.workspacesService.compare(id, req.user.id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Удалить воркспейс" })
  remove(@Param("id") id: string, @Req() req: { user: { id: string } }) {
    return this.workspacesService.remove(id, req.user.id);
  }
}
