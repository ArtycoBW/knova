import {
  Controller,
  Put,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { UpdateProfileDto, ChangePasswordDto } from "./dto/update-profile.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Users")
@Controller("users")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Put("profile")
  @ApiOperation({ summary: "Обновить профиль" })
  updateProfile(
    @Req() req: { user: { id: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Put("password")
  @ApiOperation({ summary: "Сменить пароль" })
  changePassword(
    @Req() req: { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(req.user.id, dto);
  }

  @Post("complete-onboarding")
  @ApiOperation({ summary: "Завершить онбординг" })
  completeOnboarding(@Req() req: { user: { id: string } }) {
    return this.usersService.completeOnboarding(req.user.id);
  }

  @Get("notifications")
  @ApiOperation({ summary: "Список уведомлений" })
  getNotifications(@Req() req: { user: { id: string } }) {
    return this.usersService.getNotifications(req.user.id);
  }

  @Post("notifications/:id/read")
  @ApiOperation({ summary: "Отметить уведомление прочитанным" })
  markNotificationRead(
    @Req() req: { user: { id: string } },
    @Param("id") id: string,
  ) {
    return this.usersService.markNotificationRead(req.user.id, id);
  }

  @Get("stats")
  @ApiOperation({ summary: "Статистика пользователя" })
  getStats(@Req() req: { user: { id: string } }) {
    return this.usersService.getStats(req.user.id);
  }
}
