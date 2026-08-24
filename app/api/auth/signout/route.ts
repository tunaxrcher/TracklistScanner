import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", request.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
