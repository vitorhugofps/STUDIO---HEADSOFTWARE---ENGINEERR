/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { bodySizeLimit: '50mb' },
    // Uploads de vídeo passam pelo /api/upload: sem este limite o middleware corta o corpo em 10 MB.
    middlewareClientMaxBodySize: '4gb',
  },
};

export default nextConfig;
