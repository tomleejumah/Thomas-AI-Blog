"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

export default function SitesPage() {
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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
      e.currentTarget.reset();
    } catch (err) {
      setOk(false);
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Sites</h1>
      <p className="lead">
        Connect WordPress once with Application Password. We test REST, save the site, then scan
        categories for publishing.
      </p>
      <form className="form surface" onSubmit={onSubmit}>
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
        {msg ? <p className={`msg ${ok ? "ok" : "err"}`}>{msg}</p> : null}
      </form>
    </>
  );
}
