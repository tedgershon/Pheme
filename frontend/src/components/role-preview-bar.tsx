"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/query/queries/auth";
import { useUiStore } from "@/lib/stores/uiStore";

// Shown on every page while an admin previews the UI as a regular user, so
// the preview is never forgotten. It is a view: permissions are unchanged.
export function RolePreviewBar() {
  const { isPreviewing } = useMe();
  const clearRolePreview = useUiStore((s) => s.clearRolePreview);

  if (!isPreviewing) return null;

  return (
    <div className="border-b border-border bg-muted text-muted-foreground">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <Eye size={16} className="shrink-0" />
          <span>Viewing as a user. Your admin permissions are unchanged.</span>
        </p>
        <Button variant="outline" size="sm" onClick={clearRolePreview}>
          Exit preview
        </Button>
      </div>
    </div>
  );
}
