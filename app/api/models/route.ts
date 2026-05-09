import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ANTBASE_ROUTING_MODELS = [
  { id: "ant:auto", name: "Antbase Auto (smart route)", provider: "antbase" },
  { id: "ant:fast", name: "Antbase Fast (lowest latency)", provider: "antbase" },
  { id: "ant:balanced", name: "Antbase Balanced", provider: "antbase" },
  { id: "ant:best", name: "Antbase Best (highest quality)", provider: "antbase" },
  { id: "ant:reasoning", name: "Antbase Reasoning (deep thinking)", provider: "antbase" },
];

interface HermesModel {
  id: string;
  name: string;
  provider: string;
  model: string;
}

export async function GET() {
  try {
    const path = join(homedir(), ".hermes", "models.json");
    const raw = readFileSync(path, "utf-8");
    const all: HermesModel[] = JSON.parse(raw);

    // Deduplicate by model ID — prefer non-openrouter provider when both exist
    const seen = new Map<string, HermesModel>();
    for (const m of all) {
      const key = m.model.replace(/^[^/]+\//, ""); // strip provider prefix
      const existing = seen.get(key);
      if (!existing || existing.provider === "openrouter") {
        seen.set(key, m);
      }
    }

    const models = Array.from(seen.values()).map((m) => ({
      id: m.model,
      name: m.name,
      provider: m.provider,
    }));

    // Prepend Antbase routing models when the API key is configured
    const antbaseKey = process.env.ANTBASE_API_KEY || loadSecretFromFile("ANTBASE_API_KEY");
    const allModels = antbaseKey ? [...ANTBASE_ROUTING_MODELS, ...models] : models;

    return Response.json(allModels);
  } catch {
    // Fallback to built-in list if models.json is missing
    const antbaseKey = process.env.ANTBASE_API_KEY || loadSecretFromFile("ANTBASE_API_KEY");
    const base = [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
      { id: "claude-opus-4-20250918", name: "Claude Opus 4", provider: "anthropic" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
    ];
    return Response.json(antbaseKey ? [...ANTBASE_ROUTING_MODELS, ...base] : base);
  }
}

function loadSecretFromFile(key: string): string | undefined {
  try {
    const file = join(homedir(), ".hermes", "secrets.env");
    if (!existsSync(file)) return undefined;
    const lines = readFileSync(file, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        return trimmed.slice(key.length + 1).trim() || undefined;
      }
    }
  } catch {}
  return undefined;
}
