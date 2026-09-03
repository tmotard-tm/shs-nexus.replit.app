import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Truck as TruckIcon } from "lucide-react";

/**
 * Fleet Scope dashboard.
 *
 * Tyler, 2026-09-03: "Vehicle Rental Management should be the only rental
 * management platform outside of the rental dashboard ... I want there to be
 * a total number of rentals in Fleet Scope for him, but that's it. There
 * cannot be anything left in Fleet Scope regarding rentals."
 *
 * This page used to be the Rentals Dashboard: an editable fs_trucks tracker
 * (pickup slot, rental returned, van picked up, spreadsheet import/export,
 * its own Snowflake sync and summary cards). It lived a second life beside
 * VRM Rental Operations and drifted from it. All of it is gone. The one
 * number left is read from VRM's own open-rentals feed, so it can never
 * disagree with the board.
 */
export default function Dashboard() {
  const { data, isLoading } = useQuery<{ data?: unknown[]; total?: number }>({
    queryKey: ["/api/rental-ops/open"],
    queryFn: async () => {
      const res = await fetch("/api/rental-ops/open", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const total = data?.total ?? data?.data?.length ?? 0;

  return (
    <div className="bg-background">
      <main className="px-4 lg:px-8 py-6">
        <h1 className="text-xl font-semibold mb-4">Fleet Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card
            className="p-4 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
            data-testid="card-total-rentals"
          >
            <div className="flex items-center gap-2 mb-1">
              <TruckIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Open Rentals</span>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-total-rentals">
              {isLoading ? "..." : total.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Managed on <Link href="/vehicle-rental-management" className="underline underline-offset-2">Vehicle Rental Management</Link></p>
          </Card>
        </div>
      </main>
    </div>
  );
}
