import './_group.css';
import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  RefreshCw, Search, ChevronDown, ChevronRight, Check, Wrench, AlertCircle, AlertTriangle, UserPlus, UserX, UploadCloud 
} from "lucide-react";

const selectedVehicle = {
  vehicleNumber: "61385",
  vin: "1FTBR1Y89PKA48217",
  licensePlate: "JZQ-T84",
  licenseState: "FL",
  modelYear: 2023,
  makeName: "Ford",
  modelName: "Transit Connect",
  region: "Southeast",
  district: "0744",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  color: "Oxford White",
};

const amsVehicle = {
  RepairStatusName: "Awaiting parts",
  RepairETADate: "2026-05-19",
  Vendor: "Caliber Collision · Tampa",
  EstimateCost: 2840.0,
  RentalCarName: "Enterprise · Mid-size SUV",
};

export function Variant9() {
  const [odometerOpen, setOdometerOpen] = useState(true);
  const [plateOpen, setPlateOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(true);

  return (
    <div className="w-[540px] min-h-screen bg-white dark:bg-[#0A0B10] flex flex-col font-sans text-sm border-r dark:border-[#262932]">
      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-[#0A0B10]/80 backdrop-blur-md border-b dark:border-[#262932] p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-[160px]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search fields..." 
              className="h-8 pl-8 text-xs bg-slate-50 dark:bg-slate-900 border-none shadow-none" 
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Resync
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Assign
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <UserX className="h-3.5 w-3.5 mr-1.5" />
            Unassign
          </Button>
          <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white">
            <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
            Push Canonical
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-8">
        
        {/* REVIEW REGION */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">1. Review</h3>
          <div className="border dark:border-[#262932] rounded-md overflow-hidden bg-white dark:bg-[#1B1E27] shadow-sm">
            <table className="w-full text-left border-collapse">
              <tbody>
                <tr className="border-b dark:border-[#262932] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Vehicle ID</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    {selectedVehicle.vehicleNumber}
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Snowflake · 4h ago
                    </div>
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                  </td>
                </tr>
                
                <Collapsible open={odometerOpen} onOpenChange={setOdometerOpen} asChild>
                  <>
                    <tr className={`border-b dark:border-[#262932] transition-colors cursor-pointer ${odometerOpen ? 'bg-orange-50/50 dark:bg-orange-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                      <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">
                        <div className="flex items-center gap-1.5">
                          Odometer
                          <Badge variant="outline" className="text-[9px] px-1 h-4 bg-orange-100 text-orange-700 border-orange-200">Mismatch</Badge>
                        </div>
                      </td>
                      <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100 font-bold">
                        58,420 <span className="text-xs font-normal text-slate-500">mi</span>
                        <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Multiple Sources
                        </div>
                      </td>
                      <td className="p-2.5 w-[100px] align-top text-right">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700">
                            {odometerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                      </td>
                    </tr>
                    <CollapsibleContent asChild>
                      <tr className="bg-orange-50/30 dark:bg-orange-950/20 border-b dark:border-[#262932]">
                        <td colSpan={3} className="p-0">
                          <div className="p-3 pl-8 pr-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between bg-white dark:bg-[#0A0B10] p-2 border dark:border-[#262932] rounded shadow-sm">
                              <div className="flex items-center gap-2 w-[160px]">
                                <Badge variant="secondary" className="text-[10px] px-1.5 font-normal">Samsara</Badge>
                                <span className="text-slate-500 text-[10px]">live</span>
                              </div>
                              <div className="font-mono flex-1">58,431</div>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-blue-600">Set canonical</Button>
                            </div>
                            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-2 border border-blue-200 dark:border-blue-800 rounded shadow-sm">
                              <div className="flex items-center gap-2 w-[160px]">
                                <Badge variant="secondary" className="text-[10px] px-1.5 font-normal bg-blue-100 text-blue-800">Holman</Badge>
                                <span className="text-blue-500/70 text-[10px]">12m ago</span>
                              </div>
                              <div className="font-mono flex-1 font-bold">58,420 <span className="ml-2 inline-flex items-center text-[10px] text-blue-600 bg-blue-100 px-1 rounded"><Check className="w-3 h-3 mr-0.5"/> Current</span></div>
                              <Button size="sm" variant="ghost" disabled className="h-6 text-[10px] px-2 text-slate-400">Set canonical</Button>
                            </div>
                            <div className="flex items-center justify-between bg-white dark:bg-[#0A0B10] p-2 border dark:border-[#262932] rounded shadow-sm">
                              <div className="flex items-center gap-2 w-[160px]">
                                <Badge variant="secondary" className="text-[10px] px-1.5 font-normal">AMS</Badge>
                                <span className="text-slate-500 text-[10px]">4h ago</span>
                              </div>
                              <div className="font-mono flex-1">58,200</div>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-blue-600">Set canonical</Button>
                            </div>
                            <div className="flex items-center justify-between bg-white dark:bg-[#0A0B10] p-2 border dark:border-[#262932] rounded shadow-sm border-dashed">
                              <div className="w-[160px] text-[10px] text-slate-500 pl-1">Manual Override</div>
                              <div className="flex-1 flex gap-2 pr-2">
                                <Input className="h-6 text-xs font-mono w-24 bg-slate-50" placeholder="e.g. 58450" />
                                <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2">Apply</Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </CollapsibleContent>
                  </>
                </Collapsible>

                <tr className="border-b dark:border-[#262932] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">VIN</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    {selectedVehicle.vin}
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Holman · 12m ago
                    </div>
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                  </td>
                </tr>

                <Collapsible open={plateOpen} onOpenChange={setPlateOpen} asChild>
                  <>
                    <tr className={`border-b dark:border-[#262932] transition-colors cursor-pointer ${plateOpen ? 'bg-orange-50/50 dark:bg-orange-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                      <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">
                        <div className="flex items-center gap-1.5">
                          License Plate
                          <Badge variant="outline" className="text-[9px] px-1 h-4 bg-orange-100 text-orange-700 border-orange-200">Mismatch</Badge>
                        </div>
                      </td>
                      <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100 font-bold">
                        {selectedVehicle.licensePlate} <span className="text-xs font-normal text-slate-500">{selectedVehicle.licenseState}</span>
                        <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Multiple Sources
                        </div>
                      </td>
                      <td className="p-2.5 w-[100px] align-top text-right">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700">
                            {plateOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                      </td>
                    </tr>
                    <CollapsibleContent asChild>
                      <tr className="bg-orange-50/30 dark:bg-orange-950/20 border-b dark:border-[#262932]">
                        <td colSpan={3} className="p-0">
                          <div className="p-3 pl-8 pr-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-2 border border-blue-200 dark:border-blue-800 rounded shadow-sm">
                              <div className="flex items-center gap-2 w-[160px]">
                                <Badge variant="secondary" className="text-[10px] px-1.5 font-normal bg-blue-100 text-blue-800">AMS</Badge>
                                <span className="text-blue-500/70 text-[10px]">1d ago</span>
                              </div>
                              <div className="font-mono flex-1 font-bold">JZQ-T84 <span className="ml-2 inline-flex items-center text-[10px] text-blue-600 bg-blue-100 px-1 rounded"><Check className="w-3 h-3 mr-0.5"/> Current</span></div>
                              <Button size="sm" variant="ghost" disabled className="h-6 text-[10px] px-2 text-slate-400">Set canonical</Button>
                            </div>
                            <div className="flex items-center justify-between bg-white dark:bg-[#0A0B10] p-2 border dark:border-[#262932] rounded shadow-sm">
                              <div className="flex items-center gap-2 w-[160px]">
                                <Badge variant="secondary" className="text-[10px] px-1.5 font-normal">Holman</Badge>
                                <span className="text-slate-500 text-[10px]">12m ago</span>
                              </div>
                              <div className="font-mono flex-1">JZQ-T85</div>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-blue-600">Set canonical</Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </CollapsibleContent>
                  </>
                </Collapsible>

              </tbody>
            </table>
          </div>
        </section>

        {/* UPDATE REGION */}
        <section className="space-y-2">
          <div className="flex items-center justify-between pl-1">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">2. Update</h3>
            <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-medium border border-amber-200">
              <AlertTriangle className="h-3 w-3" /> Pinned because vehicle is In Repair
            </div>
          </div>
          <div className="border dark:border-[#262932] rounded-md overflow-hidden bg-white dark:bg-[#1B1E27] shadow-sm">
            <table className="w-full text-left border-collapse">
              <tbody>
                <tr className="border-b dark:border-[#262932] bg-amber-50/30 dark:bg-amber-900/10">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Repair Status</td>
                  <td className="p-2.5 font-mono text-amber-700 dark:text-amber-400 font-bold">
                    {amsVehicle.RepairStatusName}
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5 font-normal flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> AMS · 4h ago
                    </div>
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
                <tr className="border-b dark:border-[#262932] bg-amber-50/30 dark:bg-amber-900/10">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Repair ETA</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    {amsVehicle.RepairETADate}
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
                <tr className="border-b dark:border-[#262932] bg-amber-50/30 dark:bg-amber-900/10">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Vendor</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100 text-xs">
                    {amsVehicle.Vendor}
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
                <tr className="border-b dark:border-[#262932] bg-amber-50/30 dark:bg-amber-900/10">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Estimate Cost</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    ${amsVehicle.EstimateCost.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
                
                {/* Standard Update Fields */}
                <tr className="border-b dark:border-[#262932] hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Location</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    {selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> AMS · 1d ago
                    </div>
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="bg-slate-50 dark:bg-[#0A0B10] p-1.5 text-center border-t dark:border-[#262932]">
              <Button variant="ghost" size="sm" className="h-6 text-[10px] text-slate-500 w-full">
                <ChevronDown className="h-3 w-3 mr-1" /> Show 12 more fields
              </Button>
            </div>
          </div>
        </section>

        {/* ASSIGN REGION */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">3. Assign</h3>
          <div className="border dark:border-[#262932] rounded-md overflow-hidden bg-white dark:bg-[#1B1E27] shadow-sm">
            <table className="w-full text-left border-collapse">
              <tbody>
                <tr className="border-b dark:border-[#262932] hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Assigned Tech</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100">
                    T49281 / Carlos Rivera
                    <div className="text-[10px] text-slate-400 font-sans mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Consistent across TPMS, AMS, Holman
                    </div>
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Reassign</Button>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">Rental Backstop</td>
                  <td className="p-2.5 font-mono text-slate-900 dark:text-slate-100 text-xs">
                    {amsVehicle.RentalCarName}
                  </td>
                  <td className="p-2.5 w-[100px] align-top text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-600">Edit</Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* UNASSIGN REGION */}
        <section className="space-y-2 pb-8">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">4. Unassign</h3>
          <div className="border dark:border-[#262932] rounded-md overflow-hidden bg-white dark:bg-[#1B1E27] shadow-sm">
            <table className="w-full text-left border-collapse">
              <tbody>
                <Collapsible open={unassignOpen} onOpenChange={setUnassignOpen} asChild>
                  <>
                    <tr className={`border-b dark:border-[#262932] transition-colors cursor-pointer ${unassignOpen ? 'bg-red-50/50 dark:bg-red-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                      <td className="p-2.5 w-[140px] text-slate-600 dark:text-slate-400 font-medium align-top">
                        Tech Unassignment
                      </td>
                      <td className="p-2.5 font-mono text-slate-500">
                        Pending reason...
                      </td>
                      <td className="p-2.5 w-[100px] align-top text-right">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700">
                            {unassignOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                      </td>
                    </tr>
                    <CollapsibleContent asChild>
                      <tr className="bg-red-50/20 dark:bg-red-950/10 border-b dark:border-[#262932]">
                        <td colSpan={3} className="p-0">
                          <div className="p-4 pl-8 space-y-4">
                            <div className="grid gap-3">
                              <div>
                                <Label className="text-xs mb-1.5 block">Reason for Unassignment *</Label>
                                <Select>
                                  <SelectTrigger className="w-[280px] h-8 text-xs bg-white">
                                    <SelectValue placeholder="Select reason..." />
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
                              <div className="pt-2">
                                <Button size="sm" variant="destructive" className="h-8 text-xs" disabled>
                                  Confirm Unassignment
                                </Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
