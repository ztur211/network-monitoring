import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PropertiesModule } from '../properties/properties.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { DevicesModule } from '../devices/devices.module';
import { BcfController } from './bcf.controller';
import { BcfService } from './bcf.service';
import { BcfImportService } from './bcf-import.service';
import { BcfExportService } from './bcf-export.service';

/**
 * BCF module — Spec 6 Phase C.
 *
 * Imports:
 *  - StorageModule     → StorageService (snapshot upload/download in import/export)
 *  - PropertiesModule  → PropertiesService (building lookup, subtree ids)
 *  - PermissionsModule → PermissionsService (assertCanConfigure / inScope F3 gates)
 *  - DevicesModule     → DevicesRepository (device GUID map for topic device links)
 *
 * PrismaModule is @Global, so PrismaService is available without a local import.
 *
 * No circular deps: BcfModule → {StorageModule, PropertiesModule, PermissionsModule,
 * DevicesModule}. None of those import BcfModule.
 */
@Module({
  imports: [StorageModule, PropertiesModule, PermissionsModule, DevicesModule],
  controllers: [BcfController],
  providers: [BcfService, BcfImportService, BcfExportService],
})
export class BcfModule {}
