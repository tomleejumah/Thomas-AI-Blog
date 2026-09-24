import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { estimateUsd } from "../lib/costs";
import { providerHttpError } from "../lib/providerErrors";
import { withRetry, fetchWithStatus } from "../lib/retry";

const LANG_NAMES: Record<string, string> = { en: "English", pt: "Portuguese", fr: "French" };

function stripFence(raw: string) {
  return raw.replace(/^```json\s*|```$/g, "").trim();
}

async function adaptWithOpenAI(
  language: "pt" | "fr",
  parent: {
    title: string;
    bodyHtml: string | null;
    focusKeyword: string | null;
    seoTitle: string | null;
    metaDescription: string | null;
  },
  facts: Array<{ key: string; value: string }>
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No AI provider configured (set OPENAI_API_KEY)");

  const langName = LANG_NAMES[language];
  const system = `You are a native ${langName} SEO content localizer. You will be given a
master English article. Do NOT machine-translate literally — produce a
locally natural ${langName} adaptation: your own primary keyword, secondary
keywords, search intent, SEO title, meta description, slug, and FAQ/anchor
wording appropriate for ${langName}-speaking search behavior, while
preserving every factual/business claim exactly (no invented prices,
locations, guarantees, or services). Respond ONLY with JSON:
{"title":"","bodyHtml":"","focusKeyword":"","seoTitle":"","metaDescription":"","slug":"","schemaJson":{}}`;

  const user = `Master title: ${parent.title}
Master body (HTML): ${parent.bodyHtml ?? ""}
Master focus keyword: ${parent.focusKeyword ?? ""}

Approved business facts (must stay accurate in the ${langName} version):
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
            max_tokens: 6000,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
        (status, text) => providerHttpError("OpenAI", status, text)
      ),
    { attempts: 3, baseDelayMs: 1000, label: `OpenAI localize ${language}` }
  );

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");
  const parsed = JSON.parse(stripFence(raw)) as {
    title: string;
    bodyHtml: string;
    focusKeyword: string;
    seoTitle: string;
    metaDescription: string;
    slug: string;
    schemaJson?: Prisma.InputJsonValue;
  };

  return {
    article: parsed,
    usage: data.usage,
    model: data.model ?? "gpt-4o",
    provider: "openai" as const,
  };
}

async function adaptWithGemini(
  language: "pt" | "fr",
  parent: {
    title: string;
    bodyHtml: string | null;
    focusKeyword: string | null;
    seoTitle: string | null;
    metaDescription: string | null;
  },
  facts: Array<{ key: string; value: string }>,
  onStage?: (stage: { pct?: number; label: string }) => void
) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("No Gemini key configured");

  const langName = LANG_NAMES[language];
  const prompt = `You are a native ${langName} SEO content localizer. You will be given a
master English article. Do NOT machine-translate literally — produce a
locally natural ${langName} adaptation: your own primary keyword, secondary
keywords, search intent, SEO title, meta description, slug, and FAQ/anchor
wording appropriate for ${langName}-speaking search behavior, while
preserving every factual/business claim exactly (no invented prices,
locations, guarantees, or services). Respond ONLY with JSON:
{"title":"","bodyHtml":"","focusKeyword":"","seoTitle":"","metaDescription":"","slug":"","schemaJson":{}}

Master title: ${parent.title}
Master body (HTML): ${parent.bodyHtml ?? ""}
Master focus keyword: ${parent.focusKeyword ?? ""}

Approved business facts (must stay accurate in the ${langName} version):
${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(none provided)"}`;

  const models = [
    process.env.GEMINI_MODEL,
    "gemini-3.6-flash",
    "gemini-3.1-flash",
    "gemini-2.5-flash",
  ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

  const modelErrors: string[] = [];
  for (const model of models) {
    onStage?.({ label: `Translating to ${language.toUpperCase()} with Gemini (${model})…` });
    try {
      const res = await withRetry(
        () =>
          fetchWithStatus(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.7,
                  maxOutputTokens: 8192,
                },
              }),
            },
            (status, text) => providerHttpError("Gemini", status, text)
          ),
        { attempts: 3, baseDelayMs: 1000, label: `Gemini localize ${model}` }
      );
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!raw) throw new Error("Gemini returned empty content");
      const parsed = JSON.parse(stripFence(raw)) as {
        title: string;
        bodyHtml: string;
        focusKeyword: string;
        seoTitle: string;
        metaDescription: string;
        slug: string;
        schemaJson?: Prisma.InputJsonValue;
      };
      return {
        article: parsed,
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount,
          completion_tokens: data.usageMetadata?.candidatesTokenCount,
        },
        model,
        provider: "gemini" as const,
      };
    } catch (err) {
      modelErrors.push(err instanceof Error ? err.message : String(err));
      onStage?.({ label: "Gemini model failed — trying the next model…" });
    }
  }
  throw new Error(modelErrors.join(" · ") || "Gemini: all models failed");
}

