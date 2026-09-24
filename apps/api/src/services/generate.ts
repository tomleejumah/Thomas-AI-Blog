import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { estimateUsd } from "../lib/costs";
import { providerHttpError } from "../lib/providerErrors";
import { withRetry, fetchWithStatus } from "../lib/retry";
import { researchTopic } from "./research";
import { rankLinkTargets, recordAppliedLinks } from "./linking";

export type GeneratedArticle = {
  title: string;
  bodyHtml: string;
  focusKeyword: string;
  seoTitle: string;
  metaDescription: string;
  slug?: string;
  schemaJson: Prisma.InputJsonValue;
  provider: string;
  model: string;
  imagePrompt?: string;
};

export type GenerateOptions = {
  brief?: string;
  provider?: "openai" | "gemini" | "auto";
  withImage?: boolean;
  onStage?: (stage: {
    stage: "researching" | "writing" | "saving";
    label: string;
    pct?: number;
  }) => void;
};

const SYSTEM_JSON = `You are an elite magazine-level SEO blog writer and editor (think Condé Nast Traveler / specialist industry longform — not a thin AI outline).

Return ONLY valid JSON with keys:
title, bodyHtml, focusKeyword, seoTitle, metaDescription, slug, schemaJson (BlogPosting), imagePrompt (vivid English photo brief).

WRITING STANDARD — mandatory:
- Master-level prose: vivid, sensory, authoritative, fluent. Varied sentence rhythm. No robotic filler, no "In today's world".
- VERBOSE longform: 1,400–2,200+ words in bodyHtml. Deep sections, not bullet dumps alone.
- Semantic HTML only: h2/h3, p, ul/ol, blockquote when it fits, optional short FAQ.
- Locale: fully idiomatic in the requested language (en/pt/fr).
- Facts: do NOT invent prices, guarantees, licenses, phone numbers, or business claims not in the brief.
- imagePrompt: English photo brief for a REAL-looking featured image — natural light, documentary/lifestyle. Never “AI art”.

RANK MATH — exact-phrase tests (this is how the plugin scores 0–100):
- focusKeyword: 2–4 words, lowercase, the exact phrase you will repeat. Not a long sentence.
- Use that EXACT phrase (same words, same order) in: seoTitle (start with it), metaDescription, first <p>, at least one <h2>, and naturally 4–8 more times in body (density ~1%, never stuff).
- seoTitle: 50–60 characters, unique, starts with focusKeyword.
- metaDescription: 140–160 characters, includes focusKeyword once.
- slug: kebab-case of focusKeyword only (e.g. family-yacht-charter-lisbon).
- First 100 words of bodyHtml must include focusKeyword.
- Include at least 2 internal <a href> from the provided site links (if any) and 1 reputable external source when research URLs exist.
- Do not skip the keyword because a fancier synonym “sounds better” — Rank Math only counts the exact string.

STRUCTURE VARIETY — critical (do NOT reuse a template):
- Every article must feel uniquely shaped for THIS site + topic. Never copy a fixed skeleton like Hook → Overview → Tips → FAQ → CTA for every post.
- Pick a fresh angle and outline each time (examples to rotate among — invent others too): narrative journey; myth-busting; comparison; seasonal playbook; checklist-led with rich prose; interview-style Q&A woven into narrative; "day in the life"; mistake autopsy; local insider guide; decision framework.
- Vary section count, heading voice, whether FAQ appears, whether lists appear early or late, opening device (scene / question / bold claim / anecdote).
- Match voice to the site context when provided (yacht charter luxury leisure ≠ corporate renovation blog). Same platform, different souls.
- If brief/site notes exist, let them bend tone and structure.

Reject thin or formulaic content.`;

