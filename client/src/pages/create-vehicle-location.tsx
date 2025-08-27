import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Car, MapPin, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function CreateVehicleLocation() {
  const { toast } = useToast();
  const [vehicleForm, setVehicleForm] = useState({
    make: "",
    model: "",
    year: "",
    licensePlate: "",
    vin: "",
    type: "",
    status: "available"
  });

  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    type: "",
    capacity: ""
  });

  const handleVehicleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Vehicle Created",
      description: `${vehicleForm.make} ${vehicleForm.model} has been added to the system`,
    });
    setVehicleForm({
      make: "",
      model: "",
      year: "",
      licensePlate: "",
      vin: "",
      type: "",
      status: "available"
    });
  };

  const handleLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Location Created",
      description: `${locationForm.name} has been added to the system`,
    });
    setLocationForm({
      name: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      type: "",
      capacity: ""
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar 
        title="Create Vehicle/Location" 
        breadcrumbs={["Home", "Create"]}
      />
      
      <main className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Link href="/">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Selection
              </Button>
            </Link>
          </div>

          <Tabs defaultValue="vehicle" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="vehicle" data-testid="tab-vehicle">
                <Car className="h-4 w-4 mr-2" />
                Create Vehicle
              </TabsTrigger>
              <TabsTrigger value="location" data-testid="tab-location">
                <MapPin className="h-4 w-4 mr-2" />
                Create Location
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vehicle">
              <Card>
                <CardHeader>
                  <CardTitle data-testid="text-vehicle-title">Add New Vehicle</CardTitle>
                  <CardDescription>
                    Enter the vehicle details to add it to your fleet
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVehicleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="make">Make *</Label>
                        <Input
                          id="make"
                          value={vehicleForm.make}
                          onChange={(e) => setVehicleForm(prev => ({ ...prev, make: e.target.value }))}
                          placeholder="e.g., Toyota"
                          data-testid="input-make"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="model">Model *</Label>
                        <Input
                          id="model"
                          value={vehicleForm.model}
                          onChange={(e) => setVehicleForm(prev => ({ ...prev, model: e.target.value }))}
                          placeholder="e.g., Camry"
                          data-testid="input-model"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="year">Year *</Label>
                        <Input
                          id="year"
                          value={vehicleForm.year}
                          onChange={(e) => setVehicleForm(prev => ({ ...prev, year: e.target.value }))}
                          placeholder="e.g., 2023"
                          data-testid="input-year"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="type">Vehicle Type *</Label>
                        <Select 
                          value={vehicleForm.type} 
                          onValueChange={(value) => setVehicleForm(prev => ({ ...prev, type: value }))}
                          data-testid="select-vehicle-type"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select vehicle type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sedan" data-testid="option-sedan">Sedan</SelectItem>
                            <SelectItem value="suv" data-testid="option-suv">SUV</SelectItem>
                            <SelectItem value="truck" data-testid="option-truck">Truck</SelectItem>
                            <SelectItem value="van" data-testid="option-van">Van</SelectItem>
                            <SelectItem value="motorcycle" data-testid="option-motorcycle">Motorcycle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="licensePlate">License Plate *</Label>
                        <Input
                          id="licensePlate"
                          value={vehicleForm.licensePlate}
                          onChange={(e) => setVehicleForm(prev => ({ ...prev, licensePlate: e.target.value }))}
                          placeholder="e.g., ABC-1234"
                          data-testid="input-license-plate"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vin">VIN</Label>
                        <Input
                          id="vin"
                          value={vehicleForm.vin}
                          onChange={(e) => setVehicleForm(prev => ({ ...prev, vin: e.target.value }))}
                          placeholder="Vehicle Identification Number"
                          data-testid="input-vin"
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full" data-testid="button-submit-vehicle">
                      Create Vehicle
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="location">
              <Card>
                <CardHeader>
                  <CardTitle data-testid="text-location-title">Add New Location</CardTitle>
                  <CardDescription>
                    Enter the location details to add it to your system
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLocationSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="locationName">Location Name *</Label>
                      <Input
                        id="locationName"
                        value={locationForm.name}
                        onChange={(e) => setLocationForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Downtown Office"
                        data-testid="input-location-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">Address *</Label>
                      <Input
                        id="address"
                        value={locationForm.address}
                        onChange={(e) => setLocationForm(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="Street address"
                        data-testid="input-address"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="city">City *</Label>
                        <Input
                          id="city"
                          value={locationForm.city}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, city: e.target.value }))}
                          placeholder="City"
                          data-testid="input-city"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State *</Label>
                        <Input
                          id="state"
                          value={locationForm.state}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, state: e.target.value }))}
                          placeholder="State"
                          data-testid="input-state"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zipCode">ZIP Code *</Label>
                        <Input
                          id="zipCode"
                          value={locationForm.zipCode}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, zipCode: e.target.value }))}
                          placeholder="ZIP"
                          data-testid="input-zip"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="locationType">Location Type *</Label>
                        <Select 
                          value={locationForm.type} 
                          onValueChange={(value) => setLocationForm(prev => ({ ...prev, type: value }))}
                          data-testid="select-location-type"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select location type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="office" data-testid="option-office">Office</SelectItem>
                            <SelectItem value="warehouse" data-testid="option-warehouse">Warehouse</SelectItem>
                            <SelectItem value="retail" data-testid="option-retail">Retail Store</SelectItem>
                            <SelectItem value="parking" data-testid="option-parking">Parking Facility</SelectItem>
                            <SelectItem value="service" data-testid="option-service">Service Center</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="capacity">Capacity</Label>
                        <Input
                          id="capacity"
                          value={locationForm.capacity}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, capacity: e.target.value }))}
                          placeholder="Number of people/vehicles"
                          data-testid="input-capacity"
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full" data-testid="button-submit-location">
                      Create Location
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}