import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Pencil,
  Save,
  X,
  MessageSquare,
  Wrench,
  MapPin,
  Car,
  FileText,
  History,
  UserPlus,
  AlertTriangle,
  DollarSign,
  Key
} from "lucide-react";

export function ActionCards() {
  const [editingCard, setEditingCard] = useState<string | null>(null);

  // Mock Data
  const vehicle = {
    vehicleNumber: "VEH-4471",
    vin: "1FTBR4XG6NKA12345",
    year: "2022",
    make: "Ford",
    model: "Transit-350 High Roof Cargo Van",
    district: "DAL-NORTH",
    lastUpdated: "2 hours ago",
    
    color: "White",
    branding: "Sears Home Services",
    interior: "Vinyl",
    truckStatus: "In Repair",
    theftVerified: false,
    vehicleRuns: "Yes",
    vehicleLooks: "Good",
    
    currentLocation: "Hertz Equipment Rental",
    currentZip: "75001",
    keyLocation: "Front Desk",
    keyZip: "75001",
    storageCost: 0,
    
    inRepair: true,
    repairDate: "2026-03-01",
    repairReason: "Transmission slipping, check engine light",
    repairVendor: "Hertz Equipment Rental",
    repairETA: "2026-03-10",
    repairStatus: "Awaiting Parts",
    repairEstimate: 4500,
    rentalCar: "Enterprise Box Truck #E-992",
    rentalStart: "2026-03-02",
    rentalEnd: "2026-03-15",
    
    finalDisposition: "In Service",
    dispositionReason: "",
    finalDate: "",
  };

  const handleEdit = (cardId: string) => {
    setEditingCard(cardId);
  };

  const handleSave = () => {
    setEditingCard(null);
  };

  const handleCancel = () => {
    setEditingCard(null);
  };

  return (
    <div className="max-w-[1200px] mx-auto p-6 bg-muted/30 min-h-screen font-sans text-foreground">
      {/* Header Context */}
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold tracking-tight">{vehicle.vehicleNumber}</h1>
            <Badge variant="destructive" className="text-sm px-3 py-0.5 cursor-pointer" onClick={() => handleEdit('status')}>
              {vehicle.truckStatus}
            </Badge>
            <Badge variant="secondary" className="text-sm px-3 py-0.5 cursor-pointer" onClick={() => handleEdit('repair')}>
              {vehicle.repairStatus}
            </Badge>
          </div>
          <p className="text-muted-foreground text-lg">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><FileText className="w-4 h-4" /> VIN: {vehicle.vin}</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> District: {vehicle.district}</span>
            <span className="flex items-center gap-1.5 text-muted-foreground">Last updated: {vehicle.lastUpdated}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column - Forms */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Card: Status & Disposition */}
          <Card className={`border-l-4 ${editingCard === 'status' ? 'border-l-blue-600 shadow-md' : 'border-l-slate-300'}`}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-muted-foreground" /> Status & Disposition
                </CardTitle>
                {editingCard !== 'status' && (
                  <CardDescription className="mt-1">
                    Currently <strong className="text-foreground">{vehicle.truckStatus}</strong> • Disposition: <strong className="text-foreground">{vehicle.finalDisposition}</strong>
                  </CardDescription>
                )}
              </div>
              {editingCard !== 'status' && (
                <Button variant="ghost" size="sm" onClick={() => handleEdit('status')}>
                  <Pencil className="w-4 h-4 mr-2" /> Edit
                </Button>
              )}
            </CardHeader>
            {editingCard === 'status' && (
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Truck Status</Label>
                    <Select defaultValue={vehicle.truckStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="In Service">In Service</SelectItem>
                        <SelectItem value="In Repair">In Repair</SelectItem>
                        <SelectItem value="Out of Service">Out of Service</SelectItem>
                        <SelectItem value="Sold">Sold</SelectItem>
                        <SelectItem value="Stolen">Stolen</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Final Disposition</Label>
                    <Select defaultValue={vehicle.finalDisposition}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Returned">Returned</SelectItem>
                        <SelectItem value="Sold">Sold</SelectItem>
                        <SelectItem value="Totaled">Totaled</SelectItem>
                        <SelectItem value="In Service">In Service</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Disposition Reason</Label>
                    <Textarea placeholder="Enter reason..." defaultValue={vehicle.dispositionReason} />
                  </div>
                  <div className="space-y-2">
                    <Label>Final Date</Label>
                    <Input type="date" defaultValue={vehicle.finalDate} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                  <Button onClick={handleSave}>Save Changes</Button>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Card: Vehicle Info */}
          <Card className={`border-l-4 ${editingCard === 'vehicle' ? 'border-l-blue-600 shadow-md' : 'border-l-slate-300'}`}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Car className="w-5 h-5 text-muted-foreground" /> Vehicle Information
                </CardTitle>
                {editingCard !== 'vehicle' && (
                  <CardDescription className="mt-1">
                    {vehicle.color} • {vehicle.branding} • {vehicle.interior} interior • Runs: {vehicle.vehicleRuns} • Condition: {vehicle.vehicleLooks}
                  </CardDescription>
                )}
              </div>
              {editingCard !== 'vehicle' && (
                <Button variant="ghost" size="sm" onClick={() => handleEdit('vehicle')}>
                  <Pencil className="w-4 h-4 mr-2" /> Edit
                </Button>
              )}
            </CardHeader>
            {editingCard === 'vehicle' && (
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Color</Label>
                    <Select defaultValue={vehicle.color}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="White">White</SelectItem>
                        <SelectItem value="Black">Black</SelectItem>
                        <SelectItem value="Silver">Silver</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Branding</Label>
                    <Select defaultValue={vehicle.branding}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Sears Home Services">Sears Home Services</SelectItem>
                        <SelectItem value="A&E Factory Service">A&E Factory Service</SelectItem>
                        <SelectItem value="Unbranded">Unbranded</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Interior</Label>
                    <Select defaultValue={vehicle.interior}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Vinyl">Vinyl</SelectItem>
                        <SelectItem value="Cloth">Cloth</SelectItem>
                        <SelectItem value="Leather">Leather</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Vehicle Runs?</Label>
                    <Select defaultValue={vehicle.vehicleRuns}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Vehicle Condition</Label>
                    <Select defaultValue={vehicle.vehicleLooks}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Good">Good</SelectItem>
                        <SelectItem value="Fair">Fair</SelectItem>
                        <SelectItem value="Poor">Poor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 flex flex-col justify-center">
                    <div className="flex items-center space-x-2 mt-4">
                      <Switch id="theft-verified" checked={vehicle.theftVerified} />
                      <Label htmlFor="theft-verified">Theft Verified</Label>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                  <Button onClick={handleSave}>Save Changes</Button>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Card: Repair Information */}
          <Card className={`border-l-4 ${editingCard === 'repair' ? 'border-l-blue-600 shadow-md' : 'border-l-slate-300'}`}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-muted-foreground" /> Repair Information
                </CardTitle>
                {editingCard !== 'repair' && (
                  <CardDescription className="mt-1">
                    At {vehicle.repairVendor} • ETA: {vehicle.repairETA} • Est: ${vehicle.repairEstimate.toLocaleString()}
                  </CardDescription>
                )}
              </div>
              {editingCard !== 'repair' && (
                <Button variant="ghost" size="sm" onClick={() => handleEdit('repair')}>
                  <Pencil className="w-4 h-4 mr-2" /> Edit
                </Button>
              )}
            </CardHeader>
            {editingCard === 'repair' && (
              <CardContent className="pt-2">
                <div className="flex items-center space-x-2 mb-6">
                  <Switch id="in-repair" checked={vehicle.inRepair} />
                  <Label htmlFor="in-repair" className="font-semibold">Currently In Repair</Label>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Repair Vendor</Label>
                    <Input defaultValue={vehicle.repairVendor} />
                  </div>
                  <div className="space-y-2">
                    <Label>Repair Date</Label>
                    <Input type="date" defaultValue={vehicle.repairDate} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Repair Reason</Label>
                    <Textarea defaultValue={vehicle.repairReason} />
                  </div>
                  <div className="space-y-2">
                    <Label>Repair Status</Label>
                    <Select defaultValue={vehicle.repairStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Awaiting Estimate">Awaiting Estimate</SelectItem>
                        <SelectItem value="Awaiting Approval">Awaiting Approval</SelectItem>
                        <SelectItem value="Awaiting Parts">Awaiting Parts</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Estimated Completion</Label>
                    <Input type="date" defaultValue={vehicle.repairETA} />
                  </div>
                  <div className="space-y-2">
                    <Label>Repair Estimate ($)</Label>
                    <Input type="number" defaultValue={vehicle.repairEstimate} />
                  </div>
                </div>

                <Separator className="my-6" />
                <h4 className="font-medium mb-4 text-foreground">Rental Information</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Rental Vehicle</Label>
                    <Input defaultValue={vehicle.rentalCar} />
                  </div>
                  <div className="space-y-2">
                    <Label>Rental Start</Label>
                    <Input type="date" defaultValue={vehicle.rentalStart} />
                  </div>
                  <div className="space-y-2">
                    <Label>Rental End</Label>
                    <Input type="date" defaultValue={vehicle.rentalEnd} />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                  <Button onClick={handleSave}>Save Changes</Button>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Card: Location & Keys */}
          <Card className={`border-l-4 ${editingCard === 'location' ? 'border-l-blue-600 shadow-md' : 'border-l-slate-300'}`}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-muted-foreground" /> Location, Keys & Storage
                </CardTitle>
                {editingCard !== 'location' && (
                  <CardDescription className="mt-1">
                    Truck at: {vehicle.currentLocation} • Keys at: {vehicle.keyLocation} • Storage: ${vehicle.storageCost.toFixed(2)}
                  </CardDescription>
                )}
              </div>
              {editingCard !== 'location' && (
                <Button variant="ghost" size="sm" onClick={() => handleEdit('location')}>
                  <Pencil className="w-4 h-4 mr-2" /> Edit
                </Button>
              )}
            </CardHeader>
            {editingCard === 'location' && (
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4 mb-4">
                  <div className="space-y-2">
                    <Label>Current Location</Label>
                    <Input defaultValue={vehicle.currentLocation} />
                  </div>
                  <div className="space-y-2">
                    <Label>Location Zip</Label>
                    <Input defaultValue={vehicle.currentZip} />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4 mb-4">
                  <div className="space-y-2">
                    <Label>Key Location</Label>
                    <Input defaultValue={vehicle.keyLocation} />
                  </div>
                  <div className="space-y-2">
                    <Label>Key Zip</Label>
                    <Input defaultValue={vehicle.keyZip} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Daily Storage Cost ($)</Label>
                    <Input type="number" defaultValue={vehicle.storageCost} />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                  <Button onClick={handleSave}>Save Changes</Button>
                </div>
              </CardContent>
            )}
          </Card>

        </div>

        {/* Right Column - Comments & Actions */}
        <div className="flex flex-col gap-6">
          
          {/* Card: Workflow Actions */}
          <Card className="border-l-4 border-l-slate-300">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-muted-foreground" /> Workflow Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button variant="outline" className="justify-start"><UserPlus className="w-4 h-4 mr-2" /> Assign Technician</Button>
              <Button variant="outline" className="justify-start"><X className="w-4 h-4 mr-2" /> Unassign Technician</Button>
              <Button variant="outline" className="justify-start"><Wrench className="w-4 h-4 mr-2" /> View PO History</Button>
              <Button variant="outline" className="justify-start"><FileText className="w-4 h-4 mr-2" /> View Vehicle History</Button>
              <Button className="justify-start"><AlertTriangle className="w-4 h-4 mr-2" /> Open Ops Review</Button>
            </CardContent>
          </Card>

          {/* Card: Comments (Always Expanded) */}
          <Card className="border-l-4 border-l-blue-600 flex-1 flex flex-col">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground" /> Comments
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col pt-4 gap-4">
              <div className="flex-1 space-y-4">
                <div className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-foreground">Sarah Jenkins</span>
                    <span className="text-muted-foreground text-xs">Mar 3, 2026 09:12 AM</span>
                  </div>
                  <p className="text-muted-foreground bg-muted/30 p-3 rounded-md border border-border">
                    Spoke with Hertz. They are waiting on the transmission part from Ford. ETA is next Tuesday.
                  </p>
                </div>
                <div className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-foreground">Mike Thompson</span>
                    <span className="text-muted-foreground text-xs">Mar 1, 2026 02:45 PM</span>
                  </div>
                  <p className="text-muted-foreground bg-muted/30 p-3 rounded-md border border-border">
                    Vehicle towed to Hertz. Tech provided with Enterprise rental box truck E-992.
                  </p>
                </div>
                <Button variant="link" className="w-full text-primary h-8">View all 3 comments</Button>
              </div>
              
              <Separator />
              
              <div className="space-y-3 mt-1">
                <Textarea placeholder="Add a new comment..." className="min-h-[100px] resize-none focus-visible:ring-ring" />
                <Button className="w-full">Add Comment</Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
