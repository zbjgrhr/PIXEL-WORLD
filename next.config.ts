import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.PIXEL_WORLD_PREVIEW_DIST ? { distDir: process.env.PIXEL_WORLD_PREVIEW_DIST } : {}),
  /* config options here */
  async rewrites() {
    return [
      {
        source: '/api/dashscope/:path*',
        destination: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/:path*',
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
};

export default nextConfig;