function userPayload(
  title: string,
  language: string,
  brief?: string,
  site?: {
    name?: string;
    baseUrl?: string;
    category?: string | null;
    businessFacts?: Array<{ key: string; value: string }>;
    linkTargets?: Array<{ title: string; url: string }>;
  },
  research?: {
    provider: string;
    answers: string[];
    sources: Array<{ title: string; url: string; snippet: string }>;
  } | null
) {
  const shapes = [
    "narrative journey with sensory scenes",
    "myth-busting expert teardown",
    "comparison / decision framework",
    "seasonal or occasion playbook",
    "insider local guide",
    "mistake autopsy + fixes",
    "day-in-the-life itinerary prose",
    "checklist wrapped in magazine storytelling",
  ];
  const shape = shapes[Math.floor(Math.random() * shapes.length)];

  return JSON.stringify({
    title,
    language,
    brief: brief ?? null,
    site: site
      ? {
          name: site.name ?? null,
          url: site.baseUrl ?? null,
          category: site.category ?? null,
          businessFacts: site.businessFacts?.length ? site.businessFacts : null,
          linkTargets: site.linkTargets?.length ? site.linkTargets : null,
          factsInstruction:
            "Use ONLY these approved business facts. Never invent prices, phones, licenses, guarantees, or services not listed.",
          linkingInstruction:
            "Where natural, insert 2–5 contextual <a href> links to linkTargets using varied anchor text. Do not dump a link list.",
        }
      : null,
    research: research
      ? {
          provider: research.provider,
          answers: research.answers,
          sources: research.sources,
          instruction:
            "Use research for accuracy and FAQ angles. Do not invent business facts. Cite ideas, not raw URLs in body unless natural.",
        }
      : null,
    requirements: {
      minWords: 1400,
      tone: "master-level longform blog",
      depth: "expert, practical, immersive",
      structuralDirection: shape,
      uniqueness:
        "Invent a structure that fits this site and topic; do not reuse a generic template.",
    },
  });
}

function keywordSlug(keyword: string, title: string) {
  const raw = (keyword || title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return raw || undefined;
}

function stubArticle(title: string, language: string): GeneratedArticle {
  return {
    title,
    bodyHtml: `<h1>${title}</h1><p>Stub — no live LLM key used.</p>`,
    focusKeyword: title.toLowerCase().slice(0, 60),
    seoTitle: `${title} | Guide`,
    metaDescription: `Learn about ${title}.`,
    slug: keywordSlug(title, title),
    schemaJson: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      inLanguage: language,
    },
    provider: "stub",
    model: "local-stub",
    imagePrompt: `Natural documentary photo for: ${title}. Real people/places if relevant, soft natural light, no AI-art look.`,
  };
}

function parseArticleJson(raw: string): GeneratedArticle {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as GeneratedArticle;
}

type SiteCtx = {
  name?: string;
  baseUrl?: string;
  category?: string | null;
  businessFacts?: Array<{ key: string; value: string }>;
  linkTargets?: Array<{ title: string; url: string }>;
};
type ResearchCtx = {
  provider: string;
  answers: string[];
  sources: Array<{ title: string; url: string; snippet: string }>;
};
type OnStage = GenerateOptions["onStage"];

async function openaiArticle(
  title: string,
  language: string,
  brief?: string,
  site?: SiteCtx,
  research?: ResearchCtx | null,
  onStage?: OnStage
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const res = await withRetry(
    () =>
      fetchWithStatus(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? "gpt-4o",
            response_format: { type: "json_object" },
            temperature: 0.9,
            max_tokens: 8000,
            messages: [
              { role: "system", content: SYSTEM_JSON },
              {
                role: "user",
                content: userPayload(title, language, brief, site, research),
              },
            ],
          }),
        },
        (status, text) => providerHttpError("OpenAI", status, text)
      ),
    {
      attempts: 3,
      baseDelayMs: 1000,
      label: "OpenAI generateContent",
      onAttempt: (attempt, attempts) =>
        onStage?.({
          stage: "writing",
          label: `Writing with OpenAI (attempt ${attempt}/${attempts})…`,
          pct: 25 + attempt * 10,
        }),
    }
  );

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");
  const parsed = parseArticleJson(raw);

  return {
    article: {
      ...parsed,
      provider: "openai",
      model: data.model ?? process.env.OPENAI_MODEL ?? "gpt-4o",
    },
    usage: data.usage,
  };
}

async function geminiArticle(
  title: string,
  language: string,
  brief?: string,
  site?: SiteCtx,
  research?: ResearchCtx | null,
  onStage?: OnStage
) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;

  // Try the preferred model first, then fall back to other known-good models
  // if it's overloaded (503) or rate-limited (429). Google rotates which
  // models are under heavy load, so a fallback list is more reliable than
  // pinning one model.
  const models = [
    process.env.GEMINI_MODEL,
    "gemini-3.6-flash",
    "gemini-3.1-flash",
    "gemini-2.5-flash",
  ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

  const modelErrors: string[] = [];

  for (const [modelIdx, model] of models.entries()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    try {
      const res = await withRetry(
        () =>
          fetchWithStatus(
            url,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        text: `${SYSTEM_JSON}\n\nInput:\n${userPayload(title, language, brief, site, research)}`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.9,
                  maxOutputTokens: 8192,
                },
              }),
            },
            (status, text) => providerHttpError("Gemini", status, text)
          ),
        {
          attempts: 3,
          baseDelayMs: 1000,
          label: `Gemini generateContent (${model})`,
          onAttempt: (attempt, attempts) =>
            onStage?.({
              stage: "writing",
              label: `Writing with Gemini ${model} (attempt ${attempt}/${attempts})…`,
              pct: 25 + modelIdx * 15 + attempt * 5,
            }),
        }
      );

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!raw) throw new Error("Gemini returned empty content");
      const parsed = parseArticleJson(raw);

      return {
        article: {
          ...parsed,
          provider: "gemini",
          model,
        },
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount,
          completion_tokens: data.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (err) {
      modelErrors.push(err instanceof Error ? err.message : String(err));
      // try next model in the fallback list
    }
  }

  throw new Error(modelErrors.join(" | ") || "Gemini: all models failed");
}

