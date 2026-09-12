"use client";

import { FormEvent, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
      const test = await fetch(`${API}/wordpress/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const testJson = await test.json();
      if (!test.ok) throw new Error(testJson?.message ?? testJson?.error ?? "WP test failed");

      const create = await fetch(`${API}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const createJson = await create.json();
      if (!create.ok) throw new Error(createJson?.error ?? "Save failed");

      const scan = await fetch(`${API}/wordpress/${createJson.site.id}/scan`, {
        method: "POST",
      });
      const scanJson = await scan.json();
      if (!scan.ok) throw new Error(scanJson?.error ?? "Scan failed");

      setOk(true);
      setMsg(
        `Connected. Scanned ${scanJson.scanned} categories.\nSite id: ${createJson.site.id}`
      );
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
        Connect a WordPress site with Application Password. We test REST, save the site, then scan categories.
      </p>
      <form className="form panel" onSubmit={onSubmit}>
        <label>
          Site name
          <input name="name" required placeholder="NGTEC" />
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
          {busy ? "Connecting…" : "Connect & scan"}
        </button>
        {msg ? <p className={`msg ${ok ? "ok" : "err"}`}>{msg}</p> : null}
      </form>
    </>
  );
}
