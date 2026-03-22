import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime", "nextstepjs", "motion"],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.conditionNames = [
      "browser",
      "import",
      "module",
      "require",
      "default",
    ];
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "node:fs": false,
      "node:https": false,
      fs: false,
      https: false,
      path: false,
      os: false,
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      https: false,
      path: false,
      os: false,
    };
    return config;
  },
};

export default nextConfig;
