import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    keys: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY),
      perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
      wordpress: Boolean(
        process.env.WORDPRESS_URL &&
          process.env.WORDPRESS_USERNAME &&
          process.env.WORDPRESS_APP_PASSWORD
      ),
    },
  }));
};
