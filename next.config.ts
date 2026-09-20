import type { NextConfig } from "next";

const noCacheHeaders = [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Surrogate-Control", value: "no-store" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      { source: "/", headers: noCacheHeaders },
      { source: "/admin", headers: noCacheHeaders },
      { source: "/api/:path*", headers: noCacheHeaders },
    ];
  },
};

export default nextConfig;