function naturalPhotoPrompt(prompt: string) {
  const base = prompt.trim().slice(0, 900);
  return [
    base,
    "Style: photorealistic natural photography as if shot on a full-frame camera by a travel photographer.",
    "Natural skin texture, real lighting, authentic environment, slight grain OK.",
    "Avoid: AI-art look, plastic skin, oversharpening, fake HDR, watermarks, text overlays, logos, CGI, illustration.",
    "Aspect: landscape 16:9 suitable as a WordPress featured image.",
  ].join(" ");
}

/** Featured image — OpenAI first, Gemini native image as fallback */
export async function generateFeaturedImageBytes(prompt: string): Promise<{
  bytes: Buffer;
  mime: string;
  provider: string;
  model: string;
} | null> {
  const errors: string[] = [];
  const fullPrompt = naturalPhotoPrompt(prompt);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
      const payload: Record<string, unknown> = {
        model,
        prompt: fullPrompt.slice(0, 1000),
        n: 1,
      };
      if (model.includes("dall-e")) {
        payload.size = model.includes("dall-e-3") ? "1792x1024" : "1024x1024";
      } else {
        payload.size = "1024x1024";
      }

      const res = await withRetry(
        () =>
          fetchWithStatus(
            "https://api.openai.com/v1/images/generations",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            },
            (status, text) => providerHttpError("OpenAI image", status, text)
          ),
        { attempts: 3, baseDelayMs: 1000, label: "OpenAI image generation" }
      );
      const data = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const item = data.data?.[0];
      if (item?.b64_json) {
        return {
          bytes: Buffer.from(item.b64_json, "base64"),
          mime: "image/png",
          provider: "openai",
          model,
        };
      }
      if (item?.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw new Error(`OpenAI image download ${imgRes.status}`);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        return { bytes: buf, mime: "image/png", provider: "openai", model };
      }
      throw new Error("OpenAI image empty");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    const models = [
      process.env.GEMINI_IMAGE_MODEL,
      "gemini-3.1-flash-image",
      "gemini-2.5-flash-image",
      "gemini-2.0-flash-preview-image-generation",
    ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const res = await withRetry(
          () =>
            fetchWithStatus(
              url,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
                  generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                  },
                }),
              },
              (status, text) => providerHttpError("Gemini image", status, text)
            ),
          { attempts: 3, baseDelayMs: 1000, label: `Gemini image (${model})` }
        );
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: { mimeType?: string; data?: string };
                inline_data?: { mime_type?: string; data?: string };
              }>;
            };
          }>;
        };
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          const inline = part.inlineData ?? part.inline_data;
          const b64 = inline?.data;
          const mime =
            ("mimeType" in (inline ?? {})
              ? (inline as { mimeType?: string }).mimeType
              : (inline as { mime_type?: string } | undefined)?.mime_type) ??
            "image/png";
          if (b64) {
            return {
              bytes: Buffer.from(b64, "base64"),
              mime,
              provider: "gemini",
              model,
            };
          }
        }
        throw new Error("Gemini image empty (no inline image part)");
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (errors.length) {
    throw new Error(`Image generation failed: ${errors.join(" | ")}`);
  }
  return null;
}

