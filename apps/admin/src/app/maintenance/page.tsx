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

  const [keyTarget, setKeyTarget] = useState<
    "OPENAI_API_KEY" | "GEMINI_API_KEY" | "TAVILY_API_KEY"
  >("OPENAI_API_KEY");
  const [keyValue, setKeyValue] = useState("");

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

  async function onSaveKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = keyValue.trim();
    if (!value) {
      setError("Paste the new key first.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await api("/maintenance/keys", {
        method: "PUT",
        body: JSON.stringify({ [keyTarget]: value }),
      });
      setMsg(`${keyTarget.replace("_API_KEY", "")} updated on server. Full key is never returned.`);
      setKeyValue("");
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
      <p className="muted">Leave blank to keep the current key. Saved to the API server only.</p>
      <form className="form surface" onSubmit={onSaveKey} autoComplete="off">
        <label>
          Key to update
          <select
            value={keyTarget}
            onChange={(e) => {
              setKeyTarget(e.target.value as typeof keyTarget);
              setKeyValue("");
            }}
          >
            <option value="OPENAI_API_KEY">OpenAI</option>
            <option value="GEMINI_API_KEY">Gemini</option>
            <option value="TAVILY_API_KEY">Tavily</option>
          </select>
        </label>
        <label>
          New key value
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="Paste key — leave empty / cancel to keep existing"
            autoComplete="new-password"
            name="ace_key_value"
            data-lpignore="true"
            data-1p-ignore="true"
          />
        </label>
        <button type="submit" disabled={busy || !keyValue.trim()}>
          {busy ? "Updating…" : "Update"}
        </button>
      </form>
      {msg ? <p className="msg ok">{msg}</p> : null}
      {error ? <p className="msg err">{error}</p> : null}
    </>
  );
}
