import type { FastifyPluginAsync } from "fastify";
import { rankLinkTargets } from "../services/linking";

export const linkingRoutes: FastifyPluginAsync = async (app) => {
  // GET /sites/:siteId/link-suggestions?title=...&keyword=...
  app.get("/:siteId/link-suggestions", async (req) => {
    const { siteId } = req.params as { siteId: string };
    const { title, keyword } = req.query as { title?: string; keyword?: string };
    const candidates = await rankLinkTargets(siteId, title ?? "", keyword ? [keyword] : []);
    return { candidates };
  });
};
