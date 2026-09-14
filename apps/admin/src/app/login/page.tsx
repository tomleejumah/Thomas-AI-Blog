"use client";

import { FormEvent, useState } from "react";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: String(fd.get("password") ?? "") }),
      });
      setToken(res.token);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="form panel login-card" onSubmit={onSubmit}>
        <h1>Admin login</h1>
        <p className="lead">AI Content Engine — authorized access only.</p>
        <label>
          Password
          <input name="password" type="password" required autoFocus />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p className="msg err">{error}</p> : null}
      </form>
    </div>
  );
}
