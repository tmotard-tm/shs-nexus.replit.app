import { MainContent } from "@/components/layout/main-content";
import { ToolsRecoveryQueue } from "@/components/tools-queue/ToolsRecoveryQueue";

export default function ToolsQueuePage() {
  return (
    <MainContent>
      <div className="container mx-auto p-6">
        <ToolsRecoveryQueue />
      </div>
    </MainContent>
  );
}
