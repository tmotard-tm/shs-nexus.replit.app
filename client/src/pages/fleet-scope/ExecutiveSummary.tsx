import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Truck, type TruckConsolidation, MAIN_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TruckIcon, 
  Search,
  Wrench,
  XCircle,
  Tag,
  Calendar,
  Warehouse,
  Navigation,
  CheckCircle,
  BarChart3,
  DollarSign,
  History,
  Plus,
  Minus,
} from "lucide-react";

const statusConfig: Record<MainStatus, { icon: typeof TruckIcon; color: string; bgColor: string; borderColor: string }> = {
  "Confirming Status": { 
    icon: Search, 
    color: "text-amber-600", 
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-200 dark:border-amber-800"
  },
  "Decision Pending": { 
    icon: BarChart3, 
    color: "text-purple-600", 
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
    borderColor: "border-purple-200 dark:border-purple-800"
  },
  "Repairing": { 
    icon: Wrench, 
    color: "text-blue-600", 
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800"
  },
  "Declined Repair": { 
    icon: XCircle, 
    color: "text-red-600", 
    bgColor: "bg-red-50 dark:bg-red-900/20",
    borderColor: "border-red-200 dark:border-red-800"
  },
  "Approved for sale": { 
    icon: DollarSign, 
    color: "text-emerald-600", 
    bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
    borderColor: "border-emerald-200 dark:border-emerald-800"
  },
  "Tags": { 
    icon: Tag, 
    color: "text-orange-600", 
    bgColor: "bg-orange-50 dark:bg-orange-900/20",
    borderColor: "border-orange-200 dark:border-orange-800"
  },
  "Scheduling": { 
    icon: Calendar, 
    color: "text-teal-600", 
    bgColor: "bg-teal-50 dark:bg-teal-900/20",
    borderColor: "border-teal-200 dark:border-teal-800"
  },
  "PMF": { 
    icon: Warehouse, 
    color: "text-indigo-600", 
    bgColor: "bg-indigo-50 dark:bg-indigo-900/20",
    borderColor: "border-indigo-200 dark:border-indigo-800"
  },
  "In Transit": { 
    icon: Navigation, 
    color: "text-cyan-600", 
    bgColor: "bg-cyan-50 dark:bg-cyan-900/20",
    borderColor: "border-cyan-200 dark:border-cyan-800"
  },
  "On Road": { 
    icon: CheckCircle, 
    color: "text-green-600", 
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800"
  },
  "Needs truck assigned": { 
    icon: TruckIcon, 
    color: "text-slate-600", 
    bgColor: "bg-slate-50 dark:bg-slate-900/20",
    borderColor: "border-slate-200 dark:border-slate-800"
  },
  "Available to be assigned": { 
    icon: TruckIcon, 
    color: "text-lime-600", 
    bgColor: "bg-lime-50 dark:bg-lime-900/20",
    borderColor: "border-lime-200 dark:border-lime-800"
  },
  "Relocate Van": { 
    icon: Navigation, 
    color: "text-pink-600", 
    bgColor: "bg-pink-50 dark:bg-pink-900/20",
    borderColor: "border-pink-200 dark:border-pink-800"
  },
  "NLWC - Return Rental": { 
    icon: TruckIcon, 
    color: "text-rose-600", 
    bgColor: "bg-rose-50 dark:bg-rose-900/20",
    borderColor: "border-rose-200 dark:border-rose-800"
  },
  "Truck Swap": { 
    icon: TruckIcon, 
    color: "text-cyan-600", 
    bgColor: "bg-cyan-50 dark:bg-cyan-900/20",
    borderColor: "border-cyan-200 dark:border-cyan-800"
  },
};

interface StatusCount {
  mainStatus: MainStatus;
  count: number;
  percentage: number;
}

