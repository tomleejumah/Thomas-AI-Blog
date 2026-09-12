import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const q = z
      .object({ siteId: z.string().optional() })
      .parse(req.query);

    const contents = await prisma.contentItem.findMany({
      where: q.siteId ? { siteId: q.siteId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return { contents };
  });

  app.post("/", async (req, reply) => {
    const body = z
      .object({
        siteId: z.string().min(1),
        categoryId: z.string().optional(),
        title: z.string().min(1),
        language: z.enum(["en", "pt", "fr"]).optional(),
      })
      .parse(req.body);

    const content = await prisma.contentItem.create({
      data: {
        siteId: body.siteId,
        categoryId: body.categoryId,
        title: body.title,
        language: body.language ?? "en",
        status: "IDEA",
      },
    });
    return reply.code(201).send({ content });
  });
};
