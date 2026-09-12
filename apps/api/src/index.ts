import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { healthRoutes } from "./routes/health";
import { siteRoutes } from "./routes/sites";
import { wordpressRoutes } from "./routes/wordpress";
import { contentRoutes } from "./routes/content";

const port = Number(process.env.API_PORT ?? 4000);
const origin = process.env.ADMIN_ORIGIN ?? "http://localhost:3000";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin });

  await app.register(healthRoutes);
  await app.register(siteRoutes, { prefix: "/sites" });
  await app.register(wordpressRoutes, { prefix: "/wordpress" });
  await app.register(contentRoutes, { prefix: "/content" });

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
