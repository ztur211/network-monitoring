import { Test } from '@nestjs/testing';
import { AiRateLimiterService } from '../rate-limiting/ai-rate-limiter.service';
import { RedisService } from '../../redis/redis.service';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

const mockPipeline = {
  incr: jest.fn().mockReturnThis(),
  incrby: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  mget: jest.fn(),
  pipeline: jest.fn().mockReturnValue(mockPipeline),
} as unknown as jest.Mocked<RedisService>;

describe('AiRateLimiterService', () => {
  let service: AiRateLimiterService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiRateLimiterService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(AiRateLimiterService);
    jest.clearAllMocks();
    mockRedis.pipeline = jest.fn().mockReturnValue(mockPipeline);
    mockPipeline.exec.mockResolvedValue([]);
  });

  describe('checkRateLimits', () => {
    it('passes when all counters are under their limits', async () => {
      mockRedis.mget.mockResolvedValue(['5', '10', '50000', '20']);
      await expect(service.checkRateLimits('user-1', '127.0.0.1')).resolves.not.toThrow();
    });

    it('passes when counters are null (first request)', async () => {
      mockRedis.mget.mockResolvedValue([null, null, null, null]);
      await expect(service.checkRateLimits('user-1', '127.0.0.1')).resolves.not.toThrow();
    });

    it('throws AI_001 when hourly limit is reached', async () => {
      mockRedis.mget.mockResolvedValue(['20', '10', '50000', '20']);
      await expect(service.checkRateLimits('user-1', '127.0.0.1')).rejects.toThrow(NodeScopeException);
      await expect(service.checkRateLimits('user-1', '127.0.0.1'))
        .rejects.toMatchObject({ code: 'AI_001' });
    });

    it('throws AI_002 when daily limit is reached', async () => {
      mockRedis.mget.mockResolvedValue(['5', '100', '50000', '20']);
      await expect(service.checkRateLimits('user-1', '127.0.0.1'))
        .rejects.toMatchObject({ code: 'AI_002' });
    });

    it('throws AI_003 when monthly token budget is exhausted', async () => {
      mockRedis.mget.mockResolvedValue(['5', '10', '100000', '20']);
      await expect(service.checkRateLimits('user-1', '127.0.0.1'))
        .rejects.toMatchObject({ code: 'AI_003' });
    });

    it('throws AI_001 when per-IP hourly limit is reached', async () => {
      mockRedis.mget.mockResolvedValue(['5', '10', '50000', '50']);
      await expect(service.checkRateLimits('user-1', '127.0.0.1'))
        .rejects.toMatchObject({ code: 'AI_001' });
    });
  });

  describe('buildUsageWarning', () => {
    it('returns null when well under all limits', () => {
      const result = service.buildUsageWarning({ hourlyUsed: 5, dailyUsed: 10, monthlyTokensUsed: 50000 });
      expect(result).toBeNull();
    });

    it('returns warning when hourly usage reaches 80%', () => {
      const result = service.buildUsageWarning({ hourlyUsed: 16, dailyUsed: 10, monthlyTokensUsed: 50000 });
      expect(result).toContain('16/20 messages this hour');
    });

    it('returns warning when daily usage reaches 80%', () => {
      const result = service.buildUsageWarning({ hourlyUsed: 5, dailyUsed: 80, monthlyTokensUsed: 50000 });
      expect(result).toContain('80/100 messages today');
    });

    it('returns warning when monthly token usage reaches 80%', () => {
      const result = service.buildUsageWarning({ hourlyUsed: 5, dailyUsed: 10, monthlyTokensUsed: 80001 });
      expect(result).not.toBeNull();
      expect(result).toContain('token');
    });
  });

  describe('incrementUsage', () => {
    it('increments hourly, daily, and monthly token counters via pipeline', async () => {
      await service.incrementUsage('user-1', 500);
      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.incr).toHaveBeenCalledTimes(2);
      expect(mockPipeline.incrby).toHaveBeenCalledTimes(1);
      expect(mockPipeline.expire).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('getUsageCounts', () => {
    it('returns counts from Redis and includes limits', async () => {
      mockRedis.mget.mockResolvedValue(['5', '10', '50000']);
      const result = await service.getUsageCounts('user-1');
      expect(result.hourlyUsed).toBe(5);
      expect(result.dailyUsed).toBe(10);
      expect(result.monthlyTokensUsed).toBe(50000);
      expect(result.hourlyLimit).toBeGreaterThan(0);
      expect(result.dailyLimit).toBeGreaterThan(0);
      expect(result.monthlyTokenBudget).toBeGreaterThan(0);
      expect(result.resetsAt).toBeTruthy();
    });

    it('returns zeros when keys do not exist', async () => {
      mockRedis.mget.mockResolvedValue([null, null, null]);
      const result = await service.getUsageCounts('user-1');
      expect(result.hourlyUsed).toBe(0);
      expect(result.dailyUsed).toBe(0);
      expect(result.monthlyTokensUsed).toBe(0);
    });
  });
});