export async function generateForContent(
  contentId: string,
  options: GenerateOptions = {}
) {
  const content = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: { site: true, category: true },
  });
  if (!content) throw new Error("Content not found");

  const lang = content.language;
  const prefer = options.provider ?? "auto";

  options.onStage?.({ stage: "researching", label: "Loading site context…", pct: 5 });

  const [facts, rankedLinks] = await Promise.all([
    prisma.businessFact.findMany({
      where: { siteId: content.siteId },
      orderBy: { key: "asc" },
      take: 40,
    }),
    rankLinkTargets(
      content.siteId,
      content.title,
      content.focusKeyword ? [content.focusKeyword] : [],
      { limit: 15, excludeContentId: content.id }
    ),
  ]);

  const siteCtx: SiteCtx = {
    name: content.site.name,
    baseUrl: content.site.baseUrl,
    category: content.category?.name ?? null,
    businessFacts: facts.map((f) => ({ key: f.key, value: f.value })),
    linkTargets: rankedLinks.map((p) => ({ title: p.title, url: p.url })),
  };

  options.onStage?.({ stage: "researching", label: "Researching topic…", pct: 10 });

  let research: ResearchCtx | null = null;
  let researchError: string | undefined;
  try {
    const packet = await researchTopic({
      title: content.title,
      language: lang,
      siteName: content.site.name,
      category: content.category?.name,
      brief: options.brief,
    });
    if (packet) {
      research = {
        provider: packet.provider,
        answers: packet.answers,
        sources: packet.sources,
      };
      await prisma.aiUsage.create({
        data: {
          contentId: content.id,
          provider: "tavily",
          model: "search",
          operation: "research",
          estimatedUsd: estimateUsd({
            provider: "tavily",
            model: "search",
            operation: "research",
          }),
        },
      });
    }
  } catch (err) {
    researchError = err instanceof Error ? err.message : String(err);
  }

  options.onStage?.({ stage: "writing", label: "Starting draft…", pct: 20 });

  let article: GeneratedArticle;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let fallbackFrom: string | undefined;

  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  const order: Array<"openai" | "gemini"> = [];
  if (prefer === "gemini") {
    if (hasGemini) order.push("gemini");
    if (hasOpenAI) order.push("openai");
  } else if (prefer === "openai") {
    if (hasOpenAI) order.push("openai");
    if (hasGemini) order.push("gemini");
  } else {
    // auto: OpenAI first, Gemini backup (and reverse if only one key exists)
    if (hasOpenAI) order.push("openai");
    if (hasGemini) order.push("gemini");
  }

  const providerErrors: string[] = [];
  let live: Awaited<ReturnType<typeof openaiArticle>> = null;

  for (const provider of order) {
    try {
      live =
        provider === "openai"
          ? await openaiArticle(
              content.title,
              lang,
              options.brief,
              siteCtx,
              research,
              options.onStage
            )
          : await geminiArticle(
              content.title,
              lang,
              options.brief,
              siteCtx,
              research,
              options.onStage
            );
      if (providerErrors.length > 0) {
        fallbackFrom = providerErrors[0]?.startsWith("OpenAI")
          ? "openai"
          : providerErrors[0]?.startsWith("Gemini")
            ? "gemini"
            : order[0];
      }
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      providerErrors.push(msg);
      live = null;
    }
  }

  if (live) {
    article = live.article;
    usage = live.usage;
  } else if (order.length === 0) {
    article = stubArticle(content.title, lang);
  } else {
    const summary = providerErrors.slice(0, 2).join(" · ");
    throw new Error(
      summary
        ? `All AI providers failed. ${summary}`
        : "All AI providers failed. Please try Generate again in a minute."
    );
  }

  options.onStage?.({ stage: "saving", label: "Saving draft…", pct: 90 });

  const updated = await prisma.contentItem.update({
    where: { id: content.id },
    data: {
      title: article.title || content.title,
      bodyHtml: article.bodyHtml,
      slug: article.slug || keywordSlug(article.focusKeyword, article.title || content.title) || undefined,
      focusKeyword: article.focusKeyword,
      seoTitle: article.seoTitle,
      metaDescription: article.metaDescription,
      schemaJson: article.schemaJson,
      status: "HUMAN_REVIEW",
    },
  });

  if (article.bodyHtml) {
    await recordAppliedLinks(content.siteId, "content", content.id, article.bodyHtml);
  }

  const estimatedUsd = estimateUsd({
    provider: article.provider,
    model: article.model,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    operation: "generate_article",
  });

  await prisma.aiUsage.create({
    data: {
      contentId: content.id,
      provider: article.provider,
      model: article.model,
      operation: "generate_article",
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      estimatedUsd,
    },
  });

  return {
    content: updated,
    provider: article.provider,
    fallbackFrom: fallbackFrom || null,
    research: research
      ? { provider: research.provider, sources: research.sources.length }
      : null,
    researchError,
    imagePrompt: article.imagePrompt ?? `Featured image for: ${article.title}`,
    usage: {
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      estimatedUsd,
      estimatedUsdLabel: formatUsdLabel(estimatedUsd),
    },
  };
}

function formatUsdLabel(n: number) {
  if (n > 0 && n < 0.01) return `~$${n.toFixed(4)}`;
  return `~$${n.toFixed(3)}`;
}
