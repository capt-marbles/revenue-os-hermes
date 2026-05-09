import { TwentyConfigError, queryTwentyPeople } from "@/lib/crm/twenty";

export async function GET() {
  try {
    const data = await queryTwentyPeople();
    return Response.json(data);
  } catch (err) {
    if (err instanceof TwentyConfigError) {
      return Response.json({ error: "TWENTY_API_KEY not set" }, { status: 503 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to fetch contacts" },
      { status: 500 },
    );
  }
}
