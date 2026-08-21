import { NextResponse } from "next/server";
import { resolveYtDlp, resolveFfmpeg, resolveFfprobe } from "@/lib/server/bin";
import { isAcrConfigured } from "@/lib/server/recognition/acrcloud";
import { isDjPoolConfigured } from "@/lib/server/djpool/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability check used by the UI to warn about missing dependencies. */
export async function GET() {
  const check = (fn: () => string) => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };
  return NextResponse.json({
    ytDlp: check(resolveYtDlp),
    ffmpeg: check(resolveFfmpeg),
    ffprobe: check(resolveFfprobe),
    acrCloud: isAcrConfigured(),
    djPool: isDjPoolConfigured(),
  });
}
