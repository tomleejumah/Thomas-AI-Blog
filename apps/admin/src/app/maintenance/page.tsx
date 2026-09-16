"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Probe = { status: string; detail: string };
type StatusPayload = {
  api: Probe;
  providers: {
    openai: Probe;
    gemini: Probe;
    tavily: Probe;
    perplexity: Probe;
  };
  keys: Record<string, { configured: boolean; last4: string | null }>;
  checkedAt: string;
};

function LivePulse({ ok }: { ok: boolean }) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="22" fill="none" stroke="#2a3542" strokeWidth="3" />
      <circle
        cx="28"
        cy="28"
        r="10"
        className={ok ? "pulse-ok" : "pulse-bad"}
        fill={ok ? "#3ecf8e" : "#ff7b7b"}
      />
    </svg>
  );
}

function statusLabel(s: string) {
  if (s === "up") return "Up";
  if (s === "credits") return "Credits / quota";
  if (s === "invalid") return "Invalid key";
  if (s === "missing") return "Missing";
  if (s === "configured") return "Configured";
  if (s === "down") return "Down";
  return s;
}

export default function MaintenancePage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api<StatusPayload>("/maintenance/status");
    setStatus(data);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
    const t = setInterval(() => {
      load().catch(() => null);
    }, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function onSaveKeys(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    for (const k of ["OPENAI_API_KEY", "GEMINI_API_KEY", "TAVILY_API_KEY"]) {
      const v = String(fd.get(k) ?? "").trim();
      if (v) body[k] = v;
    }
    try {
      await api("/maintenance/keys", { method: "PUT", body: JSON.stringify(body) });
      setMsg("Keys saved on server (full values never shown again).");
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const apiOk = status?.api?.status === "up";

  return (
    <>
      <h1>Maintenance</h1>
      <p className="lead">LLM / research API status and server-side key updates.</p>

      <div className="maint-top">
        <div className="pulse-block">
          <LivePulse ok={!!apiOk} />
          <div>
            <strong>API {apiOk ? "live" : "unreachable"}</strong>
            <div className="meta">{status?.api?.detail ?? "Checking…"}</div>
            <div className="meta">Checked {status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "—"}</div>
          </div>
          <button type="button" className="ghost" onClick={() => load().catch(() => null)}>
            Refresh
          </button>
        </div>
      </div>

      <div className="status-grid">
        {(
          [
            ["OpenAI", status?.providers.openai, "openai"],
            ["Gemini", status?.providers.gemini, "gemini"],
            ["Tavily", status?.providers.tavily, "tavily"],
          ] as const
        ).map(([name, probe, key]) => (
          <div key={name} className="status-row">
            <strong>{name}</strong>
            <span className={`pill pill-${probe?.status ?? "missing"}`}>
              {statusLabel(probe?.status ?? "missing")}
            </span>
            <span className="meta">{probe?.detail}</span>
            <span className="meta">
              key{" "}
              {status?.keys[key]?.configured
                ? `••••${status.keys[key].last4}`
                : "—"}
            </span>
          </div>
        ))}
      </div>

      <h2 className="subhead">Update keys</h2>
      <p className="muted">
        Leave blank to keep existing. Values are stored in server <code>.env</code> only — not on Vercel.
      </p>
      <form className="form surface" onSubmit={onSaveKeys}>
        <label>
          OpenAI API key
          <input name="OPENAI_API_KEY" type="password" placeholder="sk-… (leave blank to keep)" autoComplete="off" />
        </label>
        <label>
          Gemini API key
          <input name="GEMINI_API_KEY" type="password" placeholder="AIza… (leave blank to keep)" autoComplete="off" />
        </label>
        <label>
          Tavily research key
          <input name="TAVILY_API_KEY" type="password" placeholder="tvly-…" autoComplete="off" />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save to server"}
        </button>
      </form>
      {msg ? <p className="msg ok">{msg}</p> : null}
      {error ? <p className="msg err">{error}</p> : null}
    </>
  );
}
