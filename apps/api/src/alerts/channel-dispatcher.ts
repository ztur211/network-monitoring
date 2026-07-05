import { AlertChannel, AlertEvent } from '@prisma/client';

export const CHANNEL_DISPATCHER = Symbol('CHANNEL_DISPATCHER');

export interface ChannelDispatcher {
  /** Deliver an event through a channel. MUST throw on failure. */
  dispatch(channel: AlertChannel, event: AlertEvent): Promise<void>;
}
