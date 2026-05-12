import './_group.css';
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import {
  Search, Truck, AlertTriangle, CheckCircle2, Navigation, MapPin, Map, PaintBucket, Wrench, User, UserX,
  CreditCard, Calendar, ShieldCheck, PenLine, Tag, Fingerprint
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
  odometer: 58420,
  color: "Oxford White",
  tpmsAssignedTechId: "T49281",
  tpmsAssignedTechName: "Carlos Rivera",
  holmanTechAssigned: "ENT-44102",
  holmanTechName: "Carlos Rivera",
  ownership: "Holman Lease",
  repairStatus: "Awaiting parts",
  repairETA: "2026-05-19",
  repairVendor: "Caliber Collision · Tampa",
  estimateCost: "$2,840",
  rentalCar: "Enterprise"
};

export function Variant4() {
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [mismatchExpanded, setMismatchExpanded] = useState<Record<string, boolean>>({
    odometer: true,
    location: false
  });

  const toggleMismatch = (key: string) => {
    setMismatchExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-screen w-[500px] bg-background text-foreground border-r border-border font-sans">
      {/* Sticky Command Bar */}
      <div className="sticky top-0 z-10 p-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search fields, run actions..." 
            className="pl-9 pr-12 h-10 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-border transition-all"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
            <Kbd className="text-[10px] py-0.5 px-1.5 opacity-50 bg-background border border-border rounded shadow-sm">⌘K</Kbd>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-6 pb-24">
          
          {/* Review Group */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 flex items-center text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Review
            </div>
            
            <div className="flex flex-col gap-0.5">
              <Row icon={Fingerprint} label="Identity" value={`#${selectedVehicle.vehicleNumber} · ${selectedVehicle.modelYear} ${selectedVehicle.makeName} ${selectedVehicle.modelName}`} freshness="Holman · 12m ago" />
              <Row icon={Tag} label="VIN" value={selectedVehicle.vin} freshness="Holman · 12m ago" />
              <Row icon={CreditCard} label="License" value={`${selectedVehicle.licensePlate} (${selectedVehicle.licenseState})`} freshness="AMS · 1d ago" />
              
              {/* Mismatched Row: Location */}
              <div 
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 rounded-md cursor-pointer group"
                onClick={() => toggleMismatch('location')}
              >
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 text-sm">Location</div>
                <div className="text-sm flex items-center gap-2">
                  <span>{selectedVehicle.city}, {selectedVehicle.state}</span>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-900/50">Mismatched</Badge>
                </div>
                <div className="w-[80px] text-right text-[10px] text-muted-foreground hidden group-hover:block">Multiple</div>
              </div>
              {mismatchExpanded.location && (
                <div className="ml-10 mr-3 mb-2 p-2.5 bg-muted/40 rounded-md border border-border/50 space-y-2">
                   <div className="flex justify-between items-center group/item">
                    <span className="text-xs">Holman: Tampa, FL <span className="text-muted-foreground">· 12m ago</span></span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover/item:opacity-100">Set as source</Button>
                   </div>
                   <div className="flex justify-between items-center group/item">
                    <span className="text-xs">AMS: Orlando, FL <span className="text-muted-foreground">· 4h ago</span></span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover/item:opacity-100">Set as source</Button>
                   </div>
                   <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
                     <Input placeholder="Use a different value..." className="h-7 text-xs bg-background" />
                     <Button size="sm" variant="secondary" className="h-7 text-[10px] px-2">Save override</Button>
                   </div>
                </div>
              )}

              {/* Mismatched Row: Odometer */}
              <div 
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 rounded-md cursor-pointer group"
                onClick={() => toggleMismatch('odometer')}
              >
                <Navigation className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 text-sm">Odometer</div>
                <div className="text-sm flex items-center gap-2">
                  <span className="font-mono">58,420 mi</span>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-900/50">Mismatched</Badge>
                </div>
                <div className="w-[80px] text-right text-[10px] text-muted-foreground hidden group-hover:block">Multiple</div>
              </div>
              {mismatchExpanded.odometer && (
                <div className="ml-10 mr-3 mb-2 p-2.5 bg-muted/40 rounded-md border border-border/50 space-y-2">
                   <div className="flex justify-between items-center group/item">
                    <span className="text-xs font-mono">Holman: 58,420 mi <span className="font-sans text-muted-foreground">· 12m ago</span></span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover/item:opacity-100">Set as source</Button>
                   </div>
                   <div className="flex justify-between items-center group/item">
                    <span className="text-xs font-mono">AMS: 58,200 mi <span className="font-sans text-muted-foreground">· 4h ago</span></span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover/item:opacity-100">Set as source</Button>
                   </div>
                   <div className="flex justify-between items-center group/item">
                    <span className="text-xs font-mono">Samsara: 58,431 mi <span className="font-sans text-muted-foreground">· live</span></span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover/item:opacity-100">Set as source</Button>
                   </div>
                   <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
                     <Input placeholder="Use a different value..." className="h-7 text-xs font-mono bg-background" />
                     <Button size="sm" variant="secondary" className="h-7 text-[10px] px-2">Save override</Button>
                   </div>
                </div>
              )}

              <Row icon={PaintBucket} label="AMS Color" value={selectedVehicle.color} freshness="AMS · 1d ago" />
              <Row icon={ShieldCheck} label="Ownership" value={selectedVehicle.ownership} freshness="Holman · 12m ago" />
            </div>
          </div>

          {/* Update Group */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Update</span>
              <div className="flex items-center gap-1 text-[9px] text-amber-600 dark:text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                <AlertTriangle className="h-3 w-3" /> Pinned because vehicle is In Repair
              </div>
            </div>
            
            <div className="flex flex-col gap-0.5">
              <Row icon={Wrench} label="Repair Status" value={selectedVehicle.repairStatus} freshness="AMS · 1d ago" editable />
              <Row icon={Calendar} label="Repair ETA" value={selectedVehicle.repairETA} freshness="AMS · 1d ago" editable />
              <Row icon={Map} label="Repair Vendor" value={selectedVehicle.repairVendor} freshness="AMS · 1d ago" editable />
              <Row icon={CreditCard} label="Estimate Cost" value={selectedVehicle.estimateCost} freshness="AMS · 1d ago" editable />
              <Row icon={Truck} label="Rental Car" value={selectedVehicle.rentalCar} freshness="AMS · 1d ago" />
              
              <div className="px-3 py-3 mt-1 text-xs text-muted-foreground hover:bg-muted/50 rounded-md cursor-pointer flex items-center justify-center border border-dashed border-border">
                Show 12 more editable fields...
              </div>
            </div>
          </div>

          {/* Assign & Unassign Group */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 flex items-center gap-4">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Assign</span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Unassign</span>
            </div>
            
            <div className="flex flex-col gap-0.5">
              <Row icon={User} label="TPMS Tech" value={`${selectedVehicle.tpmsAssignedTechId} / ${selectedVehicle.tpmsAssignedTechName}`} freshness="TPMS · live" />
              <Row icon={User} label="Holman Tech" value={`${selectedVehicle.holmanTechAssigned} / ${selectedVehicle.holmanTechName}`} freshness="Holman · 12m ago" />
              <Row icon={User} label="AMS Tech" value={`${selectedVehicle.tpmsAssignedTechId} / ${selectedVehicle.tpmsAssignedTechName}`} freshness="AMS · 1d ago" />
            </div>
          </div>
          
        </div>
      </ScrollArea>

      {/* Action Footer */}
      <div className="border-t border-border bg-background p-3 flex flex-col gap-3">
        {unassignOpen && (
          <div className="flex items-center gap-2 animate-in slide-in-from-bottom-2">
            <Label className="text-xs text-muted-foreground shrink-0 w-16">Reason:</Label>
            <Select>
              <SelectTrigger className="h-8 text-xs bg-muted/50 flex-1">
                <SelectValue placeholder="Select unassignment reason..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resignation">Resignation</SelectItem>
                <SelectItem value="repair">Vehicle Repair</SelectItem>
                <SelectItem value="termination">Termination</SelectItem>
                <SelectItem value="reassignment">Reassignment</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1 h-8 text-xs font-medium bg-muted/50 hover:bg-muted"><CheckCircle2 className="h-3.5 w-3.5 mr-1.5"/>Review</Button>
          <Button variant="secondary" size="sm" className="flex-1 h-8 text-xs font-medium bg-muted/50 hover:bg-muted"><PenLine className="h-3.5 w-3.5 mr-1.5"/>Update</Button>
          <Button variant="secondary" size="sm" className="flex-1 h-8 text-xs font-medium bg-muted/50 hover:bg-muted"><User className="h-3.5 w-3.5 mr-1.5"/>Assign</Button>
          <Button 
            variant={unassignOpen ? "destructive" : "secondary"} 
            size="sm" 
            className={`flex-1 h-8 text-xs font-medium ${!unassignOpen ? 'bg-muted/50 hover:bg-muted hover:text-destructive hover:bg-destructive/10' : ''}`}
            onClick={() => setUnassignOpen(true)}
            disabled={unassignOpen} // Disable if already open to force reason selection
          >
            <UserX className="h-3.5 w-3.5 mr-1.5"/>Unassign
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value, freshness, editable }: { icon: any, label: string, value: string, freshness: string, editable?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 rounded-md group">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="w-[120px] text-sm text-muted-foreground">{label}</div>
      <div className="flex-1 text-sm flex items-center justify-between">
        <span className={editable ? "group-hover:text-primary transition-colors" : ""}>{value}</span>
      </div>
      <div className="w-[80px] text-right text-[10px] text-muted-foreground/60 hidden group-hover:block whitespace-nowrap">
        {freshness}
      </div>
      {editable && (
        <div className="w-4 flex justify-end">
          <PenLine className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  );
}
