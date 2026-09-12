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
};

function stubArticle(title: string, language: string): GeneratedArticle {
  const langNote =
    language === "pt"
      ? "Versão PT (stub)."
      : language === "fr"
        ? "Version FR (stub)."
        : "EN stub until API keys are configured.";

  return {
    title,
    bodyHtml: `<h1>${title}</h1><p>${langNote}</p><h2>Overview</h2><p>Replace this with live LLM output after OPENAI_API_KEY or ANTHROPIC_API_KEY is set in .env.</p><h2>FAQ</h2><p><strong>What is this?</strong> A Phase 1 pipeline placeholder.</p>`,
    focusKeyword: title.toLowerCase().slice(0, 60),
    seoTitle: `${title} | Guide`,
    metaDescription: `Learn about ${title}. Structured SEO draft for review.`,
    schemaJson: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      inLanguage: language,
    },
    provider: "stub",
    model: "local-stub",
  };
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
        {
          role: "system",
          content:
            "You write SEO blog articles. Return JSON with keys: title, bodyHtml, focusKeyword, seoTitle, metaDescription, schemaJson (BlogPosting object). bodyHtml must use semantic HTML (h2/h3/p/ul). Language must match the requested locale. Do not invent business facts.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title,
            language,
            brief: brief ?? null,
          }),
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
  const parsed = JSON.parse(raw) as GeneratedArticle;

  return {
    article: {
      ...parsed,
      provider: "openai",
      model: data.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    },
    usage: data.usage,
  };
}

export async function generateForContent(contentId: string, brief?: string) {
  const content = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: { site: true, category: true },
  });
  if (!content) throw new Error("Content not found");

  const lang = content.language;
  let article: GeneratedArticle;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  const live = await openaiArticle(content.title, lang, brief);
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

  return { content: updated, provider: article.provider };
}
