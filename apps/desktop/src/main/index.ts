import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { join } from 'node:path';
import { apiUrl } from './config';
import { TokenVault } from './auth/token-vault';
import { AuthFlow } from './auth/auth-flow';

let win: BrowserWindow | null = null;
const vault = new TokenVault(join(app.getPath('userData'), 'auth.bin'));
const flow = new AuthFlow({
  apiUrl, openExternal: (u) => shell.openExternal(u), fetchFn: fetch, vault,
  onChange: (authed) => win?.webContents.send('auth:changed', authed),
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAsDefaultProtocolClient('nodescope');
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith('nodescope://'));
    if (url) flow.handleCallback(url).catch(() => {});
    win?.focus();
  });
  app.on('open-url', (_e, url) => { flow.handleCallback(url).catch(() => {}); });

  app.whenReady().then(() => {
    ipcMain.handle('auth:login', () => flow.login());
    ipcMain.handle('auth:logout', () => flow.logout());
    ipcMain.handle('auth:getToken', () => flow.getToken());
    ipcMain.handle('app:getConfig', () => ({ apiUrl }));
    win = new BrowserWindow({ width: 1280, height: 800, webPreferences: {
      preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
    else win.loadFile(join(__dirname, '../renderer/index.html'));
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
