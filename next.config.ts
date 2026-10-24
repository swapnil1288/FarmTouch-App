import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /(?:^|\/)runtime-env(?:\.ts)?$/,
      path.resolve('lib/runtime-env.node.ts'),
    ));
    return config;
  },
};

export default nextConfig;
