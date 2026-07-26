/**
 * Unit tests for the agent-management client methods in api.service.ts.
 *
 * Strategy: mock the `axios` package so the `api` instance created by
 * api.service.ts uses our controlled mock, then verify each helper calls the
 * right path and unwraps the `{ success, data }` envelope.
 *
 * Component render is NOT tested here — the repo has no RN-component-test
 * infrastructure (no @testing-library/react, no react-test-renderer).
 * This is consistent with the Vitest scope (lib/*, store/*)
 * and is noted in phaseD-task-3-report.md.
 */

const mockGet = vi.fn();
const mockPost = vi.fn();

// Mock axios so the `api` instance created inside api.service.ts uses our fns.
vi.doMock('axios', () => {
  const instance = { get: mockGet, post: mockPost, interceptors: { response: { use: vi.fn() } } };
  const axiosStatic = {
    create: vi.fn(() => instance),
    isAxiosError: vi.fn(),
    // default export shape
    default: undefined as unknown,
  };
  axiosStatic.default = axiosStatic;
  return axiosStatic;
});

const { listAgents, generateAgentCode, revokeAgent } = await import('../api.service');

describe('agent client methods — endpoint + envelope', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listAgents()', () => {
    it('calls GET /agents and returns the unwrapped data array', async () => {
      const agents = [
        {
          id: 'a1',
          name: 'agent-1',
          platform: 'linux',
          version: '1.0.0',
          status: 'APPROVED',
          lastSeenAt: null,
        },
      ];
      mockGet.mockResolvedValueOnce({ data: { success: true, data: agents } });

      const result = await listAgents();

      expect(mockGet).toHaveBeenCalledWith('/agents');
      expect(result).toEqual(agents);
    });
  });

  describe('generateAgentCode()', () => {
    it('calls POST /agents/enrollment-code and returns { code }', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: { code: 'ABC-123' } },
      });

      const result = await generateAgentCode();

      expect(mockPost).toHaveBeenCalledWith('/agents/enrollment-code');
      expect(result).toEqual({ code: 'ABC-123' });
    });
  });

  describe('revokeAgent()', () => {
    it('calls POST /agents/:id/revoke with the correct id', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: null } });

      await revokeAgent('agent-99');

      expect(mockPost).toHaveBeenCalledWith('/agents/agent-99/revoke');
    });

    it('propagates errors so callers can handle them', async () => {
      mockPost.mockRejectedValueOnce(new Error('network error'));

      await expect(revokeAgent('agent-99')).rejects.toThrow('network error');
    });
  });
});
