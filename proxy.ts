import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

/**
 * Auth middleware for API mutation routes.
 *
 * GET requests are always allowed (read-only).
 * /api/health is always allowed (monitoring).
 * Same-origin requests are allowed through.
 * Browser requests from any origin (LAN dev access) are allowed.
 * External programmatic requests must provide OPERATOR_TOKEN.
 */
export function proxy(request: NextRequest) {
  // Only protect API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow GET requests (read-only)
  if (request.method === "GET") {
    return NextResponse.next();
  }

  // Allow health endpoint
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  // Allow same-origin requests from the browser
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") {
    return NextResponse.next();
  }

  // Allow browser requests from any origin (dev mode — LAN access)
  // Browsers on LAN may not send sec-fetch-site: same-origin
  if (request.headers.get("origin") || request.headers.get("referer")) {
    return NextResponse.next();
  }

  return requireAuth(request) ?? NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
