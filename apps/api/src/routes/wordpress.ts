import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { siteWpAuth } from "../lib/siteAuth";
import { createWpDraftPost, testWpConnection } from "../services/wordpress";
import { scanSite } from "../services/scanner";

export const wordpressRoutes: FastifyPluginAsync = async (app) => {
  app.post("/test", async (req) => {
    const body = z
      .object({
        baseUrl: z.string().url(),
        wpUsername: z.string().min(1),
        wpAppPassword: z.string().min(1),
      })
      .parse(req.body);

    const me = await testWpConnection(
      body.baseUrl,
      body.wpUsername,
      body.wpAppPassword
    );
    return { ok: true, user: me };
  });

  app.post("/:siteId/scan", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return reply.code(404).send({ error: "Site not found" });

    const result = await scanSite(site);

    const saved = await prisma.category.findMany({
      where: { siteId: site.id },
      orderBy: { name: "asc" },
    });

    return {
      scanned: result.categoriesIndexed,
      pagesIndexed: result.pagesIndexed,
      orphanCount: result.orphanCount,
      postTypesScanned: result.postTypesScanned,
      categories: saved,
    };
  });

  app.post("/:siteId/publish-draft", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const body = z
      .object({
        title: z.string().min(1),
        content: z.string().min(1),
        categoryWpIds: z.array(z.number()).optional(),
      })
      .parse(req.body);

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return reply.code(404).send({ error: "Site not found" });

    const auth = await siteWpAuth(site);
    const post = await createWpDraftPost(
      auth.baseUrl,
      auth.username,
      auth.appPassword,
      {
        title: body.title,
        content: body.content,
        categories: body.categoryWpIds,
        status: "draft",
      }
    );

    return { ok: true, post };
  });
};
