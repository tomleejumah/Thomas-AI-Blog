/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/usage", destination: "/maintenance", permanent: false }];
  },
};

module.exports = nextConfig;
