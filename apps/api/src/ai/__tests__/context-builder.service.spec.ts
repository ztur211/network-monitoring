import { Test } from '@nestjs/testing';
import { ContextBuilderService } from '../context/context-builder.service';
import { NETWORK_CONTEXT_PROVIDER, REALTIME_CONTEXT_PROVIDER, ACCOUNT_CONTEXT_PROVIDER, PRODUCT_CONTEXT_PROVIDER, DEVICE_FOCUS_CONTEXT_PROVIDER } from '../context/context-provider.interface';

const mockNetwork = { getContext: jest.fn() };
const mockRealtime = { getContext: jest.fn() };
const mockAccount = { getContext: jest.fn() };
const mockProduct = { getContext: jest.fn() };
const mockDeviceFocus = { getContext: jest.fn() };

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
        { provide: DEVICE_FOCUS_CONTEXT_PROVIDER, useValue: mockDeviceFocus },
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
      mockDeviceFocus.getContext.mockResolvedValue('');

      await service.buildSystemPrompt('org-42', 'user-42', 'PERSONAL_PAID');

      expect(mockNetwork.getContext).toHaveBeenCalledWith('org-42', 'user-42');
      expect(mockRealtime.getContext).toHaveBeenCalledWith('org-42', 'user-42');
      expect(mockAccount.getContext).toHaveBeenCalledWith('user-42', 'PERSONAL_PAID');
    });

    it('includes ## Focused Device section when focusDeviceId is set and provider returns non-empty', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 3 devices');
      mockRealtime.getContext.mockResolvedValue('Realtime: ok');
      mockAccount.getContext.mockResolvedValue('Account: PERSONAL_FREE');
      mockProduct.getContext.mockResolvedValue('Product: map');
      mockDeviceFocus.getContext.mockResolvedValue('## Focused Device\n- **Router** [ROUTER] IP:10.0.0.1');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE', 'device-123');

      expect(prompt).toContain('## Focused Device');
      expect(mockDeviceFocus.getContext).toHaveBeenCalledWith('org-1', 'user-1', 'device-123');
    });

    it('places the focused device section after the network section', async () => {
      mockNetwork.getContext.mockResolvedValue('## Network\nsome network data');
      mockRealtime.getContext.mockResolvedValue('## Realtime\nsome realtime data');
      mockAccount.getContext.mockResolvedValue('## Account\nsome account data');
      mockProduct.getContext.mockResolvedValue('## Product\nsome product data');
      mockDeviceFocus.getContext.mockResolvedValue('## Focused Device\ndevice data');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE', 'device-123');

      const networkPos = prompt.indexOf('## Network');
      const focusPos = prompt.indexOf('## Focused Device');
      const realtimePos = prompt.indexOf('## Realtime');
      expect(networkPos).toBeLessThan(focusPos);
      expect(focusPos).toBeLessThan(realtimePos);
    });

    it('does not include ## Focused Device section when focusDeviceId is undefined', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 3 devices');
      mockRealtime.getContext.mockResolvedValue('Realtime: ok');
      mockAccount.getContext.mockResolvedValue('Account: PERSONAL_FREE');
      mockProduct.getContext.mockResolvedValue('Product: map');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE');

      expect(prompt).not.toContain('## Focused Device');
      expect(mockDeviceFocus.getContext).not.toHaveBeenCalled();
    });

    it('does not include ## Focused Device section when provider returns empty string', async () => {
      mockNetwork.getContext.mockResolvedValue('Network: 3 devices');
      mockRealtime.getContext.mockResolvedValue('Realtime: ok');
      mockAccount.getContext.mockResolvedValue('Account: PERSONAL_FREE');
      mockProduct.getContext.mockResolvedValue('Product: map');
      mockDeviceFocus.getContext.mockResolvedValue('');

      const prompt = await service.buildSystemPrompt('org-1', 'user-1', 'PERSONAL_FREE', 'device-999');

      expect(prompt).not.toContain('## Focused Device');
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
