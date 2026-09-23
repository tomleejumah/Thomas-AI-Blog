import type { Site } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { siteWpAuth } from "../lib/siteAuth";
import { listWpCategories, listWpPosts, listWpPostTypes } from "./wordpress";

function stripHtml(html?: string) {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Pull every href from rendered content, normalized to bare path form. */
function extractLinkedUrls(html: string | undefined, siteBaseUrl: string): Set<string> {
  const found = new Set<string>();
  if (!html) return found;
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    let href = m[1];
    try {
      const abs = new URL(href, siteBaseUrl).toString();
      if (abs.startsWith(siteBaseUrl.replace(/\/$/, ""))) {
        found.add(abs.replace(/\/$/, ""));
      }
    } catch {
      // ignore malformed hrefs
    }
  }
  return found;
}

export type ScanResult = {
  categoriesIndexed: number;
  pagesIndexed: number;
  orphanCount: number;
  postTypesScanned: string[];
};

/**
 * Full site architecture import: categories (with hierarchy), posts, pages,
 * and any public custom post types — paginated so large sites are fully
 * indexed, not just the first 40 items. Then flags orphan pages: any
 * SitePage never linked to from any other page's content.
 */
export async function scanSite(site: Site): Promise<ScanResult> {
  const auth = await siteWpAuth(site);

  // --- Categories + hierarchy ---
  const categories = await listWpCategories(auth.baseUrl, auth.username, auth.appPassword);

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { siteId_slug: { siteId: site.id, slug: cat.slug } },
      create: { siteId: site.id, wpCategoryId: cat.id, name: cat.name, slug: cat.slug },
      update: { wpCategoryId: cat.id, name: cat.name },
    });
  }

  const localCats = await prisma.category.findMany({ where: { siteId: site.id } });
  const byWpId = new Map(localCats.map((c) => [c.wpCategoryId, c]));
  for (const cat of categories) {
    if (!cat.parent) continue;
    const child = byWpId.get(cat.id);
    const parent = byWpId.get(cat.parent);
    if (child && parent) {
      await prisma.category.update({ where: { id: child.id }, data: { parentId: parent.id } });
    }
  }

  // --- Post types to scan: built-ins + discovered custom types ---
  let customTypes: string[] = [];
  try {
    customTypes = await listWpPostTypes(auth.baseUrl, auth.username, auth.appPassword);
  } catch {
    // non-fatal — older WP or restricted endpoint
  }
  const typesToScan = ["posts", "pages", ...customTypes];

  const allItems: Array<{ url: string; contentHtml: string }> = [];
  let pagesIndexed = 0;
  const now = new Date();

  for (const type of typesToScan) {
    let items;
    try {
      items = await listWpPosts(auth.baseUrl, auth.username, auth.appPassword, { type });
    } catch {
      continue; // type not accessible, skip
    }

    for (const item of items) {
      const url = item.link;
      if (!url) continue;
      const title = stripHtml(item.title?.rendered) || "Untitled";
      const summary = stripHtml(item.excerpt?.rendered).slice(0, 400) || null;
      const contentHtml = item.content?.rendered ?? "";

      await prisma.sitePage.upsert({
        where: { siteId_url: { siteId: site.id, url } },
        create: {
          siteId: site.id,
          wpPostId: item.id,
          title,
          url,
          summary,
          pageType: type === "pages" ? "page" : type === "posts" ? "post" : type,
          lastScannedAt: now,
        },
        update: {
          wpPostId: item.id,
          title,
          summary,
          pageType: type === "pages" ? "page" : type === "posts" ? "post" : type,
          lastScannedAt: now,
        },
      });

      allItems.push({ url: url.replace(/\/$/, ""), contentHtml });
      pagesIndexed += 1;
    }
  }

  // --- Orphan detection: union of every href across every page's content ---
  const linkedUrls = new Set<string>();
  for (const item of allItems) {
    const links = extractLinkedUrls(item.contentHtml, site.baseUrl);
    for (const url of links) linkedUrls.add(url);
  }

  const allSitePages = await prisma.sitePage.findMany({ where: { siteId: site.id } });
  let orphanCount = 0;
  for (const page of allSitePages) {
    const isOrphan = !linkedUrls.has(page.url.replace(/\/$/, ""));
    if (isOrphan) orphanCount += 1;
    if (page.isOrphan !== isOrphan) {
      await prisma.sitePage.update({ where: { id: page.id }, data: { isOrphan } });
    }
  }

  return {
    categoriesIndexed: localCats.length,
    pagesIndexed,
    orphanCount,
    postTypesScanned: typesToScan,
  };
}
