import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import { requireAuth } from "@/lib/auth";

const SECRETS_FILE = path.join(homedir(), ".hermes", "secrets.env");

interface Secret {
  key: string;
  value: string;
  placeholder?: string;
  description: string;
}

// Define all required secrets for Revenue OS profiles
export const REQUIRED_SECRETS: Secret[] = [
  {
    key: "MATON_API_KEY",
    value: "",
    placeholder: "maton_key_123",
    description: "Maton AI API for Gmail, Calendar, Drive, Sheets"
  },
  {
    key: "TWENTY_API_KEY",
    value: "",
    placeholder: "eyJhbGci...",
    description: "Twenty CRM for managing contacts and deals"
  },
  {
    key: "HUNTER_API_KEY",
    value: "",
    placeholder: "hunter_key_789",
    description: "Hunter.io for email finding and verification"
  },
  {
    key: "APOLLO_API_KEY",
    value: "",
    placeholder: "apollo_key_abc",
    description: "Apollo.io for prospect research and enrichment"
  },
  {
    key: "ANTBASE_API_KEY",
    value: "",
    placeholder: "ant_...",
    description: "Antbase.ai smart routing — automatically selects the best model across 30+ providers"
  }
];

async function loadSecrets(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(SECRETS_FILE, "utf-8");
    const secrets: Record<string, string> = {};
    
    content.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          secrets[key.trim()] = valueParts.join("=").trim();
        }
      }
    });
    
    return secrets;
  } catch (error) {
    // File doesn't exist or read error
    return {};
  }
}

async function saveSecret(key: string, value: string): Promise<void> {
  const secrets = await loadSecrets();
  
  // Update or add the secret
  secrets[key] = value;
  
  // Build new content preserving comments and formatting
  let newContent = [
    "# Gameye Sales Stack API Keys",
    "# Add keys below as needed",
    "",
    ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
    ""
  ].join("\n");
  
  // Ensure directory exists
  const dir = path.dirname(SECRETS_FILE);
  await fs.mkdir(dir, { recursive: true });
  
  // Write back to file with restricted permissions
  await fs.writeFile(SECRETS_FILE, newContent, { mode: 0o600 });
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  try {
    const secrets = await loadSecrets();
    
    // Cache for connector configuration checks
    (global as any).__secrets_cache = secrets;
    
    const result = REQUIRED_SECRETS.map(secret => ({
      key: secret.key,
      placeholder: secret.placeholder,
      description: secret.description,
      configured: !!secrets[secret.key],
      hasValue: !!secrets[secret.key]
    }));
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load secrets:", error);
    return NextResponse.json({ error: "Failed to load secrets" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  try {
    const { key, value } = await request.json();
    
    if (!REQUIRED_SECRETS.find(s => s.key === key)) {
      return NextResponse.json({ error: "Unknown secret key" }, { status: 400 });
    }
    
    await saveSecret(key, value);
    
    // Update environment immediately so connector checks work
    process.env[key] = value;
    
    // Update cache
    if (!(global as any).__secrets_cache) {
      (global as any).__secrets_cache = {};
    }
    (global as any).__secrets_cache[key] = value;
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save secret:", error);
    return NextResponse.json({ error: "Failed to save secret" }, { status: 500 });
  }
}
