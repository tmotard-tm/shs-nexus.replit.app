import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreviewRole } from "@/hooks/use-preview-role";
import { usePermissions } from "@/hooks/use-permissions";

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Developer',
  agent: 'Agent',
};

export function PreviewModeBanner() {
  const { isPreviewMode, previewRole, exitPreviewMode } = usePreviewRole();
  const { effectiveRole } = usePermissions();

  if (!isPreviewMode || !previewRole) return null;

  const roleLabel = ROLE_LABELS[previewRole] || previewRole;

  return (
    <div 
      className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-amber-950 py-2 px-4 flex items-center justify-center gap-3 shadow-md"
      data-testid="banner-preview-mode"
    >
      <Eye className="h-4 w-4" />
      <span className="text-sm font-medium">
        Preview Mode: Viewing as <strong>{roleLabel}</strong>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white border-amber-700"
        onClick={exitPreviewMode}
        data-testid="button-exit-preview-mode"
      >
        <X className="h-3 w-3 mr-1" />
        Exit Preview
      </Button>
    </div>
  );
}
