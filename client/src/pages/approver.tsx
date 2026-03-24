import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { CheckCircle2, XCircle, Clock, ClipboardList, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ApproverPage() {
  const { toast } = useToast();

  const { data: requests, isLoading } = useQuery<any[]>({
    queryKey: ["/api/requests"],
  });

  const pendingRequests = requests?.filter((r: any) => r.status === "pending") ?? [];
  const recentlyActioned = requests?.filter((r: any) => ["approved","denied","rejected"].includes(r.status)).slice(0, 10) ?? [];

  const actionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/requests/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Request updated" });
    },
    onError: () => {
      toast({ title: "Error updating request", variant: "destructive" });
    },
  });

  const statusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "approved": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "denied": case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Approver Interface</h1>
          <p className="text-muted-foreground text-sm">Review and approve pending requests</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/queue-management">
            <Eye className="h-4 w-4 mr-1.5" />Full Queue
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{pendingRequests.length}</p>
                <p className="text-xs text-muted-foreground">Awaiting Approval</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{requests?.filter((r: any) => r.status === "approved").length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Approved</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{requests?.filter((r: any) => ["denied","rejected"].includes(r.status)).length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Denied</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-500" />Pending Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No pending requests. All caught up!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingRequests.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{req.type || req.requestType || "Request"} — {req.techName || req.employeeName || req.id}</p>
                    <p className="text-xs text-muted-foreground">By {req.requestedBy || req.requesterLdap || "Unknown"} · {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => actionMutation.mutate({ id: req.id, status: "approved" })}
                      disabled={actionMutation.isPending}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      onClick={() => actionMutation.mutate({ id: req.id, status: "denied" })}
                      disabled={actionMutation.isPending}
                    >
                      <XCircle className="h-3 w-3 mr-1" />Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {recentlyActioned.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />Recently Actioned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentlyActioned.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{req.type || req.requestType || "Request"} — {req.techName || req.employeeName || req.id}</p>
                    <p className="text-xs text-muted-foreground">{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}</p>
                  </div>
                  <Badge className={`text-xs border-none shrink-0 ${statusColor(req.status)}`}>{req.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
