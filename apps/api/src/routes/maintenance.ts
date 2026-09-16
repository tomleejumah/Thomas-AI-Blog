import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const ENV_PATH = path.resolve(__dirname, "../../../../.env");
const AUDIT_PATH = path.resolve(__dirname, "../../../../logs/key-audit.log");

const KEY_NAMES = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "TAVILY_API_KEY",
  "PERPLEXITY_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

type KeyName = (typeof KEY_NAMES)[number];

function mask(value: string | undefined) {
  if (!value) return { configured: false, last4: null as string | null };
  const v = value.trim();
  return { configured: true, last4: v.slice(-4) };
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function writeEnvFile(map: Record<string, string>) {
  const lines = Object.entries(map).map(([k, v]) => {
    const needsQuote = /[\s#"']/.test(v);
    return needsQuote ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`;
  });
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    chmodSync(ENV_PATH, 0o600);
  } catch {
    /* ignore */
  }
}

function audit(msg: string) {
  try {
    const dir = path.dirname(AUDIT_PATH);
    mkdirSync(dir, { recursive: true });
    appendFileSync(AUDIT_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

async function probeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: "missing" as const, detail: "No key" };
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return { status: "invalid" as const, detail: "Unauthorized" };
    if (res.status === 429) return { status: "credits" as const, detail: "Rate limit / credits" };
    if (!res.ok) return { status: "down" as const, detail: `HTTP ${res.status}` };
    return { status: "up" as const, detail: "OK" };
  } catch (err) {
    return { status: "down" as const, detail: err instanceof Error ? err.message : "Network error" };
  }
}

async function probeGemini() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { status: "missing" as const, detail: "No key" };
  try {
    const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (res.status === 400 || res.status === 403) {
      return { status: "invalid" as const, detail: `HTTP ${res.status}` };
    }
    if (res.status === 429) return { status: "credits" as const, detail: "Quota" };
    if (res.status === 404) return { status: "down" as const, detail: "Model not found" };
    if (!res.ok) return { status: "down" as const, detail: `HTTP ${res.status}` };
    return { status: "up" as const, detail: "OK" };
  } catch (err) {
    return { status: "down" as const, detail: err instanceof Error ? err.message : "Network error" };
  }
}

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", async () => {
    const [openai, gemini] = await Promise.all([probeOpenAI(), probeGemini()]);
    return {
      api: { status: "up" as const, detail: "ace-api responding" },
      providers: {
        openai,
        gemini,
        tavily: process.env.TAVILY_API_KEY
          ? await (async () => {
              try {
                const res = await fetch("https://api.tavily.com/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    api_key: process.env.TAVILY_API_KEY,
                    query: "yacht charter",
                    max_results: 1,
                  }),
                });
                if (res.status === 401 || res.status === 403) {
                  return { status: "invalid" as const, detail: `HTTP ${res.status}` };
                }
                if (!res.ok) return { status: "down" as const, detail: `HTTP ${res.status}` };
                return { status: "up" as const, detail: "OK" };
              } catch (err) {
                return {
                  status: "down" as const,
                  detail: err instanceof Error ? err.message : "Network error",
                };
              }
            })()
          : { status: "missing" as const, detail: "Optional research key" },
        perplexity: process.env.PERPLEXITY_API_KEY
          ? { status: "configured" as const, detail: "Key present (not probed)" }
          : { status: "missing" as const, detail: "Optional research key" },
      },
      keys: {
        openai: mask(process.env.OPENAI_API_KEY),
        gemini: mask(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        tavily: mask(process.env.TAVILY_API_KEY),
        perplexity: mask(process.env.PERPLEXITY_API_KEY),
      },
      checkedAt: new Date().toISOString(),
    };
  });

  app.put("/keys", async (req, reply) => {
    const body = z
      .object({
        OPENAI_API_KEY: z.string().optional(),
        GEMINI_API_KEY: z.string().optional(),
        TAVILY_API_KEY: z.string().optional(),
        PERPLEXITY_API_KEY: z.string().optional(),
        ANTHROPIC_API_KEY: z.string().optional(),
      })
      .parse(req.body ?? {});

    const map = readEnvFile();
    // seed from process.env for keys already loaded
    for (const k of KEY_NAMES) {
      if (map[k] == null && process.env[k]) map[k] = process.env[k] as string;
    }

    const changed: string[] = [];
    for (const k of KEY_NAMES) {
      const next = body[k as KeyName];
      if (typeof next === "string" && next.trim()) {
        map[k] = next.trim();
        process.env[k] = next.trim();
        changed.push(k);
      }
    }

    if (!changed.length) {
      return reply.code(400).send({ error: "No keys provided" });
    }

    writeEnvFile(map);
    audit(`updated ${changed.join(",")} from ${req.ip}`);

    return {
      ok: true,
      updated: changed,
      keys: {
        openai: mask(process.env.OPENAI_API_KEY),
        gemini: mask(process.env.GEMINI_API_KEY),
        tavily: mask(process.env.TAVILY_API_KEY),
        perplexity: mask(process.env.PERPLEXITY_API_KEY),
      },
    };
  });
};
