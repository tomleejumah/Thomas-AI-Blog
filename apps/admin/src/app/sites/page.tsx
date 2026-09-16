"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Site = {
  id: string;
  name: string;
  baseUrl: string;
  rankMathActive: boolean;
  createdAt: string;
  _count?: { categories: number; contents: number };
};

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ sites: Site[] }>("/sites");
    setSites(data.sites ?? []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [load]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setOk(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? ""),
      baseUrl: String(fd.get("baseUrl") ?? ""),
      wpUsername: String(fd.get("wpUsername") ?? ""),
      wpAppPassword: String(fd.get("wpAppPassword") ?? ""),
    };

    try {
      await api("/wordpress/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const createJson = await api<{ site: { id: string } }>("/sites", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const scanJson = await api<{ scanned: number }>(
        `/wordpress/${createJson.site.id}/scan`,
        { method: "POST", body: "{}" }
      );
      setOk(true);
      setMsg(`Connected. Scanned ${scanJson.scanned} categories.`);
      setShowAdd(false);
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setOk(false);
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function rescan(id: string) {
    setBusyId(id);
    setError("");
    try {
      const scan = await api<{ scanned: number }>(`/wordpress/${id}/scan`, {
        method: "POST",
        body: "{}",
      });
      setMsg(`Rescanned ${scan.scanned} categories.`);
      setOk(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Disconnect “${name}”? Content records for this site will also be removed.`)) {
      return;
    }
    setBusyId(id);
    try {
      await api(`/sites/${id}`, { method: "DELETE" });
      setMsg(`Removed ${name}`);
      setOk(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Sites</h1>
          <p className="lead">
            Connected WordPress sites. Connect once, then generate/publish from the Dashboard.
          </p>
        </div>
        <button type="button" className="add-btn" onClick={() => setShowAdd(true)} title="Add site">
          +
        </button>
      </div>

      {msg ? <p className={`msg ${ok ? "ok" : "err"}`}>{msg}</p> : null}
      {error ? <p className="msg err">{error}</p> : null}

      <div className="list">
        {sites.length === 0 ? (
          <p className="muted">No sites yet. Hit + to connect WordPress.</p>
        ) : (
          sites.map((s) => (
            <div key={s.id} className="row">
              <div className="row-main">
                <strong>{s.name}</strong>
                <div className="meta">
                  <a href={s.baseUrl} target="_blank" rel="noreferrer">
                    {s.baseUrl}
                  </a>
                  {" · "}
                  {s._count?.categories ?? 0} categories · {s._count?.contents ?? 0} content
                  {s.rankMathActive ? " · Rank Math" : ""}
                </div>
              </div>
              <div className="actions">
                {busyId === s.id ? <span className="spinner sm" /> : null}
                <button type="button" disabled={busyId === s.id} onClick={() => rescan(s.id)}>
                  Rescan
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busyId === s.id}
                  onClick={() => remove(s.id, s.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd ? (
        <div className="modal" role="dialog">
          <form className="modal-card form" onSubmit={onSubmit}>
            <div className="modal-head">
              <h2>Connect WordPress</h2>
              <button type="button" className="icon-close" aria-label="Close" onClick={() => setShowAdd(false)}>
                ×
              </button>
            </div>
            <label>
              Site name
              <input name="name" required placeholder="LisbonYacht" />
            </label>
            <label>
              Site URL
              <input name="baseUrl" required type="url" placeholder="https://example.com" />
            </label>
            <label>
              WP username
              <input name="wpUsername" required />
            </label>
            <label>
              Application Password
              <input name="wpAppPassword" required type="password" />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? (
                <span className="btn-row">
                  <span className="spinner sm" /> Connecting…
                </span>
              ) : (
                "Connect & scan"
              )}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
