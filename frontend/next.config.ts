import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // TypeScript 5.x exposes the compiler API; use it instead of Next's CLI
    // wrapper, whose --showConfig parser is incompatible with this workspace.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
