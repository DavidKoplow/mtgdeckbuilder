import type { NextConfig } from "next";

const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/mtgdeckbuilder" : "");
const workosClientId =
  process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID ?? process.env.WORKOS_CLIENT_ID;

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_WORKOS_CLIENT_ID: workosClientId,
  },
};

export default nextConfig;
