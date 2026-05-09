import type { RegisteredTool } from "./types";

const APOLLO_API = "https://api.apollo.io/v1";

export const scoutApollo: RegisteredTool = {
  definition: {
    name: "apollo_search",
    description: `Search Apollo.io for people and companies in the game industry.
Use to find technical decision-makers (CTOs, Server Engineers, DevOps leads) at target studios.

Two modes:
- people: find contacts at a specific company or with specific titles
- company: look up company details (size, funding, technology stack)

Best for finding: CTOs, Technical Directors, Server Engineers, DevOps leads at game studios.`,
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["people", "company"],
          description: "people = find contacts, company = look up org details",
        },
        company_name: { type: "string", description: "Company/studio name" },
        domain: { type: "string", description: "Company domain (e.g. studiox.com) — improves accuracy" },
        titles: {
          type: "array",
          items: { type: "string" },
          description: "Job titles to filter by (e.g. ['CTO', 'Server Engineer', 'Technical Director'])",
        },
        per_page: { type: "number", description: "Results per page (default 10, max 25)" },
      },
      required: ["mode"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return "APOLLO_API_KEY not set. Add it to .env.local.";

    const mode = String(input.mode);
    const perPage = Math.min(Number(input.per_page ?? 10), 25);

    if (mode === "people") {
      const body: Record<string, unknown> = {
        api_key: apiKey,
        per_page: perPage,
        page: 1,
      };

      if (input.company_name) body.q_organization_name = String(input.company_name);
      if (input.domain) body.q_organization_domains = [String(input.domain)];
      if (Array.isArray(input.titles) && input.titles.length > 0) {
        body.person_titles = input.titles.map(String);
      }

      const res = await fetch(`${APOLLO_API}/mixed_people/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => `HTTP ${res.status}`);
        return `Apollo people search failed: ${err}`;
      }

      const data = await res.json();
      const people = data.people ?? [];
      if (people.length === 0) return "No Apollo contacts found matching your criteria.";

      const lines = people.map((p: Record<string, unknown>, i: number) => {
        const name = String(p.name ?? "Unknown");
        const title = String(p.title ?? "");
        const org = (p.organization as Record<string, unknown>)?.name ?? "";
        const email = String(p.email ?? "");
        const linkedin = String(p.linkedin_url ?? "");
        return [
          `${i + 1}. **${name}**${title ? ` · ${title}` : ""}${org ? ` @ ${org}` : ""}`,
          email ? `   📧 ${email}` : "",
          linkedin ? `   🔗 ${linkedin}` : "",
        ].filter(Boolean).join("\n");
      });

      return `## Apollo People (${people.length} results)\n\n${lines.join("\n\n")}`;
    }

    if (mode === "company") {
      const body: Record<string, unknown> = { api_key: apiKey, per_page: perPage, page: 1 };
      if (input.company_name) body.q_organization_name = String(input.company_name);
      if (input.domain) body.q_organization_domains = [String(input.domain)];

      const res = await fetch(`${APOLLO_API}/mixed_companies/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => `HTTP ${res.status}`);
        return `Apollo company search failed: ${err}`;
      }

      const data = await res.json();
      const orgs = data.organizations ?? [];
      if (orgs.length === 0) return "No Apollo company data found.";

      const lines = orgs.slice(0, 5).map((o: Record<string, unknown>, i: number) => {
        const name = String(o.name ?? "Unknown");
        const domain = String(o.primary_domain ?? "");
        const size = String(o.estimated_num_employees ?? "Unknown");
        const industry = String(o.industry ?? "");
        const funding = o.total_funding_printed ? String(o.total_funding_printed) : null;
        const technologies = Array.isArray(o.current_technologies)
          ? (o.current_technologies as Array<Record<string, unknown>>).slice(0, 5).map((t) => t.name).join(", ")
          : "";

        return [
          `${i + 1}. **${name}** (${domain})`,
          `   Employees: ${size} · Industry: ${industry}`,
          funding ? `   Funding: ${funding}` : "",
          technologies ? `   Tech: ${technologies}` : "",
        ].filter(Boolean).join("\n");
      });

      return `## Apollo Companies (${orgs.length} results)\n\n${lines.join("\n\n")}`;
    }

    return `Unknown mode: ${mode}`;
  },
};
