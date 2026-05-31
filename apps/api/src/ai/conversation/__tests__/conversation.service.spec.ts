import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from '../conversation.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Conversation history is stored in Redis keyed by userId AND conversationId.
 * These tests pin that namespacing: it is the access-control boundary that
 * stops one authenticated user from reading/deleting another user's
 * conversation by supplying its UUID.
 */
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('ConversationService (userId-scoped keys)', () => {
  let service: ConversationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationService, { provide: RedisService, useValue: mockRedis }],
    }).compile();
    service = module.get(ConversationService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('reads history from a key namespaced by userId', async () => {
    await service.getHistory('user-A', 'conv-1');
    expect(mockRedis.get).toHaveBeenCalledWith('ai:conv:user-A:conv-1');
  });

  it('writes history under the user-scoped key with a 24h TTL', async () => {
    await service.appendMessages('user-A', 'conv-1', 'q', 'a');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'ai:conv:user-A:conv-1',
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('deletes only the requesting user’s copy of the conversation key', async () => {
    await service.deleteConversation('user-A', 'conv-1');
    expect(mockRedis.del).toHaveBeenCalledWith('ai:conv:user-A:conv-1');
  });

  it('two users supplying the SAME conversationId resolve different keys (no cross-user access)', async () => {
    await service.getHistory('user-A', 'shared-id');
    await service.getHistory('user-B', 'shared-id');
    expect(mockRedis.get).toHaveBeenNthCalledWith(1, 'ai:conv:user-A:shared-id');
    expect(mockRedis.get).toHaveBeenNthCalledWith(2, 'ai:conv:user-B:shared-id');
  });

  it('returns empty history (does not throw) when the Redis read fails', async () => {
    // History is a best-effort context source — a Redis blip must not bubble up
    // and fail the chat request from outside AiService's stream try/catch.
    mockRedis.get.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.getHistory('user-A', 'conv-1')).resolves.toEqual([]);
  });
});
