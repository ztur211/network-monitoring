import { Controller, Delete, Get, HttpStatus, Param } from '@nestjs/common';
import { AiUsageDto, ApiSuccess } from '@nodescope/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AiService } from './ai.service';

// AI chat messaging is WebSocket-only (v1:ai:message → token stream). There is
// no HTTP message endpoint; this controller only exposes the usage read and the
// conversation-delete action.
@Controller('v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('usage')
  async getUsage(@CurrentUser() user: AuthenticatedUser): Promise<ApiSuccess<AiUsageDto>> {
    const usage = await this.aiService.getUsage(user.id);
    return { success: true, data: usage, timestamp: new Date().toISOString() };
  }

  @Delete('conversation/:conversationId')
  async deleteConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<ApiSuccess<null>> {
    const deleted = await this.aiService.deleteConversation(user.id, conversationId);
    if (!deleted) {
      throw new NodeScopeException('GEN_002', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
