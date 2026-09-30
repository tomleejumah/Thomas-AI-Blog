/**
 * Link guard: keeps competitor / unwanted outbound links out of generated posts.
 *
 * Configured per site through the existing "business facts" editor (Sites page):
 *   blocked_domains: competitor1.com, competitor2.com
 *   external_links: none        (optional — strips ALL outbound links)
 */

export type LinkPolicy = {
  siteHost: string;
  blocked: string[];
  allowExternal: boolean;
};

export const LINK_POLICY_FACT_KEYS = ["blocked_domains", "competitors", "external_links"];

const norm = (h: string) => h.toLowerCase().trim().replace(/^www\./, "");

function toHost(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    return norm(new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname);
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function buildLinkPolicy(
  baseUrl: string,
  facts: Array<{ key: string; value: string }>,
): LinkPolicy {
  const blocked: string[] = [];
  let allowExternal = true;

  for (const f of facts) {
    const key = f.key.trim().toLowerCase();
    if (key === "blocked_domains" || key === "competitors") {
      for (const part of f.value.split(/[,\s;]+/)) {
        const h = toHost(part);
        if (h) blocked.push(h);
      }
    }
    if (key === "external_links" && /^(none|no|off|false)$/i.test(f.value.trim())) {
      allowExternal = false;
    }
  }

  return {
    siteHost: toHost(baseUrl) ?? "",
    blocked: Array.from(new Set(blocked)),
    allowExternal,
  };
}

/** Drop research sources that point at blocked domains. */
export function filterSources<T extends { url: string }>(
  sources: T[],
  policy: LinkPolicy,
): T[] {
  return sources.filter((s) => {
    const h = toHost(s.url);
    return !h || !policy.blocked.some((d) => hostMatches(h, d));
  });
}

/**
 * Remove <a> tags that point to blocked domains (or to any external domain when
 * external_links is "none"). The anchor text is kept, only the link goes away.
 */
export function stripDisallowedLinks(
  html: string,
  policy: LinkPolicy,
): { html: string; removed: string[] } {
  const removed: string[] = [];
  const out = html.replace(
    /<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (full, _q: string, href: string, inner: string) => {
      const h = href.trim();
      if (!h || h.startsWith("#") || h.startsWith("/") || /^(mailto|tel):/i.test(h)) {
        return full;
      }
      const host = toHost(h);
      if (!host) return full;
      if (policy.siteHost && hostMatches(host, policy.siteHost)) return full;

      const isBlocked = policy.blocked.some((d) => hostMatches(host, d));
      if (isBlocked || !policy.allowExternal) {
        removed.push(h);
        return inner;
      }
      return full;
    },
  );
  return { html: out, removed };
}
