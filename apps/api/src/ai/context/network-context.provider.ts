import { Injectable } from '@nestjs/common';
import { PermissionsRepository } from '../../permissions/permissions.repository';
import { PermissionsService } from '../../permissions/permissions.service';
import { NetworkContextRepository } from './network-context.repository';
import { truncateToTokenBudget } from './token-budget';

const MAX_INPUT_TOKENS = parseInt(process.env.AI_MAX_INPUT_TOKENS ?? '8000', 10);

// The network section is only one of several context blocks that must all share
// AI_MAX_INPUT_TOKENS with the conversation history. Cap it at ~40% of the input
// budget: generous enough to describe a substantial network, while leaving room
// for the realtime/account/product/RAG sections plus the chat history. This is a
// hard ceiling on the *assembled string*, so even a single pathological field
// (a device with a novel pasted into `notes`) that slipped past the repository's
// row caps cannot blow the prompt.
const NETWORK_CONTEXT_TOKEN_BUDGET = Math.floor(MAX_INPUT_TOKENS * 0.4);

@Injectable()
export class NetworkContextProvider {
  constructor(
    private readonly repository: NetworkContextRepository,
    private readonly permissionsRepo: PermissionsRepository,
    private readonly permissions: PermissionsService,
  ) {}

  async getContext(organizationId: string, userId: string): Promise<string> {
    const member = await this.permissionsRepo.findMember(organizationId, userId);
    const scope = member
      ? await this.permissions.scopeFilter(member)
      : { propertyIdIn: [] as string[] };
    // scope === null means OWNER: no filter. scope.propertyIdIn === [] means no
    // assignments yet: sees nothing. Non-member (member === null): empty list.
    const scopeIds = scope ? scope.propertyIdIn : null;

    const { devices, connections, fiberRuns, circuits } =
      await this.repository.getNetworkEntities(organizationId, scopeIds);

    const lines: string[] = ['## Documented Network'];

    if (devices.length === 0) {
      lines.push('No devices documented yet.');
    } else {
      lines.push(`### Devices (${devices.length})`);
      for (const d of devices) {
        let line = `- ${d.name} [${d.category}]`;
        if (d.ipAddress) line += ` IP:${d.ipAddress}`;
        if (d.floor != null) line += ` Floor:${d.floorLabel ?? d.floor}`;
        if (d.notes) line += ` — ${d.notes}`;
        lines.push(line);
      }
    }

    if (connections.length > 0) {
      lines.push(`### Connections (${connections.length})`);
      for (const c of connections) {
        lines.push(`- ${c.sourceDevice.name} → ${c.targetDevice.name} [${c.connectionType}]`);
      }
    }

    if (fiberRuns.length > 0) {
      lines.push(`### Fiber Runs (${fiberRuns.length})`);
      for (const f of fiberRuns) {
        let line = `- ${f.name}: ${f.startDevice.name} → ${f.endDevice.name}`;
        if (f.cableType) line += ` (${f.cableType})`;
        if (f.lengthMeters) line += ` ${f.lengthMeters}m`;
        lines.push(line);
      }
    }

    if (circuits.length > 0) {
      lines.push(`### ISP Circuits (${circuits.length})`);
      for (const c of circuits) {
        let line = `- ${c.ispName} ${c.serviceType}`;
        if (c.bandwidth) line += ` ${c.bandwidth}Mbps`;
        if (c.circuitId) line += ` (ID: ${c.circuitId})`;
        if (c.device) line += ` → terminates on ${c.device.name}`;
        lines.push(line);
      }
    }

    // Hard-bound the assembled section before it reaches the system prompt. The
    // repository row caps keep this well under budget in the common case; this
    // guarantees it even when individual rows carry huge free-text `notes`.
    return truncateToTokenBudget(lines.join('\n'), NETWORK_CONTEXT_TOKEN_BUDGET);
  }
}
