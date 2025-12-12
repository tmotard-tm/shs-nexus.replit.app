import { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Car, Search, Calendar, MapPin, Settings, Package, Wrench, User, Database, Loader2, RefreshCw, CheckCircle, Truck } from "lucide-react";
import { getHolmanStatus, getVehicleOwnership } from "@/lib/vehicle-utils";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";
import { useQuery } from "@tanstack/react-query";

// FleetVehicle type from Holman API
interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  vin: string;
  licensePlate: string;
  licenseState: string;
  makeName: string;
  modelName: string;
  modelYear: number;
  color: string;
  fuelType: string;
  engineSize: string;
  driverName: string;
  driverEmail: string;
  driverPhone: string;
  city: string;
  state: string;
  zip: string;
  address: string;
  region: string;
  division: string;
  district: string;
  inServiceDate: string;
  outOfServiceDate: string;
  odometer: number;
  odometerDate: string;
  regRenewalDate: string;
  deliveryDate: string;
  branding: string;
  interior: string;
  tuneStatus: string;
  holmanTechAssigned?: string;
  holmanTechName?: string;
  tpmsAssignedTechId?: string;
  tpmsAssignedTechName?: string;
  dataSource: string;
  statusCode?: number;
}

interface FleetVehiclesResponse {
  success: boolean;
  vehicles: FleetVehicle[];
  syncStatus: {
    dataMode: string;
    totalVehicles: number;
  };
}

