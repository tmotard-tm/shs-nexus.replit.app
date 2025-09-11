import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { 
  Car, 
  Truck, 
  Map, 
  TrendingUp, 
  CheckCircle, 
  Clock, 
  Users,
  BarChart3,
  Download,
  MapPin
} from 'lucide-react';
import type { Vehicle } from '@shared/schema';
import { FilteredMap } from '@/components/vehicle-map-filters';
import { HawaiiMap } from '@/components/hawaii-map';
import { PuertoRicoMap } from '@/components/puerto-rico-map';
import { activeVehicles, type FleetVehicle } from '@/data/fleetData';
import { useToast } from '@/hooks/use-toast';

export default function AnalyticsBoard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Data fetching hooks
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({ queryKey: ['/api/vehicles'] });

  // Convert vehicles to FleetVehicle format for map compatibility
  const vehiclesAsFleetData: FleetVehicle[] = vehicles.map(vehicle => ({
    vin: vehicle.vin,
    vehicleNumber: vehicle.vehicleNumber || '',
    deliveryDate: vehicle.deliveryDate || '',
    outOfServiceDate: vehicle.outOfServiceDate || '',
    saleDate: vehicle.saleDate || '',
    modelYear: vehicle.modelYear,
    makeName: vehicle.makeName,
    modelName: vehicle.modelName,
    licenseState: vehicle.licenseState || '',
    licensePlate: vehicle.licensePlate || '',
    regRenewalDate: vehicle.registrationRenewalDate || '',
    color: vehicle.color || '',
    branding: vehicle.branding || '',
    interior: vehicle.interior || '',
    tuneStatus: vehicle.tuneStatus || '',
    region: vehicle.region || '',
    district: vehicle.district || '',
    odometerDelivery: vehicle.odometerDelivery || 0,
    deliveryAddress: vehicle.deliveryAddress || '',
    city: vehicle.city || '',
    state: vehicle.state || '',
    zip: vehicle.zip || '',
    mis: vehicle.mis || '',
    remainingBookValue: parseFloat(vehicle.remainingBookValue || '0'),
    leaseEndDate: vehicle.leaseEndDate || ''
  }));

  // Use database data if available, otherwise fallback to static fleet data
  const mapVehicleData = vehicles.length > 0 ? vehiclesAsFleetData : activeVehicles;

  // Seed database mutation
  const seedVehiclesMutation = useMutation({
    mutationFn: () => apiRequest('/api/vehicles/seed', 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      toast({
        title: 'Success',
        description: `Successfully loaded ${activeVehicles.length} vehicles into database`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load sample fleet data',
        variant: 'destructive',
      });
    },
  });

  // Helper functions for vehicle statistics
  const getActiveVehicleCount = () => mapVehicleData.length;
  
  const getAvailableVehicles = () => {
    if (vehicles.length > 0) {
      return vehicles.filter(v => v.status === 'available');
    }
    return mapVehicleData.filter(v => v.branding === 'Kenmore' || v.branding === 'AE Factory Service');
  };
  
  const getAssignedVehicles = () => {
    if (vehicles.length > 0) {
      return vehicles.filter(v => v.status !== 'available');
    }
    return mapVehicleData.filter(v => v.branding === 'Craftsman' || v.branding === 'DieHard');
  };
  
  const getUnassignedVehicles = () => {
    if (vehicles.length > 0) {
      return vehicles.filter(v => v.status === 'available');
    }
    return mapVehicleData.filter(v => v.branding === 'PartsDirect');
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Analytics Dashboard</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Monitor performance, track metrics, and gain insights across all departments and operations.
          </p>
        </div>

        {/* Vehicle Statistics Section */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-foreground">Vehicle Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles")}
              data-testid="card-active-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Car className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-foreground" data-testid="text-vehicles-count">{getActiveVehicleCount()}</p>
                <p className="text-sm text-muted-foreground">Active Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=assigned")}
              data-testid="card-assigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-foreground" data-testid="text-assigned-count">{getAssignedVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Assigned Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=unassigned")}
              data-testid="card-unassigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-foreground" data-testid="text-unassigned-count">{getUnassignedVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Unassigned Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles")}
              data-testid="card-vehicle-summary"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Map className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-foreground" data-testid="text-summary-button">SUMMARY</p>
                <p className="text-sm text-muted-foreground">View All Vehicles</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Load Sample Fleet Data Button - Show when database is empty */}
        {vehicles.length === 0 && (
          <div className="mb-8 text-center">
            <Card className="bg-card border-dashed border-2 border-muted-foreground/25">
              <CardContent className="flex flex-col items-center text-center p-8">
                <Download className="h-12 w-12 mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2 text-foreground">No Vehicle Data Found</h3>
                <p className="text-muted-foreground mb-4 max-w-md">
                  Load sample fleet data to populate the analytics dashboard with {activeVehicles.length} demo vehicles across the US, Hawaii, and Puerto Rico.
                </p>
                <Button 
                  onClick={() => seedVehiclesMutation.mutate()}
                  disabled={seedVehiclesMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-load-sample-fleet"
                >
                  {seedVehiclesMutation.isPending ? 'Loading...' : `Load Sample Fleet (${activeVehicles.length} vehicles)`}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Fleet Map Visualization */}
        {mapVehicleData.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground">Fleet Map Visualization</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{mapVehicleData.length} vehicles displayed</span>
                {vehicles.length === 0 && <span className="text-amber-600">(Sample Data)</span>}
              </div>
            </div>
            
            {/* Main Map */}
            <div className="grid grid-cols-1 gap-6">
              <Card className="bg-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-foreground">Continental United States Fleet Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[600px]">
                    <FilteredMap isOpen={true} />
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Hawaii and Puerto Rico Mini Maps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <Card className="bg-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Hawaii Operations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HawaiiMap filteredVehicles={mapVehicleData} />
                </CardContent>
              </Card>
              
              <Card className="bg-card">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Puerto Rico Operations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PuertoRicoMap filteredVehicles={mapVehicleData} />
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Department Productivity Dashboard */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-foreground">Department Productivity Dashboard</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* NTAO Department */}
            <Card className="bg-card hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-card-foreground">NTAO</CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
                <p className="text-xs text-muted-foreground">Network Technical Assistance</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">23</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">2.4h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">8</span>
                </div>
              </CardContent>
            </Card>

            {/* Assets Department */}
            <Card className="bg-card hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-card-foreground">Assets Management</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <p className="text-xs text-muted-foreground">Asset Tracking & Management</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">31</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">1.8h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">12</span>
                </div>
              </CardContent>
            </Card>

            {/* Inventory Department */}
            <Card className="bg-card hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-card-foreground">Inventory Control</CardTitle>
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                </div>
                <p className="text-xs text-muted-foreground">Stock & Supply Management</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">18</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">3.1h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">6</span>
                </div>
              </CardContent>
            </Card>

            {/* Fleet Department */}
            <Card className="bg-card hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-card-foreground">Fleet Management</CardTitle>
                  <TrendingUp className="h-4 w-4 text-orange-600" />
                </div>
                <p className="text-xs text-muted-foreground">Vehicle Operations & Maintenance</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">27</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">2.7h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">10</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}