/**
 * Unit test for the access-summary client method added to api.service.ts.
 *
 * Strategy: mock the `axios` package so the `api` instance created by
 * api.service.ts uses our controlled mock, then verify the helper calls the
 * right path and unwraps the `{ success, data }` envelope.
 *
 * Mirrors api.service.snmp.spec.ts's axios-mock harness exactly.
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

const { getAccessSummary } = await import('../api.service');

describe('getAccessSummary()', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GETs /access/me and unwraps data', async () => {
    mockGet.mockResolvedValueOnce({
      data: { success: true, data: { role: 'ADMIN', assignedRootPropertyIds: [], unscoped: true } },
    });

    const res = await getAccessSummary();

    expect(mockGet).toHaveBeenCalledWith('/access/me');
    expect(res.role).toBe('ADMIN');
  });
});
