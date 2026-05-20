import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AiMessageResponseDto, AiUsageDto, ApiSuccess } from '@nodescope/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { AiService } from './ai.service';
import { SendAiMessageDto } from './ai.dto';

@Controller('v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendAiMessageDto,
    @Req() req: Request,
  ): Promise<ApiSuccess<AiMessageResponseDto>> {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.ip
      ?? '0.0.0.0';

    const result = await this.aiService.sendMessageHttp(
      user.id,
      (user as AuthenticatedUser & { tier: string }).tier,
      ip,
      dto,
    );

    return { success: true, data: result, timestamp: new Date().toISOString() };
  }

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
    const deleted = await this.aiService.deleteConversation(conversationId);
    if (!deleted) {
      throw new NodeScopeException('GEN_002', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return { success: true, data: null, timestamp: new Date().toISOString() };
  }
}
