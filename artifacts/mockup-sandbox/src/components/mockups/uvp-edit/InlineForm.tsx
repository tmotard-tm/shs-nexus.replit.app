import React, { useState } from "react";
import { 
  Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Wrench, MapPin, DollarSign, MessageSquare, Save, Calendar, 
  Truck, User, Activity, History, ExternalLink, RefreshCw, FileText
} from "lucide-react";

export function InlineForm() {
  const { toast } = useToast();

  const handleSave = (section: string) => {
    toast({
      title: "Changes saved",
      description: `${section} updated successfully for VEH-4471.`,
    });
  };

  return (
    <div className="max-w-[1200px] mx-auto p-6 bg-muted/30 min-h-screen">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold tracking-tight">VEH-4471</h1>
            <Badge variant="secondary" className="text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
              In Repair
            </Badge>
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            2022 Ford Transit-350 High-Roof Cargo Van
            <span className="text-xs px-1.5 py-0.5 bg-muted rounded-md border">VIN: 1FTBR1Y88NKA12345</span>
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p>Assigned District: <strong className="text-foreground">DAL-NORTH</strong></p>
          <p>Last updated: Today, 08:42 AM</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Main Scrollable Area */}
        <div className="md:col-span-8 lg:col-span-9 space-y-6">
          
          {/* VEHICLE INFO */}
          <Card id="vehicle-info">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Vehicle Information</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSave("Vehicle Information")}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Section
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <Select defaultValue="white">
                    <SelectTrigger id="color">
                      <SelectValue placeholder="Select color" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="white">Oxford White</SelectItem>
                      <SelectItem value="black">Agate Black</SelectItem>
                      <SelectItem value="silver">Ingot Silver</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branding">Branding</Label>
                  <Select defaultValue="standard">
                    <SelectTrigger id="branding">
                      <SelectValue placeholder="Select branding" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard Fleet</SelectItem>
                      <SelectItem value="none">Unbranded</SelectItem>
                      <SelectItem value="special">Special Ops</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interior">Interior</Label>
                  <Select defaultValue="vinyl">
                    <SelectTrigger id="interior">
                      <SelectValue placeholder="Select interior" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vinyl">Dark Palazzo Gray Vinyl</SelectItem>
                      <SelectItem value="cloth">Ebony Cloth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="truckStatus">Truck Status</Label>
                  <Select defaultValue="in_repair">
                    <SelectTrigger id="truckStatus">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_service">In Service</SelectItem>
                      <SelectItem value="in_repair">In Repair</SelectItem>
                      <SelectItem value="out_of_service">Out of Service</SelectItem>
                      <SelectItem value="sold">Sold</SelectItem>
                      <SelectItem value="stolen">Stolen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-3 border rounded-md">
                  <div className="space-y-0.5">
                    <Label>Theft Verified</Label>
                    <p className="text-sm text-muted-foreground">Has theft been reported to authorities?</p>
                  </div>
                  <Switch id="theft-verified" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vehicleRuns">Vehicle Runs</Label>
                  <Select defaultValue="yes">
                    <SelectTrigger id="vehicleRuns">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vehicleLooks">Vehicle Looks</Label>
                  <Select defaultValue="fair">
                    <SelectTrigger id="vehicleLooks">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LOCATION */}
          <Card id="location">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Location</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSave("Location Data")}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Section
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentLocation">Current Location Address</Label>
                    <Input id="currentLocation" defaultValue="Hertz Equipment Rental, 123 Industrial Pkwy" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currentZip">Current Location Zip</Label>
                    <Input id="currentZip" defaultValue="75201" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="keyLocation">Key Location Address</Label>
                    <Input id="keyLocation" defaultValue="Drop Box #4" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keyZip">Key Location Zip</Label>
                    <Input id="keyZip" defaultValue="75201" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* REPAIR INFO */}
          <Card id="repair-info" className="border-amber-200 shadow-sm">
            <CardHeader className="pb-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-amber-600" />
                  <CardTitle>Repair Information</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSave("Repair Information")}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Section
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                <div className="space-y-0.5">
                  <Label className="text-base">Currently In Repair</Label>
                  <p className="text-sm text-muted-foreground">Is the vehicle actively undergoing repairs?</p>
                </div>
                <Switch id="inRepair" defaultChecked />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="repairVendor">Repair Vendor</Label>
                  <Input id="repairVendor" defaultValue="Hertz Equipment Rental" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repairStatus">Repair Status</Label>
                  <Select defaultValue="waiting_parts">
                    <SelectTrigger id="repairStatus">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="diagnosing">Diagnosing</SelectItem>
                      <SelectItem value="waiting_approval">Waiting Approval</SelectItem>
                      <SelectItem value="waiting_parts">Waiting on Parts</SelectItem>
                      <SelectItem value="in_progress">Repair in Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="repairReason">Repair Reason</Label>
                <Textarea 
                  id="repairReason" 
                  defaultValue="Catalytic converter replacement and suspension check. Driver reported loud noise and rough ride."
                  className="min-h-[80px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="repairDate">Repair Start Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="repairDate" type="date" className="pl-9" defaultValue="2026-03-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repairETA">Repair ETA</Label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="repairETA" type="date" className="pl-9" defaultValue="2026-03-18" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repairEstimate">Estimated Cost</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="repairEstimate" type="number" className="pl-9" defaultValue="2450.00" />
                  </div>
                </div>
              </div>

              <Separator />
              
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-foreground">Rental Car Provided</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rentalCar">Rental Vendor</Label>
                    <Input id="rentalCar" defaultValue="Enterprise" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentalStart">Rental Start</Label>
                    <div className="relative">
                      <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input id="rentalStart" type="date" className="pl-9" defaultValue="2026-03-11" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rentalEnd">Rental End (Expected)</Label>
                    <div className="relative">
                      <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input id="rentalEnd" type="date" className="pl-9" defaultValue="2026-03-19" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* DISPOSITION */}
          <Card id="disposition">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Disposition</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSave("Disposition Data")}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Section
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="finalDisposition">Final Disposition</Label>
                  <Select defaultValue="in_service">
                    <SelectTrigger id="finalDisposition">
                      <SelectValue placeholder="Select disposition" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_service">In Service (Pending Return)</SelectItem>
                      <SelectItem value="returned">Returned to Lessor</SelectItem>
                      <SelectItem value="sold">Sold at Auction</SelectItem>
                      <SelectItem value="totaled">Totaled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="finalDate">Disposition Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="finalDate" type="date" className="pl-9" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dispositionReason">Disposition Notes</Label>
                <Textarea 
                  id="dispositionReason" 
                  placeholder="Enter reason or details regarding final disposition..."
                  className="min-h-[80px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storageCost">Daily Storage Cost</Label>
                <div className="relative w-full md:w-1/2">
                  <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="storageCost" type="number" className="pl-9" defaultValue="0.00" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* COMMENTS */}
          <Card id="comments">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Comments & History</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-sm">
                      JD
                    </div>
                    <div className="w-px h-full bg-border mt-2"></div>
                  </div>
                  <div className="pb-4 flex-1">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-medium text-sm">John Davis (Ops)</span>
                      <span className="text-xs text-muted-foreground">Mar 12, 2026 2:15 PM</span>
                    </div>
                    <p className="text-sm text-foreground bg-muted/50 p-3 rounded-md">
                      Followed up with Hertz. They are waiting on the replacement catalytic converter. ETA for parts is Monday. Extended rental car.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-foreground font-medium text-sm">
                      SYS
                    </div>
                    <div className="w-px h-full bg-border mt-2"></div>
                  </div>
                  <div className="pb-4 flex-1">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-medium text-sm">System</span>
                      <span className="text-xs text-muted-foreground">Mar 10, 2026 9:02 AM</span>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      Status changed from In Service to In Repair. Assigned to vendor Hertz Equipment Rental.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium text-sm">
                      MR
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-medium text-sm">Mike Rivera (Tech)</span>
                      <span className="text-xs text-muted-foreground">Mar 10, 2026 8:45 AM</span>
                    </div>
                    <p className="text-sm text-foreground bg-muted/50 p-3 rounded-md">
                      Van is extremely loud and losing power. Dropped off at Hertz on Industrial. Dropped keys in Box #4.
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label htmlFor="new-comment">Add Comment</Label>
                <Textarea 
                  id="new-comment" 
                  placeholder="Type a new comment..." 
                  className="min-h-[100px]"
                />
                <div className="flex justify-end">
                  <Button onClick={() => handleSave("Comment")}>Add Comment</Button>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Bottom spacing for scroll */}
          <div className="h-12"></div>
        </div>

        {/* Sticky Right Rail - Workflow Actions */}
        <div className="md:col-span-4 lg:col-span-3">
          <div className="sticky top-6 space-y-6">
            <Card>
              <CardHeader className="pb-3 pt-5">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Workflow Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <User className="h-4 w-4 mr-2" />
                  Assign Tech
                </Button>
                <Button variant="outline" className="w-full justify-start text-left font-normal text-destructive hover:text-destructive">
                  <User className="h-4 w-4 mr-2" />
                  Unassign Tech
                </Button>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Resync Assignments
                </Button>
                
                <Separator className="my-4" />
                
                <Button variant="ghost" className="w-full justify-start text-left font-normal">
                  <FileText className="h-4 w-4 mr-2" />
                  View PO History
                </Button>
                <Button variant="ghost" className="w-full justify-start text-left font-normal">
                  <History className="h-4 w-4 mr-2" />
                  View Vehicle History
                </Button>
                <Button variant="ghost" className="w-full justify-start text-left font-normal">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Ops Review
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-muted border-none shadow-none">
              <CardContent className="p-4 text-sm text-muted-foreground">
                <p><strong>Tip:</strong> All edits are visible on a single scrollable page. Save each section as you work, or use the comments section to log updates.</p>
              </CardContent>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}
