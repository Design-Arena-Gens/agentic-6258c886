/********** Next.js Config **********/
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true
  },
  api: {
    bodyParser: false
  }
};

module.exports = nextConfig;
