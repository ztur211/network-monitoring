import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChangeLogRepository } from './change-log.repository';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ChangeLogRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
