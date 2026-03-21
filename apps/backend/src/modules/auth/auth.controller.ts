import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { RegisterDto, VerifyCodeDto, RegisterProfileDto } from "./dto/register.dto";
import { LoginDto, LoginVerifyDto } from "./dto/login.dto";
import { ResetPasswordDto, ResetPasswordConfirmDto } from "./dto/reset-password.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Регистрация — шаг 1: email + пароль" })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("register/verify")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Регистрация — шаг 2: подтверждение кода" })
  registerVerify(@Body() dto: VerifyCodeDto) {
    return this.authService.registerVerify(dto);
  }

  @Put("register/profile")
  @ApiOperation({ summary: "Регистрация — шаг 3: заполнение профиля" })
  registerProfile(@Body() dto: RegisterProfileDto) {
    return this.authService.registerProfile(dto.userId, dto);
  }

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Логин — шаг 1: email + пароль" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("login/verify")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Логин — шаг 2: подтверждение кода" })
  loginVerify(@Body() dto: LoginVerifyDto) {
    return this.authService.loginVerify(dto);
  }

  @Post("reset-password")
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: "Сброс пароля — шаг 1: запрос кода" })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post("reset-password/confirm")
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: "Сброс пароля — шаг 2: код + новый пароль" })
  resetPasswordConfirm(@Body() dto: ResetPasswordConfirmDto) {
    return this.authService.resetPasswordConfirm(dto);
  }

  @Post("refresh")
  @ApiOperation({ summary: "Обновить токены" })
  refresh(@Body("refreshToken") refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post("logout")
  @ApiOperation({ summary: "Выход" })
  logout(@Body("refreshToken") refreshToken: string) {
    return this.authService.logout(refreshToken);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Текущий пользователь" })
  getMe(@Req() req: { user: { id: string } }) {
    return this.authService.getMe(req.user.id);
  }
}
