import { Injectable } from '@nestjs/common';
import { ConversationMessage } from '@nodescope/shared';
import { RedisService } from '../../redis/redis.service';

const CONV_TTL_SECONDS = 86400; // 24 hours
const MAX_HISTORY_PAIRS = 20;

function convKey(conversationId: string): string {
  return `ai:conv:${conversationId}`;
}

@Injectable()
export class ConversationService {
  constructor(private readonly redis: RedisService) {}

  createConversationId(): string {
    return crypto.randomUUID();
  }

  async getHistory(conversationId: string): Promise<ConversationMessage[]> {
    const raw = await this.redis.get(convKey(conversationId));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ConversationMessage[];
    } catch {
      return [];
    }
  }

  async appendMessages(
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const history = await this.getHistory(conversationId);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: assistantMessage });

    // Trim to MAX_HISTORY_PAIRS message pairs (2 messages per pair)
    const maxMessages = MAX_HISTORY_PAIRS * 2;
    const trimmed = history.length > maxMessages ? history.slice(-maxMessages) : history;

    await this.redis.set(convKey(conversationId), JSON.stringify(trimmed), 'EX', CONV_TTL_SECONDS);
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    const deleted = await this.redis.del(convKey(conversationId));
    return deleted > 0;
  }
}
