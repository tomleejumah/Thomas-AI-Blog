/** Clean provider HTTP failures for API → admin (no raw JSON bodies). */
export function providerHttpError(provider: string, status: number, bodyText: string): Error {
  const prefix = `${provider} ${status}`;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; code?: number | string };
      message?: string;
    };
    const inner = parsed.error ?? parsed;
    const detail = (inner.message || parsed.message || "").trim();
    const st = String(inner.status || "");

    if (
      status === 503 ||
      /UNAVAILABLE/i.test(st) ||
      /high demand|try again later|temporarily/i.test(detail)
    ) {
      return new Error(
        `${prefix}: The AI writer is busy right now. Wait a minute, then try again.`
      );
    }
    if (
      status === 429 ||
      /RESOURCE_EXHAUSTED/i.test(st) ||
      /quota|rate limit|billing|insufficient/i.test(detail)
    ) {
      return new Error(`${prefix}: AI credits or rate limit reached. Top up, then try again.`);
    }
    if (detail && detail.length <= 200 && !detail.startsWith("{")) {
      return new Error(`${prefix}: ${detail}`);
    }
  } catch {
    /* ignore parse */
  }

  if (status === 503) {
    return new Error(`${prefix}: The AI writer is busy right now. Wait a minute, then try again.`);
  }
  if (status === 429) {
    return new Error(`${prefix}: AI credits or rate limit reached. Top up, then try again.`);
  }
  return new Error(`${prefix}: Request failed. Please try again.`);
}
