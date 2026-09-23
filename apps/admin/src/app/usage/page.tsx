"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Usage = {
  totalUsd: number;
  byProvider: Record<string, number>;
  byOperation: Record<string, number>;
  count: number;
};

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    api<Usage>("/usage").then(setUsage).catch(() => setUsage(null));
  }, []);

  if (!usage) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <h1>AI Usage & Cost</h1>
      <p>
        Total: <strong>${usage.totalUsd.toFixed(2)}</strong> across {usage.count} operations
      </p>

      <h3>By provider</h3>
      <ul>
        {Object.entries(usage.byProvider).map(([k, v]) => (
          <li key={k}>{k}: ${v.toFixed(2)}</li>
        ))}
      </ul>

      <h3>By operation</h3>
      <ul>
        {Object.entries(usage.byOperation).map(([k, v]) => (
          <li key={k}>{k}: ${v.toFixed(2)}</li>
        ))}
      </ul>
    </div>
  );
}
