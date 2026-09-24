/** Retry helper for transient AI-provider failures (503 busy / 429 rate-limited). */

export type RetryableError = Error & { status?: number };

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` up to `attempts` times with exponential backoff + jitter.
 * `fn` should throw an Error with a `.status` property (see `fetchWithStatus`)
 * for the backoff logic to know whether a failure is retryable.
 * Non-retryable errors (e.g. 400, 401) throw immediately without retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    label?: string;
    /** Override which HTTP statuses retry. Image 429 is quota — do not hammer. */
    retryStatuses?: number[];
    onAttempt?: (attempt: number, attempts: number) => void;
  } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const retryableSet = opts.retryStatuses
    ? new Set(opts.retryStatuses)
    : RETRYABLE_STATUS;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    opts.onAttempt?.(i + 1, attempts);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as RetryableError)?.status;
      const retryable = status !== undefined && retryableSet.has(status);
      const isLastAttempt = i === attempts - 1;

      if (!retryable || isLastAttempt) throw err;

      const delay = baseDelayMs * 2 ** i + Math.floor(Math.random() * 250);
      console.warn(
        `[retry] ${opts.label ?? "call"} failed (status ${status}), retrying in ${delay}ms (attempt ${i + 1}/${attempts})`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** fetch() wrapper that attaches the HTTP status to thrown errors so withRetry can inspect it. */
export async function fetchWithStatus(
  input: string,
  init: RequestInit,
  buildError: (status: number, bodyText: string) => Error
): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const bodyText = await res.text();
    const err = buildError(res.status, bodyText) as RetryableError;
    err.status = res.status;
    throw err;
  }
  return res;
}
