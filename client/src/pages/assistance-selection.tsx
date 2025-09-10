import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainContent } from "@/components/layout/main-content";
import { useAuth } from "@/hooks/use-auth";
import { Car, MapPin, Truck, UserPlus, UserMinus, HelpCircle, Settings, Map, ArrowRight, Plus, TrendingUp, Clock, CheckCircle, Users } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";
import { getActiveVehicleCount, getAvailableVehicles, getUnassignedVehicles } from "@/data/fleetData";
import { FilteredMap } from "@/components/vehicle-map-filters";

export default function AssistanceSelection() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isAssignUpdateDialogOpen, setIsAssignUpdateDialogOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const mainWorkflowOptions = [
    {
      id: "create-vehicle-location",
      title: "Create a New Vehicle",
      description: "Add New Vehicles to the System",
      icon: Plus,
      bgColor: "bg-blue-100 dark:bg-blue-900/20",
      iconColor: "text-blue-600 dark:text-blue-400",
      action: () => setLocation("/create-vehicle-location")
    },
    {
      id: "assign-vehicle-location", 
      title: "Assign or Update a Vehicle",
      description: "Assign Existing Vehicles to Users",
      icon: Car,
      bgColor: "bg-green-100 dark:bg-green-900/20",
      iconColor: "text-green-600 dark:text-green-400", 
      action: () => setLocation("/assign-vehicle-location")
    },
    {
      id: "onboard-hire",
      title: "Onboarding",
      description: "Process New Employee Onboarding",
      icon: UserPlus,
      bgColor: "bg-purple-100 dark:bg-purple-900/20",
      iconColor: "text-purple-600 dark:text-purple-400",
      action: () => setLocation("/onboard-hire")
    },
    {
      id: "offboard-vehicle-location",
      title: "Offboarding", 
      description: "Remove Vehicles or Locations from the System",
      icon: UserMinus,
      bgColor: "bg-red-100 dark:bg-red-900/20",
      iconColor: "text-red-600 dark:text-red-400",
      action: () => setLocation("/offboard-vehicle-location")
    },
    {
      id: "other",
      title: "Other",
      description: "Access Additional Tools and Features",
      icon: Settings,
      bgColor: "bg-gray-100 dark:bg-gray-900/20",
      iconColor: "text-gray-600 dark:text-gray-400",
      action: () => setLocation("/queue-management")
    }
  ];

  return (
    <MainContent>
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Settings className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Welcome back, {user?.username}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main 
        className="p-8 relative min-h-screen"
        style={{
          backgroundImage: `url(${searsVanImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Overlay for better content readability */}
        <div className="absolute inset-0 bg-background/80"></div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#007bff', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid="text-selection-title">
              Welcome to Sears Vehicle and Asset Tool
            </h2>
            <p className="text-lg" style={{ color: 'white', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }}>
              What can we help you with today?
            </p>
          </div>



          
          {/* Main Form Modules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Create Vehicle Form Module */}
            <Card 
              className="backdrop-blur-sm border-white/20 hover:shadow-lg transition-all duration-200"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              data-testid="form-create-vehicle"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Car className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-gray-800">Create a New Vehicle</CardTitle>
                    <CardDescription className="text-gray-600">Add New Vehicles to the System</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Vehicle Type</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">License Plate</Label>
                    <Input placeholder="ABC-1234" disabled className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Make/Model</Label>
                    <Input placeholder="Ford Transit" disabled className="h-9" />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Year</Label>
                    <Input placeholder="2024" disabled className="h-9" />
                  </div>
                </div>
                <Button 
                  onClick={() => setLocation("/create-vehicle-location")}
                  className="w-full mt-4"
                  data-testid="button-create-vehicle"
                >
                  Start Vehicle Creation <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Assign Vehicle Form Module */}
            <Card 
              className="backdrop-blur-sm border-white/20 hover:shadow-lg transition-all duration-200"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              data-testid="form-assign-vehicle"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-gray-800">Assign or Update a Vehicle</CardTitle>
                    <CardDescription className="text-gray-600">Assign Existing Vehicles to Users</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Employee</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select employee..." />
                      </SelectTrigger>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Vehicle</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select vehicle..." />
                      </SelectTrigger>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Start Date</Label>
                    <Input type="date" disabled className="h-9" />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Assignment Type</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Permanent" />
                      </SelectTrigger>
                    </Select>
                  </div>
                </div>
                <Button 
                  onClick={() => setIsAssignUpdateDialogOpen(true)}
                  className="w-full mt-4"
                  data-testid="button-assign-vehicle"
                >
                  Start Assignment <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Onboarding Form Module */}
            <Card 
              className="backdrop-blur-sm border-white/20 hover:shadow-lg transition-all duration-200"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              data-testid="form-onboarding"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500 flex items-center justify-center">
                    <UserPlus className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-gray-800">Onboarding</CardTitle>
                    <CardDescription className="text-gray-600">Process New Employee Onboarding</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">First Name</Label>
                    <Input placeholder="John" disabled className="h-9" />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Last Name</Label>
                    <Input placeholder="Doe" disabled className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Department</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select department..." />
                      </SelectTrigger>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Start Date</Label>
                    <Input type="date" disabled className="h-9" />
                  </div>
                </div>
                <Button 
                  onClick={() => setLocation("/onboard-hire")}
                  className="w-full mt-4"
                  data-testid="button-onboarding"
                >
                  Start Onboarding <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Offboarding Form Module */}
            <Card 
              className="backdrop-blur-sm border-white/20 hover:shadow-lg transition-all duration-200"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              data-testid="form-offboarding"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
                    <UserMinus className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-gray-800">Offboarding</CardTitle>
                    <CardDescription className="text-gray-600">Remove Vehicles or Locations from the System</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Employee Name</Label>
                    <Input placeholder="Employee name..." disabled className="h-9" />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">RACF ID</Label>
                    <Input placeholder="RACF123" disabled className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-700">Last Day Worked</Label>
                    <Input type="date" disabled className="h-9" />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-700">Reason</Label>
                    <Select disabled>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select reason..." />
                      </SelectTrigger>
                    </Select>
                  </div>
                </div>
                <Button 
                  onClick={() => setLocation("/offboard-vehicle-location")}
                  className="w-full mt-4"
                  data-testid="button-offboarding"
                >
                  Start Offboarding <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

          </div>

          {/* Additional Tools Section */}
          </div>
      </main>

      {/* Assign/Update Selection Dialog */}
      <Dialog open={isAssignUpdateDialogOpen} onOpenChange={setIsAssignUpdateDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Choose Action</DialogTitle>
              <DialogDescription>
                Would you like to assign a vehicle to an employee or update vehicle information?
              </DialogDescription>
            </DialogHeader>
            
            {/* Vehicle Status Summary */}
            <div className="grid grid-cols-2 gap-4 my-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-green-600" data-testid="text-assigned-vehicles">{getAvailableVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Assigned Vehicles</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-orange-600" data-testid="text-unassigned-vehicles">{getUnassignedVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Unassigned Vehicles</p>
              </div>
            </div>

            <div className="space-y-3">
              <Button 
                className="w-full justify-start" 
                onClick={() => {
                  setIsAssignUpdateDialogOpen(false);
                  setLocation("/assign-vehicle-location");
                }}
                data-testid="button-assign-vehicle"
              >
                <Truck className="mr-2 h-4 w-4" />
                Assign Vehicle to Employee
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start"
                onClick={() => {
                  setIsAssignUpdateDialogOpen(false);
                  setLocation("/update-vehicle");
                }}
                data-testid="button-update-vehicle"
              >
                <Settings className="mr-2 h-4 w-4" />
                Update Vehicle Information
              </Button>
            </div>
          </DialogContent>
      </Dialog>

      {/* Vehicle Map Dialog */}
      {/* Fleet Map Dialog */}
      <Dialog open={isMapOpen} onOpenChange={setIsMapOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Map className="h-5 w-5" />
                TRUCK STATUS - Fleet Vehicle Map
              </DialogTitle>
              <DialogDescription>
                Interactive fleet tracking with real-time status updates • {getActiveVehicleCount()} Active Vehicles
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Status Legend */}
              <div className="flex flex-wrap gap-4 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-sm">Assigned to Tech</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm">In Use</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span className="text-sm">Declined Repair</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-sm">In Repair</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-sm">Spare</span>
                </div>
              </div>
              <FilteredMap isOpen={isMapOpen} />
            </div>
          </DialogContent>
      </Dialog>
    </MainContent>
  );
}