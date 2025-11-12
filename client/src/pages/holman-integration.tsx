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
import { RefreshCw, Database, Users, Wrench, Gauge, CheckCircle, XCircle, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function HolmanIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [lesseeCode, setLesseeCode] = useState("");
  const [pageNumber, setPageNumber] = useState(1);

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

  const vehiclesUrl = `/api/holman/vehicles?${new URLSearchParams({ 
    lesseeCode: lesseeCode || '', 
    pageNumber: pageNumber.toString(),
    pageSize: '100'
  }).toString()}`;

  const contactsUrl = `/api/holman/contacts?${new URLSearchParams({ 
    lesseeCode: lesseeCode || '', 
    pageNumber: pageNumber.toString(),
    pageSize: '100'
  }).toString()}`;

  const maintenanceUrl = `/api/holman/maintenance?${new URLSearchParams({ 
    lesseeCode: lesseeCode || '', 
    pageNumber: pageNumber.toString(),
    pageSize: '100'
  }).toString()}`;

  const odometerUrl = `/api/holman/odometer?${new URLSearchParams({ 
    lesseeCode: lesseeCode || '', 
    pageNumber: pageNumber.toString(),
    pageSize: '100'
  }).toString()}`;

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

    if (!data || !data.data || data.data.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No {type} data available
        </div>
      );
    }

    const items = data.data.slice(0, 10);
    const columns = items.length > 0 ? Object.keys(items[0]) : [];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {items.length} of {data.totalCount} records
            {data.pageInfo && ` (Page ${data.pageInfo.pageNumber} of ${data.pageInfo.totalPages})`}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
              disabled={pageNumber === 1}
              data-testid={`button-prev-page-${type}`}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPageNumber(pageNumber + 1)}
              disabled={!data.pageInfo || pageNumber >= data.pageInfo.totalPages}
              data-testid={`button-next-page-${type}`}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="border rounded-lg overflow-auto max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.slice(0, 8).map((col) => (
                  <TableHead key={col} className="capitalize">
                    {col.replace(/([A-Z])/g, ' $1').trim()}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any, idx: number) => (
                <TableRow key={idx} data-testid={`row-${type}-${idx}`}>
                  {columns.slice(0, 8).map((col) => (
                    <TableCell key={col} className="max-w-[200px] truncate">
                      {typeof item[col] === 'object' ? JSON.stringify(item[col]) : String(item[col] || '-')}
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
            <div className="mb-4 flex gap-4">
              <div className="flex-1">
                <Label htmlFor="lesseeCode">Lessee Code (optional)</Label>
                <Input
                  id="lesseeCode"
                  value={lesseeCode}
                  onChange={(e) => setLesseeCode(e.target.value)}
                  placeholder="Enter lessee code to filter"
                  data-testid="input-lessee-code"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to query all accessible data
                </p>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
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
