import { NextRequest } from "next/server";

export function requireAuth(request: NextRequest): Response | null {
  const token = process.env.OPERATOR_TOKEN?.trim();
  if (!token) {
    return null;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer === token) {
      return null;
    }
    return Response.json({ error: "Invalid token" }, { status: 403 });
  }

  const queryToken = request.nextUrl.searchParams.get("token");
  if (queryToken === token) {
    return null;
  }

  return Response.json({ error: "Authentication required" }, { status: 401 });
}
