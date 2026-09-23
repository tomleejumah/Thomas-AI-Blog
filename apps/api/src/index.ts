import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes, requireAuth } from "./lib/auth";
import { healthRoutes } from "./routes/health";
import { siteRoutes } from "./routes/sites";
import { wordpressRoutes } from "./routes/wordpress";
import { contentRoutes } from "./routes/content";
import { planningRoutes } from "./routes/planning";
import { linkingRoutes } from "./routes/linking";
import { usageRoutes } from "./routes/usage";
import { maintenanceRoutes } from "./routes/maintenance";

const port = Number(process.env.API_PORT ?? 4000);
const configuredOrigins = (process.env.ADMIN_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowOrigin(origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) {
  if (!origin) return cb(null, true);
  if (configuredOrigins.includes(origin)) return cb(null, true);
  if (/^https:\/\/[\w-]+\.vercel\.app$/i.test(origin)) return cb(null, true);
  return cb(null, false);
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: allowOrigin,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-token"],
  });

  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (url === "/health" && req.method === "GET") return;
    if (url === "/auth/login" && req.method === "POST") return;
    await requireAuth(req, reply);
    if (reply.sent) return;
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(maintenanceRoutes, { prefix: "/maintenance" });
  await app.register(siteRoutes, { prefix: "/sites" });
  await app.register(wordpressRoutes, { prefix: "/wordpress" });
  await app.register(contentRoutes, { prefix: "/content" });
  await app.register(planningRoutes, { prefix: "/sites" });
  await app.register(linkingRoutes, { prefix: "/sites" });
  await app.register(usageRoutes, { prefix: "/usage" });

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
