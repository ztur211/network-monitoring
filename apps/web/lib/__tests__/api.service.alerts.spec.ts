/**
 * Unit tests for the alert client methods added to api.service.ts.
 *
 * Strategy: mock the `axios` package so the `api` instance created by
 * api.service.ts uses our controlled mock, then verify each helper calls the
 * right path and unwraps the `{ success, data }` envelope. Mirrors
 * api.service.snmp.spec.ts.
 */

const jestEsm = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
};

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

// Mock axios so the `api` instance created inside api.service.ts uses our fns.
jestEsm.unstable_mockModule('axios', () => {
  const instance = {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
    interceptors: { response: { use: jest.fn() } },
  };
  const axiosStatic = {
    create: jest.fn(() => instance),
    isAxiosError: jest.fn(),
    default: undefined as unknown,
  };
  axiosStatic.default = axiosStatic;
  return axiosStatic;
});

describe('Alerts client methods — endpoint + envelope', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('listChannels GETs /alerts/channels', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [] } });
    const { listChannels } = await import('../api.service');
    await listChannels();
    expect(mockGet).toHaveBeenCalledWith('/alerts/channels');
  });

  it('createChannel POSTs /alerts/channels', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: { id: 'c1' } } });
    const { createChannel } = await import('../api.service');
    const res = await createChannel({ type: 'WEBHOOK', name: 'w' } as never);
    expect(mockPost).toHaveBeenCalledWith('/alerts/channels', { type: 'WEBHOOK', name: 'w' });
    expect(res.id).toBe('c1');
  });

  it('deleteChannel DELETEs /alerts/channels/:id', async () => {
    mockDelete.mockResolvedValue({ data: { success: true, data: null } });
    const { deleteChannel } = await import('../api.service');
    await deleteChannel('c1');
    expect(mockDelete).toHaveBeenCalledWith('/alerts/channels/c1');
  });

  it('testChannel POSTs /alerts/channels/:id/test', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: { sent: true } } });
    const { testChannel } = await import('../api.service');
    await testChannel('c1');
    expect(mockPost).toHaveBeenCalledWith('/alerts/channels/c1/test');
  });

  it('listRules/createRule/deleteRule hit the right paths', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [] } });
    mockPost.mockResolvedValue({ data: { success: true, data: { id: 'r1' } } });
    mockDelete.mockResolvedValue({ data: { success: true, data: { id: 'r1' } } });
    const m = await import('../api.service');
    await m.listRules();
    expect(mockGet).toHaveBeenCalledWith('/alerts/rules');
    await m.createRule({ name: 'r' } as never);
    expect(mockPost).toHaveBeenCalledWith('/alerts/rules', { name: 'r' });
    await m.deleteRule('r1');
    expect(mockDelete).toHaveBeenCalledWith('/alerts/rules/r1');
  });

  it('listAlertEvents GETs /alerts/events', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [] } });
    const { listAlertEvents } = await import('../api.service');
    await listAlertEvents();
    expect(mockGet).toHaveBeenCalledWith('/alerts/events');
  });
});
