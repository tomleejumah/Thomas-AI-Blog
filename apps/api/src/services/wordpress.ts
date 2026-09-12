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
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuth(username, appPassword),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

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
  const me = await wpFetch(baseUrl, username, appPassword, "/wp/v2/users/me");
  return me;
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

export async function createWpDraftPost(
  baseUrl: string,
  username: string,
  appPassword: string,
  input: {
    title: string;
    content: string;
    categories?: number[];
    status?: "draft" | "publish";
  }
) {
  return wpFetch(baseUrl, username, appPassword, "/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      status: input.status ?? "draft",
      categories: input.categories ?? [],
    }),
  });
}
