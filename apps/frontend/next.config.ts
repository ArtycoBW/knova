import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.conditionNames = ["import", "module", "require", "default"];
    return config;
  },
};

export default nextConfig;
