import { Module } from '@nestjs/common';
import { PropertyTreeRepository } from './property-tree.repository';

/**
 * Standalone module for the shared Property-hierarchy queries. It depends only on the @Global
 * PrismaModule, so both PermissionsModule and PropertiesModule can import it to share the upward CTE
 * without creating a Permissions <-> Properties cycle.
 */
@Module({
  providers: [PropertyTreeRepository],
  exports: [PropertyTreeRepository],
})
export class PropertyTreeModule {}
