import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BackButton } from "@/components/ui/back-button";
import { Database, CheckCircle, XCircle, Loader2, Play, RefreshCw, Users, History, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SyncLog } from "@shared/schema";

export default function SnowflakeIntegration() {
  const { toast } = useToast();
  const [sqlQuery, setSqlQuery] = useState("SELECT CURRENT_VERSION() as version, CURRENT_USER() as user, CURRENT_DATABASE() as database");
  const [queryResults, setQueryResults] = useState<any[] | null>(null);

  const { data: syncLogs = [], isLoading: syncLogsLoading } = useQuery<SyncLog[]>({
    queryKey: ["/api/sync-logs"],
    refetchInterval: 30000,
  });

  const { data: status, isLoading: statusLoading } = useQuery<{ 
    configured: boolean;
    diagnostics?: {
      environment: string;
      envVars: {
        SNOWFLAKE_ACCOUNT: string;
        SNOWFLAKE_USER: string;
        SNOWFLAKE_PRIVATE_KEY: string;
        SNOWFLAKE_DATABASE: string;
        SNOWFLAKE_WAREHOUSE: string;
      };
    };
  }>({
    queryKey: ["/api/snowflake/status"],
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/snowflake/test");
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Test Failed",
        description: error.message || "Failed to test Snowflake connection",
        variant: "destructive",
      });
    },
  });

  const executeQueryMutation = useMutation({
    mutationFn: async (sql: string) => {
      const response = await apiRequest("POST", "/api/snowflake/query", { sql });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        console.log('[Snowflake] Query successful, rows:', data.data?.length, 'Sample:', data.data?.[0]);
        setQueryResults(data.data);
        toast({
          title: "Query Executed Successfully",
          description: `Returned ${data.data.length} row(s). Scroll down to see results.`,
        });
      } else {
        console.error('[Snowflake] Query failed:', data.message);
        setQueryResults(null);
        toast({
          title: "Query Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Query Execution Failed",
        description: error.message || "Failed to execute query",
        variant: "destructive",
      });
    },
  });

  const syncTermedTechsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/snowflake/sync/termed-techs");
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/snowflake/sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/termed-techs'] });
      if (data.success) {
        toast({
          title: "Sync Completed",
          description: `Processed ${data.recordsProcessed} employees. Created ${data.queueItemsCreated} queue items.`,
        });
      } else {
        toast({
          title: "Sync Failed",
          description: data.errors?.join(', ') || "Failed to sync termed employees",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync termed employees",
        variant: "destructive",
      });
    },
  });

  const handleExecuteQuery = () => {
    if (!sqlQuery.trim()) {
      toast({
        title: "Empty Query",
        description: "Please enter a SQL query",
        variant: "destructive",
      });
      return;
    }
    setQueryResults(null);
    executeQueryMutation.mutate(sqlQuery);
  };

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = sqlQuery.substring(0, start) + '\t' + sqlQuery.substring(end);
      setSqlQuery(newValue);
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      }, 0);
    }
  };

  return (
    <>
      <TopBar 
        title="Snowflake Data Warehouse" 
        breadcrumbs={["Home", "Integrations Management", "Snowflake"]}
      />
      <main className="flex-1 overflow-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackButton href="/api-management" />
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Database className="h-8 w-8" />
                Snowflake Integration
              </h1>
              <p className="text-muted-foreground mt-1">
                Execute queries and manage Snowflake data warehouse connections
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Connection Status</span>
              {statusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : status?.configured ? (
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <XCircle className="h-4 w-4" />
                  Not Configured
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Test your Snowflake connection using key pair authentication
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => testConnectionMutation.mutate()}
              disabled={!status?.configured || testConnectionMutation.isPending}
              data-testid="button-test-connection"
            >
              {testConnectionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
            
            {status?.diagnostics && (
              <div className="mt-4 p-4 bg-muted rounded-lg text-sm">
                <h4 className="font-semibold mb-2">Configuration Diagnostics</h4>
                <div className="space-y-1">
                  <div><span className="font-medium">Environment:</span> {status.diagnostics.environment}</div>
                  <div className="mt-2 font-medium">Environment Variables:</div>
                  <ul className="list-disc list-inside pl-2 space-y-1">
                    <li className={status.diagnostics.envVars.SNOWFLAKE_ACCOUNT === 'missing' ? 'text-destructive' : ''}>
                      SNOWFLAKE_ACCOUNT: {status.diagnostics.envVars.SNOWFLAKE_ACCOUNT}
                    </li>
                    <li className={status.diagnostics.envVars.SNOWFLAKE_USER === 'missing' ? 'text-destructive' : ''}>
                      SNOWFLAKE_USER: {status.diagnostics.envVars.SNOWFLAKE_USER}
                    </li>
                    <li className={status.diagnostics.envVars.SNOWFLAKE_PRIVATE_KEY === 'missing' ? 'text-destructive' : ''}>
                      SNOWFLAKE_PRIVATE_KEY: {status.diagnostics.envVars.SNOWFLAKE_PRIVATE_KEY}
                    </li>
                    <li className={status.diagnostics.envVars.SNOWFLAKE_DATABASE === 'missing' ? 'text-destructive' : ''}>
                      SNOWFLAKE_DATABASE: {status.diagnostics.envVars.SNOWFLAKE_DATABASE}
                    </li>
                    <li className={status.diagnostics.envVars.SNOWFLAKE_WAREHOUSE === 'missing' ? 'text-destructive' : ''}>
                      SNOWFLAKE_WAREHOUSE: {status.diagnostics.envVars.SNOWFLAKE_WAREHOUSE}
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Create Offboarding Tasks
            </CardTitle>
            <CardDescription>
              Create offboarding queue items for recently terminated employees
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will identify recently terminated employees (effective date within last 30 days) from the unified employee roster
              and create Day 0 offboarding tasks in NTAO, Assets, Fleet, and Inventory queues.
            </p>
            <Button
              onClick={() => syncTermedTechsMutation.mutate()}
              disabled={syncTermedTechsMutation.isPending}
              data-testid="button-sync-termed-techs"
            >
              {syncTermedTechsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing Employees...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Termed Employees
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Sync History
            </CardTitle>
            <CardDescription>
              View recent synchronization activity and results
            </CardDescription>
          </CardHeader>
          <CardContent>
            {syncLogsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : syncLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sync history available yet.
              </div>
            ) : (
              <div className="rounded-md border overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead>Queue Items</TableHead>
                      <TableHead>Triggered By</TableHead>
                      <TableHead>Errors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncLogs.slice(0, 25).map((log) => {
                      const startTime = new Date(log.startedAt);
                      const endTime = log.completedAt ? new Date(log.completedAt) : null;
                      const duration = endTime 
                        ? Math.round((endTime.getTime() - startTime.getTime()) / 1000)
                        : null;
                      
                      return (
                        <TableRow key={log.id} data-testid={`row-sync-${log.id}`}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">
                              {log.syncType === 'termed_techs' ? 'Termed Techs' : 'All Techs'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={
                                log.status === 'completed' ? 'default' :
                                log.status === 'failed' ? 'destructive' :
                                log.status === 'running' ? 'secondary' : 'outline'
                              }
                              className="flex items-center gap-1 w-fit"
                            >
                              {log.status === 'completed' && <CheckCircle className="h-3 w-3" />}
                              {log.status === 'failed' && <XCircle className="h-3 w-3" />}
                              {log.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {startTime.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm">
                            {duration !== null ? `${duration}s` : '-'}
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {log.recordsProcessed || 0}
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {log.queueItemsCreated || 0}
                          </TableCell>
                          <TableCell className="text-sm">
                            <Badge variant="outline" className="text-xs">
                              {log.triggeredBy || 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {log.errorMessage ? (
                              <div className="flex items-center gap-1 text-destructive">
                                <AlertTriangle className="h-3 w-3" />
                                <span className="text-xs max-w-[200px] truncate" title={log.errorMessage}>
                                  {log.errorMessage}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">None</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SQL Query</CardTitle>
            <CardDescription>
              Execute SQL queries against your Snowflake database
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="sql-query">SQL Query</Label>
              <Textarea
                id="sql-query"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                onKeyDown={handleTabKey}
                placeholder="Enter your SQL query here..."
                className="font-mono min-h-[150px]"
                data-testid="textarea-sql-query"
              />
            </div>
            <Button
              onClick={handleExecuteQuery}
              disabled={!status?.configured || executeQueryMutation.isPending}
              data-testid="button-execute-query"
            >
              {executeQueryMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Execute Query
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {queryResults && queryResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Query Results</CardTitle>
              <CardDescription>
                {queryResults.length} row(s) returned
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(queryResults[0]).map((column) => (
                        <TableHead key={column} className="font-semibold">
                          {column}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queryResults.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-result-${idx}`}>
                        {Object.values(row).map((value: any, cellIdx) => (
                          <TableCell key={cellIdx} className="font-mono text-sm">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {queryResults && queryResults.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Query executed successfully but returned no rows.
            </CardContent>
          </Card>
        )}
      </div>
      </main>
    </>
  );
}
