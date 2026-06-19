import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { AgentTokenGuard } from './agent-token.guard';
import { AgentTokenService } from './agent-token.service';
import { AgentRepository } from './agent.repository';

export class EnrollDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsString()
  @IsNotEmpty()
  version: string;
}

@Controller('v1/monitoring/agent')
export class AgentIngestController {
  constructor(
    private readonly tokens: AgentTokenService,
    private readonly repo: AgentRepository,
  ) {}

  /**
   * Exchange an enrollment code for a persistent agent token.
   * No session guard and no AgentTokenGuard — auth is the enrollment code itself.
   */
  @Post('enroll')
  @Public()
  async enroll(@Body() body: EnrollDto) {
    const data = await this.tokens.enroll(body.code, {
      name: body.name,
      platform: body.platform,
      version: body.version,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Return the org's devices that have an IP address configured (the only ones
   * an agent can meaningfully probe).
   */
  @Get('devices')
  @Public()
  @UseGuards(AgentTokenGuard)
  async listDevices(@Req() req: { agent: { orgId: string; agentId: string } }) {
    const data = await this.repo.listOrgDevicesWithIp(req.agent.orgId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  /**
   * Agent heartbeat — the AgentTokenGuard already bumped lastSeenAt, so there
   * is nothing more to do; return 204 No Content.
   */
  @Post('heartbeat')
  @Public()
  @UseGuards(AgentTokenGuard)
  @HttpCode(204)
  heartbeat() {
    // Guard handles the side-effect; intentional no-op.
  }
}
