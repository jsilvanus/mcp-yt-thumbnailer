/**
 * Shared in-memory store for OAuth flows that are currently in progress.
 * Both the Express callback route and the MCP auth tool use this module.
 */

const pendingTenants = new Set<string>();
const PENDING_TTL_MS = 10 * 60 * 1000;

export function addPendingTenant(tenantId: string): void {
  pendingTenants.add(tenantId);
  setTimeout(() => pendingTenants.delete(tenantId), PENDING_TTL_MS).unref();
}

export function hasPendingTenant(tenantId: string): boolean {
  return pendingTenants.has(tenantId);
}

export function removePendingTenant(tenantId: string): void {
  pendingTenants.delete(tenantId);
}

/** Exposed for tests only – clears all pending tenants. */
export function clearPendingTenants(): void {
  pendingTenants.clear();
}
