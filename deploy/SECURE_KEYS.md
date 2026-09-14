# Secure API key updates (how it works)

Keys are **never** stored on Vercel. Only the admin UI talks to your API.

```
Login (ADMIN_PASSWORD)
  → API issues session token
  → Browser sends token on each request

Maintenance → Save OpenAI/Gemini/Tavily key
  → POST /maintenance/keys  (HTTPS + session required)
  → API writes server .env (mode 600) on server-remote
  → Reloads process.env for the running API
  → Response: { openai: { configured: true, last4: "xxxx" } }  — never full key
  → Audit line appended to logs/key-audit.log
```

When the client gives you Contabo later: copy `.env` + Postgres dump + PM2 app — same mechanism, new host.

Blame shield: Maintenance shows provider **Up / Down / Credits** from live probes + last generate errors so OpenAI/Gemini outages are visible as theirs, not yours.
