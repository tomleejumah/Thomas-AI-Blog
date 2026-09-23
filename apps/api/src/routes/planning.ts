import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { planTopics } from "../services/planner";

export const planningRoutes: FastifyPluginAsync = async (app) => {
  // POST /sites/:siteId/plan  { instruction: "Create 10 articles about X" }
  app.post("/:siteId/plan", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const body = z.object({ instruction: z.string().min(3) }).parse(req.body);

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return reply.code(404).send({ error: "Site not found" });

    try {
      const result = await planTopics(siteId, body.instruction);
      return { cluster: result.cluster, topics: result.topics };
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "Planning failed",
      });
    }
  });

  // GET /sites/:siteId/topics?status=PROPOSED
  app.get("/:siteId/topics", async (req) => {
    const { siteId } = req.params as { siteId: string };
    const { status } = req.query as { status?: "PROPOSED" | "APPROVED" | "REJECTED" };

    const topics = await prisma.topicIdea.findMany({
      where: { siteId, ...(status ? { status } : {}) },
      include: { cluster: { select: { name: true, instruction: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { topics };
  });

  // PATCH /topics/:id  { status?, title?, primaryKeyword? }
  app.patch("/topics/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        status: z.enum(["PROPOSED", "APPROVED", "REJECTED"]).optional(),
        title: z.string().optional(),
        primaryKeyword: z.string().optional(),
      })
      .parse(req.body);

    const topic = await prisma.topicIdea.findUnique({ where: { id } });
    if (!topic) return reply.code(404).send({ error: "Topic not found" });

    const updated = await prisma.topicIdea.update({ where: { id }, data: body });
    return { topic: updated };
  });
};
