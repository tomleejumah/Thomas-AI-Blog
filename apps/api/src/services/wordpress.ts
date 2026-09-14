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
  }
) {
  return wpFetch(baseUrl, username, appPassword, "/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      status: input.status ?? "draft",
      categories: input.categories ?? [],
      featured_media: input.featuredMediaId ?? 0,
      excerpt: input.excerpt ?? "",
    }),
  });
}
