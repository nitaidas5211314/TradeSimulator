import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici 仅在服务端用于走 HTTPS_PROXY 代理访问 Binance，无需打包
  serverExternalPackages: ["undici"],
};

export default nextConfig;
