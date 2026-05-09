import { NextResponse } from "next/server";
import { getHermesBoardStats } from "@/lib/hermes/hermes-board-stats";

// GET /api/hermes-stats — returns Hermes Kanban board stats for the dashboard
export async function GET() {
  try {
    const stats = await getHermesBoardStats();
    return Response.json(stats);
  } catch (err) {
    console.error("[HermesStats] Failed to fetch board stats:", err);
    return Response.json({ error: "Failed to fetch Hermes stats" }, { status: 500 });
  }
}
