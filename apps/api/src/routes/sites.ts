import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/secrets";

const createSiteSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  wpUsername: z.string().min(1),
  wpAppPassword: z.string().min(1),
  rankMathActive: z.boolean().optional(),
});

export const siteRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    const sites = await prisma.site.findMany({
      select: {
        id: true,
        name: true,
        baseUrl: true,
        rankMathActive: true,
        createdAt: true,
        _count: { select: { categories: true, contents: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return { sites };
  });

  app.post("/", async (req, reply) => {
    const body = createSiteSchema.parse(req.body);
    const site = await prisma.site.create({
      data: {
        name: body.name,
        baseUrl: body.baseUrl.replace(/\/$/, ""),
        wpUsername: body.wpUsername,
        wpAppPassword: encryptSecret(body.wpAppPassword),
        rankMathActive: body.rankMathActive ?? true,
      },
    });
    return reply.code(201).send({
      site: {
        id: site.id,
        name: site.name,
        baseUrl: site.baseUrl,
        rankMathActive: site.rankMathActive,
      },
    });
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Site not found" });
    await prisma.site.delete({ where: { id } });
    return { ok: true };
  });
};
