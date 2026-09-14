"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Site = { id: string; name: string; baseUrl: string };
type Content = {
  id: string;
  title: string;
  status: string;
  language: string;
  siteId: string;
  bodyHtml?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  wpUrl?: string | null;
  site?: { id: string; name: string };
};

export default function DashboardPage() {
  const [contents, setContents] = useState<Content[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [preview, setPreview] = useState<Content | null>(null);
  const [edit, setEdit] = useState<Content | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cJson, sJson] = await Promise.all([
      api<{ contents: Content[] }>("/content"),
      api<{ sites: Site[] }>("/sites"),
    ]);
    setContents(cJson.contents ?? []);
    setSites(sJson.sites ?? []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const payload = {
      siteId: String(fd.get("siteId") ?? ""),
      title: String(fd.get("title") ?? ""),
      language: String(fd.get("language") ?? "en"),
      brief: String(fd.get("brief") ?? "") || undefined,
      autoGenerate: fd.get("autoGenerate") === "on",
    };
    try {
      const { content } = await api<{ content: Content }>("/content", {
        method: "POST",
        body: JSON.stringify({
          siteId: payload.siteId,
          title: payload.title,
          language: payload.language,
        }),
      });
      if (payload.autoGenerate) {
        setBusyId(content.id);
        await api(`/content/${content.id}/generate`, {
          method: "POST",
          body: JSON.stringify({ provider: "auto", brief: payload.brief }),
        });
        setMsg(`Generated: ${content.title}`);
      } else {
        setMsg(`Idea saved: ${content.title}`);
      }
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusyId(null);
      setCreating(false);
    }
  }

  async function runGenerate(id: string) {
    setMenuId(null);
    setBusyId(id);
    setError("");
    setMsg("");
    try {
      const res = await api<{ provider: string }>(`/content/${id}/generate`, {
        method: "POST",
        body: JSON.stringify({ provider: "auto" }),
      });
      setMsg(`Generated via ${res.provider}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusyId(null);
    }
  }

  async function runApprovePublish(id: string) {
    setMenuId(null);
    if (
      !confirm(
        "Approve this article and publish it to WordPress as a DRAFT?\n\nYou can delete the draft in WP anytime."
      )
    ) {
      return;
    }
    setBusyId(id);
    setError("");
    setMsg("");
    try {
      await api(`/content/${id}/approve`, { method: "POST", body: "{}" });
      const res = await api<{ content: Content; imageError?: string }>(
        `/content/${id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ withImage: true, status: "draft" }),
        }
      );
      setMsg(
        res.content.wpUrl
          ? `Draft on WP: ${res.content.wpUrl}${res.imageError ? " (no featured image)" : ""}`
          : "Published draft"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusyId(null);
    }
  }

  async function runDelete(id: string) {
    setMenuId(null);
    if (!confirm("Delete this item from the dashboard?")) return;
    setBusyId(id);
    try {
      await api(`/content/${id}`, { method: "DELETE" });
      setMsg("Deleted");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    setBusyId(edit.id);
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/content/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(fd.get("title") ?? ""),
          bodyHtml: String(fd.get("bodyHtml") ?? ""),
          seoTitle: String(fd.get("seoTitle") ?? ""),
          metaDescription: String(fd.get("metaDescription") ?? ""),
          focusKeyword: String(fd.get("focusKeyword") ?? ""),
        }),
      });
      setEdit(null);
      setMsg("Saved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Dashboard</h1>
          <p className="lead">Your content queue — generate, review, then send a draft to WordPress.</p>
        </div>
        <button type="button" className="add-btn" onClick={() => setShowCreate(true)} title="New content">
          +
        </button>
      </div>

      {msg ? <p className="msg ok">{msg}</p> : null}
      {error ? <p className="msg err">{error}</p> : null}

      <div className="list">
        {contents.length === 0 ? (
          <p className="muted">Nothing yet. Hit + to add a topic.</p>
        ) : (
          contents.map((c) => {
            const busy = busyId === c.id;
            const canPublish =
              !!c.bodyHtml && !c.wpUrl && c.status !== "PUBLISHED";
            return (
              <div key={c.id} className="row">
                <div className="row-main">
                  <strong>{c.title}</strong>
                  <div className="meta">
                    {c.site?.name ?? c.siteId} · {c.status} · {c.language}
                    {c.wpUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a href={c.wpUrl} target="_blank" rel="noreferrer">
                          WP draft
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="actions">
                  {busy ? <span className="spinner sm" /> : null}
                  {!c.wpUrl ? (
                    <button type="button" disabled={busy} onClick={() => runGenerate(c.id)}>
                      {c.bodyHtml ? "Regenerate" : "Generate"}
                    </button>
                  ) : null}
                  {c.bodyHtml ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMenuId(null);
                        setPreview(c);
                      }}
                    >
                      Preview
                    </button>
                  ) : null}
                  <div className="more-wrap">
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                    >
                      ···
                    </button>
                    {menuId === c.id ? (
                      <div className="more-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            setEdit(c);
                          }}
                        >
                          Edit
                        </button>
                        {canPublish ? (
                          <button type="button" onClick={() => runApprovePublish(c.id)}>
                            Approve &amp; publish draft
                          </button>
                        ) : null}
                        <button type="button" className="danger" onClick={() => runDelete(c.id)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showCreate ? (
        <div className="modal" role="dialog">
          <form className="modal-card form" onSubmit={onCreate}>
            <div className="modal-head">
              <h2>New content</h2>
              <button type="button" className="ghost" onClick={() => setShowCreate(false)}>
                Close
              </button>
            </div>
            <div className="help-box">
              <p>
                <strong>Title</strong> — topic for the article.
              </p>
              <p>
                <strong>Brief</strong> — guidelines only (audience, tone, what not to invent). Not the full post.
              </p>
              <p>
                <strong>Generate</strong> — AI writes the full blog + SEO.
              </p>
              <p>
                <strong>Approve &amp; publish</strong> — one step: accept the draft and send it to WordPress as a{" "}
                <em>draft</em> (featured image if the image API works).
              </p>
            </div>
            <label>
              Site
              <select name="siteId" required defaultValue="">
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
              <input name="title" required placeholder="Sunset yacht charter tips" />
            </label>
            <label>
              Language
              <select name="language" defaultValue="en">
                <option value="en">English</option>
                <option value="pt">Portuguese</option>
                <option value="fr">French</option>
              </select>
            </label>
            <label>
              Brief (guidelines)
              <textarea name="brief" rows={3} placeholder="Audience, tone, must-avoid claims…" />
            </label>
            <label className="check">
              <input name="autoGenerate" type="checkbox" defaultChecked />
              Generate full article now
            </label>
            <button type="submit" disabled={creating || !!busyId}>
              {creating || busyId ? (
                <span className="btn-row">
                  <span className="spinner sm" /> Working…
                </span>
              ) : (
                "Create"
              )}
            </button>
          </form>
        </div>
      ) : null}

      {preview ? (
        <div className="modal" role="dialog">
          <div className="modal-card">
            <div className="modal-head">
              <h2>{preview.title}</h2>
              <button type="button" className="ghost" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <div
              className="preview-html"
              dangerouslySetInnerHTML={{ __html: preview.bodyHtml || "<p>No body</p>" }}
            />
          </div>
        </div>
      ) : null}

      {edit ? (
        <div className="modal" role="dialog">
          <form className="modal-card form" onSubmit={saveEdit}>
            <div className="modal-head">
              <h2>Edit</h2>
              <button type="button" className="ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
            <label>
              Title
              <input name="title" defaultValue={edit.title} required />
            </label>
            <label>
              SEO title
              <input name="seoTitle" defaultValue={edit.seoTitle ?? ""} />
            </label>
            <label>
              Focus keyword
              <input name="focusKeyword" defaultValue={edit.focusKeyword ?? ""} />
            </label>
            <label>
              Meta description
              <textarea name="metaDescription" rows={2} defaultValue={edit.metaDescription ?? ""} />
            </label>
            <label>
              Body HTML
              <textarea name="bodyHtml" rows={12} defaultValue={edit.bodyHtml ?? ""} />
            </label>
            <button type="submit" disabled={busyId === edit.id}>
              Save
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
