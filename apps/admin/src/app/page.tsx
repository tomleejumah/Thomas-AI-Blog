"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import DocEditor from "@/components/DocEditor";
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
  wpPostId?: number | null;
  wpUrl?: string | null;
  site?: { id: string; name: string };
};

type Filter = "all" | "idea" | "generated" | "review" | "published";
type JobKind = "generate" | "publish";
type JobProgress = { id: string; kind: JobKind; pct: number; label: string };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "idea", label: "Ideas" },
  { id: "generated", label: "Generated" },
  { id: "review", label: "Review" },
  { id: "published", label: "On WP" },
];

function matchesFilter(c: Content, f: Filter) {
  if (f === "all") return true;
  if (f === "published") return !!c.wpUrl || c.status === "PUBLISHED" || c.status === "UPDATED";
  if (f === "review") return c.status === "HUMAN_REVIEW" || c.status === "APPROVED";
  if (f === "generated")
    return !!c.bodyHtml && !c.wpUrl && c.status !== "PUBLISHED" && c.status !== "UPDATED";
  if (f === "idea") return !c.bodyHtml && !c.wpUrl;
  return true;
}

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s === "published" || s === "updated") return "st-published";
  if (s === "human_review" || s === "approved") return "st-review";
  if (s === "ai_generated" || s === "draft") return "st-generated";
  if (s === "idea" || s === "research") return "st-idea";
  return "st-muted";
}

