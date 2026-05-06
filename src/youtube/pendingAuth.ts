/**
 * Shared in-memory store for OAuth flows that are currently in progress.
 * Both the Express callback route and the MCP auth tool use this module.
 */

const pendingTenants = new Set<string>();
const pendingTimers = new Map<string, NodeJS.Timeout>();
const PENDING_TTL_MS = 10 * 60 * 1000;

export function addPendingTenant(tenantId: string): void {
  // Cancel any existing timer so only one cleanup runs per tenantId
  const existing = pendingTimers.get(tenantId);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  pendingTenants.add(tenantId);
  const timer = setTimeout(() => {
    pendingTenants.delete(tenantId);
    pendingTimers.delete(tenantId);
  }, PENDING_TTL_MS);
  timer.unref();
  pendingTimers.set(tenantId, timer);
}

export function hasPendingTenant(tenantId: string): boolean {
  return pendingTenants.has(tenantId);
}

export function removePendingTenant(tenantId: string): void {
  const timer = pendingTimers.get(tenantId);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingTimers.delete(tenantId);
  }
  pendingTenants.delete(tenantId);
}

/** Exposed for tests only – clears all pending tenants. */
export function clearPendingTenants(): void {
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
  pendingTenants.clear();
}
