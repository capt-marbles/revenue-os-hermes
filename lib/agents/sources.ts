import path from "path";
import os from "os";
import fs from "fs";
import { glob } from "glob";

export interface AgentSourceConfig {
  name: string;
  source: "marketing-skills" | "agency-agents";
  paths: string[];
}

/**
 * Resolve the marketing-skills paths.
 * Primary: ~/.hermes/skills/marketing/ (Corey Haines Marketing Skills, 36 skills)
 * Fallback: ~/.claude/plugins/cache/ glob (legacy Claude plugin cache)
 */
function resolveMarketingSkillsPaths(): string[] {
  const home = os.homedir();

  // Primary: Hermes skills directory
  const hermesSkillsDir = path.join(home, ".hermes", "skills", "marketing");
  if (fs.existsSync(hermesSkillsDir)) {
    try {
      const pattern = path.join(hermesSkillsDir, "*", "SKILL.md");
      const matches = glob.sync(pattern, { absolute: true });
      if (matches.length > 0) return matches;
    } catch {
      // fall through to legacy path
    }
  }

  // Fallback: Claude plugin cache
  const cacheBase = path.join(home, ".claude", "plugins", "cache");
  if (!fs.existsSync(cacheBase)) return [];
  try {
    const pattern = path.join(cacheBase, "**", "skills", "*", "SKILL.md");
    return glob.sync(pattern, { absolute: true });
  } catch {
    return [];
  }
}

/**
 * Resolve the agency-agents repo path.
 * Expected at ~/projects/agency-agents/ or configurable via env.
 */
function resolveAgencyAgentsPaths(): string[] {
  const repoPath = process.env.AGENCY_AGENTS_PATH ||
    path.join(os.homedir(), "projects", "agency-agents");

  if (!fs.existsSync(repoPath)) return [];

  try {
    const pattern = path.join(repoPath, "**", "*.md");
    const matches = glob.sync(pattern, { absolute: true, ignore: ["**/README.md", "**/LICENSE*", "**/CONTRIBUTING*.md", "**/examples/**", "**/scripts/**"] });
    return matches;
  } catch {
    return [];
  }
}

export function getAgentSources(): AgentSourceConfig[] {
  return [
    {
      name: "Marketing Skills (Corey Haines)",
      source: "marketing-skills",
      paths: resolveMarketingSkillsPaths(),
    },
    {
      name: "Agency Agents",
      source: "agency-agents",
      paths: resolveAgencyAgentsPaths(),
    },
  ];
}
