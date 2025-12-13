import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { 
  Car, 
  Truck, 
  Map, 
  BarChart3,
  MapPin,
  Loader2
} from 'lucide-react';
import { FilteredMap } from '@/components/vehicle-map-filters';
import { HawaiiMap } from '@/components/hawaii-map';
import { PuertoRicoMap } from '@/components/puerto-rico-map';
import { type FleetVehicle } from '@/data/fleetData';

interface FleetVehiclesResponse {
  success: boolean;
  totalCount: number;
  vehicles: FleetVehicle[];
}

export default function AnalyticsBoard() {
  const [, setLocation] = useLocation();
  
  // Fetch from Holman fleet vehicles API (same as active-vehicles page)
  const { data: apiResponse, isLoading: vehiclesLoading } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
  });

  const allVehicles = apiResponse?.vehicles || [];

  // TPMS assignment determines if vehicle is assigned
  const assignedVehicles = allVehicles.filter(v => v.tpmsAssignedTechId);
  const unassignedVehicles = allVehicles.filter(v => !v.tpmsAssignedTechId);

  // Use Holman fleet data for maps
  const mapVehicleData = allVehicles;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Fleet Distribution</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Monitor performance, track metrics, and gain insights across all departments and operations.
          </p>
        </div>

        {/* Fleet Statistics Section */}
        <div className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles")}
              data-testid="card-active-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Car className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                {vehiclesLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <p className="text-lg font-bold text-foreground" data-testid="text-vehicles-count">{allVehicles.length}</p>
                )}
                <p className="text-sm text-muted-foreground">Active Fleet</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=assigned")}
              data-testid="card-assigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                {vehiclesLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <p className="text-lg font-bold text-foreground" data-testid="text-assigned-count">{assignedVehicles.length}</p>
                )}
                <p className="text-sm text-muted-foreground">Assigned Fleet</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-card cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=unassigned")}
              data-testid="card-unassigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                {vehiclesLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <p className="text-lg font-bold text-foreground" data-testid="text-unassigned-count">{unassignedVehicles.length}</p>
                )}
                <p className="text-sm text-muted-foreground">Unassigned Fleet</p>
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
                <p className="text-sm text-muted-foreground">View All Fleet</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Fleet Map Visualization */}
        {mapVehicleData.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground">Fleet Map Visualization</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{mapVehicleData.length} vehicles displayed</span>
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
                  <div className="h-[400px]">
                    <HawaiiMap key="hawaii-map" filteredVehicles={mapVehicleData} />
                  </div>
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
                  <div className="h-[400px]">
                    <PuertoRicoMap key="pr-map" filteredVehicles={mapVehicleData} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}