import { prisma } from "../lib/prisma";
import { urlLang, type Lang } from "../lib/linkGuard";

export type LinkCandidate = { title: string; url: string; score: number; isOrphan?: boolean };

function words(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
}

/**
 * Hybrid-lite relevance ranking: keyword/title overlap between the new
 * content's title+keywords and every existing SitePage / published
 * ContentItem on the site. (Structured relational scoring now; can be
 * swapped for embedding cosine-similarity later without changing callers —
 * see TASKS.md note.)
 */
export async function rankLinkTargets(
  siteId: string,
  title: string,
  keywords: string[] = [],
  opts: { limit?: number; excludeContentId?: string; language?: Lang; minResults?: number } = {}
): Promise<LinkCandidate[]> {
  const limit = opts.limit ?? 15;
  const targetWords = new Set([...words(title), ...keywords.flatMap(words)]);

  const [pages, content] = await Promise.all([
    prisma.sitePage.findMany({
      where: { siteId },
      select: { title: true, url: true, isOrphan: true, summary: true },
    }),
    prisma.contentItem.findMany({
      where: {
        siteId,
        status: "PUBLISHED",
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.excludeContentId ? { id: { not: opts.excludeContentId } } : {}),
      },
      select: { title: true, wpUrl: true, focusKeyword: true },
    }),
  ]);

  const candidates: LinkCandidate[] = [];

  const all: LinkCandidate[] = [];

  for (const p of pages) {
    if (opts.language && urlLang(p.url) !== opts.language) continue;
    const w = new Set([...words(p.title), ...words(p.summary ?? "")]);
    const overlap = [...w].filter((x) => targetWords.has(x)).length;
    const cand = { title: p.title, url: p.url, score: overlap, isOrphan: p.isOrphan };
    all.push(cand);
    if (overlap > 0) candidates.push(cand);
  }

  for (const c of content) {
    if (!c.wpUrl) continue;
    const w = new Set([...words(c.title), ...words(c.focusKeyword ?? "")]);
    const overlap = [...w].filter((x) => targetWords.has(x)).length;
    const cand = { title: c.title, url: c.wpUrl, score: overlap };
    all.push(cand);
    if (overlap > 0) candidates.push(cand);
  }

  // Boost orphan pages slightly so they surface — brief calls out flagging
  // poorly-connected pages, and linking to them is the fix.
  for (const c of candidates) if (c.isOrphan) c.score += 0.5;

  const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, limit);

  // Pad with other same-language pages (orphans first) so callers can always
  // reach a minimum number of internal links.
  const min = opts.minResults ?? 0;
  if (ranked.length < min) {
    const have = new Set(ranked.map((r) => r.url));
    const pad = all
      .filter((c) => !have.has(c.url))
      .sort((a, b) => Number(b.isOrphan ?? false) - Number(a.isOrphan ?? false));
    for (const c of pad) {
      if (ranked.length >= min) break;
      ranked.push(c);
    }
  }
  return ranked;
}

/** Records which links were actually inserted into a piece of content — builds the explicit relationship graph the brief asks for. */
export async function recordAppliedLinks(
  siteId: string,
  sourceType: "content" | "page",
  sourceId: string,
  bodyHtml: string
) {
  const hrefRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const rows: Array<{ url: string; anchor: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(bodyHtml))) {
    rows.push({ url: m[1], anchor: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  if (!rows.length) return 0;

  await prisma.pageLink.deleteMany({ where: { siteId, sourceId } });
  await prisma.pageLink.createMany({
    data: rows.map((r) => ({
      siteId,
      sourceType,
      sourceId,
      targetUrl: r.url,
      anchorText: r.anchor || null,
    })),
  });
  return rows.length;
}
