import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/auth/origin";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  const res = NextResponse.redirect(appUrl(request, "/login"), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
