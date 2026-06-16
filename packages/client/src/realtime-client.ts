import { io, type Socket } from 'socket.io-client';

export interface RealtimeClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
}

export function createRealtimeClient(opts: RealtimeClientOptions) {
  let socket: Socket | null = null;
  return {
    async connect(): Promise<void> {
      const token = await opts.getToken();
      socket = io(opts.baseUrl, { transports: ['websocket'], auth: { token } });
    },
    on(event: string, handler: (payload: unknown) => void): void { socket?.on(event, handler); },
    off(event: string, handler: (payload: unknown) => void): void { socket?.off(event, handler); },
    disconnect(): void { socket?.disconnect(); socket = null; },
  };
}
