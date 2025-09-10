import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { 
  Car, 
  Truck, 
  Map, 
  TrendingUp, 
  CheckCircle, 
  Clock, 
  Users,
  BarChart3
} from 'lucide-react';
import type { Vehicle } from '@shared/schema';

export default function AnalyticsBoard() {
  const [, setLocation] = useLocation();
  
  // Data fetching hooks
  const { data: vehicles = [] } = useQuery<Vehicle[]>({ queryKey: ['/api/vehicles'] });

  // Helper functions for vehicle statistics
  const getActiveVehicleCount = () => vehicles.length;
  
  const getAvailableVehicles = () => vehicles.filter(v => v.status === 'available');
  
  const getUnassignedVehicles = () => vehicles.filter(v => v.status === 'available');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800">Analytics Dashboard</h1>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Monitor performance, track metrics, and gain insights across all departments and operations.
          </p>
        </div>

        {/* Vehicle Statistics Section */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Vehicle Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card 
              className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles")}
              data-testid="card-active-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Car className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-black" data-testid="text-vehicles-count">{getActiveVehicleCount()}</p>
                <p className="text-sm text-black">Active Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=assigned")}
              data-testid="card-assigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-black" data-testid="text-assigned-count">{getAvailableVehicles().length}</p>
                <p className="text-sm text-black">Assigned Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles?filter=unassigned")}
              data-testid="card-unassigned-vehicles"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-black" data-testid="text-unassigned-count">{getUnassignedVehicles().length}</p>
                <p className="text-sm text-black">Unassigned Vehicles</p>
              </CardContent>
            </Card>
            
            <Card 
              className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
              onClick={() => setLocation("/active-vehicles")}
              data-testid="card-vehicle-summary"
            >
              <CardContent className="flex flex-col items-center text-center p-4">
                <Map className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                <p className="text-lg font-bold text-black" data-testid="text-summary-button">SUMMARY</p>
                <p className="text-sm text-black">View All Vehicles</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Department Productivity Dashboard */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Department Productivity Dashboard</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* NTAO Department */}
            <Card className="bg-white hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-800">NTAO</CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
                <p className="text-xs text-gray-600">Network Technical Assistance</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">23</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">2.4h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">8</span>
                </div>
              </CardContent>
            </Card>

            {/* Assets Department */}
            <Card className="bg-white hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-800">Assets Management</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <p className="text-xs text-gray-600">Asset Tracking & Management</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">31</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">1.8h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">12</span>
                </div>
              </CardContent>
            </Card>

            {/* Inventory Department */}
            <Card className="bg-white hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-800">Inventory Control</CardTitle>
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                </div>
                <p className="text-xs text-gray-600">Stock & Supply Management</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">18</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">3.1h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Active Staff
                  </span>
                  <span className="font-semibold text-sm">6</span>
                </div>
              </CardContent>
            </Card>

            {/* Fleet Department */}
            <Card className="bg-white hover:shadow-lg transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-800">Fleet Management</CardTitle>
                  <TrendingUp className="h-4 w-4 text-orange-600" />
                </div>
                <p className="text-xs text-gray-600">Vehicle Operations & Maintenance</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Completed Today
                  </span>
                  <span className="font-semibold text-sm text-green-600">27</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Avg. Response Time
                  </span>
                  <span className="font-semibold text-sm text-blue-600">2.7h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 flex items-center gap-1">
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