import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAfterSessionChange } from "../query/invalidators";
import { queryKeys } from "../query/keys";
import { applyRolePreview } from "../role-preview";
import { GUEST_USER } from "../SessionProvider";
import { useUiStore } from "../stores/uiStore";
import type { UserProfile } from "../types";

vi.mock("../supabase", () => ({ supabase: null }));

const PROFILE: UserProfile = {
  ...GUEST_USER,
  id: "11111111-1111-1111-1111-111111111111",
  andrew_id: "someone",
  display_name: "Some One",
  tartan_coin_balance: 2500,
  claim_eligible: true,
  claim_amount: 1000,
  equipped_badge_id: "badge-1",
  equipped_badges: { streak: "badge-1" },
  avatar_url: "https://example.test/a.png",
};

describe("applyRolePreview", () => {
  it.each(["admin", "super_admin"] as const)(
    "renders a %s as a user while a preview is set",
    (role) => {
      const profile = { ...PROFILE, role, is_admin: true };
      const previewed = applyRolePreview(profile, "user");
      expect(previewed.role).toBe("user");
      expect(previewed.is_admin).toBe(false);
    },
  );

  it("changes only role and is_admin, so identity overlays keep the real id", () => {
    const profile = {
      ...PROFILE,
      role: "super_admin" as const,
      is_admin: true,
    };
    const previewed = applyRolePreview(profile, "user");
    expect({
      ...previewed,
      role: profile.role,
      is_admin: profile.is_admin,
    }).toEqual(profile);
    expect(previewed.id).toBe(profile.id);
  });

  it("does not mutate the real profile", () => {
    const profile = { ...PROFILE, role: "admin" as const, is_admin: true };
    applyRolePreview(profile, "user");
    expect(profile.role).toBe("admin");
    expect(profile.is_admin).toBe(true);
  });

  it("returns an admin's profile untouched when no preview is set", () => {
    const profile = { ...PROFILE, role: "admin" as const, is_admin: true };
    expect(applyRolePreview(profile, null)).toBe(profile);
  });

  it("ignores a preview for a regular user", () => {
    expect(applyRolePreview(PROFILE, "user")).toBe(PROFILE);
  });

  it("ignores a preview for the guest session", () => {
    expect(applyRolePreview(GUEST_USER, "user")).toBe(GUEST_USER);
  });
});

describe("role preview store", () => {
  beforeEach(() => useUiStore.getState().clearRolePreview());
  afterEach(() => useUiStore.getState().clearRolePreview());

  it("starts off, and toggles on and off", () => {
    expect(useUiStore.getState().rolePreview).toBeNull();
    useUiStore.getState().setRolePreview("user");
    expect(useUiStore.getState().rolePreview).toBe("user");
    useUiStore.getState().clearRolePreview();
    expect(useUiStore.getState().rolePreview).toBeNull();
  });

  it("is not written to any browser storage", () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    try {
      useUiStore.getState().setRolePreview("user");
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is cleared on an identity change or sign-out", async () => {
    const qc = new QueryClient();
    try {
      useUiStore.getState().setRolePreview("user");
      await resetAfterSessionChange(qc);
      expect(useUiStore.getState().rolePreview).toBeNull();
    } finally {
      qc.clear();
    }
  });

  it("is left alone by toggling, which is not a session change", () => {
    const qc = new QueryClient();
    try {
      qc.setQueryData(queryKeys.me, PROFILE);
      useUiStore.getState().setRolePreview("user");
      useUiStore.getState().clearRolePreview();
      expect(qc.getQueryData(queryKeys.me)).toEqual(PROFILE);
    } finally {
      qc.clear();
    }
  });
});
