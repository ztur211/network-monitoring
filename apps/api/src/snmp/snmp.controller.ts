import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { OrgId } from '../organizations/decorators/org-id.decorator';
import { OrgMember } from '../organizations/decorators/org-member.decorator';
import { OrgRoles } from '../organizations/decorators/org-roles.decorator';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { SnmpService } from './snmp.service';
import { AssignSnmpDto, CreateSnmpCredentialBodyDto, CreateOidProfileBodyDto } from './snmp.dto';

/**
 * SNMP credential / OID-profile management + assignment.
 *
 * All endpoints are session-authenticated (global AuthGuard) and restricted to
 * OWNER and ADMIN roles (OrgRoleGuard). Responses are manually wrapped in the
 * standard { success, data, timestamp } envelope — there is no global interceptor.
 *
 * Routes:
 *   POST   /v1/snmp/credentials         — create credential
 *   GET    /v1/snmp/credentials         — list credentials (secrets omitted)
 *   GET    /v1/snmp/credentials/:id     — get single credential
 *   DELETE /v1/snmp/credentials/:id     — delete (409 SNMP_003 if assigned)
 *   POST   /v1/snmp/profiles            — create OID profile
 *   GET    /v1/snmp/profiles            — list profiles (summary)
 *   GET    /v1/snmp/profiles/:id        — get profile with entries
 *   DELETE /v1/snmp/profiles/:id        — delete (409 SNMP_003 if assigned)
 *   POST   /v1/snmp/assign              — assign cred/profile to network or device (F3-scoped)
 */
@Controller('v1/snmp')
export class SnmpController {
  constructor(private readonly svc: SnmpService) {}

  // ─── Credentials ──────────────────────────────────────────────────────────

  @Post('credentials')
  @OrgRoles('OWNER', 'ADMIN')
  async createCredential(@OrgId() orgId: string, @Body() dto: CreateSnmpCredentialBodyDto) {
    const data = await this.svc.createCredential(orgId, dto as Parameters<typeof this.svc.createCredential>[1]);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('credentials')
  @OrgRoles('OWNER', 'ADMIN')
  async listCredentials(@OrgId() orgId: string) {
    const data = await this.svc.listCredentials(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('credentials/:id')
  @OrgRoles('OWNER', 'ADMIN')
  async getCredential(@OrgId() orgId: string, @Param('id') id: string) {
    const data = await this.svc.getCredential(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete('credentials/:id')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(200)
  async deleteCredential(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.deleteCredential(orgId, id);
    return { success: true, data: { id }, timestamp: new Date().toISOString() };
  }

  // ─── OID Profiles ─────────────────────────────────────────────────────────

  @Post('profiles')
  @OrgRoles('OWNER', 'ADMIN')
  async createProfile(@OrgId() orgId: string, @Body() dto: CreateOidProfileBodyDto) {
    const data = await this.svc.createProfile(orgId, dto as Parameters<typeof this.svc.createProfile>[1]);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('profiles')
  @OrgRoles('OWNER', 'ADMIN')
  async listProfiles(@OrgId() orgId: string) {
    const data = await this.svc.listProfiles(orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Get('profiles/:id')
  @OrgRoles('OWNER', 'ADMIN')
  async getProfile(@OrgId() orgId: string, @Param('id') id: string) {
    const data = await this.svc.getProfile(orgId, id);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  @Delete('profiles/:id')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(200)
  async deleteProfile(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.deleteProfile(orgId, id);
    return { success: true, data: { id }, timestamp: new Date().toISOString() };
  }

  // ─── Assignment ───────────────────────────────────────────────────────────

  /**
   * POST /v1/snmp/assign
   * Assign a credential and/or OID profile to a network or device.
   * F3-scoped: ADMIN must cover the governing site(s).
   */
  @Post('assign')
  @OrgRoles('OWNER', 'ADMIN')
  @HttpCode(200)
  async assign(@OrgMember() m: OrgMemberContext, @Body() dto: AssignSnmpDto) {
    const data = await this.svc.assign(m, dto);
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
