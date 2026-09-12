import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generateForContent } from "../services/generate";
import { createWpDraftPost } from "../services/wordpress";

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const q = z.object({ siteId: z.string().optional() }).parse(req.query);

    const contents = await prisma.contentItem.findMany({
      where: q.siteId ? { siteId: q.siteId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        category: { select: { id: true, name: true, wpCategoryId: true } },
        site: { select: { id: true, name: true } },
      },
    });
    return { contents };
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const content = await prisma.contentItem.findUnique({
      where: { id },
      include: {
        category: true,
        site: { select: { id: true, name: true, baseUrl: true } },
      },
    });
    if (!content) return reply.code(404).send({ error: "Not found" });
    return { content };
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

  app.post("/:id/generate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ brief: z.string().optional() }).parse(req.body ?? {});

    try {
      const result = await generateForContent(id, body.brief);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generate failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const content = await prisma.contentItem.findUnique({ where: { id } });
    if (!content) return reply.code(404).send({ error: "Not found" });
    if (!content.bodyHtml) {
      return reply.code(400).send({ error: "Generate content before approve" });
    }

    const updated = await prisma.contentItem.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    return { content: updated };
  });

  app.post("/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const content = await prisma.contentItem.findUnique({
      where: { id },
      include: { site: true, category: true },
    });
    if (!content) return reply.code(404).send({ error: "Not found" });
    if (content.status !== "APPROVED" && content.status !== "HUMAN_REVIEW") {
      return reply
        .code(400)
        .send({ error: "Content must be reviewed/approved before publish" });
    }
    if (!content.bodyHtml) {
      return reply.code(400).send({ error: "No body to publish" });
    }

    // Idempotent: already published
    if (content.wpPostId) {
      return { content, alreadyPublished: true };
    }

    const categories =
      content.category?.wpCategoryId != null
        ? [content.category.wpCategoryId]
        : [];

    const html = [
      content.bodyHtml,
      content.schemaJson
        ? `<script type="application/ld+json">${JSON.stringify(content.schemaJson)}</script>`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const post = (await createWpDraftPost(
        content.site.baseUrl,
        content.site.wpUsername,
        content.site.wpAppPassword,
        {
          title: content.seoTitle || content.title,
          content: html,
          categories,
          status: "draft",
        }
      )) as { id: number; link?: string };

      const updated = await prisma.contentItem.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          wpPostId: post.id,
          wpUrl: post.link ?? null,
        },
      });

      return { content: updated, post };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publish failed";
      return reply.code(502).send({ error: message });
    }
  });
};
