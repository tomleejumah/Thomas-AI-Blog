# Deploy admin (apps/admin) on Vercel

## Project settings

1. Import `tomleejumah/Thomas-AI-Blog` from GitHub.
2. **Root Directory:** `apps/admin` (Critical Files → Edit).
3. Framework: Next.js (auto).
4. Install / Build (from `apps/admin/vercel.json`, or set manually):
   - **Install:** `cd ../.. && npm install`
   - **Build:** `cd ../.. && npm run build -w @ace/admin`
5. Output: default Next.js (`.next`).

## Environment variables (Production)

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_API_URL` | `https://api.tommlyjumah.dev/ai-content` once nginx is live; until then use Tailscale `http://100.84.133.5:4010` |

After changing env, Redeploy.

## CORS on API

API allows `ADMIN_ORIGIN` (comma-separated) plus any `https://*.vercel.app`. Set on server-remote `.env` e.g.:

```
ADMIN_ORIGIN=https://your-app.vercel.app,http://localhost:3000
```
