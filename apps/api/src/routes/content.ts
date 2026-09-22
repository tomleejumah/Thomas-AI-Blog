import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  generateFeaturedImageBytes,
  generateForContent,
} from "../services/generate";
import { siteWpAuth } from "../lib/siteAuth";
import { createJob, updateJob, finishJob, failJob, getJob } from "../lib/jobs";
import {
  createWpCategory,
  createWpDraftPost,
  deleteWpPost,
  uploadWpMedia,
} from "../services/wordpress";

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
        customCategory: z.string().min(1).optional(),
        title: z.string().min(1),
        language: z.enum(["en", "pt", "fr"]).optional(),
      })
      .parse(req.body);

    const site = await prisma.site.findUnique({ where: { id: body.siteId } });
    if (!site) return reply.code(404).send({ error: "Site not found" });

    let categoryId = body.categoryId || undefined;

    if (body.customCategory?.trim()) {
      const name = body.customCategory.trim();
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || `cat-${Date.now()}`;

      const existing = await prisma.category.findUnique({
        where: { siteId_slug: { siteId: site.id, slug } },
      });
      if (existing) {
        categoryId = existing.id;
      } else {
        try {
          const auth = await siteWpAuth(site);
          const wpCat = await createWpCategory(
            auth.baseUrl,
            auth.username,
            auth.appPassword,
            name
          );
          const created = await prisma.category.create({
            data: {
              siteId: site.id,
              name: wpCat.name || name,
              slug: wpCat.slug || slug,
              wpCategoryId: wpCat.id,
            },
          });
          categoryId = created.id;
        } catch (err) {
          // still save locally if WP create fails
          const created = await prisma.category.create({
            data: {
              siteId: site.id,
              name,
              slug,
            },
          });
          categoryId = created.id;
          void err;
        }
      }
    }

    const content = await prisma.contentItem.create({
      data: {
        siteId: body.siteId,
        categoryId,
        title: body.title,
        language: body.language ?? "en",
        status: "IDEA",
      },
    });
    return reply.code(201).send({ content });
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).optional(),
        bodyHtml: z.string().optional(),
        seoTitle: z.string().optional(),
        metaDescription: z.string().optional(),
        focusKeyword: z.string().optional(),
        language: z.enum(["en", "pt", "fr"]).optional(),
      })
      .parse(req.body ?? {});

    const existing = await prisma.contentItem.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const content = await prisma.contentItem.update({
      where: { id },
      data: {
        ...body,
        status:
          existing.status === "PUBLISHED"
            ? "UPDATED"
            : body.bodyHtml
              ? "HUMAN_REVIEW"
              : existing.status,
      },
    });
    return { content };
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z
      .object({
        deleteWp: z
          .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
          .optional()
          .transform((v) => v === true || v === "true" || v === "1"),
      })
      .parse(req.query ?? {});
    const body = z
      .object({ deleteWp: z.boolean().optional() })
      .safeParse(req.body ?? {});
    const deleteWp = q.deleteWp || Boolean(body.success && body.data.deleteWp);

    const existing = await prisma.contentItem.findUnique({
      where: { id },
      include: { site: true },
    });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    let wpDeleted = false;
    if (deleteWp && existing.wpPostId) {
      try {
        const auth = await siteWpAuth(existing.site);
        await deleteWpPost(auth.baseUrl, auth.username, auth.appPassword, existing.wpPostId);
        wpDeleted = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "WordPress delete failed";
        return reply.code(400).send({ error: message });
      }
    }

    const hadWp = Boolean(existing.wpPostId || existing.wpUrl);
    const wpUrl = existing.wpUrl;
    await prisma.contentItem.delete({ where: { id } });
    return {
      ok: true,
      wpDeleted,
      hadWp,
      wpUrl: hadWp && !wpDeleted ? wpUrl : null,
    };
  });

  // Kicks off generation as a background job and returns immediately.
  // The frontend polls GET /:id/generate/status for real progress instead
  // of guessing with a fake timer.
  app.post("/:id/generate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        brief: z.string().optional(),
        provider: z.enum(["openai", "gemini", "auto"]).optional(),
        withImage: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const existingJob = getJob(id);
    if (existingJob?.status === "running") {
      return reply.code(409).send({ error: "Generation already in progress for this item" });
    }

    createJob(id);

    generateForContent(id, {
      brief: body.brief,
      provider: body.provider ?? "auto",
      withImage: body.withImage,
      onStage: (stage) => updateJob(id, { pct: stage.pct, label: stage.label }),
    })
      .then((result) => finishJob(id, result))
      .catch((err) => failJob(id, err instanceof Error ? err.message : String(err)));

    return reply.code(202).send({ jobId: id, status: "running" });
  });

  app.get("/:id/generate/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) return reply.code(404).send({ error: "No generation job for this item" });
    return job;
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

  // Publish also runs as a background job — featured-image generation
  // (with its own retries/model fallback) can take well over a minute in
  // the worst case, which used to run synchronously inside this request
  // and get killed by the proxy/browser as a NetworkError.
  app.post("/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        withImage: z.boolean().optional(),
        imagePrompt: z.string().optional(),
        status: z.enum(["draft", "publish"]).optional(),
      })
      .parse(req.body ?? {});

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

    if (content.wpPostId) {
      return { content, alreadyPublished: true };
    }

    const jobId = `pub:${id}`;
    const existingJob = getJob(jobId);
    if (existingJob?.status === "running") {
      return reply.code(409).send({ error: "Publish already in progress for this item" });
    }

    createJob(jobId);

    runPublish(content, body, (label, pct) => updateJob(jobId, { label, pct }))
      .then((result) => finishJob(jobId, result))
      .catch((err) => failJob(jobId, err instanceof Error ? err.message : "Publish failed"));

    return reply.code(202).send({ jobId, status: "running" });
  });

  app.get("/:id/publish/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(`pub:${id}`);
    if (!job) return reply.code(404).send({ error: "No publish job for this item" });
    return job;
  });

  async function runPublish(
    content: NonNullable<Awaited<ReturnType<typeof prisma.contentItem.findUnique>>> & {
      site: NonNullable<Awaited<ReturnType<typeof prisma.site.findUnique>>>;
      category: { wpCategoryId: number | null } | null;
    },
    body: { withImage?: boolean; imagePrompt?: string; status?: "draft" | "publish" },
    onStage: (label: string, pct: number) => void
  ) {
    const categories =
      content.category?.wpCategoryId != null ? [content.category.wpCategoryId] : [];

    const html = [
      content.bodyHtml,
      content.schemaJson
        ? `<script type="application/ld+json">${JSON.stringify(content.schemaJson)}</script>`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    onStage("Authenticating with WordPress…", 10);
    let featuredMediaId: number | undefined;
    let media: { id: number; source_url?: string } | undefined;
    let imageError: string | undefined;
    const auth = await siteWpAuth(content.site);

    if (body.withImage !== false) {
      const prompt =
        body.imagePrompt ??
        `Natural lifestyle photo for WordPress featured image about: ${content.title}. Real scene, natural light, documentary look.`;
      try {
        onStage("Generating featured image…", 25);
        const img = await generateFeaturedImageBytes(prompt);
        if (img) {
          onStage("Uploading image to WordPress…", 60);
          media = await uploadWpMedia(auth.baseUrl, auth.username, auth.appPassword, {
            bytes: img.bytes,
            filename: `${content.slug || "featured"}-${Date.now()}.png`,
            mime: img.mime,
            alt: content.focusKeyword || content.title,
            title: content.title,
          });
          featuredMediaId = media.id;
          await prisma.aiUsage.create({
            data: {
              contentId: content.id,
              provider: img.provider,
              model: img.model,
              operation: "generate_image",
              estimatedUsd: img.provider === "openai" ? 0.04 : 0.02,
            },
          });
        }
      } catch (err) {
        imageError = err instanceof Error ? err.message : String(err);
      }
    }

    onStage("Creating WordPress draft…", 85);
    const post = (await createWpDraftPost(auth.baseUrl, auth.username, auth.appPassword, {
      title: content.seoTitle || content.title,
      content: html,
      categories,
      status: body.status ?? "draft",
      featuredMediaId,
      excerpt: content.metaDescription ?? undefined,
      seo: {
        focusKeyword: content.focusKeyword ?? undefined,
        seoTitle: content.seoTitle ?? undefined,
        metaDescription: content.metaDescription ?? undefined,
      },
    })) as { id: number; link?: string };

    onStage("Saving…", 95);
    const updated = await prisma.contentItem.update({
      where: { id: content.id },
      data: {
        status: "PUBLISHED",
        wpPostId: post.id,
        wpUrl: post.link ?? null,
      },
    });

    return { content: updated, post, media, imageError };
  }
};
