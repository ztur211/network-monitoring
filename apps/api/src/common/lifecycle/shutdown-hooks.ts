export interface ShutdownHooksApp {
  enableShutdownHooks(): void;
}

export function enableShutdownHooks(app: ShutdownHooksApp): void {
  app.enableShutdownHooks();
}

export interface ClosableApp {
  close(): Promise<void>;
}

/** Close resources initialized before a bootstrap failure, then preserve the original failure. */
export async function closeAppOnBootstrapFailure(app: ClosableApp, error: unknown): Promise<never> {
  try {
    await app.close();
  } catch {
    // The bootstrap error is the actionable root cause; cleanup is best-effort here.
  }
  throw error;
}
