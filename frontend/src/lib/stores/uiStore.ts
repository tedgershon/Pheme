import { create } from "zustand";
import type { RolePreview } from "../role-preview";

// purely client-owned UI state, never mirrors server data
// add fields here when they're genuinely local (filters, toggles, modals)
interface UiState {
  // admin role preview (docs/AUTHZ_MATRIX.md section 2). In memory only: no
  // persist middleware, storage, cookie or URL, so a reload ends it and the
  // server-rendered first paint never disagrees with it. It is cleared by
  // resetAfterSessionChange, never sent to the API.
  rolePreview: RolePreview;
  setRolePreview: (preview: RolePreview) => void;
  clearRolePreview: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  rolePreview: null,
  setRolePreview: (rolePreview) => set({ rolePreview }),
  clearRolePreview: () => set({ rolePreview: null }),
}));
