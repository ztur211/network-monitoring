import { Test } from '@nestjs/testing';
import { ContextBuilderService } from '../context/context-builder.service';
import { NETWORK_CONTEXT_PROVIDER, REALTIME_CONTEXT_PROVIDER, ACCOUNT_CONTEXT_PROVIDER, PRODUCT_CONTEXT_PROVIDER, RAG_CONTEXT_PROVIDER } from '../context/context-provider.interface';

const mockNetwork = { getContext: jest.fn() };
const mockRealtime = { getContext: jest.fn() };
const mockAccount = { getContext: jest.fn() };
const mockProduct = { getContext: jest.fn() };
const mockRag = { getContext: jest.fn() };

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ContextBuilderService,
        { provide: NETWORK_CONTEXT_PROVIDER, useValue: mockNetwork },
        { provide: REALTIME_CONTEXT_PROVIDER, useValue: mockRealtime },
        { provide: ACCOUNT_CONTEXT_PROVIDER, useValue: mockAccount },
        { provide: PRODUCT_CONTEXT_PROVIDER, useValue: mockProduct },
        { provide: RAG_CONTEXT_PROVIDER, useValue: mockRag },
      ],
    }).compile();

    service = module.get(ContextBuilderService);
    jest.clearAllMocks();
  });

  describe('buildSystemPrompt', () => {
    it('includes all four context sections in the system prompt', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 3 devices including Router');
      mockRealtime.getContext.mockResolvedValue('Realtime: latency 20ms');
      mockAccount.getContext.mockResolvedValue('Account: PERSONAL_FREE tier');
      mockProduct.getContext.mockResolvedValue('Product: map and device features');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE');

      expect(prompt).toContain('Network: 3 devices including Router');
      expect(prompt).toContain('Realtime: latency 20ms');
      expect(prompt).toContain('Account: PERSONAL_FREE tier');
      expect(prompt).toContain('Product: map and device features');
    });

    it('includes honesty boundary instructions', async () => {
      mockNetwork.getContext.mockResolvedValue('');
      mockRealtime.getContext.mockResolvedValue('');
      mockAccount.getContext.mockResolvedValue('');
      mockProduct.getContext.mockResolvedValue('');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE');

      expect(prompt).toContain('planned');
      expect(prompt.toLowerCase()).toContain('acknowledge');
    });

    it('passes organizationId, userId, and userTier to context providers', async () => {
      mockNetwork.getContext.mockResolvedValue('');
      mockRealtime.getContext.mockResolvedValue('');
      mockAccount.getContext.mockResolvedValue('');
      mockProduct.getContext.mockResolvedValue('');

      await service.buildSystemPrompt('org-42', 'user-42', 'PERSONAL_PAID');

      expect(mockNetwork.getContext).toHaveBeenCalledWith('org-42', 'user-42');
      expect(mockRealtime.getContext).toHaveBeenCalledWith('org-42', 'user-42');
      expect(mockAccount.getContext).toHaveBeenCalledWith('user-42', 'PERSONAL_PAID');
    });

    it('appends the RAG section, keyed on the user question, when a question is given', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 1 device');
      mockRealtime.getContext.mockResolvedValue('');
      mockAccount.getContext.mockResolvedValue('');
      mockProduct.getContext.mockResolvedValue('');
      mockRag.getContext.mockResolvedValue('## Relevant runbooks\n- Power-cycle the ONT');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE', 'why is my fibre down?', ['dev-1']);

      expect(mockRag.getContext).toHaveBeenCalledWith('org-1', 'user-1', 'why is my fibre down?', ['dev-1']);
      expect(prompt).toContain('## Relevant runbooks');
      expect(prompt).toContain('Power-cycle the ONT');
    });

    it('does not call the RAG provider, or change the prompt, when no question is given', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 1 device');
      mockRealtime.getContext.mockResolvedValue('');
      mockAccount.getContext.mockResolvedValue('');
      mockProduct.getContext.mockResolvedValue('');
      mockRag.getContext.mockResolvedValue('## Relevant runbooks\n- should not appear');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE');

      expect(mockRag.getContext).not.toHaveBeenCalled();
      expect(prompt).not.toContain('Relevant runbooks');
    });

    it('omits the RAG section when the retriever returns nothing (byte-identical to no-RAG)', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 1 device');
      mockRealtime.getContext.mockResolvedValue('');
      mockAccount.getContext.mockResolvedValue('');
      mockProduct.getContext.mockResolvedValue('');
      mockRag.getContext.mockResolvedValue(''); // no results

      const withQuestion = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE', 'q');
      const withoutQuestion = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE');
      expect(withQuestion).toBe(withoutQuestion);
    });
  });

  describe('estimateTokenCount', () => {
    it('returns approximate token count based on character length', () => {
      const count = service.estimateTokenCount('hello world');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20);
    });
  });
});
