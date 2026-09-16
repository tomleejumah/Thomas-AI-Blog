/** WordPress REST helpers — Application Password = Basic auth */

function basicAuth(username: string, appPassword: string) {
  const token = Buffer.from(`${username}:${appPassword}`).toString("base64");
  return `Basic ${token}`;
}

export async function wpFetch(
  baseUrl: string,
  username: string,
  appPassword: string,
  path: string,
  init?: RequestInit
) {
  const url = `${baseUrl.replace(/\/$/, "")}/wp-json${path}`;
  const headers: Record<string, string> = {
    Authorization: basicAuth(username, appPassword),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (!(init?.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...init, headers });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`WP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

export async function testWpConnection(
  baseUrl: string,
  username: string,
  appPassword: string
) {
  return wpFetch(baseUrl, username, appPassword, "/wp/v2/users/me");
}

export async function listWpCategories(
  baseUrl: string,
  username: string,
  appPassword: string
) {
  return wpFetch(
    baseUrl,
    username,
    appPassword,
    "/wp/v2/categories?per_page=100"
  ) as Promise<Array<{ id: number; name: string; slug: string; parent: number }>>;
}

export async function createWpCategory(
  baseUrl: string,
  username: string,
  appPassword: string,
  name: string
) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || `cat-${Date.now()}`;

  return wpFetch(baseUrl, username, appPassword, "/wp/v2/categories", {
    method: "POST",
    body: JSON.stringify({ name: name.trim(), slug }),
  }) as Promise<{ id: number; name: string; slug: string }>;
}

export async function uploadWpMedia(
  baseUrl: string,
  username: string,
  appPassword: string,
  input: { bytes: Buffer; filename: string; mime: string; alt?: string; title?: string }
) {
  const url = `${baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/media`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(username, appPassword),
      "Content-Disposition": `attachment; filename="${input.filename}"`,
      "Content-Type": input.mime,
    },
    body: new Uint8Array(input.bytes),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`WP media ${res.status}: ${JSON.stringify(data)}`);
  }

  if (input.alt || input.title) {
    await wpFetch(baseUrl, username, appPassword, `/wp/v2/media/${data.id}`, {
      method: "POST",
      body: JSON.stringify({
        alt_text: input.alt ?? "",
        title: input.title ?? input.filename,
      }),
    });
  }

  return data as { id: number; source_url?: string };
}

export async function createWpDraftPost(
  baseUrl: string,
  username: string,
  appPassword: string,
  input: {
    title: string;
    content: string;
    categories?: number[];
    status?: "draft" | "publish";
    featuredMediaId?: number;
    excerpt?: string;
    seo?: {
      focusKeyword?: string;
      seoTitle?: string;
      metaDescription?: string;
    };
  }
) {
  const meta: Record<string, string> = {};
  if (input.seo?.focusKeyword) meta.rank_math_focus_keyword = input.seo.focusKeyword;
  if (input.seo?.seoTitle) meta.rank_math_title = input.seo.seoTitle;
  if (input.seo?.metaDescription) meta.rank_math_description = input.seo.metaDescription;

  const post = (await wpFetch(baseUrl, username, appPassword, "/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      status: input.status ?? "draft",
      categories: input.categories ?? [],
      featured_media: input.featuredMediaId ?? 0,
      excerpt: input.excerpt ?? "",
      ...(Object.keys(meta).length ? { meta } : {}),
    }),
  })) as { id: number; link?: string };

  // Rank Math meta sometimes needs an explicit update after create
  if (post?.id && Object.keys(meta).length) {
    try {
      await wpFetch(baseUrl, username, appPassword, `/wp/v2/posts/${post.id}`, {
        method: "POST",
        body: JSON.stringify({ meta }),
      });
    } catch {
      // non-fatal — draft still published
    }
  }

  return post;
}

/** Move a WP post to Trash (not permanent). */
export async function deleteWpPost(
  baseUrl: string,
  username: string,
  appPassword: string,
  postId: number
) {
  return wpFetch(baseUrl, username, appPassword, `/wp/v2/posts/${postId}`, {
    method: "DELETE",
  });
}

export async function listWpPosts(
  baseUrl: string,
  username: string,
  appPassword: string,
  opts: { type?: "posts" | "pages"; perPage?: number } = {}
) {
  const type = opts.type ?? "posts";
  const perPage = opts.perPage ?? 50;
  return wpFetch(
    baseUrl,
    username,
    appPassword,
    `/wp/v2/${type}?per_page=${perPage}&status=publish&_fields=id,title,link,excerpt`
  ) as Promise<
    Array<{
      id: number;
      title?: { rendered?: string };
      link?: string;
      excerpt?: { rendered?: string };
    }>
  >;
}
