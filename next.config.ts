import type { NextConfig } from "next";

const repo = "mtgdeckbuilder";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NODE_ENV === "production" ? `/${repo}` : "",
  trailingSlash: true,
};

export default nextConfig;
