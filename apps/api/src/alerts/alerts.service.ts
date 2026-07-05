import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlertRepository } from './alert.repository';
import { CHANNEL_DISPATCHER, ChannelDispatcher } from './channel-dispatcher';
import { CreateChannelDto, CreateRuleDto } from './alerts.dto';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import type { RuleScope } from './alerts.types';

@Injectable()
export class AlertsService {
  constructor(
    private readonly repo: AlertRepository,
    @Inject(CHANNEL_DISPATCHER) private readonly dispatcher: ChannelDispatcher,
  ) {}

  createChannel(orgId: string, dto: CreateChannelDto) {
    return this.repo.createChannel(orgId, {
      type: dto.type, name: dto.name, enabled: dto.enabled,
      config: dto.config as Prisma.JsonValue | undefined, secret: dto.secret,
    });
  }
  listChannels(orgId: string) { return this.repo.listChannels(orgId); }
  deleteChannel(orgId: string, id: string) { return this.repo.deleteChannel(orgId, id); }

  async createRule(orgId: string, dto: CreateRuleDto) {
    if (dto.channelIds.length) {
      const orgChannelIds = new Set((await this.repo.listChannels(orgId)).map((c) => c.id));
      const foreign = dto.channelIds.some((id) => !orgChannelIds.has(id));
      if (foreign) {
        throw new NodeScopeException('ALERT_001', 'CHANNEL_NOT_FOUND', HttpStatus.BAD_REQUEST);
      }
    }
    return this.repo.createRule(orgId, { ...dto, scope: dto.scope as unknown as RuleScope, targetStates: dto.targetStates ?? [] });
  }
  listRules(orgId: string) { return this.repo.listRules(orgId); }
  deleteRule(orgId: string, id: string) { return this.repo.deleteRule(orgId, id); }
  listEvents(orgId: string) { return this.repo.listEvents(orgId); }

  /** Send a synthetic event through a channel to validate config/reachability. */
  async testChannel(orgId: string, id: string): Promise<void> {
    const [full] = await this.repo.channelsByIds([id]);
    if (!full || full.organizationId !== orgId) throw new Error('channel not found');
    await this.dispatcher.dispatch(full, {
      id: 'test', organizationId: orgId, ruleId: 'test', deviceId: null, kind: 'FIRING',
      severity: 'INFO', detail: { test: true }, dedupKey: 'test', createdAt: new Date(),
    });
  }
}
