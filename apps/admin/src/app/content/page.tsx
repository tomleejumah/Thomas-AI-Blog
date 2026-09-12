"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Site = { id: string; name: string; baseUrl: string };
type Content = {
  id: string;
  title: string;
  status: string;
  language: string;
  siteId: string;
  bodyHtml?: string | null;
  wpUrl?: string | null;
  site?: { id: string; name: string };
  category?: { id: string; name: string } | null;
};

export default function ContentPage() {
  const [contents, setContents] = useState<Content[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cRes, sRes] = await Promise.all([
      fetch(`${API}/content`),
      fetch(`${API}/sites`),
    ]);
    const cJson = await cRes.json();
    const sJson = await sRes.json();
    if (!cRes.ok) throw new Error(cJson?.error ?? "Failed to load content");
    if (!sRes.ok) throw new Error(sJson?.error ?? "Failed to load sites");
    setContents(cJson.contents ?? []);
    setSites(sJson.sites ?? []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const payload = {
      siteId: String(fd.get("siteId") ?? ""),
      title: String(fd.get("title") ?? ""),
      language: String(fd.get("language") ?? "en"),
    };
    const res = await fetch(`${API}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? "Create failed");
      return;
    }
    e.currentTarget.reset();
    setMsg(`Created idea: ${json.content.title}`);
    await load();
  }

  async function runAction(id: string, action: "generate" | "approve" | "publish") {
    setBusyId(id);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API}/content/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "generate" ? JSON.stringify({}) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `${action} failed`);
      if (action === "generate") {
        setMsg(`Generated via ${json.provider}`);
      } else if (action === "publish") {
        setMsg(json.alreadyPublished ? "Already on WP" : `WP draft #${json.post?.id}`);
      } else {
        setMsg("Approved");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Content</h1>
      <p className="lead">
        Create idea → Generate (stub without keys) → Approve → Publish draft to WordPress.
      </p>

      <form className="form panel" onSubmit={onCreate}>
        <label>
          Site
          <select name="siteId" required defaultValue="" style={{ background: "#0f1419", color: "#e8eef4", border: "1px solid #2a3542", borderRadius: 8, padding: "0.6rem" }}>
            <option value="" disabled>
              Select site
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title / topic
          <input name="title" required placeholder="Bathroom renovation tips" />
        </label>
        <label>
          Language
          <select name="language" defaultValue="en" style={{ background: "#0f1419", color: "#e8eef4", border: "1px solid #2a3542", borderRadius: 8, padding: "0.6rem" }}>
            <option value="en">English</option>
            <option value="pt">Portuguese</option>
            <option value="fr">French</option>
          </select>
        </label>
        <button type="submit">Create idea</button>
      </form>

      {msg ? <p className="msg ok">{msg}</p> : null}
      {error ? <p className="msg err">{error}</p> : null}
      {sites.length === 0 ? (
        <p className="msg">Connect a WordPress site under Sites first (or use stub flow after adding a site record).</p>
      ) : null}

      <div className="panel" style={{ marginTop: "1rem" }}>
        {contents.length === 0 ? (
          <p>No content items yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
            {contents.map((c) => (
              <li key={c.id} style={{ borderBottom: "1px solid #2a3542", paddingBottom: "0.75rem" }}>
                <strong>{c.title}</strong>
                <div style={{ color: "#93a4b5", fontSize: "0.9rem" }}>
                  {c.site?.name ?? c.siteId} · {c.status} · {c.language}
                  {c.wpUrl ? (
                    <>
                      {" "}
                      · <a href={c.wpUrl} target="_blank" rel="noreferrer">WP</a>
                    </>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                  <button disabled={busyId === c.id} type="button" onClick={() => runAction(c.id, "generate")}>
                    Generate
                  </button>
                  <button disabled={busyId === c.id} type="button" onClick={() => runAction(c.id, "approve")}>
                    Approve
                  </button>
                  <button disabled={busyId === c.id} type="button" onClick={() => runAction(c.id, "publish")}>
                    Publish draft
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
