import { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Car, User } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { type InsertVehicle } from "@shared/schema";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

export default function CreateVehicle() {
  const { toast } = useToast();
  const [vehicleForm, setVehicleForm] = useState<Partial<InsertVehicle & { vehicleType: string }>>({
    vin: "",
    vehicleNumber: "",
    modelYear: new Date().getFullYear(),
    makeName: "",
    modelName: "",
    vehicleType: "",
    color: "",
    licensePlate: "",
    licenseState: "",
    branding: "",
    interior: "",
    tuneStatus: "",
    region: "",
    district: "",
    deliveryAddress: "",
    city: "",
    state: "",
    zip: "",
    status: "available"
  });
  
  const [employeeData, setEmployeeData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    manager: "",
    enterpriseId: "",
    region: "",
    district: "",
    requisitionId: "",
    techId: "",
    proposedRouteStartDate: "",
    specialties: [] as string[],
    emergencyContact: "",
    emergencyPhone: ""
  });
  
  const departments = [
    "Human Resources",
    "Sales", 
    "Marketing",
    "Operations",
    "Finance",
    "IT",
    "Customer Service"
  ];

  const specialtyOptions = [
    "Cooking",
    "Microwave",
    "Laundry",
    "Dishwasher",
    "Refrigerator",
    "HA PM Check"
  ];

  const regions = [
    "Northeast",
    "Southeast",
    "Midwest",
    "Southwest",
    "West Coast",
    "Central"
  ];
  
  const managers = [
    { id: "1", name: "Sarah Johnson", department: "Sales" },
    { id: "2", name: "Mike Chen", department: "Operations" },
    { id: "3", name: "Emily Davis", department: "Marketing" },
    { id: "4", name: "Robert Wilson", department: "Finance" }
  ];

  // Apply prefill data from query parameters on component mount
  useEffect(() => {
    const vehicleFields = [
      'vin', 'vehicleNumber', 'modelYear', 'makeName', 'modelName', 'vehicleType',
      'color', 'licensePlate', 'licenseState', 'branding', 'interior', 'tuneStatus',
      'region', 'district', 'deliveryAddress', 'city', 'state', 'zip', 'status'
    ];
    
    const employeeFields = [
      'firstName', 'lastName', 'email', 'phone', 'department', 'position', 'manager',
      'enterpriseId', 'region', 'district', 'requisitionId', 'techId', 'proposedRouteStartDate',
      'emergencyContact', 'emergencyPhone'
    ];

    const validators = {
      email: commonValidators.email,
      phone: commonValidators.phone,
      vehicleNumber: commonValidators.vehicleNumber,
      firstName: commonValidators.employeeName,
      lastName: commonValidators.employeeName,
      proposedRouteStartDate: commonValidators.date,
      modelYear: commonValidators.number,
      emergencyContact: commonValidators.employeeName,
      emergencyPhone: commonValidators.phone
    };

    const vehiclePrefill = getPrefillParams(vehicleFields, validators);
    const employeePrefill = getPrefillParams(employeeFields, validators);

    // Apply vehicle prefill data
    if (Object.keys(vehiclePrefill).length > 0) {
      setVehicleForm(prev => ({
        ...prev,
        ...vehiclePrefill,
        // Convert modelYear to number if provided
        ...(vehiclePrefill.modelYear && { modelYear: parseInt(vehiclePrefill.modelYear as string, 10) || new Date().getFullYear() })
      }));
    }

    // Apply employee prefill data
    if (Object.keys(employeePrefill).length > 0) {
      setEmployeeData(prev => ({
        ...prev,
        ...employeePrefill
      }));
    }
  }, []);

  const handleVehicleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Vehicle Created",
      description: `${vehicleForm.modelYear} ${vehicleForm.makeName} ${vehicleForm.modelName} has been added to the system`,
    });
    setVehicleForm({
      vin: "",
      vehicleNumber: "",
      modelYear: new Date().getFullYear(),
      makeName: "",
      modelName: "",
      vehicleType: "",
      color: "",
      licensePlate: "",
      licenseState: "",
      branding: "",
      interior: "",
      tuneStatus: "",
      region: "",
      district: "",
      deliveryAddress: "",
      city: "",
      state: "",
      zip: "",
      status: "available"
    });
  };


  return (
    <MainContent>
      <TopBar 
        title="Create Vehicle" 
        breadcrumbs={["Home", "Create Vehicle"]}
      />
      
      <main className="p-6">
        <div className="max-w-4xl mx-auto">
          <BackButton href="/" />
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle data-testid="text-vehicle-title">Add New Vehicle</CardTitle>
                  <CardDescription>
                    Enter the vehicle details to add it to your fleet
                  </CardDescription>
                </div>
                <CopyLinkButton
                  variant="icon"
                  preserveQuery={true}
                  preserveHash={true}
                  data-testid="button-copy-form-link"
                  className="shrink-0"
                />
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVehicleSubmit} className="space-y-8">
                {/* Basic Vehicle Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-basic">Basic Vehicle Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vin">VIN *</Label>
                      <Input
                        id="vin"
                        value={vehicleForm.vin || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, vin: e.target.value }))}
                        placeholder="17-character Vehicle Identification Number"
                        maxLength={17}
                        data-testid="input-vin"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicleNumber">Vehicle Number</Label>
                      <Input
                        id="vehicleNumber"
                        value={vehicleForm.vehicleNumber || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                        placeholder="Internal fleet number"
                        data-testid="input-vehicle-number"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="modelYear">Model Year *</Label>
                      <Input
                        id="modelYear"
                        type="number"
                        value={vehicleForm.modelYear || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, modelYear: parseInt(e.target.value) || undefined }))}
                        placeholder={new Date().getFullYear().toString()}
                        min="1990"
                        max={new Date().getFullYear() + 1}
                        data-testid="input-model-year"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="makeName">Make *</Label>
                      <Select 
                        value={vehicleForm.makeName || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, makeName: value }))}
                        data-testid="select-make"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select make" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FORD" data-testid="option-ford">Ford</SelectItem>
                          <SelectItem value="CHEVROLET" data-testid="option-chevrolet">Chevrolet</SelectItem>
                          <SelectItem value="TOYOTA" data-testid="option-toyota">Toyota</SelectItem>
                          <SelectItem value="HONDA" data-testid="option-honda">Honda</SelectItem>
                          <SelectItem value="NISSAN" data-testid="option-nissan">Nissan</SelectItem>
                          <SelectItem value="RAM" data-testid="option-ram">Ram</SelectItem>
                          <SelectItem value="GMC" data-testid="option-gmc">GMC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="modelName">Model *</Label>
                      <Input
                        id="modelName"
                        value={vehicleForm.modelName || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, modelName: e.target.value }))}
                        placeholder="e.g., Econoline, Transit"
                        data-testid="input-model-name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vehicleType">Vehicle Type *</Label>
                    <Select 
                      value={vehicleForm.vehicleType || ""} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, vehicleType: value }))}
                      data-testid="select-vehicle-type"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select vehicle type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sears-fleet" data-testid="option-sears-fleet">Sears Fleet</SelectItem>
                        <SelectItem value="byov" data-testid="option-byov">BYOV (Bring Your Own Vehicle)</SelectItem>
                        <SelectItem value="rental" data-testid="option-rental">Rental</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="color">Color</Label>
                    <Select 
                      value={vehicleForm.color || ""} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, color: value }))}
                      data-testid="select-color"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select color" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Blue" data-testid="option-blue">Blue</SelectItem>
                        <SelectItem value="White" data-testid="option-white">White</SelectItem>
                        <SelectItem value="Red" data-testid="option-red">Red</SelectItem>
                        <SelectItem value="Black" data-testid="option-black">Black</SelectItem>
                        <SelectItem value="Silver" data-testid="option-silver">Silver</SelectItem>
                        <SelectItem value="Gray" data-testid="option-gray">Gray</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Registration & Licensing */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-registration">Registration & Licensing</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="licensePlate">License Plate</Label>
                      <Input
                        id="licensePlate"
                        value={vehicleForm.licensePlate || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, licensePlate: e.target.value }))}
                        placeholder="e.g., ABC1234"
                        data-testid="input-license-plate"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="licenseState">License State</Label>
                      <Input
                        id="licenseState"
                        value={vehicleForm.licenseState || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, licenseState: e.target.value.toUpperCase() }))}
                        placeholder="e.g., NY, CA, TX"
                        maxLength={2}
                        data-testid="input-license-state"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Configuration & Branding */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-configuration">Configuration & Branding</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branding">Branding</Label>
                      <Select 
                        value={vehicleForm.branding || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, branding: value }))}
                        data-testid="select-branding"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select branding" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Sears" data-testid="option-sears">Sears</SelectItem>
                          <SelectItem value="AE Factory Service" data-testid="option-ae-factory">AE Factory Service</SelectItem>
                          <SelectItem value="Unmarked" data-testid="option-unmarked">Unmarked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="interior">Interior Configuration</Label>
                      <Select 
                        value={vehicleForm.interior || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, interior: value }))}
                        data-testid="select-interior"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select interior type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Lawn & Garden" data-testid="option-lawn-garden">Lawn & Garden</SelectItem>
                          <SelectItem value="Utility With Ref Racks" data-testid="option-utility-with-racks">Utility With Ref Racks</SelectItem>
                          <SelectItem value="Utility Without Ref Racks" data-testid="option-utility-without-racks">Utility Without Ref Racks</SelectItem>
                          <SelectItem value="Empty" data-testid="option-empty">Empty</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tuneStatus">Tune Status</Label>
                      <Select 
                        value={vehicleForm.tuneStatus || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, tuneStatus: value }))}
                        data-testid="select-tune-status"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select tune status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Maximum" data-testid="option-maximum">Maximum</SelectItem>
                          <SelectItem value="Medium" data-testid="option-medium">Medium</SelectItem>
                          <SelectItem value="Stock" data-testid="option-stock">Stock</SelectItem>
                          <SelectItem value="NA" data-testid="option-na">N/A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Location & Assignment */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-location">Location & Assignment</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="region">Region</Label>
                      <Input
                        id="region"
                        value={vehicleForm.region || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, region: e.target.value }))}
                        placeholder="e.g., 0000850"
                        data-testid="input-region"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="district">District</Label>
                      <Input
                        id="district"
                        value={vehicleForm.district || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, district: e.target.value }))}
                        placeholder="e.g., 0007670"
                        data-testid="input-district"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="acquisitionAddress">Acquisition Address</Label>
                    <Input
                      id="acquisitionAddress"
                      value={vehicleForm.deliveryAddress || ""}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, deliveryAddress: e.target.value }))}
                      placeholder="Street address"
                      data-testid="input-acquisition-address"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={vehicleForm.city || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, city: e.target.value }))}
                        placeholder="City name"
                        data-testid="input-city"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={vehicleForm.state || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, state: e.target.value.toUpperCase() }))}
                        placeholder="e.g., NY, CA"
                        maxLength={2}
                        data-testid="input-state"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip">Zip Code</Label>
                      <Input
                        id="zip"
                        value={vehicleForm.zip || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, zip: e.target.value }))}
                        placeholder="Zip code"
                        data-testid="input-zip"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Status */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-status">Vehicle Status</h3>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select 
                      value={vehicleForm.status || "available"} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, status: value }))}
                      data-testid="select-status"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available" data-testid="option-available">Available</SelectItem>
                        <SelectItem value="assigned" data-testid="option-assigned">Assigned</SelectItem>
                        <SelectItem value="maintenance" data-testid="option-maintenance">Maintenance</SelectItem>
                        <SelectItem value="retired" data-testid="option-retired">Retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Employee Information Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2" data-testid="text-section-employee">
                    <User className="h-5 w-5" />
                    Employee Assignment Information
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={employeeData.firstName}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder="John"
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={employeeData.lastName}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder="Doe"
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={employeeData.email}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="john.doe@company.com"
                        data-testid="input-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        value={employeeData.phone}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        data-testid="input-phone"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="empRegion">Employee Region</Label>
                      <Select 
                        value={employeeData.region} 
                        onValueChange={(value) => setEmployeeData(prev => ({ ...prev, region: value }))}
                        data-testid="select-emp-region"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee region" />
                        </SelectTrigger>
                        <SelectContent>
                          {regions.map(region => (
                            <SelectItem key={region} value={region} data-testid={`option-${region.toLowerCase().replace(/\s+/g, '-')}`}>
                              {region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="empDistrict">Employee District</Label>
                      <Input
                        id="empDistrict"
                        value={employeeData.district}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, district: e.target.value }))}
                        placeholder="e.g., District 25"
                        data-testid="input-emp-district"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="requisitionId">Requisition ID</Label>
                      <Input
                        id="requisitionId"
                        value={employeeData.requisitionId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, requisitionId: e.target.value }))}
                        placeholder="REQ-2024-001"
                        data-testid="input-requisition-id"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="enterpriseId">Enterprise ID</Label>
                      <Input
                        id="enterpriseId"
                        value={employeeData.enterpriseId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, enterpriseId: e.target.value }))}
                        placeholder="ENT1234"
                        data-testid="input-enterprise-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="techId">Tech ID</Label>
                      <Input
                        id="techId"
                        value={employeeData.techId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, techId: e.target.value }))}
                        placeholder="TECH-001"
                        data-testid="input-tech-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="proposedRouteStartDate">Proposed Route Start Date</Label>
                      <Input
                        id="proposedRouteStartDate"
                        type="date"
                        value={employeeData.proposedRouteStartDate}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, proposedRouteStartDate: e.target.value }))}
                        data-testid="input-proposed-route-start-date"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label>Specialties</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {specialtyOptions.map(specialty => (
                          <div key={specialty} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                              checked={employeeData.specialties.includes(specialty)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setEmployeeData(prev => ({ 
                                    ...prev, 
                                    specialties: [...prev.specialties, specialty]
                                  }));
                                } else {
                                  setEmployeeData(prev => ({ 
                                    ...prev, 
                                    specialties: prev.specialties.filter(s => s !== specialty)
                                  }));
                                }
                              }}
                              data-testid={`checkbox-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                            />
                            <Label 
                              htmlFor={`specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {specialty}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="emergencyContact">Emergency Contact</Label>
                      <Input
                        id="emergencyContact"
                        value={employeeData.emergencyContact}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyContact: e.target.value }))}
                        placeholder="Jane Doe"
                        data-testid="input-emergency-contact"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emergencyPhone">Emergency Phone</Label>
                      <Input
                        id="emergencyPhone"
                        value={employeeData.emergencyPhone}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyPhone: e.target.value }))}
                        placeholder="(555) 987-6543"
                        data-testid="input-emergency-phone"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <Button type="submit" className="w-full" data-testid="button-submit-vehicle">
                  Create Vehicle & Assign Employee
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </MainContent>
  );
}