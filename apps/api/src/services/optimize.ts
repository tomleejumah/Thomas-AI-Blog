import { prisma } from "../lib/prisma";
import { estimateUsd } from "../lib/costs";
import { providerHttpError } from "../lib/providerErrors";
import { withRetry, fetchWithStatus } from "../lib/retry";
import { siteWpAuth } from "../lib/siteAuth";
import { getWpPostByUrl } from "./wordpress";

function stripFence(raw: string) {
  return raw.replace(/^```json\s*|```$/g, "").trim();
}

/**
 * Pulls the live WP version of a published ContentItem, asks the model to
 * propose improvements (missing topics, weak structure, outdated info, SEO
 * gaps, missing FAQs), and stores the proposal as a NEEDS_REVISION draft —
 * it never overwrites the live content directly. A human approves via the
 * normal review flow (PATCH -> approve -> publish), which then diffs
 * against the ContentVersion snapshot taken automatically on save.
 */
export async function proposeOptimization(contentId: string) {
  const content = await prisma.contentItem.findUniqueOrThrow({
    where: { id: contentId },
    include: { site: true },
  });
  if (!content.wpPostId) throw new Error("Content has no published WP post to analyze");

  const auth = await siteWpAuth(content.site);
  const live = await getWpPostByUrl(auth.baseUrl, auth.username, auth.appPassword, content.wpPostId);
  const liveHtml = live.content?.rendered ?? content.bodyHtml ?? "";

  const facts = await prisma.businessFact.findMany({ where: { siteId: content.siteId } });

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No AI provider configured (set OPENAI_API_KEY)");

  const system = `You are an SEO content auditor. Given a live published page, identify:
missing topics/sections, weak structure, outdated info, SEO gaps
(title/meta/keyword), missing FAQs, and weak/broken internal links. Then
produce an improved version. Preserve all factual/business claims exactly.
Respond ONLY with JSON:
{"changeSummary":["bullet points of what changed and why"],"bodyHtml":"","seoTitle":"","metaDescription":"","focusKeyword":""}`;

  const user = `Live page title: ${live.title?.rendered ?? content.title}
Live page HTML:
${liveHtml}

Approved business facts:
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
            temperature: 0.5,
            max_tokens: 6000,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
        (status, text) => providerHttpError("OpenAI", status, text)
      ),
    { attempts: 3, baseDelayMs: 1000, label: "OpenAI optimize" }
  );

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");
  const proposal = JSON.parse(stripFence(raw)) as {
    changeSummary: string[];
    bodyHtml: string;
    seoTitle: string;
    metaDescription: string;
    focusKeyword: string;
  };

  // Snapshot current (live-mirrored) state so the before/after diff works.
  await prisma.contentVersion.create({
    data: {
      contentId: content.id,
      title: content.title,
      bodyHtml: liveHtml,
      seoTitle: content.seoTitle,
      metaDescription: content.metaDescription,
    },
  });

  const updated = await prisma.contentItem.update({
    where: { id: content.id },
    data: {
      bodyHtml: proposal.bodyHtml,
      seoTitle: proposal.seoTitle,
      metaDescription: proposal.metaDescription,
      focusKeyword: proposal.focusKeyword,
      status: "NEEDS_REVISION",
      reviewNote: `Optimization proposal: ${proposal.changeSummary.join("; ")}`,
    },
  });

  if (data.usage) {
    await prisma.aiUsage.create({
      data: {
        contentId: content.id,
        provider: "openai",
        model: data.model ?? "gpt-4o",
        operation: "optimize_content",
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        estimatedUsd: estimateUsd({
          provider: "openai",
          model: data.model ?? "gpt-4o",
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        }),
      },
    });
  }

  return { content: updated, changeSummary: proposal.changeSummary };
}
