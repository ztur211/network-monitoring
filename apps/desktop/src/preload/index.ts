import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('nodescope', {
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getToken: () => ipcRenderer.invoke('auth:getToken') as Promise<string | null>,
    onAuthChanged: (cb: (authed: boolean) => void) => {
      const listener = (_e: unknown, authed: boolean) => cb(authed);
      ipcRenderer.on('auth:changed', listener);
      return () => ipcRenderer.removeListener('auth:changed', listener);
    },
  },
  app: { getConfig: () => ipcRenderer.invoke('app:getConfig') as Promise<{ apiUrl: string }> },
});
