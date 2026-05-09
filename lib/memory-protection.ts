// Categories that require human approval to modify.
// Agents and automated processes cannot update these — only the operator via the UI.
const PROTECTED_CATEGORIES = new Set(["brand_voice"]);

/**
 * Check if a memory write should be blocked.
 * Returns an error message if blocked, null if allowed.
 */
export function checkMemoryProtection(
  category: string,
  updatedBy: string | undefined
): string | null {
  if (!PROTECTED_CATEGORIES.has(category)) return null;

  // Only 'human' and 'import' (the brand sync script) can write to protected categories
  const allowedWriters = new Set(["human", "import"]);
  if (updatedBy && allowedWriters.has(updatedBy)) return null;

  return `Category "${category}" is protected and requires operator approval. Only human edits are allowed.`;
}
