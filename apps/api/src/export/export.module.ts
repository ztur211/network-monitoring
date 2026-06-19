import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { PropertiesModule } from '../properties/properties.module';
import { PermissionsModule } from '../permissions/permissions.module';

// PrismaModule is @Global (PrismaService is app-wide); PropertiesModule (F2 subtree) +
// PermissionsModule (F3 scope) are imported for the export gather.
@Module({
  imports: [PropertiesModule, PermissionsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
