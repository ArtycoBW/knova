import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateProfileDto, ChangePasswordDto } from "./dto/update-profile.dto";
import { UserRole } from "@prisma/client";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingDone: true, xp: { increment: 100 } },
    });
    return { xp: user.xp, message: "Онбординг завершён" };
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
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      xp: user.xp,
      level: user.level,
      onboardingDone: user.onboardingDone,
    };
  }
}
