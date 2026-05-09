import { getAgentActivity } from "./get-agent-activity";
import { getGoals } from "./get-goals";
import { getTasks } from "./get-tasks";
import { getOutreachStats } from "./get-outreach-stats";
import { getPipelineSummary } from "./get-pipeline-summary";
import { getToolConnections } from "./get-tool-connections";
import { dispatchAgent } from "./dispatch-agent";
import { crmListDeals } from "./crm-list-deals";
import { crmUpdateDeal } from "./crm-update-deal";
import { crmAddActivity } from "./crm-add-activity";
import { crmStaleDeals } from "./crm-stale-deals";
import { memoryRead } from "./memory-read";
import { memoryWrite } from "./memory-write";
import { scoutWebSearch } from "./scout-web-search";
import { scoutGithubSearch } from "./scout-github-search";
import { scoutSteamLookup } from "./scout-steam-lookup";
import { scoutWayback } from "./scout-wayback";
import { scoutRedditSearch } from "./scout-reddit-search";
import { scoutHunter } from "./scout-hunter";
import { scoutApollo } from "./scout-apollo";
import { scoutCreateDeal } from "./scout-create-deal";
import { scoutSteamBridge } from "./scout-steam-bridge";
import { updateGoal, createGoal } from "./update-goal";
import type { RegisteredTool } from "./types";

/**
 * All registered tools for Revenue OS.
 *
 * To add a new tool:
 *   1. Create `lib/tools/your-tool-name.ts` exporting a `RegisteredTool`
 *   2. Import and add it to this array
 *
 * Set `connector: "tool-name"` on the tool if it should only be offered
 * when that connector is status "connected" in the DB.
 */
export const ALL_TOOLS: RegisteredTool[] = [
  getPipelineSummary,
  getToolConnections,
  getAgentActivity,
  getOutreachStats,
  getGoals,
  getTasks,
  dispatchAgent,
  crmListDeals,
  crmUpdateDeal,
  crmAddActivity,
  crmStaleDeals,
  memoryRead,
  memoryWrite,
  scoutWebSearch,
  scoutGithubSearch,
  scoutSteamLookup,
  scoutWayback,
  scoutRedditSearch,
  scoutHunter,
  scoutApollo,
  scoutCreateDeal,
  scoutSteamBridge,
  updateGoal,
  createGoal,
];

export { getToolsForAgent } from "./registry";
export type { RegisteredTool, ToolScope, ToolDefinition } from "./types";
