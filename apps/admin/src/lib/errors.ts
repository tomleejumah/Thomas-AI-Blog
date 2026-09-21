/** Turn provider dumps (Gemini/OpenAI JSON) into short operator-facing copy. */
export function friendlyError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "Something went wrong");

  const jsonMatch = msg.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: { message?: string; status?: string; code?: number | string };
        message?: string;
        status?: string;
        code?: number | string;
      };
      const inner = parsed.error ?? parsed;
      const detail = (inner.message || parsed.message || "").trim();
      const status = String(inner.status || parsed.status || "");
      const code = String(inner.code ?? parsed.code ?? "");

      if (
        /UNAVAILABLE/i.test(status) ||
        code === "503" ||
        /high demand|try again later|temporarily/i.test(detail)
      ) {
        return "The AI writer is busy right now. Wait a minute, then tap Generate again.";
      }
      if (
        /RESOURCE_EXHAUSTED/i.test(status) ||
        code === "429" ||
        /quota|rate limit|billing|insufficient/i.test(detail)
      ) {
        return "AI credits or rate limit reached. Top up the provider key, then try again.";
      }
      if (detail && detail.length <= 160 && !detail.startsWith("{")) {
        return detail;
      }
    } catch {
      /* fall through */
    }
  }

  if (/503|UNAVAILABLE|high demand/i.test(msg)) {
    return "The AI writer is busy right now. Wait a minute, then tap Generate again.";
  }
  if (/429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "AI credits or rate limit reached. Top up the provider key, then try again.";
  }
  if (/401|invalid.*key|API key/i.test(msg)) {
    return "AI API key looks invalid. Check it under Maintenance.";
  }

  const cleaned = msg.replace(/\s+/g, " ").trim();
  if (cleaned.length > 160) return `${cleaned.slice(0, 157)}…`;
  return cleaned || "Something went wrong. Please try again.";
}

/** Prefer a clean Error for API responses (no raw provider JSON bodies). */
export function providerHttpError(provider: string, status: number, bodyText: string): Error {
  const prefix = `${provider} ${status}`;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; code?: number | string };
      message?: string;
      status?: string;
      code?: number | string;
    };
    const inner = parsed.error ?? parsed;
    const detail = (inner.message || parsed.message || "").trim();
    const st = String(inner.status || parsed.status || "");
    if (
      status === 503 ||
      /UNAVAILABLE/i.test(st) ||
      /high demand|try again later/i.test(detail)
    ) {
      return new Error(
        `${prefix}: The AI writer is busy right now. Wait a minute, then try again.`
      );
    }
    if (
      status === 429 ||
      /RESOURCE_EXHAUSTED/i.test(st) ||
      /quota|rate limit/i.test(detail)
    ) {
      return new Error(`${prefix}: AI credits or rate limit reached. Top up, then try again.`);
    }
    if (detail && detail.length <= 200) {
      return new Error(`${prefix}: ${detail}`);
    }
  } catch {
    /* ignore */
  }
  return new Error(friendlyError(`${prefix}: ${bodyText}`));
}
