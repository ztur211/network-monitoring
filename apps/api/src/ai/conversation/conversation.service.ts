import { Injectable } from '@nestjs/common';
import { ConversationMessage } from '@nodescope/shared';
import { RedisService } from '../../redis/redis.service';

const CONV_TTL_SECONDS = 86400; // 24 hours
const MAX_HISTORY_PAIRS = 20;

// The conversationId is a server-generated UUID the client echoes back on each
// turn. Namespacing the Redis key by the authenticated userId means a client
// that supplies someone else's conversationId resolves a key under its OWN
// userId — so it can never read, append to, or delete another user's
// conversation. Without this, conversationId-only keys let any authenticated
// user reach any conversation by UUID (mitigated only by UUID unguessability).
function convKey(userId: string, conversationId: string): string {
  return `ai:conv:${userId}:${conversationId}`;
}

@Injectable()
export class ConversationService {
  constructor(private readonly redis: RedisService) {}

  createConversationId(): string {
    return crypto.randomUUID();
  }

  async getHistory(userId: string, conversationId: string): Promise<ConversationMessage[]> {
    const raw = await this.redis.get(convKey(userId, conversationId));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ConversationMessage[];
    } catch {
      return [];
    }
  }

  async appendMessages(
    userId: string,
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const history = await this.getHistory(userId, conversationId);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: assistantMessage });

    // Trim to MAX_HISTORY_PAIRS message pairs (2 messages per pair)
    const maxMessages = MAX_HISTORY_PAIRS * 2;
    const trimmed = history.length > maxMessages ? history.slice(-maxMessages) : history;

    await this.redis.set(
      convKey(userId, conversationId),
      JSON.stringify(trimmed),
      'EX',
      CONV_TTL_SECONDS,
    );
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const deleted = await this.redis.del(convKey(userId, conversationId));
    return deleted > 0;
  }
}
