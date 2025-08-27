import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { RequestItem } from "@/components/request-item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Request } from "@shared/schema";
import { BackButton } from "@/components/ui/back-button";
import { useState } from "react";
import { Search } from "lucide-react";

export default function RequestsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: allRequests, isLoading } = useQuery({
    queryKey: ["/api/requests"],
  });

  const filteredRequests = (allRequests as Request[])?.filter((request) => {
    const matchesSearch = request.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         request.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || request.status === statusFilter;
    const matchesType = typeFilter === "all" || request.type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  }) || [];

  const requestStats = {
    total: (allRequests as Request[])?.length || 0,
    pending: (allRequests as Request[])?.filter(r => r.status === "pending").length || 0,
    approved: (allRequests as Request[])?.filter(r => r.status === "approved").length || 0,
    denied: (allRequests as Request[])?.filter(r => r.status === "denied").length || 0,
  };

  return (
    <div className="flex-1 ml-64">
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
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-all-types">All Types</SelectItem>
                  <SelectItem value="api_access" data-testid="option-api-access">API Access</SelectItem>
                  <SelectItem value="snowflake_query" data-testid="option-snowflake-query">Snowflake Query</SelectItem>
                  <SelectItem value="system_config" data-testid="option-system-config">System Config</SelectItem>
                  <SelectItem value="user_permission" data-testid="option-user-permission">User Permission</SelectItem>
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
      </main>
    </div>
  );
}
