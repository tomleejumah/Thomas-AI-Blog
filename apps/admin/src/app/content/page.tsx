"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Content = {
  id: string;
  title: string;
  status: string;
  language: string;
  siteId: string;
};

export default function ContentPage() {
  const [contents, setContents] = useState<Content[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/content`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Failed to load");
        setContents(json.contents ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);

  return (
    <>
      <h1>Content</h1>
      <p className="lead">Ideas → review → publish. Generation pipeline comes next once API keys are in.</p>
      {error ? <p className="msg err">{error}</p> : null}
      <div className="panel">
        {contents.length === 0 ? (
          <p>No content items yet.</p>
        ) : (
          <ul>
            {contents.map((c) => (
              <li key={c.id}>
                {c.title} — {c.status} ({c.language})
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
