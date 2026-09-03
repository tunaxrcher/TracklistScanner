import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/WASM recognition packages out of the bundler.
  serverExternalPackages: [
    "node-shazam",
    "shazamio-core",
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "archiver",
    "@prisma/adapter-mariadb",
    "mariadb",
  ],
};

export default nextConfig;
