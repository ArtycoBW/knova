import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import * as crypto from "crypto";
import * as fs from "fs";
import { createWriteStream } from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Users")
@Controller("users")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Put("profile")
  @ApiOperation({ summary: "Обновить профиль" })
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Put("avatar")
  @ApiOperation({ summary: "Загрузить аватар" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadAvatar(@Req() req: AuthenticatedRequest) {
    const uploadRoot = process.env.UPLOAD_DIR || "./uploads";
    const avatarDir = path.join(uploadRoot, "avatars");
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException("Файл не найден в запросе");
    }

    const ext = path.extname(data.filename) || ".png";
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    const filePath = path.join(avatarDir, filename);

    await pipeline(data.file, createWriteStream(filePath));

    return this.usersService.uploadAvatar(req.user.id, filename);
  }

  @Put("password")
  @ApiOperation({ summary: "Сменить пароль" })
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(req.user.id, dto);
  }

  @Post("complete-onboarding")
  @ApiOperation({ summary: "Завершить онбординг" })
  completeOnboarding(@Req() req: AuthenticatedRequest) {
    return this.usersService.completeOnboarding(req.user.id);
  }

  @Get("notifications")
  @ApiOperation({ summary: "Список уведомлений" })
  getNotifications(@Req() req: AuthenticatedRequest) {
    return this.usersService.getNotifications(req.user.id);
  }

  @Post("notifications/:id/read")
  @ApiOperation({ summary: "Отметить уведомление прочитанным" })
  markNotificationRead(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.usersService.markNotificationRead(req.user.id, id);
  }

  @Get("stats")
  @ApiOperation({ summary: "Статистика пользователя" })
  getStats(@Req() req: AuthenticatedRequest) {
    return this.usersService.getStats(req.user.id);
  }
}
