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
5. Queues, cost tracking, server-remote API + Vercel admin  

## Deploy

- **API** — server-remote (`server` @ `100.84.133.5:9557`), path `/home/server/Apis/thomas-ai-blog`, PM2 `ace-api` on `:4010`. See `ecosystem.config.cjs`, `docker-compose.prod.yml`.
- **Admin** — Vercel. Root Directory `apps/admin`. Steps: `deploy/VERCEL.md`.
- **Public API path** — nginx snippet `deploy/nginx-ai-content.snippet.conf` → `https://api.tommlyjumah.dev/ai-content/` (needs sudo on the host). Until then: Tailscale `http://100.84.133.5:4010`.

### Monitor API (on server-remote)

```bash
ssh -p 9557 server@100.84.133.5
pm2 status
pm2 logs ace-api
pm2 logs ace-api --lines 200
curl -sS http://127.0.0.1:4010/health
```

### Self-hosted Actions

API Deploy uses `runs-on: self-hosted` (`~/actions-runner-ace`).

- Keep **Cloudflare WARP Connected** on the server (`warp=on`) — required for the Actions broker; without it jobs queue forever.
- Tailscale SSH stays (`100.64.0.0/10` excluded). Don’t run this runner under pm2 + systemd together.
- Don’t re-run an old Deploy after a newer success. Shared checklist: `~/ACTIONS-OPS.md` on the server.
