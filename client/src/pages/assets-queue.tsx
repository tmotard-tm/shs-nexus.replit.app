import { MainContent } from "@/components/layout/main-content";
import { AssetsRecoveryQueue } from "@/components/assets-queue/AssetsRecoveryQueue";

export default function AssetsQueuePage() {
  return (
    <MainContent>
      <div className="container mx-auto p-6">
        <AssetsRecoveryQueue />
      </div>
    </MainContent>
  );
}
