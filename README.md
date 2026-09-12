# AI Content Engine

Central dashboard + API that plans, generates, reviews, and publishes multilingual SEO content into WordPress via REST (Application Passwords) + Rank Math.

## Stack

- `apps/admin` — Next.js dashboard (ours; no client WP login required)
- `apps/api` — Fastify API, Prisma, workers hooks
- PostgreSQL + Redis (Docker Compose)
- LLM keys in `.env` only (never frontend)

## Local setup

```bash
cp .env.example .env
docker compose up -d   # postgres + redis
npm install
npm run db:push
npm run dev:api        # :4000
npm run dev:admin      # :3000
```

API keys and WordPress Application Passwords are plugged into `.env` when the client provides them.

## Phase 1 order

1. WP connect + scan + draft publish PoC  
2. Content records + review statuses  
3. Generate pipeline (1 language)  
4. EN/PT/FR + Rank Math meta  
5. Queues, cost tracking, Contabo deploy  