export default function ExecutiveSummary() {
  const { data: trucks, isLoading } = useQuery<Truck[]>({
    queryKey: ["/api/fs/trucks"],
  });

  const { data: consolidationHistory } = useQuery<TruckConsolidation[]>({
    queryKey: ["/api/fs/truck-consolidations"],
  });

  const statusCounts: StatusCount[] = MAIN_STATUSES.map((status) => {
    const count = trucks?.filter((t) => t.mainStatus === status).length || 0;
    const percentage = trucks && trucks.length > 0 ? Math.round((count / trucks.length) * 100) : 0;
    return { mainStatus: status, count, percentage };
  });

  const totalTrucks = trucks?.length || 0;

  if (isLoading) {
    return (
      <div className="bg-background">
        <main className="px-4 lg:px-8 py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <main className="px-4 lg:px-8 py-6">
        <h1 className="text-xl font-semibold mb-6" data-testid="text-page-title">Executive Summary</h1>
        <div className="mb-8">
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Vehicles in System</p>
                  <p className="text-5xl font-bold text-primary" data-testid="text-total-trucks">{totalTrucks}</p>
                </div>
                <TruckIcon className="w-16 h-16 text-primary/30" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {statusCounts.map(({ mainStatus, count, percentage }) => {
            const config = statusConfig[mainStatus];
            const Icon = config.icon;
            
            return (
              <Link key={mainStatus} href={`/?mainStatus=${encodeURIComponent(mainStatus)}`}>
                <Card 
                  className={`${config.bgColor} ${config.borderColor} border-2 transition-all hover:scale-[1.02] cursor-pointer h-full`}
                  data-testid={`card-status-${mainStatus.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-background/50`}>
                        <Icon className={`w-5 h-5 ${config.color}`} />
                      </div>
                      <span className={`text-base font-semibold ${config.color}`}>{mainStatus}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className={`text-4xl font-bold ${config.color}`} data-testid={`text-count-${mainStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                          {count}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          vehicles
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-semibold ${config.color}`}>
                          {percentage}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          of vehicles
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-4 h-2 bg-background/50 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${config.color.replace('text-', 'bg-')} opacity-60 transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {statusCounts
                  .sort((a, b) => b.count - a.count)
                  .map(({ mainStatus, count, percentage }) => {
                    const config = statusConfig[mainStatus];
                    const Icon = config.icon;
                    
                    return (
                      <div key={mainStatus} className="flex items-center gap-4">
                        <div className={`p-1.5 rounded ${config.bgColor}`}>
                          <Icon className={`w-4 h-4 ${config.color}`} />
                        </div>
                        <span className="text-sm font-medium min-w-[140px]">{mainStatus}</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${config.color.replace('text-', 'bg-')} opacity-40 flex items-center justify-end pr-2 transition-all duration-500`}
                            style={{ width: `${Math.max(percentage, 5)}%` }}
                          >
                            {percentage >= 10 && (
                              <span className="text-xs font-medium text-foreground">{count}</span>
                            )}
                          </div>
                        </div>
                        {percentage < 10 && (
                          <span className="text-sm font-medium min-w-[40px] text-right">{count}</span>
                        )}
                        <span className="text-sm text-muted-foreground min-w-[45px] text-right">{percentage}%</span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="w-5 h-5" />
                Consolidation History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {consolidationHistory && consolidationHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Week</th>
                        <th className="text-left p-2 font-medium">Date</th>
                        <th className="text-left p-2 font-medium">By</th>
                        <th className="text-center p-2 font-medium">
                          <span className="flex items-center justify-center gap-1">
                            <Plus className="w-3 h-3 text-green-600" /> Added
                          </span>
                        </th>
                        <th className="text-center p-2 font-medium">
                          <span className="flex items-center justify-center gap-1">
                            <Minus className="w-3 h-3 text-red-600" /> Removed
                          </span>
                        </th>
                        <th className="text-center p-2 font-medium">Unchanged</th>
                        <th className="text-center p-2 font-medium">Total List</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consolidationHistory.slice(0, 10).map((record) => {
                        const addedTrucks = record.addedTrucks ? JSON.parse(record.addedTrucks) : [];
                        const removedTrucks = record.removedTrucks ? JSON.parse(record.removedTrucks) : [];
                        const consolidatedDate = record.consolidatedAt ? new Date(record.consolidatedAt) : null;
                        
                        return (
                          <tr key={record.id} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-mono text-xs">
                              {record.weekYear && record.weekNumber 
                                ? `W${record.weekNumber} '${String(record.weekYear).slice(-2)}`
                                : "-"}
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {consolidatedDate 
                                ? consolidatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                                : "-"}
                            </td>
                            <td className="p-2">{record.consolidatedBy || "-"}</td>
                            <td className="p-2 text-center">
                              {record.addedCount > 0 ? (
                                <span 
                                  className="inline-flex items-center justify-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium cursor-help"
                                  title={addedTrucks.length > 0 ? `Added: ${addedTrucks.join(", ")}` : ""}
                                >
                                  +{record.addedCount}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              {record.removedCount > 0 ? (
                                <span 
                                  className="inline-flex items-center justify-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium cursor-help"
                                  title={removedTrucks.length > 0 ? `Removed: ${removedTrucks.join(", ")}` : ""}
                                >
                                  -{record.removedCount}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="p-2 text-center text-muted-foreground">
                              {record.unchangedCount}
                            </td>
                            <td className="p-2 text-center font-medium">
                              {record.totalInList}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {consolidationHistory.length > 10 && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Showing 10 of {consolidationHistory.length} consolidations
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No consolidation history yet</p>
                  <p className="text-xs mt-1">Use the Consolidate button on the Dashboard to sync truck lists</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
