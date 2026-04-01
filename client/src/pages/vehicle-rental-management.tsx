import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { BackButton } from "@/components/ui/back-button";
import { Car } from "lucide-react";

export default function VehicleRentalManagement() {
  return (
    <>
      <TopBar />
      <MainContent>
        <div className="flex items-center gap-3 mb-6">
          <BackButton />
          <Car className="h-6 w-6 text-teal-600" />
          <h1 className="text-2xl font-bold">Vehicle Rental Management</h1>
        </div>
      </MainContent>
    </>
  );
}
