import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { MapRepository } from './map.repository';
import { GEOCODING_PROVIDER } from './geocoding/geocoding.interface';
import { NominatimAdapter } from './geocoding/nominatim.adapter';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [MapController],
  providers: [
    MapService,
    MapRepository,
    { provide: GEOCODING_PROVIDER, useClass: NominatimAdapter },
  ],
  exports: [MapService, GEOCODING_PROVIDER],
})
export class MapModule {}
