import { NextRequest } from "next/server";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VALID_DESKS = ["outreach", "scout", "steward", "marketing", "sales-engineering", "leo"];

function directivePath(desk: string) {
  return join(homedir(), ".agents", desk, "directives.md");
}

export async function GET() {
  const result: Record<string, string> = {};
  for (const desk of VALID_DESKS) {
    const p = directivePath(desk);
    try {
      result[desk] = existsSync(p) ? readFileSync(p, "utf-8") : "";
    } catch {
      result[desk] = "";
    }
  }
  return Response.json(result);
}

export async function POST(request: NextRequest) {
  let body: { desk: string; directive: string; issuedBy?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { desk, directive, issuedBy = "Chief of Staff" } = body;

  if (!desk || !VALID_DESKS.includes(desk)) {
    return Response.json({ error: `Invalid desk. Valid: ${VALID_DESKS.join(", ")}` }, { status: 400 });
  }

  if (!directive?.trim()) {
    return Response.json({ error: "directive is required" }, { status: 400 });
  }

  const now = new Date().toISOString().split("T")[0];
  const content = `# ${desk.charAt(0).toUpperCase() + desk.slice(1)} Directives\n\n${directive.trim()}\n\nLast updated: ${now}\nIssued by: ${issuedBy}\n`;

  try {
    writeFileSync(directivePath(desk), content, "utf-8");
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }

  return Response.json({ ok: true, desk, updatedAt: now });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const desk = searchParams.get("desk");

  if (!desk || !VALID_DESKS.includes(desk)) {
    return Response.json({ error: "Invalid desk" }, { status: 400 });
  }

  const content = `# ${desk.charAt(0).toUpperCase() + desk.slice(1)} Directives\n\n_No active directives. Default behaviour applies._\n\nLast updated: ${new Date().toISOString().split("T")[0]}\nIssued by: —\n`;
  writeFileSync(directivePath(desk), content, "utf-8");

  return Response.json({ ok: true, desk, cleared: true });
}
