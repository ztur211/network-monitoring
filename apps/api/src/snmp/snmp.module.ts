import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { NetworksModule } from '../networks/networks.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SnmpController } from './snmp.controller';
import { SnmpRepository } from './snmp.repository';
import { SnmpService } from './snmp.service';

/**
 * SNMP management module: credential & OID-profile CRUD, F3-scoped assignment.
 *
 * Imports:
 *  - CryptoModule     → CryptoService (encrypt/decrypt secrets at rest)
 *  - PermissionsModule → PermissionsService (assertCanConfigure / assertNetworkFullCoverage)
 *  - NetworksModule   → NetworksRepository (charteredPropertyIds / deviceFootprintPropertyIds)
 *
 * PrismaModule is @Global so PrismaService is available without a local import.
 *
 * No circular deps: SnmpModule → NetworksModule (one-way). NetworksModule does not
 * import SnmpModule.
 */
@Module({
  imports: [CryptoModule, PermissionsModule, NetworksModule],
  controllers: [SnmpController],
  providers: [SnmpService, SnmpRepository],
  exports: [SnmpService, SnmpRepository],
})
export class SnmpModule {}
