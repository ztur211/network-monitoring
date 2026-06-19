import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SnmpModule } from '../snmp/snmp.module';
import { AgentRepository } from './agent.repository';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenGuard } from './agent-token.guard';
import { AgentIngestController } from './agent-ingest.controller';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

/**
 * Spec 8 agent registry core (Phase C): the agent/enrollment-code persistence,
 * token enroll/verify service, and the per-agent token guard. Phase D layers the
 * agent-facing endpoints + management surface on top of these exports.
 *
 * Imports SnmpModule (one-way dep: SnmpModule → CryptoModule/PermissionsModule/NetworksModule,
 * none of which import AgentModule) so SnmpService is available to AgentIngestController
 * for attaching resolved SNMP targets to the agent device-sync payload (Spec 9 Phase C).
 */
@Module({
  imports: [PrismaModule, AuditModule, SnmpModule],
  controllers: [AgentIngestController, AgentsController],
  providers: [AgentRepository, AgentTokenService, AgentTokenGuard, AgentsService],
  exports: [AgentTokenService, AgentRepository, AgentTokenGuard],
})
export class AgentModule {}
