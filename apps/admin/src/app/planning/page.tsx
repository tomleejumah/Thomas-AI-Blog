"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Topic = {
  id: string;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string | null;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  isUpdateToPage: boolean;
  cannibalizes: string[];
};

export default function PlanningPage() {
  const [siteId, setSiteId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTopics = useCallback(async (sid: string) => {
    if (!sid) return;
    const data = await api<{ topics: Topic[] }>(`/sites/${sid}/topics`);
    setTopics(data.topics);
  }, []);

  useEffect(() => {
    if (siteId) loadTopics(siteId);
  }, [siteId, loadTopics]);

  async function submitPlan() {
    setBusy(true);
    setError("");
    try {
      await api(`/sites/${siteId}/plan`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
      setInstruction("");
      await loadTopics(siteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planning failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: Topic["status"]) {
    await api(`/sites/topics/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadTopics(siteId);
  }

  return (
    <div className="page">
      <h1>Topic Planning</h1>
      <input
        placeholder="Site ID"
        value={siteId}
        onChange={(e) => setSiteId(e.target.value)}
      />
      <textarea
        placeholder='e.g. "Create 10 articles around Bathroom Renovation"'
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
      />
      <button type="button" disabled={busy || !siteId || !instruction} onClick={submitPlan}>
        {busy ? "Planning…" : "Generate topics"}
      </button>
      {error && <p className="error">{error}</p>}

      <ul className="topic-list">
        {topics.map((t) => (
          <li key={t.id} className={`topic ${t.status.toLowerCase()}`}>
            <strong>{t.title}</strong> — {t.primaryKeyword}
            {t.isUpdateToPage && <span className="badge">update existing page</span>}
            {t.cannibalizes.length > 0 && (
              <div className="warn">
                ⚠ overlaps with: {t.cannibalizes.join(", ")}
              </div>
            )}
            <div className="actions">
              <button type="button" onClick={() => setStatus(t.id, "APPROVED")}>
                Approve
              </button>
              <button type="button" onClick={() => setStatus(t.id, "REJECTED")}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
