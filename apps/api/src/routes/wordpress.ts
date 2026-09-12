import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  createWpDraftPost,
  listWpCategories,
  testWpConnection,
} from "../services/wordpress";

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

    const categories = await listWpCategories(
      site.baseUrl,
      site.wpUsername,
      site.wpAppPassword
    );

    for (const cat of categories) {
      await prisma.category.upsert({
        where: { siteId_slug: { siteId: site.id, slug: cat.slug } },
        create: {
          siteId: site.id,
          wpCategoryId: cat.id,
          name: cat.name,
          slug: cat.slug,
        },
        update: {
          wpCategoryId: cat.id,
          name: cat.name,
        },
      });
    }

    // Wire parent relations after all categories exist
    const local = await prisma.category.findMany({ where: { siteId: site.id } });
    const byWpId = new Map(local.map((c) => [c.wpCategoryId, c]));

    for (const cat of categories) {
      if (!cat.parent) continue;
      const child = byWpId.get(cat.id);
      const parent = byWpId.get(cat.parent);
      if (child && parent) {
        await prisma.category.update({
          where: { id: child.id },
          data: { parentId: parent.id },
        });
      }
    }

    const saved = await prisma.category.findMany({
      where: { siteId: site.id },
      orderBy: { name: "asc" },
    });

    return { scanned: saved.length, categories: saved };
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

    const post = await createWpDraftPost(
      site.baseUrl,
      site.wpUsername,
      site.wpAppPassword,
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
