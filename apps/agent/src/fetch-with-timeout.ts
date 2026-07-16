const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/** Apply one wall-clock deadline to fetch plus complete response-body consumption. */
export async function fetchWithTimeout<T>(options: {
  fetchImpl: typeof fetch;
  input: string;
  init?: RequestInit;
  timeoutMs?: number;
  consume: (response: Response) => Promise<T>;
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await options.fetchImpl(options.input, {
      ...options.init,
      signal: controller.signal,
    });
    return await options.consume(response);
  } catch (error) {
    if (timedOut) throw new Error(`HTTP request timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
