import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@life-os/db"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "26mb",
    },
    proxyClientMaxBodySize: "26mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
