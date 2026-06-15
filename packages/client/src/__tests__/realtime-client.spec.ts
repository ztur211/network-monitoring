import { describe, it, expect, vi } from 'vitest';
const ioMock = vi.fn();
vi.mock('socket.io-client', () => ({ io: (...a: unknown[]) => ioMock(...a) }));
import { createRealtimeClient } from '../realtime-client';

describe('createRealtimeClient', () => {
  it('connects with the token in the handshake auth and registers handlers', async () => {
    const on = vi.fn(); ioMock.mockReturnValue({ on, disconnect: vi.fn() });
    const rt = createRealtimeClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    await rt.connect();
    expect(ioMock).toHaveBeenCalledWith('http://api', expect.objectContaining({ auth: { token: 'TKN' } }));
    const handler = vi.fn(); rt.on('v1:device:updated', handler);
    expect(on).toHaveBeenCalledWith('v1:device:updated', handler);
  });
});
