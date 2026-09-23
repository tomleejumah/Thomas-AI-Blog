"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Content = {
  id: string;
  title: string;
  bodyHtml: string | null;
  status: string;
  reviewNote: string | null;
};
type Version = { id: string; title: string; bodyHtml: string | null; createdAt: string };

export default function ReviewPage() {
  const [contentId, setContentId] = useState("");
  const [content, setContent] = useState<Content | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [note, setNote] = useState("");

  async function load() {
    if (!contentId) return;
    const c = await api<{ content: Content }>(`/content/${contentId}`);
    const v = await api<{ versions: Version[] }>(`/content/${contentId}/versions`);
    setContent(c.content);
    setVersions(v.versions);
  }

  useEffect(() => {
    if (contentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  async function act(action: "approve" | "reject" | "request-changes") {
    const body = action === "approve" ? {} : { note };
    await api(`/content/${contentId}/${action}`, { method: "POST", body: JSON.stringify(body) });
    await load();
  }

  return (
    <div className="page">
      <h1>Review</h1>
      <input placeholder="Content ID" value={contentId} onChange={(e) => setContentId(e.target.value)} />

      {content && (
        <>
          <h2>{content.title} — {content.status}</h2>
          {content.reviewNote && <p className="warn">Note: {content.reviewNote}</p>}
          <div dangerouslySetInnerHTML={{ __html: content.bodyHtml ?? "" }} />

          <textarea
            placeholder="Note (required for reject/request changes)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="actions">
            <button type="button" onClick={() => act("approve")}>Approve</button>
            <button type="button" onClick={() => act("request-changes")}>Send back for revision</button>
            <button type="button" onClick={() => act("reject")}>Reject</button>
          </div>

          <h3>Version history ({versions.length})</h3>
          <ul>
            {versions.map((v) => (
              <li key={v.id}>
                <details>
                  <summary>{new Date(v.createdAt).toLocaleString()} — {v.title}</summary>
                  <div dangerouslySetInnerHTML={{ __html: v.bodyHtml ?? "" }} />
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