/** If model stored escaped tags (&lt;p&gt;), turn into real HTML for display/edit */
function readableHtml(raw: string | null | undefined) {
  const s = raw || "";
  if (!s) return "<p></p>";
  if (s.includes("<") && !s.includes("&lt;")) return s;
  if (s.includes("&lt;") || s.includes("&gt;")) {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  return s;
}

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
  const [editBodyHtml, setEditBodyHtml] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [job, setJob] = useState<JobProgress | null>(null);

  const filtered = useMemo(
    () => contents.filter((c) => matchesFilter(c, filter)),
    [contents, filter]
  );

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

  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => {
      setJob((prev) => {
        if (!prev || prev.pct >= 92) return prev;
        const step = prev.kind === "generate" ? 2.5 + Math.random() * 3.5 : 3 + Math.random() * 4;
        return { ...prev, pct: Math.min(92, prev.pct + step) };
      });
    }, 450);
    return () => clearInterval(t);
  }, [job?.id, job?.kind]);

  function startJob(id: string, kind: JobKind) {
    setJob({
      id,
      kind,
      pct: 5,
      label: kind === "generate" ? "Generating…" : "Deploying to WordPress…",
    });
  }

  async function finishJob() {
    setJob((prev) => (prev ? { ...prev, pct: 100, label: "Done" } : null));
    await new Promise((r) => setTimeout(r, 350));
    setJob(null);
  }

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
        startJob(content.id, "generate");
        await api(`/content/${content.id}/generate`, {
          method: "POST",
          body: JSON.stringify({ provider: "auto", brief: payload.brief }),
        });
        await finishJob();
        setMsg(`Generated: ${content.title}`);
      } else {
        setMsg(`Idea saved: ${content.title}`);
      }
      setShowCreate(false);
      await load();
    } catch (err) {
      setJob(null);
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
    startJob(id, "generate");
    try {
      const res = await api<{ provider: string }>(`/content/${id}/generate`, {
        method: "POST",
        body: JSON.stringify({ provider: "auto" }),
      });
      await finishJob();
      setMsg(`Generated via ${res.provider}`);
      await load();
    } catch (err) {
      setJob(null);
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
    startJob(id, "publish");
    try {
      await api(`/content/${id}/approve`, { method: "POST", body: "{}" });
      setJob((p) => (p ? { ...p, pct: Math.max(p.pct, 35), label: "Publishing draft…" } : p));
      const res = await api<{ content: Content; imageError?: string }>(
        `/content/${id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ withImage: true, status: "draft" }),
        }
      );
      await finishJob();
      setMsg(
        res.content.wpUrl
          ? `Published to WordPress${res.imageError ? " (no featured image)" : ""}. Open View on the card anytime.`
          : "Published draft"
      );
      await load();
    } catch (err) {
      setJob(null);
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusyId(null);
    }
  }

  async function runDelete(id: string) {
    setMenuId(null);
    const item = contents.find((c) => c.id === id);
    const linked = Boolean(item?.wpPostId || item?.wpUrl);
    let deleteWp = false;
    if (linked) {
      const go = confirm(
        "Delete from dashboard?\n\nOK = continue\nCancel = keep it"
      );
      if (!go) return;
      deleteWp = confirm(
        "Also move the WordPress draft to Trash?\n\nOK = trash in WP + delete here\nCancel = dashboard only (WP draft stays — delete it in WP Admin → Posts if needed)"
      );
    } else if (!confirm("Delete this item from the dashboard?")) {
      return;
    }
    setBusyId(id);
    try {
      const res = await api<{
        ok: boolean;
        wpDeleted?: boolean;
        hadWp?: boolean;
        wpUrl?: string | null;
      }>(`/content/${id}?deleteWp=${deleteWp ? "true" : "false"}`, {
        method: "DELETE",
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (res.wpDeleted) {
        setMsg("Deleted from dashboard and moved WP draft to Trash.");
      } else if (linked && !deleteWp) {
        setMsg(
          "Deleted from dashboard only. To remove the WP draft, open WordPress Admin → Posts (or Trash) and delete it there."
        );
      } else {
        setMsg("Deleted");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === filtered.length && filtered.every((c) => prev.has(c.id))
        ? new Set()
        : new Set(filtered.map((c) => c.id))
    );
  }

  async function runBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const linked = contents.filter((c) => ids.includes(c.id) && (c.wpPostId || c.wpUrl));
    let deleteWp = false;
    if (linked.length > 0) {
      if (
        !confirm(
          `Delete ${ids.length} selected item(s) from the dashboard?\n\n${linked.length} have a WordPress draft linked.`
        )
      ) {
        return;
      }
      deleteWp = confirm(
        `Also move ${linked.length} linked WordPress draft(s) to Trash?\n\nOK = trash in WP + delete here\nCancel = dashboard only (WP drafts stay)`
      );
    } else if (!confirm(`Delete ${ids.length} selected item(s) from the dashboard?`)) {
      return;
    }
    setBulkBusy(true);
    setError("");
    setMsg("");
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          api(`/content/${id}?deleteWp=${deleteWp ? "true" : "false"}`, {
            method: "DELETE",
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const ok = ids.length - failed;
      setSelected(new Set());
      if (failed) {
        setMsg(`Deleted ${ok}, failed ${failed}`);
      } else if (linked.length > 0 && !deleteWp) {
        setMsg(
          `Deleted ${ok} from dashboard only. To remove WP drafts, open WordPress Admin → Posts and trash them there.`
        );
      } else if (linked.length > 0 && deleteWp) {
        setMsg(`Deleted ${ok} (WP drafts moved to Trash where linked).`);
      } else {
        setMsg(`Deleted ${ok}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkBusy(false);
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
          bodyHtml: editBodyHtml || String(fd.get("bodyHtml") ?? ""),
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

  function openEdit(c: Content) {
    setMenuId(null);
    setEdit(c);
    setEditBodyHtml(readableHtml(c.bodyHtml));
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

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

      <div className="filter-bar" role="tablist" aria-label="Filter content">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`filter-chip${filter === f.id ? " active" : ""}`}
            onClick={() => {
              setFilter(f.id);
              setSelected(new Set());
            }}
          >
            {f.label}
            <span className="filter-count">
              {contents.filter((c) => matchesFilter(c, f.id)).length}
            </span>
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="bulk-bar">
          <label className="bulk-check">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    selected.size > 0 &&
                    !allFilteredSelected &&
                    filtered.some((c) => selected.has(c.id));
              }}
              onChange={toggleSelectAll}
            />
            Select all
          </label>
          {selected.size > 0 ? (
            <button
              type="button"
              className="danger icon-btn"
              disabled={bulkBusy}
              onClick={() => runBulkDelete()}
              title={`Delete ${selected.size} selected`}
              aria-label={`Delete ${selected.size} selected`}
            >
              {bulkBusy ? (
                <span className="spinner sm" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span>{selected.size}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="list">
        {contents.length === 0 ? (
          <p className="muted">Nothing yet. Hit + to add a topic.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">No items in this filter.</p>
        ) : (
          filtered.map((c) => {
            const busy = busyId === c.id;
            const canPublish = !!c.bodyHtml && !c.wpUrl && c.status !== "PUBLISHED";
            const rowJob = job?.id === c.id ? job : null;
            return (
              <div key={c.id} className={`row${busy ? " row-busy" : ""}`}>
                <label className="row-check">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    disabled={bulkBusy}
                  />
                </label>
                <div className="row-main">
                  <strong>{c.title}</strong>
                  <div className="meta">
                    {c.site?.name ?? c.siteId} ·{" "}
                    <span className={`st ${statusClass(c.status)}`}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                    {" · "}
                    {c.language}
                  </div>
                  {c.wpUrl ? (
                    <div className="row-link">
                      <a href={c.wpUrl} target="_blank" rel="noreferrer">
                        {c.wpUrl}
                      </a>
                    </div>
                  ) : null}
                  {rowJob ? (
                    <div className="job-progress row-progress" role="status">
                      <div className="job-progress-top">
                        <span>{rowJob.label}</span>
                        <strong>{Math.round(rowJob.pct)}%</strong>
                      </div>
                      <div className="job-progress-track">
                        <div className="job-progress-fill" style={{ width: `${rowJob.pct}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="actions">
                  {busy && !rowJob ? <span className="spinner sm" /> : null}
                  {c.wpUrl ? (
                    <a
                      className="btn-link"
                      href={c.wpUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  ) : (
                    <button type="button" disabled={busy || bulkBusy} onClick={() => runGenerate(c.id)}>
                      {c.bodyHtml ? "Regenerate" : "Generate"}
                    </button>
                  )}
                  {c.bodyHtml ? (
                    <button
                      type="button"
                      disabled={busy || bulkBusy}
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
                      disabled={busy || bulkBusy}
                      onClick={() => setMenuId(menuId === c.id ? null : c.id)}
                    >
                      ···
                    </button>
                    {menuId === c.id ? (
                      <div className="more-menu">
                        <button type="button" onClick={() => openEdit(c)}>
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
          <div className="modal-card modal-wide">
            <div className="modal-head">
              <h2>{preview.title}</h2>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    const c = preview;
                    setPreview(null);
                    openEdit(c);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="icon-close"
                  aria-label="Close"
                  onClick={() => setPreview(null)}
                >
                  ×
                </button>
              </div>
            </div>
            <div
              className="preview-html"
              dangerouslySetInnerHTML={{
                __html: readableHtml(preview.bodyHtml) || "<p>No body</p>",
              }}
            />
          </div>
        </div>
      ) : null}

      {edit ? (
        <div className="modal" role="dialog">
          <form className="modal-card modal-wide form form-wide" onSubmit={saveEdit}>
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
              Article
              <span className="field-hint">Google Docs–style edit — formatting toolbar, no raw HTML.</span>
              <DocEditor html={readableHtml(edit.bodyHtml)} onChange={setEditBodyHtml} />
              <input type="hidden" name="bodyHtml" value={editBodyHtml} readOnly />
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
