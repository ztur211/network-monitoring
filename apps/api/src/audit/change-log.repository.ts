import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChangeLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(rows: Prisma.ChangeLogCreateManyInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.changeLog.createMany({ data: rows });
  }
}
