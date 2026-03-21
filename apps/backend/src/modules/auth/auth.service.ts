import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto, VerifyCodeDto, RegisterProfileDto } from "./dto/register.dto";
import { LoginDto, LoginVerifyDto } from "./dto/login.dto";
import { ResetPasswordDto, ResetPasswordConfirmDto } from "./dto/reset-password.dto";
import { CodeType, UserRole } from "@prisma/client";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing?.isVerified) {
      throw new ConflictException("Пользователь с таким email уже существует");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = existing
      ? await this.prisma.user.update({
          where: { email: dto.email },
          data: { password: hashedPassword },
        })
      : await this.prisma.user.create({
          data: { email: dto.email, password: hashedPassword },
        });

    const code = this.generateCode();
    await this.saveVerificationCode(dto.email, code, CodeType.REGISTER, user.id);

    return { message: "Код подтверждения отправлен", verificationCode: code };
  }

  async registerVerify(dto: VerifyCodeDto) {
    const record = await this.validateCode(dto.email, dto.code, CodeType.REGISTER);

    await this.prisma.user.update({
      where: { id: record.userId! },
      data: { isVerified: true },
    });

    return { userId: record.userId, step: "profile" };
  }

  async registerProfile(userId: string, dto: RegisterProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        organization: dto.organization,
        role: (dto.role as UserRole) || UserRole.STUDENT,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException("Неверный email или пароль");
    }

    const code = this.generateCode();
    await this.saveVerificationCode(dto.email, code, CodeType.LOGIN, user.id);

    return { message: "Код подтверждения отправлен", verificationCode: code };
  }

  async loginVerify(dto: LoginVerifyDto) {
    const record = await this.validateCode(dto.email, dto.code, CodeType.LOGIN);

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId! },
    });

    const tokens = await this.generateTokens(user!.id, user!.email);
    return { ...tokens, user: this.sanitizeUser(user!) };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      return { message: "Если email зарегистрирован, код будет отправлен" };
    }

    const code = this.generateCode();
    await this.saveVerificationCode(dto.email, code, CodeType.RESET_PASSWORD, user.id);

    return {
      message: "Код подтверждения отправлен",
      verificationCode: code,
    };
  }

  async resetPasswordConfirm(dto: ResetPasswordConfirmDto) {
    const record = await this.validateCode(
      dto.email,
      dto.code,
      CodeType.RESET_PASSWORD,
    );

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: record.userId! },
      data: { password: hashedPassword },
    });

    return { message: "Пароль успешно изменён" };
  }

  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Невалидный refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден");
    }

    await this.prisma.session.delete({ where: { id: session.id } });
    return this.generateTokens(user.id, user.email);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.deleteMany({ where: { refreshToken } });
    return { message: "Выход выполнен" };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException("Пользователь не найден");
    return { user: this.sanitizeUser(user) };
  }

  private generateCode(): string {
    return Math.floor(10000 + Math.random() * 90000).toString();
  }

  private async saveVerificationCode(
    email: string,
    code: string,
    type: CodeType,
    userId: string,
  ) {
    await this.prisma.verificationCode.deleteMany({
      where: { email, type, used: false },
    });

    await this.prisma.verificationCode.create({
      data: {
        email,
        code,
        type,
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }

  private async validateCode(email: string, code: string, type: CodeType) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { email, code, type, used: false },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      throw new BadRequestException("Неверный код подтверждения");
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException("Код истёк, запросите новый");
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { used: true },
    });

    return record;
  }

  private async generateTokens(userId: string, email: string) {
    const accessToken = this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get("JWT_SECRET"),
        expiresIn: this.config.get("JWT_EXPIRES_IN", "15m"),
      },
    );

    const refreshToken = this.jwt.sign(
      { sub: userId },
      {
        secret: this.config.get("JWT_REFRESH_SECRET"),
        expiresIn: this.config.get("JWT_REFRESH_EXPIRES_IN", "30d"),
      },
    );

    await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
    role: UserRole;
    avatarUrl: string | null;
    xp: number;
    level: number;
    onboardingDone: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organization: user.organization,
      role: user.role,
      avatarUrl: user.avatarUrl,
      xp: user.xp,
      level: user.level,
      onboardingDone: user.onboardingDone,
    };
  }
}
