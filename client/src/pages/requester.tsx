import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Plus, ClipboardList, Clock, CheckCircle2, XCircle, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function RequesterPage() {
  const { user } = useAuth();

  const { data: requests, isLoading } = useQuery<any[]>({
    queryKey: ["/api/requests"],
  });

  const myRequests = requests?.filter((r: any) => r.requestedBy === user?.username || r.requesterLdap === user?.username) ?? [];

  const statusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "approved": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "denied": case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      case "in_progress": case "in progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requester Interface</h1>
          <p className="text-muted-foreground text-sm">Submit and track your fleet requests</p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/onboard-hire">
              <Plus className="h-4 w-4 mr-1.5" />New Onboarding
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/offboard-technician">
              <Plus className="h-4 w-4 mr-1.5" />New Offboarding
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{myRequests.filter((r: any) => r.status === "pending").length}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{myRequests.filter((r: any) => r.status === "approved").length}</p>
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
                <p className="text-2xl font-bold">{myRequests.filter((r: any) => ["denied","rejected"].includes(r.status)).length}</p>
                <p className="text-xs text-muted-foreground">Denied</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />My Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : myRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No requests found for your account.</p>
              <p className="text-xs mt-1">Use the buttons above to submit a new request.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myRequests.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{req.type || req.requestType || "Request"} — {req.techName || req.employeeName || req.id}</p>
                    <p className="text-xs text-muted-foreground">{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}</p>
                  </div>
                  <Badge className={`text-xs border-none shrink-0 ${statusColor(req.status)}`}>{req.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
