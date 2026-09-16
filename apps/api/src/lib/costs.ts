/** Rough USD estimates from token counts (list prices; update if models change). */

const RATES: Record<string, { inPerM: number; outPerM: number }> = {
  "gpt-4o": { inPerM: 2.5, outPerM: 10 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4.1": { inPerM: 2, outPerM: 8 },
  "gpt-4.1-mini": { inPerM: 0.4, outPerM: 1.6 },
  "gemini-3.6-flash": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-2.0-flash": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-1.5-flash": { inPerM: 0.075, outPerM: 0.3 },
  "gemini-1.5-pro": { inPerM: 1.25, outPerM: 5 },
};

const TAVILY_PER_SEARCH = 0.008;

export function estimateUsd(input: {
  provider: string;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  operation?: string;
}) {
  const provider = input.provider.toLowerCase();
  if (provider === "tavily" || input.operation === "research") {
    return TAVILY_PER_SEARCH;
  }

  const model = (input.model ?? "").toLowerCase();
  const rate =
    Object.entries(RATES).find(([k]) => model.includes(k))?.[1] ??
    (provider.includes("gemini")
      ? RATES["gemini-2.0-flash"]
      : RATES["gpt-4o"]);

  const inn = input.inputTokens ?? 0;
  const out = input.outputTokens ?? 0;
  const usd = (inn / 1_000_000) * rate.inPerM + (out / 1_000_000) * rate.outPerM;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function formatUsd(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n > 0 && n < 0.01) return `~$${n.toFixed(4)}`;
  return `~$${n.toFixed(3)}`;
}
