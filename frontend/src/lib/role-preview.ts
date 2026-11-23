import type { UserProfile } from "./types";

// Admin role preview (docs/AUTHZ_MATRIX.md section 2). Presentation only:
// the preview changes what the UI renders and nothing else. The API, the
// proxy and the database keep using the real profiles.role, and the preview
// is never sent to the server. The only target is "user".
export type RolePreview = "user" | null;

export function isAdminRole(role: UserProfile["role"]): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * Returns the profile as the previewed role would see it. Only the role and
 * `is_admin` change; identity (id, balance, name, badges) stays the real
 * one, so creator, bettor and voter overlays keep following the real user.
 * A preview is ignored unless the real role is admin or super_admin, so
 * users and the guest sentinel always get their real profile back.
 */
export function applyRolePreview(
  profile: UserProfile,
  preview: RolePreview,
): UserProfile {
  if (preview !== "user" || !isAdminRole(profile.role)) return profile;
  return { ...profile, role: "user", is_admin: false };
}
