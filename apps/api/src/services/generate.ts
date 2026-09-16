import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { researchTopic } from "./research";

export type GeneratedArticle = {
  title: string;
  bodyHtml: string;
  focusKeyword: string;
  seoTitle: string;
  metaDescription: string;
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
title, bodyHtml, focusKeyword, seoTitle, metaDescription, schemaJson (BlogPosting), imagePrompt (vivid English photo brief).

WRITING STANDARD — mandatory:
- Master-level prose: vivid, sensory, authoritative, fluent. Varied sentence rhythm. No robotic filler, no "In today's world", no keyword stuffing.
- VERBOSE longform: aim for 1,400–2,200+ words of real content in bodyHtml (not a stub). Deep sections, not bullet dumps alone.
- Semantic HTML only: h2/h3, p, ul/ol, blockquote when it fits, optional short FAQ.
- SEO: natural keyword use; unique seoTitle (~50–60 chars) and metaDescription (~150–160 chars).
- Locale: fully idiomatic in the requested language (en/pt/fr).
- Facts: do NOT invent prices, guarantees, licenses, phone numbers, or business claims not in the brief.
- imagePrompt: English photo brief for a REAL-looking featured image — natural light, documentary/lifestyle, imperfect reality. Never “AI art”, CGI, plastic skin, or over-processed stock.

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

function stubArticle(title: string, language: string): GeneratedArticle {
  return {
    title,
    bodyHtml: `<h1>${title}</h1><p>Stub — no live LLM key used.</p>`,
    focusKeyword: title.toLowerCase().slice(0, 60),
    seoTitle: `${title} | Guide`,
    metaDescription: `Learn about ${title}.`,
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

async function openaiArticle(
  title: string,
  language: string,
  brief?: string,
  site?: SiteCtx,
  research?: ResearchCtx | null
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

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
  research?: ResearchCtx | null
) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;

  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
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
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

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

      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${await res.text()}`);
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
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          }),
        });
        if (!res.ok) throw new Error(`Gemini image ${res.status}: ${await res.text()}`);
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

  const [facts, pages] = await Promise.all([
    prisma.businessFact.findMany({
      where: { siteId: content.siteId },
      orderBy: { key: "asc" },
      take: 40,
    }),
    prisma.sitePage.findMany({
      where: { siteId: content.siteId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { title: true, url: true },
    }),
  ]);

  const siteCtx: SiteCtx = {
    name: content.site.name,
    baseUrl: content.site.baseUrl,
    category: content.category?.name ?? null,
    businessFacts: facts.map((f) => ({ key: f.key, value: f.value })),
    linkTargets: pages.map((p) => ({ title: p.title, url: p.url })),
  };

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
        },
      });
    }
  } catch (err) {
    researchError = err instanceof Error ? err.message : String(err);
  }

  let article: GeneratedArticle;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  let live: Awaited<ReturnType<typeof openaiArticle>> = null;
  try {
    if (prefer === "gemini") {
      live = await geminiArticle(content.title, lang, options.brief, siteCtx, research);
    } else if (prefer === "openai") {
      live = await openaiArticle(content.title, lang, options.brief, siteCtx, research);
    } else {
      try {
        live = await openaiArticle(content.title, lang, options.brief, siteCtx, research);
      } catch {
        live = null;
      }
      if (!live) live = await geminiArticle(content.title, lang, options.brief, siteCtx, research);
    }
  } catch (err) {
    if (prefer === "openai") {
      live = await geminiArticle(content.title, lang, options.brief, siteCtx, research);
      if (!live) throw err;
    } else {
      throw err;
    }
  }

  if (live) {
    article = live.article;
    usage = live.usage;
  } else {
    article = stubArticle(content.title, lang);
  }

  const updated = await prisma.contentItem.update({
    where: { id: content.id },
    data: {
      title: article.title || content.title,
      bodyHtml: article.bodyHtml,
      focusKeyword: article.focusKeyword,
      seoTitle: article.seoTitle,
      metaDescription: article.metaDescription,
      schemaJson: article.schemaJson,
      status: "HUMAN_REVIEW",
    },
  });

  await prisma.aiUsage.create({
    data: {
      contentId: content.id,
      provider: article.provider,
      model: article.model,
      operation: "generate_article",
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    },
  });

  return {
    content: updated,
    provider: article.provider,
    research: research
      ? { provider: research.provider, sources: research.sources.length }
      : null,
    researchError,
    imagePrompt: article.imagePrompt ?? `Featured image for: ${article.title}`,
  };
}
