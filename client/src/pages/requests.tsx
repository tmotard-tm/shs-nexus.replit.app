import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { RequestItem } from "@/components/request-item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Request } from "@shared/schema";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { useState } from "react";
import { Search, Calendar, User, Target, AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";

export default function RequestsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: allRequests, isLoading } = useQuery({
    queryKey: ["/api/requests"],
  });

  const filteredRequests = (allRequests as Request[])?.filter((request) => {
    const matchesSearch = request.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         request.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || request.status === statusFilter;
    
    let matchesType = true;
    if (typeFilter !== "all") {
      switch (typeFilter) {
        case "ntao":
          matchesType = request.title.toLowerCase().includes("ntao") || request.description.toLowerCase().includes("ntao");
          break;
        case "vehicle_assignment":
          matchesType = request.title.toLowerCase().includes("vehicle assignment") || request.title.toLowerCase().includes("van") || request.title.toLowerCase().includes("transit");
          break;
        case "assets_supplies":
          matchesType = request.title.toLowerCase().includes("assets") || request.title.toLowerCase().includes("supplies") || request.title.toLowerCase().includes("day 1");
          break;
        case "decommission":
          matchesType = request.title.toLowerCase().includes("decommission") || request.description.toLowerCase().includes("decommission");
          break;
        default:
          matchesType = request.type === typeFilter;
      }
    }
    
    return matchesSearch && matchesStatus && matchesType;
  }) || [];

  const requestStats = {
    total: (allRequests as Request[])?.length || 0,
    pending: (allRequests as Request[])?.filter(r => r.status === "pending").length || 0,
    approved: (allRequests as Request[])?.filter(r => r.status === "approved").length || 0,
    denied: (allRequests as Request[])?.filter(r => r.status === "denied").length || 0,
  };

  return (
    <MainContent>
      <TopBar 
        title="All Requests" 
        breadcrumbs={["Home", "Requests"]}
      />
      
      <main className="p-6">
        <BackButton href="/" />
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mr-4">
                <i className="fas fa-list text-primary"></i>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-requests">{requestStats.total}</p>
                <p className="text-sm text-muted-foreground">Total Requests</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-[hsl(var(--chart-1))]/10 rounded-lg flex items-center justify-center mr-4">
                <i className="fas fa-clock text-[hsl(var(--chart-1))]"></i>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-pending-requests">{requestStats.pending}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-[hsl(var(--chart-2))]/10 rounded-lg flex items-center justify-center mr-4">
                <i className="fas fa-check text-[hsl(var(--chart-2))]"></i>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-approved-requests">{requestStats.approved}</p>
                <p className="text-sm text-muted-foreground">Approved</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-destructive/10 rounded-lg flex items-center justify-center mr-4">
                <i className="fas fa-times text-destructive"></i>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-denied-requests">{requestStats.denied}</p>
                <p className="text-sm text-muted-foreground">Denied</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle data-testid="text-filters-title">Filter Requests</CardTitle>
            <CardDescription>
              Search and filter requests by status, type, and keywords
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search requests..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-all-status">All Status</SelectItem>
                  <SelectItem value="pending" data-testid="option-pending">Pending</SelectItem>
                  <SelectItem value="approved" data-testid="option-approved">Approved</SelectItem>
                  <SelectItem value="denied" data-testid="option-denied">Denied</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter} data-testid="select-type-filter">
                <SelectTrigger>
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-all-types">All Categories</SelectItem>
                  <SelectItem value="ntao" data-testid="option-ntao">NTAO Requests</SelectItem>
                  <SelectItem value="vehicle_assignment" data-testid="option-vehicle-assignment">Van Assignment Requests</SelectItem>
                  <SelectItem value="assets_supplies" data-testid="option-assets-supplies">Asset & Supplies Requests</SelectItem>
                  <SelectItem value="decommission" data-testid="option-decommission">Decommission Requests</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Requests List */}
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-requests-list-title">
              Requests ({filteredRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                ))}
              </div>
            ) : filteredRequests.length > 0 ? (
              <div className="space-y-4">
                {filteredRequests.map((request) => (
                  <RequestItem
                    key={request.id}
                    request={{ ...request, requesterName: "User" }}
                    onView={(req) => {
                      setSelectedRequest(req);
                      setIsDialogOpen(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground" data-testid="text-no-matching-requests">
                  {searchTerm || statusFilter !== "all" || typeFilter !== "all" 
                    ? "No requests match your filters" 
                    : "No requests found"
                  }
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Request Detail Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-file-alt text-primary"></i>
                </div>
                {selectedRequest?.title}
              </DialogTitle>
              <DialogDescription>
                Request Details and Information
              </DialogDescription>
            </DialogHeader>
            
            {selectedRequest && (
              <div className="space-y-6">
                {/* Status and Priority */}
                <div className="flex items-center gap-4">
                  <Badge 
                    variant={selectedRequest.status === "approved" ? "default" : selectedRequest.status === "denied" ? "destructive" : "secondary"}
                    className={`flex items-center gap-2 ${
                      selectedRequest.status === "pending" ? "bg-[hsl(var(--chart-1))]/10 text-[hsl(var(--chart-1))]" :
                      selectedRequest.status === "approved" ? "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]" : ""
                    }`}
                  >
                    {selectedRequest.status === "pending" && <Clock className="h-3 w-3" />}
                    {selectedRequest.status === "approved" && <CheckCircle className="h-3 w-3" />}
                    {selectedRequest.status === "denied" && <XCircle className="h-3 w-3" />}
                    {selectedRequest.status.charAt(0).toUpperCase() + selectedRequest.status.slice(1)}
                  </Badge>
                  <Badge variant="outline" className="flex items-center gap-2">
                    <AlertCircle className="h-3 w-3" />
                    {selectedRequest.priority.charAt(0).toUpperCase() + selectedRequest.priority.slice(1)} Priority
                  </Badge>
                </div>

                {/* Description */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Description</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground leading-relaxed">
                      {selectedRequest.description}
                    </p>
                  </CardContent>
                </Card>

                {/* Request Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
                          <User className="h-5 w-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Requester ID</p>
                          <p className="font-medium">{selectedRequest.requesterId}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
                          <Target className="h-5 w-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Target API/Team</p>
                          <p className="font-medium">{selectedRequest.targetApi || "General"}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
                          <Calendar className="h-5 w-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Created</p>
                          <p className="font-medium">{new Date(selectedRequest.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
                          <Calendar className="h-5 w-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Last Updated</p>
                          <p className="font-medium">{new Date(selectedRequest.updatedAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Approver Info (if available) */}
                {selectedRequest.approverId && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Approval Information</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[hsl(var(--chart-2))]/10 rounded-lg flex items-center justify-center">
                          <CheckCircle className="h-5 w-5 text-[hsl(var(--chart-2))]" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Approver ID</p>
                          <p className="font-medium">{selectedRequest.approverId}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Close
                  </Button>
                  {selectedRequest.status === "pending" && (
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm">
                        Deny Request
                      </Button>
                      <Button size="sm">
                        Approve Request
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </MainContent>
  );
}
