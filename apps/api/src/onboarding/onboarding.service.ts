import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { DeviceCategory, DeviceMobility, Network } from '@prisma/client';
import {
  OnboardingProgress,
  OnboardingStepId,
  OnboardingTurnResponse,
  WS_EVENTS,
} from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import { DevicesService } from '../devices/devices.service';
import { GEOCODING_PROVIDER, GeocodingProvider } from '../map/geocoding/geocoding.interface';
import { NetworksRepository } from '../networks/networks.repository';
import { NetworksService } from '../networks/networks.service';
import { RedisService } from '../redis/redis.service';
import { UsersRepository } from '../users/users.repository';
import { AiService } from '../ai/ai.service';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';
import { OnboardingTurnDto } from './onboarding.dto';
import {
  handleStep,
  OnboardingInput,
  OnboardingSideEffect,
  renderStep,
} from './onboarding.state-machine';

interface PersistedState {
  stepId: OnboardingStepId;
  progress: OnboardingProgress;
}

const STATE_TTL_SECONDS = 24 * 60 * 60;
const DISMISSED_TTL_SECONDS = 30 * 24 * 60 * 60;

function stateKey(userId: string): string {
  return `onboarding:state:${userId}`;
}

function dismissedKey(userId: string): string {
  return `onboarding:dismissed:${userId}`;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly networksService: NetworksService,
    private readonly networksRepository: NetworksRepository,
    private readonly devicesService: DevicesService,
    private readonly devicesRepository: DevicesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly aiService: AiService,
    private readonly conflictService: ConflictResolutionService,
    @Inject(GEOCODING_PROVIDER) private readonly geocoder: GeocodingProvider,
    @Inject(REALTIME_SERVICE) private readonly realtimeService: IRealtimeService,
  ) {}

  async handleTurn(
    userId: string,
    ip: string,
    dto: OnboardingTurnDto,
  ): Promise<OnboardingTurnResponse> {
    // Decide whether this is a new/in-flight wizard or a restart of a FINISHED
    // one. This must NOT key on "user already has a Network": the wizard creates
    // the Network row early (at the address step) and keeps editing it, so a
    // network exists for most of the flow. The previous code threw ONBOARD_002
    // whenever there was no Redis state but a network existed — which
    // permanently locked a user out if their 24h state TTL expired mid-flow.
    // We gate instead on a durable "completed" marker written only when the
    // wizard actually finishes. No marker + no state ⇒ an abandoned/expired
    // session, which we resume from the top; the side effects are idempotent
    // (createBrowserDevice upserts, persistNetworkFields updates the existing
    // network, infra-device create swallows duplicate-name errors), so
    // re-walking the steps never duplicates data.
    const persisted = await this.redis.get(stateKey(userId));
    if (!persisted && (await this.isCompleted(userId))) {
      throw new NodeScopeException('ONBOARD_002', 'ONBOARDING_ALREADY_COMPLETE', HttpStatus.CONFLICT);
    }

    const state = persisted ? this.parseState(persisted) : { stepId: 'welcome' as OnboardingStepId, progress: {} };
    const input = this.buildInput(dto);

    const result = handleStep(state.stepId, state.progress, input);

    for (const effect of result.sideEffects) {
      await this.enactSideEffect(userId, ip, dto.browserDeviceId, effect);
    }

    const ai = await this.aiService.generateOnboardingMessage(
      userId,
      ip,
      result.nextStepId,
      result.progress,
      dto.userMessage,
    );
    const render = renderStep(result.nextStepId);

    await this.saveState(userId, { stepId: result.nextStepId, progress: result.progress });
    if (result.complete) {
      await this.redis.del(stateKey(userId));
      await this.markCompleted(userId);
    }

    const response: OnboardingTurnResponse = {
      stepId: result.nextStepId,
      botMessage: ai.content,
      chips: render.chips,
      fields: render.fields,
      progress: result.progress,
      complete: result.complete,
    };

    this.conflictService.emitEntityEvent(
      WS_EVENTS.ONBOARDING_TURN,
      { stepId: response.stepId, complete: response.complete },
      userId,
    );

    return response;
  }

  async skip(userId: string): Promise<void> {
    await this.redis.set(dismissedKey(userId), '1', 'EX', DISMISSED_TTL_SECONDS);
    await this.redis.del(stateKey(userId));
  }

  async isDismissedForSession(userId: string): Promise<boolean> {
    return (await this.redis.get(dismissedKey(userId))) === '1';
  }

  private async markCompleted(userId: string): Promise<void> {
    await this.usersRepository.markOnboardingComplete(userId);
  }

  private async isCompleted(userId: string): Promise<boolean> {
    return this.usersRepository.isOnboardingComplete(userId);
  }

  private async loadState(userId: string): Promise<PersistedState> {
    const raw = await this.redis.get(stateKey(userId));
    if (!raw) return { stepId: 'welcome', progress: {} };
    return this.parseState(raw);
  }

  private parseState(raw: string): PersistedState {
    try {
      return JSON.parse(raw) as PersistedState;
    } catch {
      return { stepId: 'welcome', progress: {} };
    }
  }

  private async saveState(userId: string, state: PersistedState): Promise<void> {
    await this.redis.set(stateKey(userId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
  }

  private buildInput(dto: OnboardingTurnDto): OnboardingInput {
    if (dto.chipChoice) return { kind: 'chip', value: dto.chipChoice };
    if (dto.fieldValues) return { kind: 'fields', values: dto.fieldValues };
    return { kind: 'init' };
  }

  private async enactSideEffect(
    userId: string,
    ip: string,
    browserDeviceId: string,
    effect: OnboardingSideEffect,
  ): Promise<void> {
    switch (effect.type) {
      case 'SaveNetwork':
        await this.persistNetworkFields(userId, effect.payload as unknown as Record<string, unknown>);
        break;
      case 'SaveBrowserDevice': {
        const network = await this.findUserNetwork(userId);
        await this.devicesService.createBrowserDevice(
          userId,
          browserDeviceId,
          effect.payload.name,
          effect.payload.mobility as DeviceMobility,
          network?.id,
        );
        break;
      }
      case 'SaveRouterDevice':
        await this.createInfrastructureDevice(userId, DeviceCategory.ROUTER, effect.payload);
        break;
      case 'SaveModemDevice':
        await this.createInfrastructureDevice(userId, DeviceCategory.MODEM, effect.payload);
        break;
      case 'SaveHomeIp':
        await this.persistNetworkFields(userId, { homePublicIp: ip });
        void this.realtimeService.recomputeOnHomeForUser(userId);
        break;
      case 'GeocodeAddress': {
        try {
          const result = await this.geocoder.geocode(effect.payload.address);
          if (result) {
            await this.persistNetworkFields(userId, {
              homeLatitude: result.latitude,
              homeLongitude: result.longitude,
            });
          }
        } catch (err) {
          this.logger.warn({ err }, 'Geocoding failed during onboarding — continuing without lat/lng');
        }
        break;
      }
    }
  }

  /**
   * Idempotent network upsert specifically for the onboarding flow. The
   * 1-per-user UX cap is enforced by NetworksService — once a network row
   * exists, this method updates it directly via the repository to avoid the
   * optimistic-concurrency dance (the wizard is the sole writer during this
   * session, so a version conflict here would only mean a duplicate
   * onboarding tab, which we want to fail loudly elsewhere).
   */
  private async persistNetworkFields(
    userId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.findUserNetwork(userId);
    if (!existing) {
      const created = await this.networksService.createNetwork(userId, {
        name: typeof fields.name === 'string' ? fields.name : 'Home',
        ...stripNameKey(fields),
      });
      return void created;
    }
    const updated = await this.networksRepository.updateWithVersion(
      existing.id,
      userId,
      stripNameKey(fields),
      existing.version,
    );
    if (!updated) {
      // optimistic-concurrency miss; for the wizard this is non-fatal —
      // just reload and skip rather than throwing through the user's flow
      this.logger.warn({ networkId: existing.id }, 'Network update version-conflict during onboarding');
    }
  }

  private async findUserNetwork(userId: string): Promise<Network | null> {
    const networks = await this.networksRepository.findAllByUserId(userId);
    return networks[0] ?? null;
  }

  private async createInfrastructureDevice(
    userId: string,
    category: DeviceCategory,
    payload: { name: string; macAddress: string | undefined },
  ): Promise<void> {
    const network = await this.findUserNetwork(userId);
    try {
      await this.devicesRepository.create({
        userId,
        name: payload.name,
        category,
        macAddress: payload.macAddress,
        networkId: network?.id,
      });
    } catch (err) {
      this.logger.warn(
        { err, category, payload },
        'Failed to persist infrastructure device during onboarding — wizard continues',
      );
    }
  }
}

function stripNameKey<T extends Record<string, unknown>>(obj: T): Omit<T, 'name'> {
  const { name: _omitted, ...rest } = obj;
  return rest;
}