async function adaptArticle(
  language: "pt" | "fr",
  parent: {
    title: string;
    bodyHtml: string | null;
    focusKeyword: string | null;
    seoTitle: string | null;
    metaDescription: string | null;
  },
  facts: Array<{ key: string; value: string }>,
  onStage?: (stage: { pct?: number; label: string }) => void
) {
  const errors: string[] = [];
  if (process.env.OPENAI_API_KEY) {
    try {
      onStage?.({ label: `Translating to ${language.toUpperCase()} with OpenAI…` });
      return await adaptWithOpenAI(language, parent, facts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      onStage?.({ label: "OpenAI failed — trying Gemini…" });
    }
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    try {
      return await adaptWithGemini(language, parent, facts, onStage);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(
    errors.join(" · ") || "No AI provider configured (set OPENAI_API_KEY or GEMINI_API_KEY)"
  );
}

/** Creates (or refreshes) a localized child ContentItem per requested language. */
export async function localizeContent(
  parentId: string,
  languages: Array<"pt" | "fr">,
  onStage?: (stage: { pct?: number; label: string }) => void
) {
  const parent = await prisma.contentItem.findUniqueOrThrow({
    where: { id: parentId },
    include: { site: true, category: true },
  });
  if (!parent.bodyHtml) throw new Error("Parent content has no body yet — generate it first");

  const facts = await prisma.businessFact.findMany({ where: { siteId: parent.siteId } });

  const results = [];
  for (let i = 0; i < languages.length; i++) {
    const language = languages[i];
    if (!language) continue;
    onStage?.({
      pct: Math.round(10 + (i / languages.length) * 80),
      label: `Translating to ${language.toUpperCase()}…`,
    });
    const { article, usage, model, provider } = await adaptArticle(
      language,
      parent,
      facts.map((f) => ({ key: f.key, value: f.value })),
      onStage
    );

    const existing = await prisma.contentItem.findFirst({
      where: { parentContentId: parent.id, language },
    });

    const data = {
      siteId: parent.siteId,
      categoryId: parent.categoryId,
      language,
      status: "HUMAN_REVIEW" as const,
      title: article.title,
      slug: article.slug,
      bodyHtml: article.bodyHtml,
      focusKeyword: article.focusKeyword,
      seoTitle: article.seoTitle,
      metaDescription: article.metaDescription,
      schemaJson: article.schemaJson ?? parent.schemaJson ?? undefined,
      parentContentId: parent.id,
    };

    const child = existing
      ? await prisma.contentItem.update({ where: { id: existing.id }, data })
      : await prisma.contentItem.create({ data });

    await prisma.aiUsage.create({
      data: {
        contentId: child.id,
        provider,
        model,
        operation: `localize_${language}`,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
        estimatedUsd: estimateUsd({
          provider,
          model,
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        }),
      },
    });

    results.push(child);
  }

  return results;
}
