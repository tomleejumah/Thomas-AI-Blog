export type ResearchPacket = {
  query: string;
  provider: string;
  answers: string[];
  sources: Array<{ title: string; url: string; snippet: string }>;
};

export async function researchTopic(input: {
  title: string;
  language: string;
  siteName?: string;
  category?: string | null;
  brief?: string;
}): Promise<ResearchPacket | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;

  const query = [
    input.title,
    input.siteName ? `site:${input.siteName}` : null,
    input.category,
    input.language === "pt" ? "português" : input.language === "fr" ? "français" : null,
    input.brief?.slice(0, 120) || null,
  ]
    .filter(Boolean)
    .join(" ");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      include_answer: true,
      max_results: 6,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const sources = (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 400),
  }));

  const answers = [data.answer].filter(Boolean) as string[];

  return {
    query,
    provider: "tavily",
    answers,
    sources,
  };
}
