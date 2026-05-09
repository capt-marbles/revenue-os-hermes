import { db } from "@/db";
import { deals } from "@/db/schema";
import { getTenantId } from "@/lib/tenant";
import { eq, sql, and, notInArray, inArray } from "drizzle-orm";

const CLOSED_STAGES = ["contract_signed", "lost"];

const FUNNEL_STAGES = [
  { name: "Reachout",       stages: ["reachout"] },
  { name: "Connected",      stages: ["connected"] },
  { name: "Technical Eval", stages: ["technical_evaluation"] },
  { name: "Quote Issued",   stages: ["quote_issued"] },
  { name: "Committed",      stages: ["committed"] },
  { name: "Contract Signed", stages: ["contract_signed"] },
];

export async function GET() {
  try {
    const tenantId = getTenantId();

    const [stageResults, totalActiveResult] = await Promise.all([
      Promise.all(
        FUNNEL_STAGES.map(async (s) => {
          const result = db
            .select({ count: sql<number>`count(*)` })
            .from(deals)
            .where(and(eq(deals.tenantId, tenantId), inArray(deals.stage, s.stages)))
            .all();
          return { name: s.name, count: Number(result[0]?.count ?? 0), statuses: s.stages };
        }),
      ),
      Promise.resolve(
        db
          .select({ count: sql<number>`count(*)` })
          .from(deals)
          .where(and(eq(deals.tenantId, tenantId), notInArray(deals.stage, CLOSED_STAGES)))
          .all(),
      ),
    ]);

    const totalActive = Number(totalActiveResult[0]?.count ?? 0);
    const closingCount = stageResults[stageResults.length - 1]?.count ?? 0;
    const conversionRate = totalActive > 0
      ? Math.round((closingCount / totalActive) * 10000) / 100
      : 0;

    return Response.json({
      stages: stageResults,
      totalActive,
      conversionRate,
      avgScore: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
