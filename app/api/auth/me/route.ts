import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authSecret, verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Current signed-in user, for the header UI. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token, authSecret()) : null;
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: { email: session.email, name: session.name, picture: session.picture },
  });
}
