import { HttpStatus, Injectable } from '@nestjs/common';
import { Circuit } from '@prisma/client';
import { CircuitDto, CursorPaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { CIRCUIT_WRITABLE_FIELDS, CreateCircuitDto, ListCircuitsQueryDto, PatchCircuitDto } from './circuits.dto';
import { CircuitsRepository } from './circuits.repository';

const DEFAULT_LIMIT = 50;

/**
 * Sentinel value for device-less circuits. A circuit without a linked device has no governing
 * site, so we assign it the sentinel '__nosite__' — which is never in any member's subtree.
 * This means device-less circuits are OWNER-only for both reads and writes.
 */
const NO_SITE = '__nosite__';

@Injectable()
export class CircuitsService {
  constructor(
    private readonly circuitsRepository: CircuitsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async listCircuits(member: OrgMemberContext, query: ListCircuitsQueryDto): Promise<CursorPaginatedResponse<CircuitDto>> {
    const scope = await this.permissions.scopeFilter(member);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [items, total] = await Promise.all([
      this.circuitsRepository.findWithCursor(member.organizationId, limit + 1, query.cursor, scope ?? undefined),
      this.circuitsRepository.countByOrgId(member.organizationId, scope ?? undefined),
    ]);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
          }),
        ).toString('base64')
      : null;

    return { items: page.map((c) => this.toDto(c)), nextCursor, total };
  }

  async createCircuit(
    member: OrgMemberContext,
    creatorUserId: string,
    dto: CreateCircuitDto,
  ): Promise<CircuitDto> {
    // circuitGoverningSite also performs the device-exists check when deviceId is set.
    const governingSite = await this.circuitGoverningSite(member.organizationId, dto.deviceId ?? null);
    await this.permissions.assertCanConfigure(member, governingSite);

    const circuit = await this.circuitsRepository.create({
      organizationId: member.organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(member.organizationId, 'Circuit', circuit);
    return this.toDto(circuit);
  }

  async getCircuit(member: OrgMemberContext, circuitId: string): Promise<CircuitDto> {
    const scope = await this.permissions.scopeFilter(member);
    const circuit = await this.circuitsRepository.findVisibleByIdAndOrgId(circuitId, member.organizationId, scope);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(circuit);
  }

  async updateCircuit(
    member: OrgMemberContext,
    circuitId: string,
    patch: PatchCircuitDto,
  ): Promise<CircuitDto> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const circuit = await this.circuitsRepository.findByIdAndOrgId(circuitId, organizationId);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Authorize against the circuit's current governing site
    await this.permissions.assertCanConfigure(
      member,
      await this.circuitGoverningSite(organizationId, circuit.deviceId),
    );

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      CIRCUIT_WRITABLE_FIELDS,
      circuit.version,
      CreateCircuitDto,
    );

    // If patch changes deviceId to a new non-null device, also authorize against the new governing site
    if (updatePayload.deviceId !== undefined && updatePayload.deviceId !== null) {
      const newDeviceId = updatePayload.deviceId as string;
      if (newDeviceId !== circuit.deviceId) {
        await this.permissions.assertCanConfigure(
          member,
          await this.circuitGoverningSite(organizationId, newDeviceId),
        );
      }
    }

    const updated = await this.circuitsRepository.updateWithVersion(
      circuitId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    await this.audit.recordUpdate(organizationId, 'Circuit', circuitId, patch.changes);
    const site = await this.circuitGoverningSite(organizationId, updated.deviceId);
    await this.conflictService.emitScoped(
      organizationId,
      site,
      WS_EVENTS.CIRCUIT_UPDATED,
      { circuitId, circuit: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
    );
    return dto;
  }

  async deleteCircuit(member: OrgMemberContext, circuitId: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const circuit = await this.circuitsRepository.findByIdAndOrgId(circuitId, organizationId);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.permissions.assertCanConfigure(
      member,
      await this.circuitGoverningSite(organizationId, circuit.deviceId),
    );
    const site = await this.circuitGoverningSite(organizationId, circuit.deviceId);
    await this.circuitsRepository.deleteByIdAndOrgId(circuitId, organizationId);
    await this.audit.recordDelete(organizationId, 'Circuit', circuit);
    await this.conflictService.emitScoped(organizationId, site, WS_EVENTS.CIRCUIT_DELETED, { circuitId });
  }

  /**
   * Resolves the governing site for a circuit based on its linked device.
   * Returns `NO_SITE` ('__nosite__') when `deviceId` is null — device-less circuits
   * are OWNER-only (the sentinel is never in any member's subtree).
   * Also performs the device-exists check when `deviceId` is set.
   */
  private async circuitGoverningSite(organizationId: string, deviceId: string | null | undefined): Promise<string> {
    if (!deviceId) return NO_SITE;
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return device.propertyId;
  }

  private toDto(circuit: Circuit): CircuitDto {
    return {
      id: circuit.id,
      userId: circuit.userId,
      ispName: circuit.ispName,
      circuitId: circuit.circuitId,
      serviceType: circuit.serviceType,
      bandwidth: circuit.bandwidth,
      deviceId: circuit.deviceId,
      notes: circuit.notes,
      version: circuit.version,
      createdAt: circuit.createdAt.toISOString(),
      updatedAt: circuit.updatedAt.toISOString(),
    };
  }
}
