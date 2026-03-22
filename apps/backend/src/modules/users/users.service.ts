import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationType, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        organization: dto.organization,
        bio: dto.bio,
        role: dto.role ? (dto.role as UserRole) : undefined,
      },
    });
    return { user: this.sanitize(user) };
  }

  async uploadAvatar(userId: string, filename: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("Пользователь не найден");
    }

    if (user.avatarUrl) {
      const currentPath = this.resolveAvatarPath(user.avatarUrl);
      if (currentPath && fs.existsSync(currentPath)) {
        fs.unlinkSync(currentPath);
      }
    }

    const avatarUrl = `${this.getPublicBaseUrl()}/uploads/avatars/${filename}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    return { avatarUrl };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Пользователь не найден");

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new BadRequestException("Неверный текущий пароль");

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: "Пароль изменён" };
  }

  async completeOnboarding(userId: string) {
    const existingBadge = await this.prisma.badge.findFirst({
      where: { userId, name: "Первопроходец" },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        onboardingDone: true,
        xp: existingBadge ? undefined : { increment: 100 },
      },
    });

    let badge = existingBadge;
    if (!badge) {
      badge = await this.prisma.badge.create({
        data: {
          userId,
          name: "Первопроходец",
          description: "Завершил первое знакомство с платформой",
          icon: "🚀",
        },
      });

      await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.BADGE_EARNED,
          title: "Новый бейдж",
          message: "Вы получили бейдж «Первопроходец»",
          metadata: {
            badgeId: badge.id,
            icon: badge.icon,
          },
        },
      });
    }

    return { user: this.sanitize(user), badge };
  }

  async getBadges(userId: string) {
    return this.prisma.badge.findMany({
      where: { userId },
      orderBy: { earnedAt: "desc" },
    });
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
    return { message: "Прочитано" };
  }

  async getStats(userId: string) {
    const [workspaces, documents, chatMessages, mindmaps, podcasts, quizzes] =
      await Promise.all([
        this.prisma.workspace.count({ where: { userId } }),
        this.prisma.document.count({
          where: { workspace: { userId } },
        }),
        this.prisma.chatMessage.count({
          where: { session: { workspace: { userId } } },
        }),
        this.prisma.mindmap.count({ where: { workspace: { userId } } }),
        this.prisma.podcast.count({ where: { workspace: { userId } } }),
        this.prisma.quiz.count({ where: { workspace: { userId } } }),
      ]);

    return { workspaces, documents, chatMessages, mindmaps, podcasts, quizzes };
  }

  private sanitize(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
    role: UserRole;
    avatarUrl: string | null;
    bio: string | null;
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
      avatarUrl: this.normalizeAvatarUrl(user.avatarUrl),
      bio: user.bio,
      xp: user.xp,
      level: user.level,
      onboardingDone: user.onboardingDone,
    };
  }

  private getPublicBaseUrl() {
    const appUrl = this.config.get<string>("APP_URL")?.trim();
    if (appUrl) {
      return appUrl.replace(/\/+$/, "");
    }

    const publicApiUrl = this.config.get<string>("PUBLIC_API_URL")?.trim();
    if (publicApiUrl) {
      return publicApiUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
    }

    return `http://localhost:${this.config.get<string>("PORT", "3001")}`;
  }

  private resolveAvatarPath(avatarUrl: string) {
    try {
      const url = new URL(avatarUrl);
      const relativePath = url.pathname.replace(/^\/uploads\//, "");
      return path.resolve(
        this.config.get<string>("UPLOAD_DIR", "./uploads"),
        relativePath,
      );
    } catch {
      return null;
    }
  }

  private normalizeAvatarUrl(avatarUrl: string | null) {
    if (!avatarUrl) {
      return null;
    }

    try {
      const url = new URL(avatarUrl);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return `${this.getPublicBaseUrl()}${url.pathname}`;
      }

      return avatarUrl;
    } catch {
      return avatarUrl;
    }
  }
}
