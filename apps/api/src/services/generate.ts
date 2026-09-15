import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

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
};

const SYSTEM_JSON =
  "You write SEO blog articles. Return JSON with keys: title, bodyHtml, focusKeyword, seoTitle, metaDescription, schemaJson (BlogPosting object), imagePrompt (short English prompt for a featured photo). bodyHtml must use semantic HTML (h2/h3/p/ul/faq). Language must match the requested locale. Do not invent business facts, prices, or guarantees.";

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
    imagePrompt: `Professional photo for article: ${title}`,
  };
}

function parseArticleJson(raw: string): GeneratedArticle {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as GeneratedArticle;
}

async function openaiArticle(title: string, language: string, brief?: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_JSON },
        {
          role: "user",
          content: JSON.stringify({ title, language, brief: brief ?? null }),
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

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
      model: data.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    },
    usage: data.usage,
  };
}

async function geminiArticle(title: string, language: string, brief?: string) {
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
              text: `${SYSTEM_JSON}\n\nInput:\n${JSON.stringify({
                title,
                language,
                brief: brief ?? null,
              })}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
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

/** Featured image bytes — OpenAI Images, then Gemini Imagen */
export async function generateFeaturedImageBytes(prompt: string): Promise<{
  bytes: Buffer;
  mime: string;
  provider: string;
  model: string;
} | null> {
  const errors: string[] = [];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
      const payload: Record<string, unknown> = {
        model,
        prompt: prompt.slice(0, 1000),
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
    try {
      const model = process.env.GEMINI_IMAGE_MODEL ?? "imagen-3.0-generate-002";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(geminiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: prompt.slice(0, 1000) }],
          parameters: { sampleCount: 1 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini image ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
      };
      const pred = data.predictions?.[0];
      if (!pred?.bytesBase64Encoded) throw new Error("Gemini image empty");
      return {
        bytes: Buffer.from(pred.bytesBase64Encoded, "base64"),
        mime: pred.mimeType ?? "image/png",
        provider: "gemini",
        model,
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
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
  let article: GeneratedArticle;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  let live: Awaited<ReturnType<typeof openaiArticle>> = null;
  try {
    if (prefer === "gemini") {
      live = await geminiArticle(content.title, lang, options.brief);
    } else if (prefer === "openai") {
      live = await openaiArticle(content.title, lang, options.brief);
    } else {
      try {
        live = await openaiArticle(content.title, lang, options.brief);
      } catch {
        live = null;
      }
      if (!live) live = await geminiArticle(content.title, lang, options.brief);
    }
  } catch (err) {
    if (prefer === "openai") {
      // OpenAI quota/errors → try Gemini
      live = await geminiArticle(content.title, lang, options.brief);
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
    imagePrompt: article.imagePrompt ?? `Featured image for: ${article.title}`,
  };
}
