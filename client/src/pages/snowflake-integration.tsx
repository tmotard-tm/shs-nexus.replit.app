import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { Database, CheckCircle, XCircle, Loader2, Play } from "lucide-react";
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

export default function SnowflakeIntegration() {
  const { toast } = useToast();
  const [sqlQuery, setSqlQuery] = useState("SELECT CURRENT_VERSION() as version, CURRENT_USER() as user, CURRENT_DATABASE() as database");
  const [queryResults, setQueryResults] = useState<any[] | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<{ configured: boolean }>({
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
        setQueryResults(data.data);
        toast({
          title: "Query Executed",
          description: `Returned ${data.data.length} row(s)`,
        });
      } else {
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

  return (
    <MainContent>
      <TopBar 
        title="Snowflake Data Warehouse" 
        breadcrumbs={["Home", "Integrations Management", "Snowflake"]}
      />
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
          <CardContent>
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
    </MainContent>
  );
}
