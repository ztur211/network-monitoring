import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import type { MapPreferences } from '@nodescope/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  update(userId: string, data: Partial<Pick<User, 'name' | 'email'>>): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  updateLocation(userId: string, latitude: number, longitude: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { homeLatitude: latitude, homeLongitude: longitude },
    });
  }

  async existsByEmail(email: string, excludeUserId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email, NOT: { id: excludeUserId } },
      select: { id: true },
    });
    return user !== null;
  }

  async getPreferences(userId: string): Promise<MapPreferences> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mapPreferences: true },
    });
    if (!user) return {};
    return (user.mapPreferences as MapPreferences) ?? {};
  }

  async updatePreferences(userId: string, prefs: MapPreferences): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mapPreferences: prefs as Prisma.InputJsonValue },
    });
  }

  async markOnboardingComplete(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
    });
  }

  async isOnboardingComplete(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    });
    return user?.onboardingCompletedAt != null;
  }
}
