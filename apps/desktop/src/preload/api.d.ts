export {};
declare global {
  interface Window {
    nodescope: {
      auth: {
        login: () => Promise<void>;
        logout: () => Promise<void>;
        getToken: () => Promise<string | null>;
        onAuthChanged: (cb: (authed: boolean) => void) => () => void;
      };
      app: { getConfig: () => Promise<{ apiUrl: string }> };
    };
  }
}
