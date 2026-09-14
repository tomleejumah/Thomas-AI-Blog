# Architecture (final)

```
Browser → https://thomas-ai-blog-admin.vercel.app   (UI on Vercel)
       → https://api.tommlyjumah.dev/ai-content/*   (API via Cloudflare tunnel)
            → cloudflared → nginx :80 → ace-api :4010 on server-remote
```

- **UI:** Vercel only. Not Cloudflare-hosted.
- **API:** Cloudflare tunnel already points `api.tommlyjumah.dev` → nginx on server-remote. We add `/ai-content/` → `:4010`.
- **Tailscale was temporary** so we could test `:4010` before nginx. Vercel cannot reach Tailscale IPs — that is why Overview shows API Offline.

## One-time on server-remote (needs your sudo password)

```bash
ssh server-remote
bash /home/server/Apis/thomas-ai-blog/deploy/apply-nginx-ai-content.sh
curl -sS https://api.tommlyjumah.dev/ai-content/health
```

## Vercel env (then Redeploy)

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_API_URL` | `https://api.tommlyjumah.dev/ai-content` |

Root Directory: `apps/admin`  
Install: `cd ../.. && npm install`  
Build: `cd ../.. && npm run build -w @ace/admin`

## Monitor API

```bash
ssh server-remote
pm2 logs ace-api
pm2 status
curl -sS http://127.0.0.1:4010/health
```
