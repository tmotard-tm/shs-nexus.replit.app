import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QueueItem, User } from "@shared/schema";
import { Clock, User as UserIcon, Save, AlertTriangle, CheckCircle, Ban, Truck, RefreshCw, ExternalLink } from "lucide-react";
import { MainContent } from "@/components/layout/main-content";
import { PickUpRequestDialog } from "@/components/pick-up-request-dialog";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { QueueItemDataTemplate } from "@/components/queue-item-data-template";

interface ToolsQueueItem extends Omit<QueueItem, 'isByov' | 'fleetRoutingDecision' | 'routingReceivedAt' | 'blockedActions'> {
  isByov?: boolean | null;
  fleetRoutingDecision?: string | null;
  routingReceivedAt?: string | null;
  blockedActions?: string[] | null;
  currentBlockingStatus?: {
    status: string;
    routingPath: string | null;
    blockedActions: string[];
    isByov: boolean;
  };
}

type CardVariant = 'byov' | 'blocked' | 'pmf' | 'pepboys' | 'reassigned';

function getCardVariant(item: ToolsQueueItem): CardVariant {
  const blockingStatus = item.currentBlockingStatus;
  
  if (blockingStatus) {
    if (blockingStatus.isByov) {
      return 'byov';
    }
    
    if (blockingStatus.blockedActions && blockingStatus.blockedActions.length > 0) {
      return 'blocked';
    }
    
    const routingPath = blockingStatus.routingPath?.toUpperCase() || '';
    if (routingPath === 'PMF') {
      return 'pmf';
    }
    if (routingPath === 'PEP_BOYS' || routingPath === 'PEPBOYS' || routingPath === 'PEP BOYS') {
      return 'pepboys';
    }
    if (routingPath === 'REASSIGNED' || routingPath.includes('REASSIGN')) {
      return 'reassigned';
    }
  }
  
  const routing = item.fleetRoutingDecision?.toUpperCase() || '';
  
  if (item.isByov) {
    return 'byov';
  }
  
  if (routing === 'PMF') {
    return 'pmf';
  }
  
  if (routing === 'PEP_BOYS' || routing === 'PEPBOYS' || routing === 'PEP BOYS') {
    return 'pepboys';
  }
  
  if (routing === 'REASSIGNED' || routing.includes('REASSIGN')) {
    return 'reassigned';
  }
  
  if (!item.fleetRoutingDecision && !item.isByov) {
    return 'blocked';
  }
  
  return 'blocked';
}

function getTechnicianInfo(item: ToolsQueueItem): { name: string; truck: string } {
  const data = item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {};
  return {
    name: data.techName || data.technicianName || data.employeeName || 'Unknown Technician',
    truck: data.vehicleNumber || data.truckNumber || data.truck || 'Unknown'
  };
}

