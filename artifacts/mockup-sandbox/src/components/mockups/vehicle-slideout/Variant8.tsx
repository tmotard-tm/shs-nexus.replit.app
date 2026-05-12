import './_group.css';
import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Truck, AlertTriangle, CheckCircle2, MessageSquare, 
  MapPin, Wrench, FileText, Search, Edit3, UserPlus, UserX, X
} from "lucide-react";

const selectedVehicle = {
  vehicleNumber: "61385",
  vin: "1FTBR1Y89PKA48217",
  licensePlate: "JZQ-T84",
  licenseState: "FL",
  modelYear: 2023,
  makeName: "Ford",
  modelName: "Transit Connect",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  odometer: 58420,
  tpmsAssignedTechId: "T49281",
  tpmsAssignedTechName: "Carlos Rivera",
  holmanTechAssigned: "ENT-44102",
  holmanTechName: "Carlos Rivera",
};

export function Variant8() {
  const [activeTab, setActiveTab] = useState<'none' | 'review' | 'update' | 'assign' | 'unassign'>('none');

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-zinc-950 flex justify-center font-sans">
      <div className="w-[500px] bg-background border-x flex flex-col h-screen overflow-hidden shadow-xl">
        
        {/* Header - Vehicle Identity */}
        <div className="p-4 border-b bg-card z-10 shrink-0">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-full text-primary">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-none">#{selectedVehicle.vehicleNumber}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">
                In Repair
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</span>
            </div>
          </div>
        </div>

        {/* Thread Body */}
        <ScrollArea className="flex-1 p-4 bg-[#F1F5F9] dark:bg-zinc-900/50">
          <div className="space-y-6 pb-20">
            
            <div className="text-center text-xs text-muted-foreground my-4 font-medium uppercase tracking-wider">Today</div>

            {/* Message: Snowflake */}
            <div className="flex flex-col items-start max-w-[90%]">
              <div className="flex items-center gap-2 mb-1 pl-1">
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Snowflake</span>
                <span className="text-[10px] text-muted-foreground">1d ago</span>
              </div>
              <Card className="p-3 bg-white dark:bg-zinc-900 shadow-sm rounded-2xl rounded-tl-sm border-blue-100 dark:border-blue-900">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">Profitability snapshot refreshed for the week.</span>
                </div>
              </Card>
            </div>

            {/* Message: AMS Repair Update */}
            <div className="flex flex-col items-start max-w-[90%]">
              <div className="flex items-center gap-2 mb-1 pl-1">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">AMS</span>
                <span className="text-[10px] text-muted-foreground">4h ago</span>
              </div>
              <Card className="p-3 bg-white dark:bg-zinc-900 shadow-sm rounded-2xl rounded-tl-sm border-indigo-100 dark:border-indigo-900">
                <div className="flex items-start gap-2">
                  <Wrench className="h-4 w-4 text-indigo-500 mt-0.5" />
                  <div>
                    <span className="text-sm font-medium">Repair status updated</span>
                    <p className="text-sm text-muted-foreground mt-1">Status changed to <strong className="text-foreground">'Awaiting parts'</strong> for transmission service.</p>
                    <div className="mt-2 text-xs text-muted-foreground border-l-2 pl-2 border-indigo-200 dark:border-indigo-800">
                      <div>Vendor: Caliber Collision · Tampa</div>
                      <div>ETA: 2026-05-19</div>
                      <div>Estimate: $2,840</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Message: Samsara GPS */}
            <div className="flex flex-col items-start max-w-[90%]">
              <div className="flex items-center gap-2 mb-1 pl-1">
                <span className="text-xs font-semibold text-green-600 dark:text-green-400">Samsara</span>
                <span className="text-[10px] text-muted-foreground">2m ago</span>
              </div>
              <Card className="p-3 bg-white dark:bg-zinc-900 shadow-sm rounded-2xl rounded-tl-sm border-green-100 dark:border-green-900">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-green-500" />
                  <span className="text-sm">GPS location reported at Tampa FL (33602).</span>
                </div>
                {/* Mismatch: Location */}
                <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-900/50">
                  <div className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-500 font-medium mb-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Disagrees with AMS location (Orlando, FL)</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs bg-white dark:bg-black">Set as source</Button>
                    <Input className="h-7 text-xs w-32" placeholder="Override value..." />
                  </div>
                </div>
              </Card>
            </div>

            {/* Message: Holman */}
            <div className="flex flex-col items-start max-w-[90%]">
              <div className="flex items-center gap-2 mb-1 pl-1">
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Holman</span>
                <span className="text-[10px] text-muted-foreground">just now</span>
              </div>
              <Card className="p-3 bg-white dark:bg-zinc-900 shadow-sm rounded-2xl rounded-tl-sm border-rose-100 dark:border-rose-900 w-full">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Odometer</span>
                    <span className="font-medium">58,420 mi</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Tech</span>
                    <span className="font-medium">{selectedVehicle.holmanTechName}</span>
                  </div>
                </div>
                
                {/* Mismatch: Odometer */}
                <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-950/30 rounded border border-orange-200 dark:border-orange-900/50">
                  <div className="flex items-center gap-1.5 text-xs text-orange-800 dark:text-orange-500 font-medium mb-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Mismatched Odometer</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Holman · 12m ago</span>
                      <span className="font-medium">58,420 mi</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">AMS · 4h ago</span>
                      <span className="font-medium text-orange-700 dark:text-orange-400">58,200 mi</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Samsara · 2m ago</span>
                      <span className="font-medium text-orange-700 dark:text-orange-400">58,431 mi</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1 bg-white dark:bg-black">Set Holman as source</Button>
                    <Input className="h-7 text-xs flex-1" placeholder="Custom value..." />
                  </div>
                </div>
              </Card>
            </div>

          </div>
        </ScrollArea>

        {/* Action Bar (Sticky Bottom) */}
        <div className="bg-card border-t shrink-0">
          
          {/* Expanded Action Areas */}
          {activeTab === 'update' && (
            <div className="p-4 border-b bg-muted/30">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-sm">Update Vehicle Details</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setActiveTab('none')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md border border-amber-200 dark:border-amber-900/50 mb-3">
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500 font-medium mb-2">
                  <Wrench className="h-3.5 w-3.5" />
                  Pinned because vehicle is In Repair
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Repair ETA</Label>
                      <Input defaultValue="2026-05-19" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Estimate Cost</Label>
                      <Input defaultValue="$2,840" className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Vendor</Label>
                    <Input defaultValue="Caliber Collision · Tampa" className="h-8 text-sm" />
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs h-8 text-muted-foreground">
                More fields...
              </Button>
            </div>
          )}

          {activeTab === 'unassign' && (
            <div className="p-4 border-b bg-muted/30">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-sm">Unassign Technician</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setActiveTab('none')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Reason for Unassignment</Label>
                  <Select>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Resignation">Resignation</SelectItem>
                      <SelectItem value="Vehicle Repair">Vehicle Repair</SelectItem>
                      <SelectItem value="Termination">Termination</SelectItem>
                      <SelectItem value="Reassignment">Reassignment</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Note</Label>
                  <Input placeholder="Add note..." className="h-8 text-sm" />
                </div>
                <div className="flex justify-end pt-1">
                  <Button size="sm" variant="destructive" className="h-8 text-xs">Confirm Unassign</Button>
                </div>
              </div>
            </div>
          )}

          {/* Core 4 Buttons */}
          <div className="flex p-3 gap-2">
            <Button 
              variant={activeTab === 'review' ? "secondary" : "outline"} 
              size="sm" 
              className="flex-1 h-9 bg-card"
              onClick={() => setActiveTab(activeTab === 'review' ? 'none' : 'review')}
            >
              <Search className="h-4 w-4 mr-1.5 text-muted-foreground" />
              Review
            </Button>
            <Button 
              variant={activeTab === 'update' ? "secondary" : "outline"} 
              size="sm" 
              className="flex-1 h-9 bg-card"
              onClick={() => setActiveTab(activeTab === 'update' ? 'none' : 'update')}
            >
              <Edit3 className="h-4 w-4 mr-1.5 text-muted-foreground" />
              Update
            </Button>
            <Button 
              variant={activeTab === 'assign' ? "secondary" : "outline"} 
              size="sm" 
              className="flex-1 h-9 bg-card"
              onClick={() => setActiveTab(activeTab === 'assign' ? 'none' : 'assign')}
            >
              <UserPlus className="h-4 w-4 mr-1.5 text-muted-foreground" />
              Assign
            </Button>
            <Button 
              variant={activeTab === 'unassign' ? "secondary" : "outline"} 
              size="sm" 
              className="flex-1 h-9 bg-card"
              onClick={() => setActiveTab(activeTab === 'unassign' ? 'none' : 'unassign')}
            >
              <UserX className="h-4 w-4 mr-1.5 text-muted-foreground" />
              Unassign
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
