// Single-tenant helper — returns the default tenant ID.
// When multi-tenancy is added, this will resolve from session/auth.
export function getTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || "01JDEFAULT0000000000000000";
}
