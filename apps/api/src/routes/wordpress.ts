import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { siteWpAuth } from "../lib/siteAuth";
import {
  createWpDraftPost,
  listWpCategories,
  listWpPosts,
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

    const auth = await siteWpAuth(site);
    const categories = await listWpCategories(
      auth.baseUrl,
      auth.username,
      auth.appPassword
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

    // Index published posts/pages for internal-link context
    let pagesIndexed = 0;
    for (const type of ["posts", "pages"] as const) {
      try {
        const items = await listWpPosts(auth.baseUrl, auth.username, auth.appPassword, {
          type,
          perPage: 40,
        });
        for (const item of items) {
          const url = item.link;
          if (!url) continue;
          const title = item.title?.rendered?.replace(/<[^>]+>/g, "").trim() || "Untitled";
          const summary = item.excerpt?.rendered
            ?.replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 400);
          await prisma.sitePage.upsert({
            where: { siteId_url: { siteId: site.id, url } },
            create: {
              siteId: site.id,
              wpPostId: item.id,
              title,
              url,
              summary: summary || null,
              pageType: type === "pages" ? "page" : "post",
            },
            update: {
              wpPostId: item.id,
              title,
              summary: summary || null,
              pageType: type === "pages" ? "page" : "post",
            },
          });
          pagesIndexed += 1;
        }
      } catch {
        // non-fatal — categories still saved
      }
    }

    const saved = await prisma.category.findMany({
      where: { siteId: site.id },
      orderBy: { name: "asc" },
    });

    return { scanned: saved.length, pagesIndexed, categories: saved };
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
