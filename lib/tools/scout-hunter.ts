import type { RegisteredTool } from "./types";

const HUNTER_API = "https://api.hunter.io/v2";

export const scoutHunter: RegisteredTool = {
  definition: {
    name: "hunter_find_email",
    description: `Find email addresses and contacts at a company domain using Hunter.io.
Use after identifying a validated studio target to find the right technical or leadership contact.

Two modes:
- domain: list all found emails for a domain (best for studio discovery)
- verify: verify if a specific email is valid before outreach`,
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["domain", "verify"],
          description: "domain = find emails at a company, verify = check if an email is valid",
        },
        domain: { type: "string", description: "Company domain (e.g. studiox.com) — for domain mode" },
        email: { type: "string", description: "Email address to verify — for verify mode" },
        limit: { type: "number", description: "Max contacts to return for domain search (default 10)" },
      },
      required: ["mode"],
    },
  },
  scopes: ["scout"],
  async execute(input) {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return "HUNTER_API_KEY not set. Add it to .env.local.";

    const mode = String(input.mode);

    if (mode === "domain") {
      const domain = String(input.domain ?? "").trim();
      if (!domain) return "hunter_find_email: domain required for domain mode";
      const limit = Math.min(Number(input.limit ?? 10), 25);

      const url = `${HUNTER_API}/domain-search?domain=${encodeURIComponent(domain)}&limit=${limit}&api_key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.text().catch(() => `HTTP ${res.status}`);
        return `Hunter domain search failed: ${err}`;
      }

      const data = await res.json();
      const d = data.data ?? {};
      const emails: Array<Record<string, unknown>> = d.emails ?? [];
      const org = d.organization ?? domain;

      if (emails.length === 0) return `No email addresses found at ${domain} via Hunter.io.`;

      const lines = emails.map((e, i) => {
        const value = String(e.value ?? "");
        const firstName = String(e.first_name ?? "");
        const lastName = String(e.last_name ?? "");
        const position = String(e.position ?? "");
        const confidence = Number(e.confidence ?? 0);
        const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
        return `${i + 1}. **${value}** · ${name}${position ? ` · ${position}` : ""} · ${confidence}% confidence`;
      });

      return [
        `## Hunter.io: ${org} (${domain})`,
        `Found ${emails.length} email${emails.length !== 1 ? "s" : ""}`,
        "",
        ...lines,
      ].join("\n");
    }

    if (mode === "verify") {
      const email = String(input.email ?? "").trim();
      if (!email) return "hunter_find_email: email required for verify mode";

      const url = `${HUNTER_API}/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.text().catch(() => `HTTP ${res.status}`);
        return `Hunter verify failed: ${err}`;
      }

      const data = await res.json();
      const d = data.data ?? {};
      const status = String(d.status ?? "unknown");
      const score = Number(d.score ?? 0);
      const result = String(d.result ?? "unknown");

      return [
        `## Hunter.io Verification: ${email}`,
        `**Status:** ${status}`,
        `**Result:** ${result}`,
        `**Confidence:** ${score}%`,
        status === "valid" ? "✅ Safe to send" : status === "risky" ? "⚠️ Risky — may bounce" : "❌ Invalid or undeliverable",
      ].join("\n");
    }

    return `Unknown mode: ${mode}`;
  },
};
