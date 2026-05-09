// Global secret cache for server-side code
declare global {
  var __secrets_cache: Record<string, string> | undefined;
}