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
  // Server code touches the filesystem with runtime paths (job temp dirs,
  // downloads), which makes Next trace "the whole project" for those routes.
  // On a server those folders hold gigabytes of audio — walking them during
  // `next build` blew past 7 GB and got OOM-killed. They are never needed in
  // the build output, so keep the tracer out of them entirely.
  outputFileTracingExcludes: {
    "*": ["./downloads/**", "./temp/**", "./data/**", "./public/lobby.mp3"],
  },
};

export default nextConfig;