function ToolsTaskCard({ 
  item, 
  users, 
  currentUser,
  onPickUp,
  onComplete,
  onRefresh,
  isCompletePending 
}: { 
  item: ToolsQueueItem;
  users: User[];
  currentUser?: User;
  onPickUp: (item: ToolsQueueItem) => void;
  onComplete: (itemId: string) => void;
  onRefresh: () => void;
  isCompletePending: boolean;
}) {
  const variant = getCardVariant(item);
  const { name: techName, truck: truckNumber } = getTechnicianInfo(item);
  const blockedActions = item.currentBlockingStatus?.blockedActions || item.blockedActions || [];
  const isBlocked = blockedActions.length > 0;
  
  const getVariantStyles = () => {
    switch (variant) {
      case 'byov':
        return 'border-l-4 border-l-green-500';
      case 'blocked':
        return 'border-l-4 border-l-yellow-500';
      case 'pmf':
        return 'border-l-4 border-l-blue-500';
      case 'pepboys':
        return 'border-l-4 border-l-red-500';
      case 'reassigned':
        return 'border-l-4 border-l-purple-500';
      default:
        return '';
    }
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">TOOLS - Recover Equipment</span>
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
          Day 0
        </Badge>
      </div>
      {item.isByov && (
        <Badge className="bg-green-100 text-green-800 border-green-200">
          BYOV
        </Badge>
      )}
    </div>
  );

  const renderTechInfo = () => (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 text-sm">
        <UserIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Technician:</span>
        <span>{techName}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Truck className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Truck:</span>
        <span>{truckNumber}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Type:</span>
        {variant === 'byov' ? (
          <Badge variant="outline" className="bg-green-50 text-green-700">BYOV [YES]</Badge>
        ) : variant === 'blocked' ? (
          <span>Company Vehicle</span>
        ) : (
          <span>Routing: {item.fleetRoutingDecision?.toUpperCase() || 'Pending'}</span>
        )}
      </div>
    </div>
  );

  const renderByovContent = () => (
    <>
      <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg mb-4">
        <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium mb-2">
          <CheckCircle className="h-4 w-4" />
          <span>Status: Ready to proceed</span>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <p className="font-medium text-sm">Instructions:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-muted-foreground">
          <li>Check Segno for open orders</li>
          <li>Call technician</li>
          <li>Issue QR codes to Lawrence, KS</li>
        </ol>
      </div>
      <div className="flex gap-2 pt-4 border-t">
        <Button size="sm" variant="outline" data-testid={`button-issue-qr-${item.id}`}>
          Issue QR Codes
        </Button>
        <Button 
          size="sm" 
          onClick={() => onComplete(item.id)}
          disabled={isCompletePending}
          data-testid={`button-complete-${item.id}`}
        >
          Mark Complete
        </Button>
      </div>
    </>
  );

  const renderBlockedContent = () => (
    <>
      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg mb-4 border border-yellow-200 dark:border-yellow-800">
        <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300 font-medium">
          <Ban className="h-4 w-4" />
          <span>[BLOCKED] Awaiting Fleet routing decision</span>
        </div>
      </div>
      
      <div className="space-y-3 mb-4">
        <div>
          <p className="font-medium text-sm text-green-700 dark:text-green-300 mb-2">You can complete these now:</p>
          <ul className="text-sm space-y-1">
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Check Segno for open orders</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Attempt to contact technician</span>
            </li>
          </ul>
        </div>
        
        <div>
          <p className="font-medium text-sm text-red-700 dark:text-red-300 mb-2">Blocked until routing confirmed:</p>
          <ul className="text-sm space-y-1">
            {blockedActions.includes('issue_qr_codes') && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Ban className="h-4 w-4 text-red-400" />
                <span>Issue QR codes</span>
              </li>
            )}
            {blockedActions.includes('coordinate_audit') && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Ban className="h-4 w-4 text-red-400" />
                <span>Coordinate tool audit</span>
              </li>
            )}
          </ul>
        </div>
        
        <div className="p-2 bg-muted rounded text-sm">
          <span className="font-medium">Workaround:</span> Check FleetScope for routing
        </div>
      </div>
      
      <div className="flex gap-2 pt-4 border-t">
        <Button size="sm" variant="outline" data-testid={`button-check-fleetscope-${item.id}`}>
          <ExternalLink className="h-4 w-4 mr-1" />
          Check FleetScope
        </Button>
        <Button 
          size="sm" 
          variant="outline"
          onClick={onRefresh}
          data-testid={`button-refresh-${item.id}`}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh Status
        </Button>
      </div>
    </>
  );

  const renderPmfContent = () => (
    <>
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-4">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium mb-1">
          <CheckCircle className="h-4 w-4" />
          <span>Status: No action required</span>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <p className="font-medium text-sm">Instructions:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-muted-foreground">
          <li>Tools will stay in the vehicle</li>
          <li>PMF will perform tool audit</li>
          <li>Audit cost: $135 per vehicle</li>
        </ol>
      </div>
      <div className="flex gap-2 pt-4 border-t">
        <Button 
          size="sm" 
          onClick={() => onComplete(item.id)}
          disabled={isCompletePending}
          data-testid={`button-complete-${item.id}`}
        >
          Mark Complete
        </Button>
      </div>
    </>
  );

  const renderPepboysContent = () => (
    <>
      <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg mb-4 border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium">
          <AlertTriangle className="h-4 w-4" />
          <span>[CRITICAL] Issue QR codes BEFORE truck pickup</span>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <p className="font-medium text-sm">Instructions:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-muted-foreground">
          <li>Generate QR codes for tool return</li>
          <li>Email QR codes to technician's personal email</li>
          <li>Instruct tech to ship before truck pickup</li>
        </ol>
      </div>
      <div className="flex gap-2 pt-4 border-t">
        <Button size="sm" variant="outline" data-testid={`button-issue-qr-${item.id}`}>
          Issue QR Codes
        </Button>
        <Button 
          size="sm" 
          onClick={() => onComplete(item.id)}
          disabled={isCompletePending}
          data-testid={`button-complete-${item.id}`}
        >
          Mark Complete
        </Button>
      </div>
    </>
  );

  const renderReassignedContent = () => (
    <>
      <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg mb-4">
        <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 font-medium">
          <span>Routing: REASSIGNED TO NEW HIRE</span>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <p className="font-medium text-sm">Instructions:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-muted-foreground">
          <li>Track this truck for new hire tool audit</li>
          <li>Note new hire name when assigned</li>
          <li>Verify tool audit during new hire onboarding</li>
        </ol>
      </div>
      <div className="flex gap-2 pt-4 border-t">
        <Button 
          size="sm" 
          onClick={() => onComplete(item.id)}
          disabled={isCompletePending}
          data-testid={`button-complete-${item.id}`}
        >
          Mark Complete
        </Button>
      </div>
    </>
  );

  const renderContent = () => {
    switch (variant) {
      case 'byov':
        return renderByovContent();
      case 'blocked':
        return renderBlockedContent();
      case 'pmf':
        return renderPmfContent();
      case 'pepboys':
        return renderPepboysContent();
      case 'reassigned':
        return renderReassignedContent();
      default:
        return renderBlockedContent();
    }
  };

  return (
    <Card className={`hover:shadow-md transition-shadow ${getVariantStyles()}`}>
      <CardContent className="p-4">
        {renderHeader()}
        {renderTechInfo()}
        {renderContent()}
      </CardContent>
    </Card>
  );
}

