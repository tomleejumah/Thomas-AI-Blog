import { prisma } from "../lib/prisma";
import { estimateUsd } from "../lib/costs";
import { providerHttpError } from "../lib/providerErrors";
import { withRetry, fetchWithStatus } from "../lib/retry";

type PlannedTopic = {
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  isUpdateToPage: boolean;
  relatedPageUrl?: string;
};

function stripFence(raw: string) {
  return raw.replace(/^```json\s*|```$/g, "").trim();
}

/**
 * Calls OpenAI to turn a broad instruction into a topic cluster, grounded in
 * the site's existing architecture + business knowledge so it doesn't
 * propose things that already exist. (Gemini fallback can be added the same
 * way generate.ts does it, if needed later.)
 */
async function planWithOpenAI(
  instruction: string,
  siteName: string,
  existingTitles: string[],
  facts: Array<{ key: string; value: string }>
): Promise<{ topics: PlannedTopic[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const system = `You are an SEO content strategist. Given a broad instruction, existing site
content titles, and business facts, propose a topic cluster. Avoid duplicating
or closely overlapping any existing title. Respond ONLY with JSON:
{"topics":[{"title":"","primaryKeyword":"","secondaryKeywords":["",""],"searchIntent":"informational|transactional|commercial|navigational","isUpdateToPage":false,"relatedPageUrl":""}]}`;

  const user = `Site: ${siteName}
Instruction: ${instruction}

Existing content titles (do not duplicate or closely overlap):
${existingTitles.slice(0, 200).map((t) => `- ${t}`).join("\n") || "(none yet)"}

Business facts:
${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(none provided)"}`;

  const res = await withRetry(
    () =>
      fetchWithStatus(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? "gpt-4o",
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 3000,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
        (status, text) => providerHttpError("OpenAI", status, text)
      ),
    { attempts: 3, baseDelayMs: 1000, label: "OpenAI planTopics" }
  );

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");
  const parsed = JSON.parse(stripFence(raw)) as { topics: PlannedTopic[] };

  return { topics: parsed.topics ?? [], usage: data.usage, model: data.model ?? "gpt-4o" };
}

/** Cheap lexical overlap check — flags a new topic against existing titles it might cannibalize. */
function findCannibalization(title: string, existing: string[]): string[] {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
  const targetWords = new Set(norm(title));
  const hits: string[] = [];
  for (const t of existing) {
    const words = norm(t);
    const overlap = words.filter((w) => targetWords.has(w)).length;
    const ratio = overlap / Math.max(targetWords.size, 1);
    if (ratio >= 0.6) hits.push(t);
  }
  return hits;
}

export async function planTopics(siteId: string, instruction: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const [existingContent, existingPages, facts] = await Promise.all([
    prisma.contentItem.findMany({ where: { siteId }, select: { title: true, wpUrl: true } }),
    prisma.sitePage.findMany({ where: { siteId }, select: { title: true, url: true } }),
    prisma.businessFact.findMany({ where: { siteId } }),
  ]);

  const existingTitles = [
    ...existingContent.map((c) => c.title),
    ...existingPages.map((p) => p.title),
  ];

  const result = await planWithOpenAI(instruction, site.name, existingTitles, facts);
  if (!result) {
    throw new Error("No AI provider configured (set OPENAI_API_KEY)");
  }

  const cluster = await prisma.topicCluster.create({
    data: { siteId, name: instruction.slice(0, 120), instruction },
  });

  const created = [];
  for (const t of result.topics) {
    const cannibalizes = findCannibalization(t.title, existingTitles);
    const relatedPage = t.relatedPageUrl
      ? existingPages.find((p) => p.url === t.relatedPageUrl)
      : undefined;

    const idea = await prisma.topicIdea.create({
      data: {
        clusterId: cluster.id,
        siteId,
        title: t.title,
        primaryKeyword: t.primaryKeyword,
        secondaryKeywords: t.secondaryKeywords ?? [],
        searchIntent: t.searchIntent,
        isUpdateToPage: Boolean(t.isUpdateToPage && relatedPage),
        cannibalizes,
      },
    });
    created.push(idea);
  }

  if (result.usage) {
    await prisma.aiUsage.create({
      data: {
        provider: "openai",
        model: result.model,
        operation: "plan_topics",
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
        estimatedUsd: estimateUsd({
          provider: "openai",
          model: result.model,
          inputTokens: result.usage.prompt_tokens ?? 0,
          outputTokens: result.usage.completion_tokens ?? 0,
        }),
      },
    });
  }

  return { cluster, topics: created };
}
