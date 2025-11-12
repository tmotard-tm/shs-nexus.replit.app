import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { RefreshCw, Database, Users, Wrench, Gauge, CheckCircle, XCircle, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export default function HolmanIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  
  const [sortConfig, setSortConfig] = useState<{column: string, direction: 'asc' | 'desc'} | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  
  const [vehiclesParams, setVehiclesParams] = useState({
    lesseeCodes: "2B56",
    statusCodes: "",
    soldDateCode: "5",
    pageNumber: 1,
    pageSize: 1000
  });
  
  const [contactsParams, setContactsParams] = useState({
    lesseeCodes: "2B56",
    pageNumber: 1,
    pageSize: 1000
  });
  
  const [maintenanceParams, setMaintenanceParams] = useState({
    lesseeCodes: "2B56",
    poDateCode: "1",
    pageNumber: 1,
    pageSize: 1000
  });
  
  const [odometerParams, setOdometerParams] = useState({
    lesseeCodes: "2B56",
    odometerHistoryDateCode: "1",
    pageNumber: 1,
    pageSize: 1000
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/holman/test");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Test Failed",
        description: error.message || "Failed to test Holman API connection",
        variant: "destructive",
      });
    },
  });

  const buildVehiclesUrl = () => {
    const params: Record<string, string> = {
      pageNumber: vehiclesParams.pageNumber.toString(),
      pageSize: vehiclesParams.pageSize.toString()
    };
    if (vehiclesParams.lesseeCodes) params.lesseeCode = vehiclesParams.lesseeCodes;
    if (vehiclesParams.statusCodes) {
      // Trim and remove trailing commas
      const cleaned = vehiclesParams.statusCodes.trim().replace(/,+$/, '');
      if (cleaned) {
        params.statusCodes = cleaned;
        // Check if status code 3 is present as a discrete code
        const codes = cleaned.split(',').map(c => c.trim());
        if (codes.includes('3') && vehiclesParams.soldDateCode) {
          params.soldDateCode = vehiclesParams.soldDateCode;
        }
      }
    }
    return `/api/holman/vehicles?${new URLSearchParams(params).toString()}`;
  };
  const vehiclesUrl = buildVehiclesUrl();

  const buildContactsUrl = () => {
    const params: Record<string, string> = {
      pageNumber: contactsParams.pageNumber.toString(),
      pageSize: contactsParams.pageSize.toString()
    };
    if (contactsParams.lesseeCodes) params.lesseeCode = contactsParams.lesseeCodes;
    return `/api/holman/contacts?${new URLSearchParams(params).toString()}`;
  };
  const contactsUrl = buildContactsUrl();

  const buildMaintenanceUrl = () => {
    const params: Record<string, string> = {
      pageNumber: maintenanceParams.pageNumber.toString(),
      pageSize: maintenanceParams.pageSize.toString()
    };
    if (maintenanceParams.lesseeCodes) params.lesseeCode = maintenanceParams.lesseeCodes;
    return `/api/holman/maintenance?${new URLSearchParams(params).toString()}`;
  };
  const maintenanceUrl = buildMaintenanceUrl();

  const buildOdometerUrl = () => {
    const params: Record<string, string> = {
      pageNumber: odometerParams.pageNumber.toString(),
      pageSize: odometerParams.pageSize.toString()
    };
    if (odometerParams.lesseeCodes) params.lesseeCode = odometerParams.lesseeCodes;
    return `/api/holman/odometer?${new URLSearchParams(params).toString()}`;
  };
  const odometerUrl = buildOdometerUrl();

  const { data: vehiclesData, isLoading: vehiclesLoading, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: [vehiclesUrl],
    enabled: activeTab === "vehicles",
    retry: false,
  });

  const { data: contactsData, isLoading: contactsLoading, error: contactsError, refetch: refetchContacts } = useQuery({
    queryKey: [contactsUrl],
    enabled: activeTab === "contacts",
    retry: false,
  });

  const { data: maintenanceData, isLoading: maintenanceLoading, error: maintenanceError, refetch: refetchMaintenance } = useQuery({
    queryKey: [maintenanceUrl],
    enabled: activeTab === "maintenance",
    retry: false,
  });

  const { data: odometerData, isLoading: odometerLoading, error: odometerError, refetch: refetchOdometer } = useQuery({
    queryKey: [odometerUrl],
    enabled: activeTab === "odometer",
    retry: false,
  });

  useEffect(() => {
    if (vehiclesError && activeTab === "vehicles") {
      toast({
        title: "Failed to Load Vehicles",
        description: vehiclesError.message || "Unable to fetch vehicles data from Holman API",
        variant: "destructive",
      });
    }
  }, [vehiclesError, activeTab, toast]);

  useEffect(() => {
    if (contactsError && activeTab === "contacts") {
      toast({
        title: "Failed to Load Contacts",
        description: contactsError.message || "Unable to fetch contacts data from Holman API",
        variant: "destructive",
      });
    }
  }, [contactsError, activeTab, toast]);

  useEffect(() => {
    if (maintenanceError && activeTab === "maintenance") {
      toast({
        title: "Failed to Load Maintenance Data",
        description: maintenanceError.message || "Unable to fetch maintenance data from Holman API",
        variant: "destructive",
      });
    }
  }, [maintenanceError, activeTab, toast]);

  useEffect(() => {
    if (odometerError && activeTab === "odometer") {
      toast({
        title: "Failed to Load Odometer Data",
        description: odometerError.message || "Unable to fetch odometer data from Holman API",
        variant: "destructive",
      });
    }
  }, [odometerError, activeTab, toast]);

  const renderDataTable = (data: any, isLoading: boolean, error: Error | null, type: string) => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-destructive">
          <XCircle className="h-8 w-8 mb-2" />
          <p className="font-medium">Error loading {type} data</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      );
    }

    if (!data || !data.items || data.items.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No {type} data available
        </div>
      );
    }

    let items = data.items;
    let allColumns = items.length > 0 ? Object.keys(items[0]) : [];
    
    // Show all columns with holmanVehicleNumber and vin first
    let columns = allColumns;
    if (type === 'vehicles' && allColumns.includes('holmanVehicleNumber') && allColumns.includes('vin')) {
      const otherColumns = allColumns.filter(col => col !== 'holmanVehicleNumber' && col !== 'vin');
      columns = ['holmanVehicleNumber', 'vin', ...otherColumns];
    }

    // Apply filters
    if (Object.keys(filters).length > 0) {
      items = items.filter((item: any) => {
        return Object.entries(filters).every(([col, selectedValues]) => {
          if (selectedValues.length === 0) return true;
          const itemValue = String(item[col] || '');
          return selectedValues.includes(itemValue);
        });
      });
    }

    // Apply sorting
    if (sortConfig) {
      items = [...items].sort((a: any, b: any) => {
        const aValue = String(a[sortConfig.column] || '');
        const bValue = String(b[sortConfig.column] || '');
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const handleSort = (column: string) => {
      setSortConfig(current => {
        if (!current || current.column !== column) {
          return { column, direction: 'asc' };
        }
        if (current.direction === 'asc') {
          return { column, direction: 'desc' };
        }
        return null;
      });
    };

    const getUniqueValues = (column: string) => {
      const values = new Set(data.items.map((item: any) => String(item[column] || '')));
      return Array.from(values).sort();
    };

    const toggleFilter = (column: string, value: string) => {
      setFilters(current => {
        const currentFilters = current[column] || [];
        const newFilters = currentFilters.includes(value)
          ? currentFilters.filter(v => v !== value)
          : [...currentFilters, value];
        
        if (newFilters.length === 0) {
          const { [column]: _, ...rest } = current;
          return rest;
        }
        
        return { ...current, [column]: newFilters };
      });
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {items.length} of {data.totalCount} records
            {data.pageInfo && ` (Page ${data.pageInfo.pageNumber} of ${data.pageInfo.totalPages})`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (type === 'vehicles') setVehiclesParams({...vehiclesParams, pageNumber: Math.max(1, vehiclesParams.pageNumber - 1)});
                else if (type === 'contacts') setContactsParams({...contactsParams, pageNumber: Math.max(1, contactsParams.pageNumber - 1)});
                else if (type === 'maintenance') setMaintenanceParams({...maintenanceParams, pageNumber: Math.max(1, maintenanceParams.pageNumber - 1)});
                else if (type === 'odometer') setOdometerParams({...odometerParams, pageNumber: Math.max(1, odometerParams.pageNumber - 1)});
              }}
              disabled={
                (type === 'vehicles' && vehiclesParams.pageNumber === 1) ||
                (type === 'contacts' && contactsParams.pageNumber === 1) ||
                (type === 'maintenance' && maintenanceParams.pageNumber === 1) ||
                (type === 'odometer' && odometerParams.pageNumber === 1)
              }
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {type === 'vehicles' ? vehiclesParams.pageNumber : type === 'contacts' ? contactsParams.pageNumber : type === 'maintenance' ? maintenanceParams.pageNumber : odometerParams.pageNumber}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (type === 'vehicles') setVehiclesParams({...vehiclesParams, pageNumber: vehiclesParams.pageNumber + 1});
                else if (type === 'contacts') setContactsParams({...contactsParams, pageNumber: contactsParams.pageNumber + 1});
                else if (type === 'maintenance') setMaintenanceParams({...maintenanceParams, pageNumber: maintenanceParams.pageNumber + 1});
                else if (type === 'odometer') setOdometerParams({...odometerParams, pageNumber: odometerParams.pageNumber + 1});
              }}
              disabled={data.pageInfo && data.pageInfo.pageNumber >= data.pageInfo.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="border rounded-lg max-w-full">
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  {columns.map((col) => (
                    <th 
                      key={col} 
                      className="px-2 py-2 text-left font-medium whitespace-nowrap bg-muted border-b"
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 hover:bg-muted-foreground/10"
                          onClick={() => handleSort(col)}
                        >
                          <span className="text-xs">{col.replace(/([A-Z])/g, ' $1').trim()}</span>
                          {sortConfig?.column === col ? (
                            sortConfig.direction === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />
                          )}
                        </Button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-auto p-1 hover:bg-muted-foreground/10">
                              <Filter className={`h-3 w-3 ${filters[col]?.length > 0 ? 'text-primary' : 'opacity-50'}`} />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 max-h-64 overflow-y-auto" align="start">
                            <div className="space-y-2">
                              <div className="font-medium text-sm">Filter by {col}</div>
                              {getUniqueValues(col).map((value: string) => (
                                <div key={String(value)} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`${col}-${String(value)}`}
                                    checked={filters[col]?.includes(String(value)) || false}
                                    onCheckedChange={() => toggleFilter(col, String(value))}
                                  />
                                  <label
                                    htmlFor={`${col}-${String(value)}`}
                                    className="text-sm cursor-pointer flex-1"
                                  >
                                    {value || '(empty)'}
                                  </label>
                                </div>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => (
                  <tr 
                    key={idx} 
                    data-testid={`row-${type}-${idx}`}
                    className="border-b hover:bg-muted/50"
                  >
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-3 whitespace-nowrap">
                        {typeof item[col] === 'object' ? JSON.stringify(item[col]) : String(item[col] || '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <MainContent>
      <TopBar 
        title="Holman API Integration" 
        breadcrumbs={["Home", "API Management", "Holman"]}
      />
      
      <main className="p-6">
        <BackButton href="/api-management" />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-connection-title">Connection Status</CardTitle>
              <CardDescription>
                Test and monitor your Holman API connection
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Holman Fleet Management API</p>
                  <p className="text-sm text-muted-foreground">Production Environment</p>
                </div>
              </div>
              <Button
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
                className="w-full"
                data-testid="button-test-connection"
              >
                {testConnectionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle data-testid="text-endpoints-title">Available Endpoints</CardTitle>
              <CardDescription>
                Holman API data sources
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Vehicles</span>
                </div>
                <Badge variant="outline" data-testid="badge-vehicles">Query & Submit</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Contacts</span>
                </div>
                <Badge variant="outline" data-testid="badge-contacts">Query & Submit</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Maintenance</span>
                </div>
                <Badge variant="outline" data-testid="badge-maintenance">Query & Submit</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Odometer</span>
                </div>
                <Badge variant="outline" data-testid="badge-odometer">Query & Submit</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-data-browser-title">Data Browser</CardTitle>
            <CardDescription>
              Query and view data from Holman API endpoints
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                <TabsTrigger value="vehicles" data-testid="tab-vehicles">
                  <Database className="h-4 w-4 mr-2" />
                  Vehicles
                </TabsTrigger>
                <TabsTrigger value="contacts" data-testid="tab-contacts">
                  <Users className="h-4 w-4 mr-2" />
                  Contacts
                </TabsTrigger>
                <TabsTrigger value="maintenance" data-testid="tab-maintenance">
                  <Wrench className="h-4 w-4 mr-2" />
                  Maintenance
                </TabsTrigger>
                <TabsTrigger value="odometer" data-testid="tab-odometer">
                  <Gauge className="h-4 w-4 mr-2" />
                  Odometer
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Holman API Integration Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="prose dark:prose-invert max-w-none">
                      <p>
                        The Holman API integration provides access to fleet management data including:
                      </p>
                      <ul>
                        <li><strong>Vehicles:</strong> Fleet inventory, VIN information, and vehicle assignments</li>
                        <li><strong>Contacts:</strong> Driver and contact information from your HRIM system</li>
                        <li><strong>Maintenance:</strong> Service history, repair records, and maintenance schedules</li>
                        <li><strong>Odometer:</strong> Mileage tracking and odometer readings</li>
                      </ul>
                      <p className="text-sm text-muted-foreground mt-4">
                        Use the tabs above to browse data from each endpoint. The integration supports both querying
                        existing data and submitting updates to Holman's systems.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="vehicles" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="vehicles-lessee-codes">Lessee Codes</Label>
                    <Input
                      id="vehicles-lessee-codes"
                      value={vehiclesParams.lesseeCodes}
                      onChange={(e) => setVehiclesParams({...vehiclesParams, lesseeCodes: e.target.value})}
                      placeholder="e.g., 2B56"
                      data-testid="input-vehicles-lessee-codes"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vehicles-status-codes">Status Codes</Label>
                    <Input
                      id="vehicles-status-codes"
                      value={vehiclesParams.statusCodes}
                      onChange={(e) => setVehiclesParams({...vehiclesParams, statusCodes: e.target.value})}
                      placeholder="e.g., 1,2"
                      data-testid="input-vehicles-status-codes"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Valid codes: 1 (Active), 2 (Inactive), 3 (Sold)
                    </p>
                  </div>
                  {vehiclesParams.statusCodes.split(',').map(c => c.trim()).includes('3') && (
                    <div>
                      <Label htmlFor="vehicles-sold-date-code">Sold Date Code</Label>
                      <Input
                        id="vehicles-sold-date-code"
                        value={vehiclesParams.soldDateCode}
                        onChange={(e) => setVehiclesParams({...vehiclesParams, soldDateCode: e.target.value})}
                        placeholder="e.g., 5"
                        data-testid="input-vehicles-sold-date-code"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Required when status code 3 is used (default: 5)
                      </p>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="vehicles-page-number">Page Number</Label>
                    <Input
                      id="vehicles-page-number"
                      type="number"
                      value={vehiclesParams.pageNumber}
                      onChange={(e) => setVehiclesParams({...vehiclesParams, pageNumber: parseInt(e.target.value) || 1})}
                      min="1"
                      data-testid="input-vehicles-page-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vehicles-page-size">Page Size</Label>
                    <Input
                      id="vehicles-page-size"
                      type="number"
                      value={vehiclesParams.pageSize}
                      onChange={(e) => setVehiclesParams({...vehiclesParams, pageSize: parseInt(e.target.value) || 1000})}
                      min="1"
                      max="1000"
                      data-testid="input-vehicles-page-size"
                    />
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Vehicles Data</h3>
                  <Button
                    onClick={() => refetchVehicles()}
                    size="sm"
                    variant="outline"
                    disabled={vehiclesLoading}
                    data-testid="button-refresh-vehicles"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${vehiclesLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {renderDataTable(vehiclesData, vehiclesLoading, vehiclesError, "vehicles")}
              </TabsContent>

              <TabsContent value="contacts" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="contacts-lessee-codes">Lessee Codes</Label>
                    <Input
                      id="contacts-lessee-codes"
                      value={contactsParams.lesseeCodes}
                      onChange={(e) => setContactsParams({...contactsParams, lesseeCodes: e.target.value})}
                      placeholder="e.g., 2B56"
                      data-testid="input-contacts-lessee-codes"
                    />
                  </div>
                  <div>
                    <Label htmlFor="contacts-page-number">Page Number</Label>
                    <Input
                      id="contacts-page-number"
                      type="number"
                      value={contactsParams.pageNumber}
                      onChange={(e) => setContactsParams({...contactsParams, pageNumber: parseInt(e.target.value) || 1})}
                      min="1"
                      data-testid="input-contacts-page-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="contacts-page-size">Page Size</Label>
                    <Input
                      id="contacts-page-size"
                      type="number"
                      value={contactsParams.pageSize}
                      onChange={(e) => setContactsParams({...contactsParams, pageSize: parseInt(e.target.value) || 1000})}
                      min="1"
                      max="1000"
                      data-testid="input-contacts-page-size"
                    />
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Contacts Data</h3>
                  <Button
                    onClick={() => refetchContacts()}
                    size="sm"
                    variant="outline"
                    disabled={contactsLoading}
                    data-testid="button-refresh-contacts"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${contactsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {renderDataTable(contactsData, contactsLoading, contactsError, "contacts")}
              </TabsContent>

              <TabsContent value="maintenance" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="maintenance-lessee-codes">Lessee Codes</Label>
                    <Input
                      id="maintenance-lessee-codes"
                      value={maintenanceParams.lesseeCodes}
                      onChange={(e) => setMaintenanceParams({...maintenanceParams, lesseeCodes: e.target.value})}
                      placeholder="e.g., 2B56"
                      data-testid="input-maintenance-lessee-codes"
                    />
                  </div>
                  <div>
                    <Label htmlFor="maintenance-po-date-code">PO Date Code</Label>
                    <Input
                      id="maintenance-po-date-code"
                      value={maintenanceParams.poDateCode}
                      onChange={(e) => setMaintenanceParams({...maintenanceParams, poDateCode: e.target.value})}
                      placeholder="1"
                      data-testid="input-maintenance-po-date-code"
                    />
                  </div>
                  <div>
                    <Label htmlFor="maintenance-page-number">Page Number</Label>
                    <Input
                      id="maintenance-page-number"
                      type="number"
                      value={maintenanceParams.pageNumber}
                      onChange={(e) => setMaintenanceParams({...maintenanceParams, pageNumber: parseInt(e.target.value) || 1})}
                      min="1"
                      data-testid="input-maintenance-page-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="maintenance-page-size">Page Size</Label>
                    <Input
                      id="maintenance-page-size"
                      type="number"
                      value={maintenanceParams.pageSize}
                      onChange={(e) => setMaintenanceParams({...maintenanceParams, pageSize: parseInt(e.target.value) || 1000})}
                      min="1"
                      max="1000"
                      data-testid="input-maintenance-page-size"
                    />
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Maintenance Data</h3>
                  <Button
                    onClick={() => refetchMaintenance()}
                    size="sm"
                    variant="outline"
                    disabled={maintenanceLoading}
                    data-testid="button-refresh-maintenance"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${maintenanceLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {renderDataTable(maintenanceData, maintenanceLoading, maintenanceError, "maintenance")}
              </TabsContent>

              <TabsContent value="odometer" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="odometer-lessee-codes">Lessee Codes</Label>
                    <Input
                      id="odometer-lessee-codes"
                      value={odometerParams.lesseeCodes}
                      onChange={(e) => setOdometerParams({...odometerParams, lesseeCodes: e.target.value})}
                      placeholder="e.g., 2B56"
                      data-testid="input-odometer-lessee-codes"
                    />
                  </div>
                  <div>
                    <Label htmlFor="odometer-history-date-code">History Date Code</Label>
                    <Input
                      id="odometer-history-date-code"
                      value={odometerParams.odometerHistoryDateCode}
                      onChange={(e) => setOdometerParams({...odometerParams, odometerHistoryDateCode: e.target.value})}
                      placeholder="1"
                      data-testid="input-odometer-history-date-code"
                    />
                  </div>
                  <div>
                    <Label htmlFor="odometer-page-number">Page Number</Label>
                    <Input
                      id="odometer-page-number"
                      type="number"
                      value={odometerParams.pageNumber}
                      onChange={(e) => setOdometerParams({...odometerParams, pageNumber: parseInt(e.target.value) || 1})}
                      min="1"
                      data-testid="input-odometer-page-number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="odometer-page-size">Page Size</Label>
                    <Input
                      id="odometer-page-size"
                      type="number"
                      value={odometerParams.pageSize}
                      onChange={(e) => setOdometerParams({...odometerParams, pageSize: parseInt(e.target.value) || 1000})}
                      min="1"
                      max="1000"
                      data-testid="input-odometer-page-size"
                    />
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Odometer Data</h3>
                  <Button
                    onClick={() => refetchOdometer()}
                    size="sm"
                    variant="outline"
                    disabled={odometerLoading}
                    data-testid="button-refresh-odometer"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${odometerLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {renderDataTable(odometerData, odometerLoading, odometerError, "odometer")}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </MainContent>
  );
}
