import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { List, BarChart2, Tag, Truck } from "lucide-react";
import { FleetTable } from "./FleetTable";
import { VendorSpend } from "./VendorSpend";
import { AtaBreakdown } from "./AtaBreakdown";
import { VehicleSummary } from "./VehicleSummary";

export function PoHistory() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/60 px-6 py-4 flex items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 leading-none">Fleet PO History</h1>
          <p className="text-xs text-zinc-500 mt-1">Holman purchase orders · last 3 years</p>
        </div>
      </div>

      <Tabs defaultValue="all" className="flex flex-col">
        <div className="border-b border-zinc-800 bg-zinc-900/40 px-6">
          <TabsList className="h-10 bg-transparent p-0 gap-0 rounded-none">
            <TabsTrigger
              value="all"
              className="h-10 rounded-none border-b-2 border-transparent px-4 text-sm font-medium text-zinc-400 gap-2
                data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 data-[state=active]:bg-transparent
                hover:text-zinc-200 transition-colors"
            >
              <List className="w-3.5 h-3.5" />
              All POs
            </TabsTrigger>
            <TabsTrigger
              value="vendor"
              className="h-10 rounded-none border-b-2 border-transparent px-4 text-sm font-medium text-zinc-400 gap-2
                data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 data-[state=active]:bg-transparent
                hover:text-zinc-200 transition-colors"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              By Vendor
            </TabsTrigger>
            <TabsTrigger
              value="ata"
              className="h-10 rounded-none border-b-2 border-transparent px-4 text-sm font-medium text-zinc-400 gap-2
                data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 data-[state=active]:bg-transparent
                hover:text-zinc-200 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" />
              By ATA Group
            </TabsTrigger>
            <TabsTrigger
              value="vehicle"
              className="h-10 rounded-none border-b-2 border-transparent px-4 text-sm font-medium text-zinc-400 gap-2
                data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 data-[state=active]:bg-transparent
                hover:text-zinc-200 transition-colors"
            >
              <Truck className="w-3.5 h-3.5" />
              By Vehicle
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all" className="mt-0 flex-1">
          <FleetTable />
        </TabsContent>
        <TabsContent value="vendor" className="mt-0 flex-1">
          <VendorSpend />
        </TabsContent>
        <TabsContent value="ata" className="mt-0 flex-1">
          <AtaBreakdown />
        </TabsContent>
        <TabsContent value="vehicle" className="mt-0 flex-1">
          <VehicleSummary />
        </TabsContent>
      </Tabs>
    </div>
  );
}
