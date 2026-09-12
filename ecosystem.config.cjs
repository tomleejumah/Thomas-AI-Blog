/** PM2 — API only on server-remote. Admin runs on Vercel. */
module.exports = {
  apps: [
    {
      name: "ace-api",
      cwd: "/home/server/Apis/thomas-ai-blog/apps/api",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        API_PORT: "4010",
      },
    },
  ],
};
