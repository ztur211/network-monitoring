import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
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
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AgentIngestController, AgentsController],
  providers: [AgentRepository, AgentTokenService, AgentTokenGuard, AgentsService],
  exports: [AgentTokenService, AgentRepository, AgentTokenGuard],
})
export class AgentModule {}
