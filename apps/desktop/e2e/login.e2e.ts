import { test, expect, _electron as electron } from '@playwright/test';
test('launches to the signed-out shell', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] });
  const win = await app.firstWindow();
  await expect(win.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await app.close();
});
