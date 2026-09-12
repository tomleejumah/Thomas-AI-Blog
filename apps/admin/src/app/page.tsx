const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getHealth() {
  try {
    const res = await fetch(`${API}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <>
      <h1>Overview</h1>
      <p className="lead">
        Your admin for planning, generating, reviewing, and publishing to WordPress.
        API keys stay on the server — plug them into <code>.env</code> when ready.
      </p>
      <div className="grid">
        <div className="panel">
          <h2>API</h2>
          <p>{health?.ok ? "Online" : "Offline — start apps/api"}</p>
        </div>
        <div className="panel">
          <h2>OpenAI key</h2>
          <p>{health?.keys?.openai ? "Configured" : "Missing (ok for now)"}</p>
        </div>
        <div className="panel">
          <h2>Anthropic key</h2>
          <p>{health?.keys?.anthropic ? "Configured" : "Missing (ok for now)"}</p>
        </div>
        <div className="panel">
          <h2>Tavily key</h2>
          <p>{health?.keys?.tavily ? "Configured" : "Missing (ok for now)"}</p>
        </div>
      </div>
    </>
  );
}
