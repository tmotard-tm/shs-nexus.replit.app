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
import { RefreshCw, Database, Users, Wrench, CheckCircle, XCircle, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Search, Truck, List } from "lucide-react";
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

const LOOKUP_TYPES = [
  { key: 'colors', label: 'Colors' },
  { key: 'branding', label: 'Branding' },
  { key: 'interior', label: 'Interior' },
  { key: 'sct-tune', label: 'SCT Tune' },
  { key: 'grades', label: 'Grades' },
  { key: 'vehicle-runs', label: 'Vehicle Runs' },
  { key: 'vehicle-looks', label: 'Vehicle Looks' },
  { key: 'service-reasons', label: 'Service Reasons' },
  { key: 'repair-status', label: 'Repair Status' },
  { key: 'repair-disposition', label: 'Repair Disposition' },
  { key: 'disposition-reasons', label: 'Disposition Reasons' },
  { key: 'rental-car', label: 'Rental Car' },
  { key: 'truck-status', label: 'Truck Status' },
];

export default function AmsIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const [sortConfig, setSortConfig] = useState<{column: string, direction: 'asc' | 'desc'} | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  const [vehicleSearchParams, setVehicleSearchParams] = useState({
    vin: "",
    plate: "",
    vehicleId: "",
    tech: "",
    region: "",
    district: "",
    limit: 100,
    offset: 0,
  });

  const [techSearchParams, setTechSearchParams] = useState({
    techName: "",
    ldapId: "",
    lastUpdateAfter: "",
    lastUpdateBefore: "",
    limit: 100,
    offset: 0,
  });

  const [selectedLookup, setSelectedLookup] = useState("colors");

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/ams/test");
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
        description: error.message || "Failed to test AMS API connection",
        variant: "destructive",
      });
    },
  });

  const buildVehiclesUrl = () => {
    const params: Record<string, string> = {
      limit: vehicleSearchParams.limit.toString(),
      offset: vehicleSearchParams.offset.toString(),
    };
    if (vehicleSearchParams.vin) params.vin = vehicleSearchParams.vin;
    if (vehicleSearchParams.plate) params.plate = vehicleSearchParams.plate;
    if (vehicleSearchParams.vehicleId) params.vehicleId = vehicleSearchParams.vehicleId;
    if (vehicleSearchParams.tech) params.tech = vehicleSearchParams.tech;
    if (vehicleSearchParams.region) params.region = vehicleSearchParams.region;
    if (vehicleSearchParams.district) params.district = vehicleSearchParams.district;
    return `/api/ams/vehicles?${new URLSearchParams(params).toString()}`;
  };
  const vehiclesUrl = buildVehiclesUrl();

  const buildTechsUrl = () => {
    const params: Record<string, string> = {
      limit: techSearchParams.limit.toString(),
      offset: techSearchParams.offset.toString(),
    };
    if (techSearchParams.techName) params.techName = techSearchParams.techName;
    if (techSearchParams.ldapId) params.ldapId = techSearchParams.ldapId;
    if (techSearchParams.lastUpdateAfter) params.lastUpdateAfter = techSearchParams.lastUpdateAfter;
    if (techSearchParams.lastUpdateBefore) params.lastUpdateBefore = techSearchParams.lastUpdateBefore;
    return `/api/ams/techs?${new URLSearchParams(params).toString()}`;
  };
  const techsUrl = buildTechsUrl();

  const hasVehicleSearchParam = !!(vehicleSearchParams.vin || vehicleSearchParams.plate || vehicleSearchParams.vehicleId || vehicleSearchParams.tech || vehicleSearchParams.region || vehicleSearchParams.district);
  const hasTechSearchParam = !!(techSearchParams.techName || techSearchParams.ldapId || techSearchParams.lastUpdateAfter || techSearchParams.lastUpdateBefore);

  const { data: vehiclesData, isLoading: vehiclesLoading, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: [vehiclesUrl],
    enabled: activeTab === "vehicles" && hasVehicleSearchParam,
    retry: false,
  });

  const { data: techsData, isLoading: techsLoading, error: techsError, refetch: refetchTechs } = useQuery({
    queryKey: [techsUrl],
    enabled: activeTab === "techs" && hasTechSearchParam,
    retry: false,
  });

  const { data: lookupData, isLoading: lookupLoading, error: lookupError, refetch: refetchLookup } = useQuery({
    queryKey: ['/api/ams/lookups', selectedLookup],
    enabled: activeTab === "lookups",
    retry: false,
  });

  useEffect(() => {
    if (vehiclesError && activeTab === "vehicles") {
      toast({ title: "Failed to Load Vehicles", description: vehiclesError.message, variant: "destructive" });
    }
  }, [vehiclesError, activeTab, toast]);

  useEffect(() => {
    if (techsError && activeTab === "techs") {
      toast({ title: "Failed to Load Techs", description: techsError.message, variant: "destructive" });
    }
  }, [techsError, activeTab, toast]);

  useEffect(() => {
    if (lookupError && activeTab === "lookups") {
      toast({ title: "Failed to Load Lookup Data", description: lookupError.message, variant: "destructive" });
    }
  }, [lookupError, activeTab, toast]);

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

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && Array.isArray(data.items)) {
      items = data.items;
    } else if (data && Array.isArray(data.data)) {
      items = data.data;
    }

    if (items.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No {type} data available. Try adjusting your search parameters.
        </div>
      );
    }

    const allColumns = items.length > 0 ? Object.keys(items[0]) : [];
    let columns = allColumns;
    if (type === 'vehicles' && allColumns.includes('VIN')) {
      const priorityCols = ['VIN', 'VehicleNumber', 'TechName', 'Tech', 'MakeName', 'ModelName', 'ModelYear'];
      const priority = priorityCols.filter(c => allColumns.includes(c));
      const rest = allColumns.filter(c => !priorityCols.includes(c));
      columns = [...priority, ...rest];
    }

    let filteredItems = items;
    if (Object.keys(filters).length > 0) {
      filteredItems = items.filter((item: any) => {
        return Object.entries(filters).every(([col, selectedValues]) => {
          if (selectedValues.length === 0) return true;
          return selectedValues.includes(String(item[col] || ''));
        });
      });
    }

    if (sortConfig) {
      filteredItems = [...filteredItems].sort((a: any, b: any) => {
        const aValue = String(a[sortConfig.column] || '');
        const bValue = String(b[sortConfig.column] || '');
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const handleSort = (column: string) => {
      setSortConfig(current => {
        if (!current || current.column !== column) return { column, direction: 'asc' };
        if (current.direction === 'asc') return { column, direction: 'desc' };
        return null;
      });
    };

    const getUniqueValues = (column: string): string[] => {
      const values = new Set<string>(items.map((item: any) => String(item[column] || '')));
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
      <div>
        <div className="text-sm text-muted-foreground mb-2">
          Showing {filteredItems.length} of {items.length} records
          {data?.total && ` (${data.total} total)`}
        </div>
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSort(col)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <span className="text-xs font-medium">{col}</span>
                        {sortConfig?.column === col ? (
                          sortConfig.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className={`p-0.5 rounded hover:bg-accent ${filters[col]?.length ? 'text-primary' : 'opacity-40'}`}>
                            <Filter className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 max-h-60 overflow-auto p-2">
                          <div className="space-y-1">
                            {getUniqueValues(col).slice(0, 50).map(value => (
                              <label key={value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent rounded px-1 py-0.5">
                                <Checkbox
                                  checked={filters[col]?.includes(value) || false}
                                  onCheckedChange={() => toggleFilter(col, value)}
                                />
                                <span className="truncate">{value || '(empty)'}</span>
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.slice(0, 500).map((item: any, idx: number) => (
                <TableRow key={idx}>
                  {columns.map((col) => (
                    <TableCell key={col} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                      {item[col] !== null && item[col] !== undefined ? String(item[col]) : '-'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <TopBar title="AMS API Integration" subtitle="In-Home Asset Management System" />
      <div className="p-6">
        <div className="mb-4">
          <BackButton href="/integrations" label="Back to Integrations" />
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  AMS Vehicle API
                </CardTitle>
                <CardDescription>
                  Search vehicles, technicians, manage repairs, and access lookup data from the AMS system
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={testConnectionMutation.isPending}
                >
                  {testConnectionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  )}
                  Test Connection
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSortConfig(null); setFilters({}); }}>
              <TabsList className="mb-4">
                <TabsTrigger value="overview" className="flex items-center gap-1">
                  <Database className="h-4 w-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="vehicles" className="flex items-center gap-1">
                  <Truck className="h-4 w-4" />
                  Vehicles
                </TabsTrigger>
                <TabsTrigger value="techs" className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  Techs
                </TabsTrigger>
                <TabsTrigger value="lookups" className="flex items-center gap-1">
                  <List className="h-4 w-4" />
                  Lookups
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Truck className="h-4 w-4 text-primary" />
                        Vehicles
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-2">Search, view, and update vehicle records. Manage user-defined fields, tech assignments, comments, and repair status.</p>
                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px] px-1">GET</Badge> Search vehicles</div>
                        <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px] px-1">GET</Badge> Get vehicle by VIN</div>
                        <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px] px-1">POST</Badge> Update user fields</div>
                        <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px] px-1">POST</Badge> Update tech assignment</div>
                        <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px] px-1">POST</Badge> Add comment</div>
                        <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px] px-1">GET</Badge> Get comments</div>
                        <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px] px-1">POST</Badge> Update repair status</div>
                        <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px] px-1">POST</Badge> Complete repair / disposition</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Users className="h-4 w-4 text-blue-500" />
                        Technicians
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-2">Search technicians by name, LDAP ID, or last update date range. Returns organization hierarchy and equipment info.</p>
                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px] px-1">GET</Badge> Search technicians</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <List className="h-4 w-4 text-amber-500" />
                        Lookups
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-2">Reference data tables for vehicle attributes, repair codes, and disposition options.</p>
                      <div className="text-xs space-y-1">
                        {LOOKUP_TYPES.map(lt => (
                          <div key={lt.key} className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] px-1">GET</Badge> {lt.label}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="vehicles">
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Search Parameters</CardTitle>
                    <CardDescription className="text-xs">At least one search parameter is required</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div>
                        <Label className="text-xs">VIN</Label>
                        <Input
                          placeholder="Full or partial VIN"
                          value={vehicleSearchParams.vin}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, vin: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Plate</Label>
                        <Input
                          placeholder="License plate"
                          value={vehicleSearchParams.plate}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, plate: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Vehicle ID</Label>
                        <Input
                          placeholder="Vehicle number"
                          value={vehicleSearchParams.vehicleId}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, vehicleId: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Tech ID</Label>
                        <Input
                          placeholder="Technician ID"
                          value={vehicleSearchParams.tech}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, tech: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Region</Label>
                        <Input
                          placeholder="Region"
                          value={vehicleSearchParams.region}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, region: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">District</Label>
                        <Input
                          placeholder="District"
                          value={vehicleSearchParams.district}
                          onChange={(e) => setVehicleSearchParams(p => ({ ...p, district: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => refetchVehicles()}
                        disabled={vehiclesLoading || !hasVehicleSearchParam}
                      >
                        {vehiclesLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                        Search
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVehicleSearchParams({ vin: "", plate: "", vehicleId: "", tech: "", region: "", district: "", limit: 100, offset: 0 })}
                      >
                        Clear
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {hasVehicleSearchParam && renderDataTable(vehiclesData, vehiclesLoading, vehiclesError as Error | null, 'vehicles')}
                {!hasVehicleSearchParam && (
                  <div className="text-center py-8 text-muted-foreground">
                    Enter at least one search parameter to search vehicles
                  </div>
                )}
              </TabsContent>

              <TabsContent value="techs">
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Search Parameters</CardTitle>
                    <CardDescription className="text-xs">Search by tech name, LDAP ID, or last update date range</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs">Tech Name</Label>
                        <Input
                          placeholder="Partial name match"
                          value={techSearchParams.techName}
                          onChange={(e) => setTechSearchParams(p => ({ ...p, techName: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">LDAP / Enterprise ID</Label>
                        <Input
                          placeholder="Exact match"
                          value={techSearchParams.ldapId}
                          onChange={(e) => setTechSearchParams(p => ({ ...p, ldapId: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Updated After (MM/dd/yyyy)</Label>
                        <Input
                          placeholder="02/21/2026"
                          value={techSearchParams.lastUpdateAfter}
                          onChange={(e) => setTechSearchParams(p => ({ ...p, lastUpdateAfter: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Updated Before (MM/dd/yyyy)</Label>
                        <Input
                          placeholder="02/28/2026"
                          value={techSearchParams.lastUpdateBefore}
                          onChange={(e) => setTechSearchParams(p => ({ ...p, lastUpdateBefore: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => refetchTechs()}
                        disabled={techsLoading || !hasTechSearchParam}
                      >
                        {techsLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                        Search
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTechSearchParams({ techName: "", ldapId: "", lastUpdateAfter: "", lastUpdateBefore: "", limit: 100, offset: 0 })}
                      >
                        Clear
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {hasTechSearchParam && renderDataTable(techsData, techsLoading, techsError as Error | null, 'techs')}
                {!hasTechSearchParam && (
                  <div className="text-center py-8 text-muted-foreground">
                    Enter at least one search parameter to search technicians
                  </div>
                )}
              </TabsContent>

              <TabsContent value="lookups">
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Lookup Tables</CardTitle>
                    <CardDescription className="text-xs">Reference data for vehicle attributes and repair codes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {LOOKUP_TYPES.map(lt => (
                        <Button
                          key={lt.key}
                          variant={selectedLookup === lt.key ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => { setSelectedLookup(lt.key); setSortConfig(null); setFilters({}); }}
                        >
                          {lt.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refetchLookup()}
                        disabled={lookupLoading}
                      >
                        {lookupLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                        Refresh
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {renderDataTable(lookupData, lookupLoading, lookupError as Error | null, selectedLookup)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
