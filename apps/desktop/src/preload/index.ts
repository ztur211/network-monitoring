import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('nodescope', {
  app: { ping: () => 'pong' },
});