export default function ToolsQueuePage() {
  const [viewQueueItem, setViewQueueItem] = useState<ToolsQueueItem | null>(null);
  const [pickUpItem, setPickUpItem] = useState<ToolsQueueItem | null>(null);
  const [workModuleItem, setWorkModuleItem] = useState<ToolsQueueItem | null>(null);
  const [isWorkModuleOpen, setIsWorkModuleOpen] = useState(false);
  const { toast } = useToast();

  const { data: queueItems = [], isLoading, refetch } = useQuery<ToolsQueueItem[]>({
    queryKey: ["/api/tools-queue"],
    queryFn: () => apiRequest("GET", "/api/tools-queue").then(res => res.json()),
    refetchInterval: 30000,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { user } = useAuth();

  const toolsUsers = users.filter(u => u.departments?.includes("TOOLS") || u.role === "developer" || u.role === "admin");

  const assignMutation = useMutation({
    mutationFn: ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) =>
      apiRequest("PATCH", `/api/tools-queue/${queueItemId}/assign`, { assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
      setPickUpItem(null);
      toast({
        title: "Success",
        description: "Queue item assigned successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (queueItemId: string) =>
      apiRequest("PATCH", `/api/tools-queue/${queueItemId}/complete`, { completedBy: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
      toast({
        title: "Success",
        description: "Queue item marked as complete.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "in_progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "completed": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "failed": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "cancelled": return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "destructive";
      case "high": return "destructive";
      case "medium": return "default";
      case "low": return "secondary";
      default: return "secondary";
    }
  };

  const pendingItems = queueItems.filter(item => item.status === "pending");
  const inProgressItems = queueItems.filter(item => item.status === "in_progress");
  const completedItems = queueItems.filter(item => item.status === "completed");

  if (isLoading) {
    return (
      <MainContent>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/3"></div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tools Queue</h1>
            <p className="text-muted-foreground">
              Manage Tools department tasks - recover equipment and tools from terminated employees
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900 dark:text-amber-100">
              Tools Department
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                {pendingItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items awaiting assignment
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                {inProgressItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inProgressItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items being worked on
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <Badge variant="outline" className="bg-green-50 text-green-700">
                {completedItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completedItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items finished today
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="in_progress" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pendingItems.length})</TabsTrigger>
            <TabsTrigger value="in_progress">In Progress ({inProgressItems.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedItems.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pendingItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No pending items</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {pendingItems.map((item) => (
                  <Card key={item.id} className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-yellow-400"
                        onClick={() => setPickUpItem(item)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-2xl">🔧</span>
                            <div>
                              <h3 className="font-semibold">{item.title}</h3>
                              <p className="text-sm text-muted-foreground">{item.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                            {item.isByov && (
                              <Badge className="bg-green-100 text-green-800">BYOV</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex gap-2">
                            <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                            <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                          </div>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPickUpItem(item);
                            }}
                            disabled={assignMutation.isPending}
                            data-testid={`button-pick-up-${item.id}`}
                          >
                            Pick Up
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="in_progress" className="space-y-4">
            {inProgressItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No items in progress</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {inProgressItems.map((item) => (
                  <ToolsTaskCard 
                    key={item.id}
                    item={item}
                    users={users}
                    currentUser={user ?? undefined}
                    onPickUp={setPickUpItem}
                    onComplete={(id) => completeMutation.mutate(id)}
                    onRefresh={() => refetch()}
                    isCompletePending={completeMutation.isPending}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="space-y-4">
            {completedItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No completed items</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {completedItems.map((item) => {
                  const assignedUser = users.find(user => user.id === item.assignedTo);
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-green-500"
                          onClick={() => setViewQueueItem(item)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">✅</span>
                              <div>
                                <h3 className="font-semibold">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </div>
                              {assignedUser && (
                                <div className="flex items-center gap-1">
                                  <UserIcon className="h-4 w-4" />
                                  {assignedUser.username}
                                </div>
                              )}
                              {item.isByov && (
                                <Badge className="bg-green-100 text-green-800">BYOV</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                              <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Tools Queue Item Details</DialogTitle>
              <DialogDescription>
                View complete form submission and manage queue item
              </DialogDescription>
            </DialogHeader>
            {viewQueueItem && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="font-semibold">Status</Label>
                    <div className="mt-1">
                      <Badge className={getStatusColor(viewQueueItem.status)}>
                        {viewQueueItem.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="font-semibold">Priority</Label>
                    <div className="mt-1">
                      <Badge variant={getPriorityColor(viewQueueItem.priority)}>
                        {viewQueueItem.priority}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="font-semibold">Created</Label>
                    <p className="text-sm">{new Date(viewQueueItem.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <Label className="font-semibold">Assigned To</Label>
                    <p className="text-sm">
                      {users.find(u => u.id === viewQueueItem.assignedTo)?.username || 'Unassigned'}
                    </p>
                  </div>
                  <div>
                    <Label className="font-semibold">BYOV Status</Label>
                    <div className="mt-1">
                      {viewQueueItem.isByov ? (
                        <Badge className="bg-green-100 text-green-800">Yes - BYOV</Badge>
                      ) : (
                        <Badge variant="outline">No - Company Vehicle</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="font-semibold">Routing Decision</Label>
                    <p className="text-sm">
                      {viewQueueItem.fleetRoutingDecision || 'Pending Fleet Decision'}
                    </p>
                  </div>
                </div>

                <div>
                  <Label className="font-semibold">Description</Label>
                  <p className="text-sm mt-1 p-3 bg-muted rounded">{viewQueueItem.description}</p>
                </div>

                {viewQueueItem.data && (
                  <div>
                    <Label className="font-medium">Additional Data</Label>
                    <div className="mt-1">
                      <QueueItemDataTemplate data={viewQueueItem.data} />
                    </div>
                  </div>
                )}

                <NotesSection item={viewQueueItem} />
              </div>
            )}
            {viewQueueItem && (
              <div className="flex gap-2 pt-4 border-t">
                {viewQueueItem.status === "pending" && (
                  <Button 
                    onClick={() => setPickUpItem(viewQueueItem)}
                    disabled={assignMutation.isPending}
                    data-testid={`button-pick-up-dialog-${viewQueueItem.id}`}
                  >
                    Pick Up
                  </Button>
                )}
                {viewQueueItem.status === "in_progress" && viewQueueItem.assignedTo === user?.id && (
                  <>
                    <Button 
                      onClick={() => {
                        setWorkModuleItem(viewQueueItem);
                        setIsWorkModuleOpen(true);
                      }}
                      data-testid={`button-start-work-${viewQueueItem.id}`}
                    >
                      Start Work
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => completeMutation.mutate(viewQueueItem.id)}
                      disabled={completeMutation.isPending}
                    >
                      Mark Complete
                    </Button>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <PickUpRequestDialog
          isOpen={!!pickUpItem}
          onClose={() => setPickUpItem(null)}
          onPickUp={(agentId) => {
            if (pickUpItem) {
              assignMutation.mutate({ queueItemId: pickUpItem.id, assigneeId: agentId });
            }
          }}
          users={users}
          queueModule="tools"
          isLoading={assignMutation.isPending}
          currentUser={user ?? undefined}
        />

        <WorkModuleDialog
          isOpen={isWorkModuleOpen}
          onOpenChange={setIsWorkModuleOpen}
          queueItem={workModuleItem as QueueItem | null}
          module="tools"
          currentUser={user ?? undefined}
          users={users}
          onTaskCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
            setViewQueueItem(null);
          }}
        />
      </div>
    </MainContent>
  );
}

function NotesSection({ item }: { item: ToolsQueueItem }) {
  const [notes, setNotes] = useState(item.notes || "");
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  const updateNotesMutation = useMutation({
    mutationFn: (newNotes: string) =>
      apiRequest("PATCH", `/api/tools-queue/${item.id}/notes`, { notes: newNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Notes updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateNotesMutation.mutate(notes);
  };

  const handleCancel = () => {
    setNotes(item.notes || "");
    setIsEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-semibold">Notes</Label>
        {!isEditing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            data-testid="button-edit-notes"
          >
            Edit Notes
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={updateNotesMutation.isPending}
              data-testid="button-cancel-notes"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateNotesMutation.isPending}
              data-testid="button-save-notes"
            >
              <Save className="h-4 w-4 mr-1" />
              {updateNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>
      
      {isEditing ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about your work on this item..."
          className="min-h-[100px] bg-amber-50 border-amber-300 text-amber-900 placeholder:text-amber-500 dark:bg-amber-900 dark:border-amber-600 dark:text-amber-100 dark:placeholder:text-amber-300"
          data-testid="textarea-notes"
        />
      ) : (
        <div className="p-3 bg-muted rounded border min-h-[100px]" data-testid="display-notes">
          {item.notes ? (
            <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes added yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
