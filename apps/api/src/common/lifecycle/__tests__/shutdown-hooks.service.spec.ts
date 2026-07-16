import { closeAppOnBootstrapFailure, enableShutdownHooks } from '../shutdown-hooks';

describe('enableShutdownHooks', () => {
  it('enables Nest process-signal shutdown handling', () => {
    const app = { enableShutdownHooks: jest.fn() };

    enableShutdownHooks(app);

    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });

  it('closes an initialized app before rethrowing a bootstrap failure', async () => {
    const app = { close: jest.fn().mockResolvedValue(undefined) };
    const error = new Error('listen failed');

    await expect(closeAppOnBootstrapFailure(app, error)).rejects.toBe(error);
    expect(app.close).toHaveBeenCalledTimes(1);
  });
});
