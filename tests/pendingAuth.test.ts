/**
 * Tests for the shared pendingAuth module.
 */
import {
  addPendingTenant,
  hasPendingTenant,
  removePendingTenant,
  clearPendingTenants,
} from "../src/youtube/pendingAuth";

const UUID_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

describe("pendingAuth", () => {
  beforeEach(() => {
    clearPendingTenants();
  });

  it("hasPendingTenant returns false for unknown tenantId", () => {
    expect(hasPendingTenant(UUID_A)).toBe(false);
  });

  it("addPendingTenant makes hasPendingTenant return true", () => {
    addPendingTenant(UUID_A);
    expect(hasPendingTenant(UUID_A)).toBe(true);
  });

  it("removePendingTenant removes a pending tenant", () => {
    addPendingTenant(UUID_A);
    removePendingTenant(UUID_A);
    expect(hasPendingTenant(UUID_A)).toBe(false);
  });

  it("clearPendingTenants removes all pending tenants", () => {
    addPendingTenant(UUID_A);
    addPendingTenant(UUID_B);
    clearPendingTenants();
    expect(hasPendingTenant(UUID_A)).toBe(false);
    expect(hasPendingTenant(UUID_B)).toBe(false);
  });

  it("does not affect other tenants when removing one", () => {
    addPendingTenant(UUID_A);
    addPendingTenant(UUID_B);
    removePendingTenant(UUID_A);
    expect(hasPendingTenant(UUID_A)).toBe(false);
    expect(hasPendingTenant(UUID_B)).toBe(true);
  });

  it("removePendingTenant is a no-op for a tenantId not in the set", () => {
    expect(() => removePendingTenant(UUID_A)).not.toThrow();
    expect(hasPendingTenant(UUID_A)).toBe(false);
  });
});
