import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  // GET /usage?siteId=&from=&to=
  app.get("/", async (req) => {
    const { siteId, from, to } = req.query as { siteId?: string; from?: string; to?: string };

    const where = {
      ...(siteId
        ? { content: { siteId } } // AiUsage -> content -> site
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const rows = await prisma.aiUsage.findMany({
      where,
      select: { provider: true, model: true, operation: true, estimatedUsd: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });

    const totalUsd = rows.reduce((sum, r) => sum + (r.estimatedUsd ?? 0), 0);

    const byProvider: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of rows) {
      const usd = r.estimatedUsd ?? 0;
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + usd;
      byOperation[r.operation] = (byOperation[r.operation] ?? 0) + usd;
      const day = r.createdAt.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + usd;
    }

    return { totalUsd, byProvider, byOperation, byDay, count: rows.length, rows: rows.slice(0, 200) };
  });
};
