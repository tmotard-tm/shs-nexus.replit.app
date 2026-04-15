import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Package } from "lucide-react";
import { useLocation } from "wouter";

interface WeeklyCount {
  weekStart: string;
  weekEnd: string;
  count: number;
}

export default function ProcurementHistory() {
  const [, navigate] = useLocation();

  const { data: weeklyCounts = [], isLoading } = useQuery<WeeklyCount[]>({
    queryKey: ["/api/fs/decommissioning/procurement-weekly-counts"],
  });

  const totalSent = weeklyCounts.reduce((sum, w) => sum + w.count, 0);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-");
    return `${m}/${d}/${y}`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/fleet-scope/decommissioning")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Decommissioning
        </Button>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Package className="h-5 w-5 text-emerald-600" />
          Procurement History
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total (Last 10 Weeks)</p>
            <p className="text-3xl font-bold">{totalSent}</p>
          </CardContent>
        </Card>
        {weeklyCounts.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">This Week</p>
              <p className="text-3xl font-bold">{weeklyCounts[0]?.count ?? 0}</p>
              <p className="text-xs text-muted-foreground">{formatDate(weeklyCounts[0]?.weekStart)} – {formatDate(weeklyCounts[0]?.weekEnd)}</p>
            </CardContent>
          </Card>
        )}
        {weeklyCounts.length > 1 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Last Week</p>
              <p className="text-3xl font-bold">{weeklyCounts[1]?.count ?? 0}</p>
              <p className="text-xs text-muted-foreground">{formatDate(weeklyCounts[1]?.weekStart)} – {formatDate(weeklyCounts[1]?.weekEnd)}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly Breakdown (Mon – Sun)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead className="text-right">Vehicles Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeklyCounts.map((w, i) => (
                  <TableRow key={w.weekStart} className={i === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 font-medium" : ""}>
                    <TableCell>{i === 0 ? "Current Week" : i === 1 ? "Last Week" : `${i} Weeks Ago`}</TableCell>
                    <TableCell>{formatDate(w.weekStart)}</TableCell>
                    <TableCell>{formatDate(w.weekEnd)}</TableCell>
                    <TableCell className="text-right font-mono text-lg">{w.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
