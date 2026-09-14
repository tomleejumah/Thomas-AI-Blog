import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

const sessions = new Map<string, { expires: number }>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function adminPassword() {
  return process.env.ADMIN_PASSWORD || process.env.ACE_ADMIN_PASSWORD || "";
}

function sign(token: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || adminPassword() || "dev-secret";
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function issueSession() {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

export function revokeSession(token: string) {
  sessions.delete(token);
}

export function isValidSession(token: string | undefined | null) {
  if (!token) return false;
  const row = sessions.get(token);
  if (!row) return false;
  if (row.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function getBearer(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  const alt = req.headers["x-admin-token"];
  if (typeof alt === "string") return alt.trim();
  return null;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Allow unauthenticated health for uptime monitors
  if (req.url.startsWith("/health") && req.method === "GET") return;

  const pwd = adminPassword();
  if (!pwd) {
    // Dev fallback: open if no password configured
    if (process.env.NODE_ENV !== "production") return;
    return reply.code(503).send({ error: "ADMIN_PASSWORD not configured on API" });
  }

  const token = getBearer(req);
  if (!isValidSession(token)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    const body = (req.body ?? {}) as { password?: string };
    const pwd = adminPassword();
    if (!pwd) {
      return reply.code(503).send({ error: "ADMIN_PASSWORD not set on server" });
    }
    const given = String(body.password ?? "");
    const a = Buffer.from(given);
    const b = Buffer.from(pwd);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) return reply.code(401).send({ error: "Invalid password" });
    const token = issueSession();
    return { token, expiresInHours: 12 };
  });

  app.post("/logout", async (req) => {
    const token = getBearer(req);
    if (token) revokeSession(token);
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    const token = getBearer(req);
    if (!isValidSession(token)) return reply.code(401).send({ error: "Unauthorized" });
    return { ok: true };
  });
};

// silence unused in case
void sign;
