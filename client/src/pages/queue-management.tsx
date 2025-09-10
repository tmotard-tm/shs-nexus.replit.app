import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Clock, User, CheckCircle, XCircle, AlertCircle, Filter, Plus, Eye, Settings, List, Calendar } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import type { QueueItem, InsertQueueItem, User as UserType } from "@shared/schema";

export default function QueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [searchRequestId, setSearchRequestId] = useState<string>("");
  const [searchServiceOrder, setSearchServiceOrder] = useState<string>("");
  const [selectedResolution, setSelectedResolution] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("new");
  const [viewQueueItem, setViewQueueItem] = useState<QueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch queue items
  const { data: queueItems = [], isLoading } = useQuery({
    queryKey: ["/api/queue", selectedFilter, selectedWorkflowType],
    queryFn: async () => {
      let url = "/api/queue";
      const params = new URLSearchParams();
      
      if (selectedFilter === "my-items") {
        params.append("userId", user?.id || "");
      } else if (selectedFilter === "assigned-to-me") {
        params.append("assignedTo", user?.id || "");
      } else if (selectedFilter !== "all") {
        params.append("status", selectedFilter);
      }
      
      if (selectedWorkflowType !== "all") {
        params.append("workflowType", selectedWorkflowType);
      }
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await apiRequest("GET", url);
      return response.json();
    },
  });

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      // Since we don't have a users endpoint yet, we'll use mock data
      return [
        { id: "1", username: "ENT1234", email: "requester@sears.com", password: "", role: "requester", createdAt: new Date() },
        { id: "2", username: "ENT1235", email: "approver@sears.com", password: "", role: "approver", createdAt: new Date() },
        { id: "3", username: "ADMIN123", email: "admin@sears.com", password: "", role: "admin", createdAt: new Date() },
      ];
    },
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: async ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) => {
      const response = await apiRequest("PATCH", `/api/queue/${queueItemId}/assign`, {
        assigneeId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({
        title: "Success",
        description: "Queue item assigned successfully",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (queueItemId: string) => {
      const response = await apiRequest("PATCH", `/api/queue/${queueItemId}/complete`, {
        completedBy: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({
        title: "Success",
        description: "Queue item marked as completed",
      });
    },
  });

  // Calculate stats
  const newTasksCount = queueItems.filter((item: QueueItem) => item.status === "pending").length;
  const inProgressCount = queueItems.filter((item: QueueItem) => item.status === "in_progress").length;
  const completedCount = queueItems.filter((item: QueueItem) => item.status === "completed").length;
  const totalCount = queueItems.length;

  // Filter queue items based on active tab
  const filteredQueueItems = queueItems.filter((item: QueueItem) => {
    // Filter by tab
    if (activeTab === "new") return item.status === "pending";
    if (activeTab === "in_progress") return item.status === "in_progress";
    if (activeTab === "completed") return item.status === "completed";
    if (activeTab === "all") return true;
    
    // Apply additional filters
    let matches = true;
    
    if (searchRequestId && !item.id.toLowerCase().includes(searchRequestId.toLowerCase())) {
      matches = false;
    }
    
    if (selectedWorkflowType !== "all" && item.workflowType !== selectedWorkflowType) {
      matches = false;
    }
    
    return matches;
  });

  if (isLoading) {
    return (
      <MainContent>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading queue items...</p>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="min-h-screen bg-slate-900 text-white p-6">
        <BackButton href="/" />
        
        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-orange-500 border-orange-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">New Tasks</p>
                  <p className="text-white text-2xl font-bold">{newTasksCount}</p>
                </div>
                <Clock className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-blue-500 border-blue-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">In Progress</p>
                  <p className="text-white text-2xl font-bold">{inProgressCount}</p>
                </div>
                <Settings className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-green-500 border-green-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">Completed</p>
                  <p className="text-white text-2xl font-bold">{completedCount}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-red-500 border-red-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">Total Requests</p>
                  <p className="text-white text-2xl font-bold">{totalCount}</p>
                </div>
                <List className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="bg-slate-800 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4">
            <div>
              <Label className="text-slate-300 text-sm">Filter by Agent:</Label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-slate-300 text-sm">Search Request ID:</Label>
              <Input
                placeholder="Request ID..."
                value={searchRequestId}
                onChange={(e) => setSearchRequestId(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
              />
            </div>
            
            <div>
              <Label className="text-slate-300 text-sm">Service Order:</Label>
              <Input
                placeholder="Service Order..."
                value={searchServiceOrder}
                onChange={(e) => setSearchServiceOrder(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
              />
            </div>
            
            <div>
              <Label className="text-slate-300 text-sm">Resolution:</Label>
              <Select value={selectedResolution} onValueChange={setSelectedResolution}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                  <SelectValue placeholder="All Resolutions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Resolutions</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-slate-300 text-sm">From:</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div>
              <Label className="text-slate-300 text-sm">To:</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>
          
          <div className="flex justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setSelectedAgent("all");
                setSearchRequestId("");
                setSearchServiceOrder("");
                setSelectedResolution("all");
                setDateFrom("");
                setDateTo("");
              }}
              className="text-slate-300 border-slate-600 hover:bg-slate-700"
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-800 rounded-lg">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full bg-slate-700 grid grid-cols-4">
              <TabsTrigger value="new" className="data-[state=active]:bg-orange-500">
                <Clock className="h-4 w-4 mr-2" />
                New Tasks ({newTasksCount})
              </TabsTrigger>
              <TabsTrigger value="in_progress" className="data-[state=active]:bg-blue-500">
                <Settings className="h-4 w-4 mr-2" />
                In Progress ({inProgressCount})
              </TabsTrigger>
              <TabsTrigger value="completed" className="data-[state=active]:bg-green-500">
                <CheckCircle className="h-4 w-4 mr-2" />
                Completed ({completedCount})
              </TabsTrigger>
              <TabsTrigger value="all" className="data-[state=active]:bg-slate-600">
                <List className="h-4 w-4 mr-2" />
                All Requests
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              <div className="p-4">
                {/* Table Header */}
                <div className="grid grid-cols-9 gap-4 text-slate-300 text-sm font-medium border-b border-slate-700 pb-2 mb-4">
                  <div>ID</div>
                  <div>Submitted</div>
                  <div>Type</div>
                  <div>Title</div>
                  <div>Priority</div>
                  <div>Assigned To</div>
                  <div>Status</div>
                  <div>Actions</div>
                  <div></div>
                </div>

                {/* Table Content */}
                {filteredQueueItems.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No items found for the current filter</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredQueueItems.map((item: QueueItem) => (
                      <div key={item.id} className="grid grid-cols-9 gap-4 text-sm bg-slate-700/50 rounded p-3 hover:bg-slate-700 transition-colors">
                        <div className="text-slate-300">#{item.id.slice(0, 8)}...</div>
                        <div className="text-slate-300">{new Date(item.createdAt).toLocaleDateString()}</div>
                        <div className="text-slate-300 capitalize">{item.workflowType.replace('_', ' ')}</div>
                        <div className="text-white font-medium truncate">{item.title}</div>
                        <div>
                          <Badge variant={item.priority === 'high' ? 'destructive' : item.priority === 'medium' ? 'default' : 'secondary'}>
                            {item.priority}
                          </Badge>
                        </div>
                        <div className="text-slate-300">
                          {item.assignedTo ? users.find(u => u.id === item.assignedTo)?.username || 'Unknown' : '-'}
                        </div>
                        <div>
                          <Badge variant={item.status === 'completed' ? 'secondary' : item.status === 'in_progress' ? 'default' : 'outline'}>
                            {item.status === 'in_progress' ? 'In Progress' : item.status}
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="bg-blue-600 text-white border-blue-500 hover:bg-blue-700"
                            onClick={() => assignMutation.mutate({ queueItemId: item.id, assigneeId: user?.id || "" })}
                          >
                            Pick Up
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => setViewQueueItem(item)}
                          >
                            View
                          </Button>
                        </div>
                        <div></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Queue Item Details</DialogTitle>
              <DialogDescription>
                View and manage queue item information
              </DialogDescription>
            </DialogHeader>
            {viewQueueItem && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Title</Label>
                    <p className="text-sm text-muted-foreground">{viewQueueItem.title}</p>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Badge className="mt-1">{viewQueueItem.status}</Badge>
                  </div>
                  <div>
                    <Label>Workflow Type</Label>
                    <p className="text-sm text-muted-foreground">{viewQueueItem.workflowType}</p>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Badge className="mt-1">{viewQueueItem.priority}</Badge>
                  </div>
                </div>
                <div>
                  <Label>Description</Label>
                  <p className="text-sm text-muted-foreground">{viewQueueItem.description}</p>
                </div>
                {viewQueueItem.data && (
                  <div>
                    <Label>Data</Label>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
                      {JSON.stringify(JSON.parse(viewQueueItem.data), null, 2)}
                    </pre>
                  </div>
                )}
                <div className="flex gap-2 pt-4">
                  {viewQueueItem.status === "pending" && (
                    <Button onClick={() => assignMutation.mutate({ queueItemId: viewQueueItem.id, assigneeId: user?.id || "" })}>
                      Assign to Me
                    </Button>
                  )}
                  {viewQueueItem.status === "in_progress" && viewQueueItem.assignedTo === user?.id && (
                    <Button onClick={() => completeMutation.mutate(viewQueueItem.id)}>
                      Mark Complete
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainContent>
  );
}