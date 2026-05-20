// Stub used in place of the real Zustand-backed ui.store when running unit
// tests that exercise pure logic (e.g. websocket.service). Wired via jest's
// `moduleNameMapper`.
export const useUiStore = {
  getState: () => ({
    setConnectionStatus: () => {},
    setLatency: () => {},
  }),
};
