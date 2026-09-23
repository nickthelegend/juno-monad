import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a lockfile in a parent directory — the Expo app
  // has its own — is never picked up as this project's.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // Native packages the upload route uses to probe media and cut video poster
  // frames. They load platform binaries through dynamic requires a bundler
  // cannot follow, so they stay in node_modules and are traced in explicitly.
  serverExternalPackages: [
    "sharp",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "fluent-ffmpeg",
    "pg",
    "mongodb",
  ],
  outputFileTracingIncludes: {
    "/api/juno/upload": [
      "./node_modules/@img/**",
      "./node_modules/sharp/**",
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/@ffprobe-installer/**",
    ],
  },
};

export default nextConfig;