export default function AssignVehicleLocation() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [vehicleAssignment, setVehicleAssignment] = useState({
    employeeId: "",
    vehicleId: "",
    startDate: "",
    endDate: "",
    purpose: ""
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
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [interiorFilter, setInteriorFilter] = useState("all");
  const [targetZipcode, setTargetZipcode] = useState("");
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [supplyOrders, setSupplyOrders] = useState({
    assetsSupplies: false,
    ntaoPartsStock: false
  });
  const [rentalInfo, setRentalInfo] = useState({
    isRental: false,
    rentalVanNumber: "",
    assignmentReason: ""
  });
  
  const [techLookupQuery, setTechLookupQuery] = useState("");
  const [isLookingUpTech, setIsLookingUpTech] = useState(false);
  const [techLookupResult, setTechLookupResult] = useState<any>(null);

  // Fetch vehicles from Holman API
  const { data: apiResponse, isLoading: vehiclesLoading } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Get all vehicles from API response
  const allVehicles = apiResponse?.vehicles || [];
  
  // Unassigned vehicles = no TPMS assignment (TPMS determines assignment status)
  const unassignedVehicles = allVehicles.filter(v => !v.tpmsAssignedTechId);
  
  // Get filter options from actual data
  const getBrandingOptions = () => Array.from(new Set(allVehicles.map(v => v.branding))).filter(Boolean).sort();
  const getInteriorOptions = () => Array.from(new Set(allVehicles.map(v => v.interior))).filter(Boolean).sort();
  const getTuneStatusOptions = () => Array.from(new Set(allVehicles.map(v => v.tuneStatus))).filter(Boolean).sort();

  // Real data from CSV
  const employees = [
    { id: "1", name: "John Doe", department: "Sales", region: "Northeast" },
    { id: "2", name: "Jane Smith", department: "Marketing", region: "Southeast" },
    { id: "3", name: "Mike Johnson", department: "Operations", region: "Midwest" },
    { id: "4", name: "Sarah Williams", department: "Service", region: "West Coast" },
    { id: "5", name: "David Brown", department: "Field Service", region: "Southwest" }
  ];
  
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
    const assignmentFields = ['employeeId', 'vehicleId', 'startDate', 'endDate', 'purpose'];
    const employeeFields = [
      'firstName', 'lastName', 'email', 'phone', 'department', 'position', 'manager',
      'enterpriseId', 'region', 'district', 'requisitionId', 'techId', 'proposedRouteStartDate',
      'emergencyContact', 'emergencyPhone'
    ];
    const rentalFields = ['isRental', 'rentalVanNumber', 'assignmentReason'];
    const searchFields = ['searchQuery', 'brandingFilter', 'interiorFilter', 'targetZipcode'];

    // Define alias mappings for specification compliance
    const assignmentAliases = {
      'employee': 'employeeId',      // specification example: ?employee=55231 maps to employeeId
      'vehicle': 'vehicleId',        // specification example: ?vehicle=TRK001 maps to vehicleId
      'vehicleNumber': 'vehicleId',  // alternative alias for vehicle identification
      'start': 'startDate',          // specification example: ?start=2025-09-15 maps to startDate
      'end': 'endDate',              // alternative alias for end date
      'type': 'purpose'              // specification example: ?type=Permanent maps to purpose
    };

    const assignmentPrefill = getPrefillParams(assignmentFields, undefined, assignmentAliases) as Record<string, string>;
    const employeePrefill = getPrefillParams(employeeFields) as Record<string, string>;
    const rentalPrefill = getPrefillParams(rentalFields) as Record<string, string>;
    const searchPrefill = getPrefillParams(searchFields) as Record<string, string>;

    // Apply assignment prefill data
    if (Object.keys(assignmentPrefill).length > 0) {
      const processedData: any = {};
      if (assignmentPrefill.startDate) processedData.startDate = commonValidators.date(assignmentPrefill.startDate);
      if (assignmentPrefill.endDate) processedData.endDate = commonValidators.date(assignmentPrefill.endDate);
      Object.keys(assignmentPrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && assignmentPrefill[key]) {
          processedData[key] = assignmentPrefill[key];
        }
      });
      setVehicleAssignment(prev => ({ ...prev, ...processedData }));
    }

    // Apply employee prefill data
    if (Object.keys(employeePrefill).length > 0) {
      const processedData: any = {};
      if (employeePrefill.email) processedData.email = commonValidators.email(employeePrefill.email);
      if (employeePrefill.phone) processedData.phone = commonValidators.phone(employeePrefill.phone);
      if (employeePrefill.firstName) processedData.firstName = commonValidators.employeeName(employeePrefill.firstName);
      if (employeePrefill.lastName) processedData.lastName = commonValidators.employeeName(employeePrefill.lastName);
      if (employeePrefill.proposedRouteStartDate) processedData.proposedRouteStartDate = commonValidators.date(employeePrefill.proposedRouteStartDate);
      if (employeePrefill.emergencyContact) processedData.emergencyContact = commonValidators.employeeName(employeePrefill.emergencyContact);
      if (employeePrefill.emergencyPhone) processedData.emergencyPhone = commonValidators.phone(employeePrefill.emergencyPhone);
      Object.keys(employeePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && employeePrefill[key]) {
          processedData[key] = employeePrefill[key];
        }
      });
      setEmployeeData(prev => ({ ...prev, ...processedData }));
    }

    // Apply rental prefill data
    if (Object.keys(rentalPrefill).length > 0) {
      const processedData: any = {};
      if (rentalPrefill.rentalVanNumber) processedData.rentalVanNumber = commonValidators.vehicleNumber(rentalPrefill.rentalVanNumber);
      if (rentalPrefill.isRental) processedData.isRental = rentalPrefill.isRental === 'true';
      Object.keys(rentalPrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && rentalPrefill[key]) {
          processedData[key] = rentalPrefill[key];
        }
      });
      setRentalInfo(prev => ({ ...prev, ...processedData }));
    }

    // Apply search prefill data
    if (searchPrefill.searchQuery) setSearchQuery(searchPrefill.searchQuery);
    if (searchPrefill.brandingFilter) setBrandingFilter(searchPrefill.brandingFilter);
    if (searchPrefill.interiorFilter) setInteriorFilter(searchPrefill.interiorFilter);
    if (searchPrefill.targetZipcode) setTargetZipcode(searchPrefill.targetZipcode);
  }, []);

  // Simple distance calculation based on zip code numerical difference
  // This is a basic approximation - can be enhanced with proper geocoding later
  const calculateZipDistance = (zip1: string, zip2: string): number => {
    if (!zip1 || !zip2) return 9999;
    const num1 = parseInt(zip1.replace(/\D/g, ''), 10);
    const num2 = parseInt(zip2.replace(/\D/g, ''), 10);
    if (isNaN(num1) || isNaN(num2)) return 9999;
    return Math.abs(num1 - num2);
  };

  let filteredVehicles = unassignedVehicles.filter(vehicle => {
    const matchesSearch = !searchQuery || 
      vehicle.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBranding = brandingFilter === "all" || vehicle.branding === brandingFilter;
    const matchesInterior = interiorFilter === "all" || vehicle.interior === interiorFilter;
    
    return matchesSearch && matchesBranding && matchesInterior;
  });

  // Sort by distance to target zipcode if provided
  if (targetZipcode.trim()) {
    filteredVehicles = filteredVehicles
      .map(vehicle => ({
        ...vehicle,
        distanceScore: calculateZipDistance(vehicle.zip, targetZipcode.trim())
      }))
      .sort((a, b) => a.distanceScore - b.distanceScore);
  }


  const handleVehicleAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const vehicle = unassignedVehicles.find(veh => veh.vin === vehicleAssignment.vehicleId);
    
    const isLookupEmployee = vehicleAssignment.employeeId.startsWith('lookup-');
    const staticEmployee = !isLookupEmployee ? employees.find(emp => emp.id === vehicleAssignment.employeeId) : null;
    
    const employeeName = isLookupEmployee 
      ? `${employeeData.firstName} ${employeeData.lastName}`.trim() || employeeData.enterpriseId || 'Unknown'
      : staticEmployee?.name;
    
    if ((!isLookupEmployee && !staticEmployee) || !vehicle) {
      toast({
        title: "Error",
        description: "Please select both an employee and a vehicle",
        variant: "destructive"
      });
      return;
    }
    
    const orderMessages = [];
    if (supplyOrders.assetsSupplies) {
      orderMessages.push("Assets & Supplies order triggered for Day 1 supplies");
    }
    if (supplyOrders.ntaoPartsStock) {
      orderMessages.push("NTAO — National Truck Assortment order triggered for parts stock");
    }
    
    const description = orderMessages.length > 0 
      ? `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (${vehicle.licensePlate}) assigned to ${employeeName}. ${orderMessages.join(". ")}.`
      : `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (${vehicle.licensePlate}) has been assigned to ${employeeName}`;
    
    const employeePayload = isLookupEmployee 
      ? {
          id: vehicleAssignment.employeeId,
          name: employeeName,
          department: employeeData.department || 'Field Service',
          region: employeeData.region,
          enterpriseId: employeeData.enterpriseId,
          techId: employeeData.techId,
          district: employeeData.district,
          specialties: employeeData.specialties,
          dataSource: 'system_lookup'
        }
      : {
          id: staticEmployee!.id,
          name: staticEmployee!.name,
          department: staticEmployee!.department,
          region: staticEmployee!.region,
          enterpriseId: employeeData.enterpriseId,
          specialties: employeeData.specialties
        };
    
    try {
      await apiRequest("POST", "/api/queue", {
        workflowType: "vehicle_assignment",
        title: `Assign Vehicle to ${employeeName}`,
        description: `Assign ${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (${vehicle.licensePlate}) to ${employeeName}. ${orderMessages.length > 0 ? `Orders: ${orderMessages.join(", ")}.` : ""}`,
        priority: "medium",
        requesterId: user?.id || "anonymous",
        submitterInfo: user ? {
          id: user.id,
          name: user.username || user.email,
          email: user.email
        } : {
          id: "anonymous",
          name: "Anonymous User",
          email: null
        },
        data: JSON.stringify({
          employee: employeePayload,
          vehicle: {
            vin: vehicle.vin,
            year: vehicle.modelYear,
            make: vehicle.makeName,
            model: vehicle.modelName,
            licensePlate: vehicle.licensePlate,
            location: `${vehicle.city}, ${vehicle.state}`
          },
          supplyOrders,
          orderMessages,
          assignmentDate: new Date().toISOString(),
          submitter: user ? {
            name: user.username || user.email || "Unknown User",
            submittedAt: new Date().toISOString()
          } : {
            name: "Anonymous User",
            submittedAt: new Date().toISOString()
          }
        })
      });
    } catch (queueError) {
      console.error('Error creating queue item:', queueError);
    }

    toast({
      title: "Vehicle Assigned",
      description,
    });
    
    setVehicleAssignment({
      employeeId: "",
      vehicleId: "",
      startDate: "",
      endDate: "",
      purpose: ""
    });
    setSelectedVehicle(null);
    setIsAssignmentDialogOpen(false);
    setSupplyOrders({ assetsSupplies: false, ntaoPartsStock: false });
    setRentalInfo({ isRental: false, rentalVanNumber: "", assignmentReason: "" });
    setTechLookupQuery("");
    setTechLookupResult(null);
  };

  const handleVehicleSelect = (vehicleVin: string) => {
    const vehicle = unassignedVehicles.find(v => v.vin === vehicleVin);
    setSelectedVehicle(vehicle || null);
    setVehicleAssignment(prev => ({ ...prev, vehicleId: vehicleVin }));
    setIsAssignmentDialogOpen(true);
  };

  const handleTechLookup = async () => {
    if (!techLookupQuery.trim()) return;
    
    setIsLookingUpTech(true);
    setTechLookupResult(null);
    
    try {
      const response = await fetch(`/api/vehicle-assignments/tech/${techLookupQuery.trim().toUpperCase()}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        setTechLookupResult(null);
        if (response.status === 404) {
          toast({
            title: "Technician Not Found",
            description: `No technician found with Enterprise ID: ${techLookupQuery}`,
            variant: "destructive",
          });
        } else if (response.status === 401) {
          toast({
            title: "Authentication Required",
            description: "Please log in to search for technicians",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Lookup Failed",
            description: `Server error (${response.status}). Please try again.`,
            variant: "destructive",
          });
        }
        return;
      }
      
      const result = await response.json();
      if (result.success && result.data) {
        const data = result.data;
        const snowflake = data.snowflakeData || {};
        const tpms = data.tpmsAssignment || {};
        
        setTechLookupResult({
          ...data,
          dataSources: {
            snowflake: !!data.snowflakeData,
            tpms: !!data.tpmsAssignment,
            holman: !!data.holmanVehicle,
          }
        });
        
        const nameParts = (snowflake.techName || data.techName || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        setEmployeeData(prev => ({
          ...prev,
          firstName: firstName || prev.firstName,
          lastName: lastName || prev.lastName,
          enterpriseId: snowflake.techRacfid || tpms.enterpriseId || data.techRacfid || prev.enterpriseId,
          techId: snowflake.techId || tpms.techId || prev.techId,
          email: snowflake.email || prev.email,
          phone: snowflake.contactNo || prev.phone,
          district: snowflake.districtNo || tpms.districtNo || prev.district,
          region: snowflake.region || tpms.region || prev.region,
        }));
        
        const dynamicEmployeeId = `lookup-${snowflake.techRacfid || tpms.enterpriseId || data.techRacfid}`;
        setVehicleAssignment(prev => ({ ...prev, employeeId: dynamicEmployeeId }));
        
        toast({
          title: "Technician Data Loaded",
          description: `Loaded data for ${snowflake.techName || data.techName || data.techRacfid}`,
        });
      }
    } catch (error: any) {
      console.error('Tech lookup error:', error);
      setTechLookupResult(null);
      toast({
        title: "Lookup Failed",
        description: error.message || "Failed to lookup technician data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUpTech(false);
    }
  };


  return (
    <MainContent>
      <TopBar 
        title="Assign Vehicle" 
        breadcrumbs={["Home", "Assign Vehicle"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            {/* Vehicle Search and Filters */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle>Search Available Vehicles</CardTitle>
                      <CardDescription>
                        Search by VIN, vehicle number, license plate, or make/model
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
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                      <Input
                        placeholder="Search vehicles..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                        data-testid="input-search-vehicles"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sort By Distance To Zipcode</Label>
                      <Input
                        placeholder="Enter zipcode (e.g. 10001)"
                        value={targetZipcode}
                        onChange={(e) => setTargetZipcode(e.target.value)}
                        data-testid="input-target-zipcode"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Branding</Label>
                      <Select value={brandingFilter} onValueChange={setBrandingFilter} data-testid="select-branding-filter">
                        <SelectTrigger>
                          <SelectValue placeholder="All branding" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All branding</SelectItem>
                          {getBrandingOptions().map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Interior</Label>
                      <Select value={interiorFilter} onValueChange={setInteriorFilter} data-testid="select-interior-filter">
                        <SelectTrigger>
                          <SelectValue placeholder="All interiors" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All interiors</SelectItem>
                          {getInteriorOptions().map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Status Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Vehicle Assignment Overview</CardTitle>
                  <CardDescription>
                    Current fleet assignment status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                      <p className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-assigned-vehicles-count">{allVehicles.filter(v => v.tpmsAssignedTechId).length}</p>
                      <p className="text-sm text-green-700 dark:text-green-300">Assigned Vehicles</p>
                      <p className="text-xs text-muted-foreground mt-1">Currently in use (TPMS)</p>
                    </div>
                    <div className="text-center p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                      <p className="text-3xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-unassigned-vehicles-count">{unassignedVehicles.length}</p>
                      <p className="text-sm text-orange-700 dark:text-orange-300">Unassigned Vehicles</p>
                      <p className="text-xs text-muted-foreground mt-1">Available for assignment</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle List */}
              <div className="grid gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">
                    Unassigned Vehicles ({filteredVehicles.length})
                    {targetZipcode.trim() && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        - Sorted by distance to {targetZipcode}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-muted-foreground">Only showing vehicles available for assignment</p>
                </div>
                
                <div className="grid gap-4">
                  {filteredVehicles.map((vehicle) => (
                    <Card 
                      key={vehicle.vin}
                      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${selectedVehicle?.vin === vehicle.vin ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => handleVehicleSelect(vehicle.vin)}
                      data-testid={`card-vehicle-${vehicle.vin}`}
                    >
                      <CardContent className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Car className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">Vehicle #{vehicle.vehicleNumber}</p>
                            <p className="text-sm text-muted-foreground">VIN: {vehicle.vin}</p>
                            
                            {/* Holman Status & Ownership Badges */}
                            <div className="flex items-center gap-2 mt-2">
                              <span 
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getHolmanStatus(vehicle.statusCode).bgColor} ${getHolmanStatus(vehicle.statusCode).color} border ${getHolmanStatus(vehicle.statusCode).borderColor}`}
                                data-testid={`holman-status-${vehicle.vin}`}
                              >
                                {getHolmanStatus(vehicle.statusCode).label}
                              </span>
                              <span 
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getVehicleOwnership(vehicle.vehicleNumber).bgColor} ${getVehicleOwnership(vehicle.vehicleNumber).color} border ${getVehicleOwnership(vehicle.vehicleNumber).borderColor}`}
                                data-testid={`ownership-${vehicle.vin}`}
                              >
                                {getVehicleOwnership(vehicle.vehicleNumber).type === 'BYOV' ? (
                                  <><Truck className="h-3 w-3 mr-1" />BYOV</>
                                ) : (
                                  <>Fleet</>
                                )}
                              </span>
                            </div>
                            
                            {targetZipcode.trim() && 'distanceScore' in vehicle && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                  Distance Score: {(vehicle as any).distanceScore}
                                </span>
                              </div>
                            )}
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <img src={licensePlateIcon} alt="License plate" className="h-6 w-8 object-contain" />
                              <span className="text-sm">{vehicle.licensePlate}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{vehicle.licenseState}</p>
                            <p className="text-xs text-muted-foreground">Color: {vehicle.color}</p>
                          </div>
                          
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{vehicle.branding}</p>
                            <p className="text-xs text-muted-foreground">{vehicle.interior}</p>
                            <p className="text-xs text-muted-foreground">Tune: {vehicle.tuneStatus}</p>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{vehicle.city}, {vehicle.state} {vehicle.zip}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Region: {vehicle.region}</p>
                            <p className="text-xs text-muted-foreground">District: {vehicle.district}</p>
                          </div>
                        </div>
                        
                        {vehicle.odometer > 0 && (
                          <div className="mt-2 pt-2 border-t">
                            <p className="text-xs text-muted-foreground">
                              Odometer: {vehicle.odometer.toLocaleString()} miles
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  
                  {filteredVehicles.length === 0 && (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No vehicles found matching your criteria</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Assignment Dialog */}
          <Dialog open={isAssignmentDialogOpen} onOpenChange={setIsAssignmentDialogOpen}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Vehicle Assignment & Employee Route details
                </DialogTitle>
                <DialogDescription>
                  Assign the selected vehicle and manage complete employee information
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => {
                handleVehicleAssignment(e);
              }} className="space-y-6">
                {/* Basic Assignment Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dialog-employeeId">Employee *</Label>
                    <Select 
                      value={vehicleAssignment.employeeId} 
                      onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, employeeId: value }))}
                      data-testid="dialog-select-employee"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee or use lookup below" />
                      </SelectTrigger>
                      <SelectContent>
                        {techLookupResult && (
                          <SelectItem 
                            key={`lookup-${techLookupResult.techRacfid || techLookupResult.snowflakeData?.techRacfid}`} 
                            value={`lookup-${techLookupResult.techRacfid || techLookupResult.snowflakeData?.techRacfid}`}
                            data-testid="dialog-option-employee-lookup"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                              <span>{techLookupResult.snowflakeData?.techName || techLookupResult.techName || techLookupResult.techRacfid}</span>
                              <span className="text-xs text-green-600">(from system lookup)</span>
                            </div>
                          </SelectItem>
                        )}
                        {employees.map(employee => (
                          <SelectItem key={employee.id} value={employee.id} data-testid={`dialog-option-employee-${employee.id}`}>
                            {employee.name}
                            <span className="text-muted-foreground ml-2">({employee.department} - {employee.region})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {techLookupResult && vehicleAssignment.employeeId.startsWith('lookup-') && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Using data from system lookup
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dialog-purpose">Assignment Purpose</Label>
                    <Select 
                      value={vehicleAssignment.purpose} 
                      onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, purpose: value }))}
                      data-testid="dialog-select-purpose"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="field_service" data-testid="dialog-option-field-service">Field Service</SelectItem>
                        <SelectItem value="delivery" data-testid="dialog-option-delivery">Acquisition/Transport</SelectItem>
                        <SelectItem value="maintenance" data-testid="dialog-option-maintenance">Maintenance Work</SelectItem>
                        <SelectItem value="business_travel" data-testid="dialog-option-business-travel">Business Travel</SelectItem>
                        <SelectItem value="daily_operations" data-testid="dialog-option-daily-operations">Daily Operations</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dialog-startDate">Start Date *</Label>
                    <Input
                      id="dialog-startDate"
                      type="date"
                      value={vehicleAssignment.startDate}
                      onChange={(e) => setVehicleAssignment(prev => ({ ...prev, startDate: e.target.value }))}
                      data-testid="dialog-input-start-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dialog-endDate">End Date</Label>
                    <Input
                      id="dialog-endDate"
                      type="date"
                      value={vehicleAssignment.endDate}
                      onChange={(e) => setVehicleAssignment(prev => ({ ...prev, endDate: e.target.value }))}
                      data-testid="dialog-input-end-date"
                    />
                  </div>
                </div>

                {/* Employee Information Section */}
                <div className="border-t pt-6">
                  <h4 className="font-semibold mb-4 text-lg">Employee Information</h4>
                  
                  {/* Tech Lookup Section */}
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <Database className="h-5 w-5 text-blue-600" />
                      <span className="font-medium text-blue-900 dark:text-blue-100">Lookup Employee from System</span>
                    </div>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                      Enter an Enterprise ID to auto-populate employee data from Snowflake, TPMS, and Holman
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Enter Enterprise ID (e.g., JSMITH01)..."
                          value={techLookupQuery}
                          onChange={(e) => setTechLookupQuery(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleTechLookup())}
                          className="pl-9"
                          data-testid="input-tech-lookup"
                        />
                      </div>
                      <Button 
                        type="button" 
                        onClick={handleTechLookup} 
                        disabled={isLookingUpTech || !techLookupQuery.trim()}
                        data-testid="button-tech-lookup"
                      >
                        {isLookingUpTech ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                        <span className="ml-2">{isLookingUpTech ? 'Looking up...' : 'Lookup'}</span>
                      </Button>
                    </div>
                    
                    {techLookupResult && (
                      <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm font-medium">Data loaded from system</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Name:</span>{' '}
                            <span className="font-medium">{techLookupResult.techName || '-'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Enterprise ID:</span>{' '}
                            <span className="font-mono">{techLookupResult.techRacfid || '-'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Current Truck:</span>{' '}
                            <span className="font-mono">{techLookupResult.truckNo || 'None assigned'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">District:</span>{' '}
                            <span>{techLookupResult.districtNo || '-'}</span>
                          </div>
                        </div>
                        {techLookupResult.dataSources && (
                          <div className="mt-2 flex gap-1 items-center text-xs text-muted-foreground">
                            <span>Data from:</span>
                            {techLookupResult.dataSources.snowflake && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded">Snowflake</span>}
                            {techLookupResult.dataSources.tpms && <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded">TPMS</span>}
                            {techLookupResult.dataSources.holman && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded">Holman</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-firstName">First Name *</Label>
                      <Input
                        id="dialog-firstName"
                        value={employeeData.firstName}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder="John"
                        data-testid="dialog-input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-lastName">Last Name *</Label>
                      <Input
                        id="dialog-lastName"
                        value={employeeData.lastName}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder="Doe"
                        data-testid="dialog-input-last-name"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-email">Email *</Label>
                      <Input
                        id="dialog-email"
                        type="email"
                        value={employeeData.email}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="john.doe@company.com"
                        data-testid="dialog-input-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-phone">Phone</Label>
                      <Input
                        id="dialog-phone"
                        value={employeeData.phone}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        data-testid="dialog-input-phone"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-department">Department *</Label>
                      <Select 
                        value={employeeData.department} 
                        onValueChange={(value) => setEmployeeData(prev => ({ ...prev, department: value }))}
                        data-testid="dialog-select-department"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          {departments.map(dept => (
                            <SelectItem key={dept} value={dept} data-testid={`dialog-option-${dept.toLowerCase().replace(/\s+/g, '-')}`}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-position">Position *</Label>
                      <Input
                        id="dialog-position"
                        value={employeeData.position}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, position: e.target.value }))}
                        placeholder="e.g., Service Employee"
                        data-testid="dialog-input-position"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-manager">Manager *</Label>
                      <Input
                        value={employeeData.manager}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, manager: e.target.value }))}
                        placeholder="Enter manager name"
                        data-testid="dialog-input-manager"
                      />
                    </div>
                  </div>

                  {/* Additional Employee Information */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-region">Region *</Label>
                      <Select 
                        value={employeeData.region} 
                        onValueChange={(value) => setEmployeeData(prev => ({ ...prev, region: value }))}
                        data-testid="dialog-select-region"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select region" />
                        </SelectTrigger>
                        <SelectContent>
                          {regions.map(region => (
                            <SelectItem key={region} value={region} data-testid={`dialog-option-${region.toLowerCase().replace(/\s+/g, '-')}`}>
                              {region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-district">District *</Label>
                      <Input
                        id="dialog-district"
                        value={employeeData.district}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, district: e.target.value }))}
                        placeholder="e.g., District 25"
                        data-testid="dialog-input-district"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-requisitionId">Requisition ID *</Label>
                      <Input
                        id="dialog-requisitionId"
                        value={employeeData.requisitionId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, requisitionId: e.target.value }))}
                        placeholder="REQ-2024-001"
                        data-testid="dialog-input-requisition-id"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-enterpriseId">Enterprise ID *</Label>
                      <Input
                        id="dialog-enterpriseId"
                        value={employeeData.enterpriseId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, enterpriseId: e.target.value }))}
                        placeholder="ENT1234"
                        data-testid="dialog-input-enterprise-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-techId">Employee ID</Label>
                      <Input
                        id="dialog-techId"
                        value={employeeData.techId}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, techId: e.target.value }))}
                        placeholder="EMP-001"
                        data-testid="dialog-input-tech-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-proposedRouteStartDate">Proposed Route Start Date</Label>
                      <Input
                        id="dialog-proposedRouteStartDate"
                        type="date"
                        value={employeeData.proposedRouteStartDate}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, proposedRouteStartDate: e.target.value }))}
                        data-testid="dialog-input-proposed-route-start-date"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label>Specialties *</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {specialtyOptions.map(specialty => (
                          <div key={specialty} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`dialog-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
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
                              data-testid={`dialog-checkbox-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                            />
                            <Label 
                              htmlFor={`dialog-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
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
                      <Label htmlFor="dialog-emergencyContact">Emergency Contact</Label>
                      <Input
                        id="dialog-emergencyContact"
                        value={employeeData.emergencyContact}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyContact: e.target.value }))}
                        placeholder="Jane Doe"
                        data-testid="dialog-input-emergency-contact"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-emergencyPhone">Emergency Phone</Label>
                      <Input
                        id="dialog-emergencyPhone"
                        value={employeeData.emergencyPhone}
                        onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyPhone: e.target.value }))}
                        placeholder="(555) 987-6543"
                        data-testid="dialog-input-emergency-phone"
                      />
                    </div>
                  </div>
                </div>

                {selectedVehicle && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="font-semibold text-sm mb-1">Selected Vehicle:</p>
                    <p className="text-sm">{selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedVehicle.licensePlate} | VIN: {selectedVehicle.vin}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="dialog-startDate">Start Date *</Label>
                  <Input
                    id="dialog-startDate"
                    type="date"
                    value={vehicleAssignment.startDate}
                    onChange={(e) => setVehicleAssignment(prev => ({ ...prev, startDate: e.target.value }))}
                    data-testid="dialog-input-start-date"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="dialog-endDate">End Date</Label>
                  <Input
                    id="dialog-endDate"
                    type="date"
                    value={vehicleAssignment.endDate}
                    onChange={(e) => setVehicleAssignment(prev => ({ ...prev, endDate: e.target.value }))}
                    data-testid="dialog-input-end-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dialog-purpose">Purpose</Label>
                  <Select 
                    value={vehicleAssignment.purpose} 
                    onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, purpose: value }))}
                    data-testid="dialog-select-purpose"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="field_service" data-testid="dialog-option-field-service">Field Service</SelectItem>
                      <SelectItem value="delivery" data-testid="dialog-option-delivery">Acquisition/Transport</SelectItem>
                      <SelectItem value="maintenance" data-testid="dialog-option-maintenance">Maintenance Work</SelectItem>
                      <SelectItem value="business_travel" data-testid="dialog-option-business-travel">Business Travel</SelectItem>
                      <SelectItem value="daily_operations" data-testid="dialog-option-daily-operations">Daily Operations</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Rental Vehicle Section */}
                <div className="border-t pt-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <input 
                      type="checkbox" 
                      id="dialog-is-rental"
                      checked={rentalInfo.isRental}
                      onChange={(e) => setRentalInfo(prev => ({ ...prev, isRental: e.target.checked }))}
                      className="rounded border-gray-300"
                      data-testid="dialog-checkbox-is-rental"
                    />
                    <Label htmlFor="dialog-is-rental" className="font-semibold">
                      This is a rental vehicle assignment
                    </Label>
                  </div>
                  
                  {rentalInfo.isRental && (
                    <div className="space-y-3 ml-6">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-rental-van-number">Rental Van Number</Label>
                        <Input
                          id="dialog-rental-van-number"
                          value={rentalInfo.rentalVanNumber}
                          onChange={(e) => setRentalInfo(prev => ({ ...prev, rentalVanNumber: e.target.value }))}
                          placeholder="Enter rental van number"
                          data-testid="dialog-input-rental-van-number"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-assignment-reason">Reason for Rental Assignment</Label>
                        <Select 
                          value={rentalInfo.assignmentReason} 
                          onValueChange={(value) => setRentalInfo(prev => ({ ...prev, assignmentReason: value }))}
                          data-testid="dialog-select-assignment-reason"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select reason for rental assignment" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="truck-breakdown-at-shop" data-testid="dialog-option-truck-breakdown">Truck Breakdown - At Shop</SelectItem>
                            <SelectItem value="new-hire-temp-truck" data-testid="dialog-option-new-hire-temp">New Hire - Temp Truck</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Supply Order Triggers */}
                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Day 1 Supply Orders
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <input 
                        type="checkbox" 
                        id="dialog-assets-supplies"
                        checked={supplyOrders.assetsSupplies}
                        onChange={(e) => setSupplyOrders(prev => ({ ...prev, assetsSupplies: e.target.checked }))}
                        className="rounded border-gray-300"
                        data-testid="dialog-checkbox-assets-supplies"
                      />
                      <Label htmlFor="dialog-assets-supplies" className="flex items-center gap-2 text-sm">
                        <Package className="h-4 w-4" />
                        Trigger Assets & Supplies Order
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3">
                      <input 
                        type="checkbox" 
                        id="dialog-ntao-parts"
                        checked={supplyOrders.ntaoPartsStock}
                        onChange={(e) => setSupplyOrders(prev => ({ ...prev, ntaoPartsStock: e.target.checked }))}
                        className="rounded border-gray-300"
                        data-testid="dialog-checkbox-ntao-parts"
                      />
                      <Label htmlFor="dialog-ntao-parts" className="flex items-center gap-2 text-sm">
                        <Wrench className="h-4 w-4" />
                        Trigger NTAO — National Truck Assortment Order for Parts Stock
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="flex-1" 
                    onClick={() => setIsAssignmentDialogOpen(false)}
                    data-testid="dialog-button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1" 
                    disabled={!vehicleAssignment.employeeId || !vehicleAssignment.vehicleId || !vehicleAssignment.startDate}
                    data-testid="dialog-button-assign-vehicle"
                  >
                    Assign Vehicle
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </MainContent>
  );
}