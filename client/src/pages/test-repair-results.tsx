import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from "@/components/ui/back-button";
import { CheckCircle, XCircle, AlertTriangle, Wrench, FileText, Search, Code } from "lucide-react";

interface Finding {
  id: string;
  category: "obsolete_code" | "wording_inconsistency" | "bug" | "improvement";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  location: string;
  status: "fixed" | "pending" | "noted";
  fix?: string;
}

const findings: Finding[] = [
  {
    id: "1",
    category: "obsolete_code",
    severity: "high",
    title: "Obsolete 'department' field in Fleet Queue",
    description: "Using deprecated u.department instead of u.departments array for user filtering",
    location: "client/src/pages/fleet-queue.tsx:45",
    status: "fixed",
    fix: "Changed to u.departments?.includes('FLEET')"
  },
  {
    id: "2",
    category: "obsolete_code",
    severity: "high",
    title: "Obsolete 'department' field in NTAO Queue",
    description: "Using deprecated u.department instead of u.departments array for user filtering",
    location: "client/src/pages/ntao-queue.tsx:45",
    status: "fixed",
    fix: "Changed to u.departments?.includes('NTAO')"
  },
  {
    id: "3",
    category: "obsolete_code",
    severity: "high",
    title: "Obsolete 'department' field in Assets Queue",
    description: "Using deprecated u.department instead of u.departments array for user filtering",
    location: "client/src/pages/assets-queue.tsx:45",
    status: "fixed",
    fix: "Changed to u.departments?.includes('ASSETS')"
  },
  {
    id: "4",
    category: "obsolete_code",
    severity: "high",
    title: "Obsolete 'department' field in Inventory Queue",
    description: "Using deprecated u.department instead of u.departments array for user filtering",
    location: "client/src/pages/inventory-queue.tsx:47",
    status: "fixed",
    fix: "Changed to u.departments?.includes('INVENTORY')"
  },
  {
    id: "5",
    category: "obsolete_code",
    severity: "high",
    title: "Obsolete 'department' field in Decommissions Queue",
    description: "Using deprecated u.department instead of u.departments array for user filtering",
    location: "client/src/pages/decommissions-queue.tsx:39",
    status: "fixed",
    fix: "Changed to u.departments?.includes('FLEET')"
  },
  {
    id: "6",
    category: "obsolete_code",
    severity: "medium",
    title: "Deprecated termed_techs table still referenced",
    description: "The termed_techs table is deprecated but still exists in schema. Now using all_techs table with effectiveDate filter instead.",
    location: "shared/schema.ts, server/storage.ts, replit.md",
    status: "noted",
    fix: "Table kept for backward compatibility. New code uses all_techs table."
  },
  {
    id: "7",
    category: "wording_inconsistency",
    severity: "low",
    title: "Mixed 'Fleet' and 'Vehicle' terminology",
    description: "Pages use inconsistent terminology: 'Active Vehicles', 'Fleet Distribution', 'Vehicle Assignments', 'Fleet Queue'",
    location: "Multiple pages and page-registry.ts",
    status: "noted",
    fix: "Terminology is contextually appropriate: 'Fleet' for department/distribution, 'Vehicle' for individual assets"
  },
  {
    id: "8",
    category: "wording_inconsistency",
    severity: "low",
    title: "Breadcrumb inconsistency in Vehicle Assignments",
    description: "Vehicle Assignments page uses breadcrumb 'Home > Fleet > Vehicle Assignments' mixing Fleet and Vehicle terms",
    location: "client/src/pages/vehicle-assignments.tsx:192",
    status: "noted",
    fix: "Acceptable - 'Fleet' is the category, 'Vehicle Assignments' is the specific function"
  },
  {
    id: "9",
    category: "improvement",
    severity: "low",
    title: "TPMS Cache Sync using wrong ID field",
    description: "TPMS cache sync was using employeeId (numeric) instead of techRacfid (LDAP ID) for lookups",
    location: "server/tpms-cache-sync-service.ts:122",
    status: "fixed",
    fix: "Changed to use tech.techRacfid?.trim().toUpperCase()"
  },
  {
    id: "10",
    category: "improvement",
    severity: "medium",
    title: "TPMS cache increased from 109 to 1,802 entries",
    description: "After fixing the ID field issue, TPMS cache now correctly syncs all technicians (1,802 total, 314 with truck assignments)",
    location: "Database: tpms_cached_assignments",
    status: "fixed",
    fix: "Sync now uses correct techRacfid field"
  }
];

export default function TestRepairResults() {
  const [activeTab, setActiveTab] = useState("all");

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "medium": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "low": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "fixed": return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "pending": return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case "noted": return <FileText className="h-4 w-4 text-blue-600" />;
      default: return null;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "obsolete_code": return <Code className="h-4 w-4" />;
      case "wording_inconsistency": return <FileText className="h-4 w-4" />;
      case "bug": return <XCircle className="h-4 w-4" />;
      case "improvement": return <Wrench className="h-4 w-4" />;
      default: return <Search className="h-4 w-4" />;
    }
  };

  const filteredFindings = activeTab === "all" 
    ? findings 
    : findings.filter(f => f.category === activeTab);

  const stats = {
    total: findings.length,
    fixed: findings.filter(f => f.status === "fixed").length,
    noted: findings.filter(f => f.status === "noted").length,
    pending: findings.filter(f => f.status === "pending").length,
    obsolete: findings.filter(f => f.category === "obsolete_code").length,
    wording: findings.filter(f => f.category === "wording_inconsistency").length,
    improvements: findings.filter(f => f.category === "improvement").length,
  };

  return (
    <MainContent>
      <TopBar 
        title="Test and Repair Results"
        breadcrumbs={["Home", "Test and Repair Results"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Application Audit Summary
                </CardTitle>
                <CardDescription>
                  Comprehensive review of codebase for inefficiencies, inaccuracies, and inconsistencies
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <p className="text-3xl font-bold" data-testid="text-total-findings">{stats.total}</p>
                    <p className="text-sm text-muted-foreground">Total Findings</p>
                  </div>
                  <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                    <p className="text-3xl font-bold text-green-600" data-testid="text-fixed-count">{stats.fixed}</p>
                    <p className="text-sm text-muted-foreground">Fixed</p>
                  </div>
                  <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <p className="text-3xl font-bold text-blue-600" data-testid="text-noted-count">{stats.noted}</p>
                    <p className="text-sm text-muted-foreground">Noted</p>
                  </div>
                  <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                    <p className="text-3xl font-bold text-yellow-600" data-testid="text-pending-count">{stats.pending}</p>
                    <p className="text-sm text-muted-foreground">Pending</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Audit Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 border rounded-lg">
                    <Code className="h-5 w-5 text-red-600" />
                    <div>
                      <p className="font-medium">Obsolete Code</p>
                      <p className="text-sm text-muted-foreground">{stats.obsolete} findings</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 border rounded-lg">
                    <FileText className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="font-medium">Wording Inconsistencies</p>
                      <p className="text-sm text-muted-foreground">{stats.wording} findings</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 border rounded-lg">
                    <Wrench className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium">Improvements Made</p>
                      <p className="text-sm text-muted-foreground">{stats.improvements} findings</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Detailed Findings</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all" data-testid="tab-all">All ({findings.length})</TabsTrigger>
                    <TabsTrigger value="obsolete_code" data-testid="tab-obsolete">Obsolete Code</TabsTrigger>
                    <TabsTrigger value="wording_inconsistency" data-testid="tab-wording">Wording</TabsTrigger>
                    <TabsTrigger value="improvement" data-testid="tab-improvements">Improvements</TabsTrigger>
                  </TabsList>

                  <TabsContent value={activeTab} className="space-y-4">
                    {filteredFindings.map((finding) => (
                      <div 
                        key={finding.id} 
                        className="border rounded-lg p-4 space-y-2"
                        data-testid={`finding-${finding.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(finding.category)}
                            <h3 className="font-medium">{finding.title}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={getSeverityColor(finding.severity)}>
                              {finding.severity}
                            </Badge>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(finding.status)}
                              <span className="text-sm capitalize">{finding.status}</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{finding.description}</p>
                        <div className="text-xs font-mono bg-muted p-2 rounded">
                          {finding.location}
                        </div>
                        {finding.fix && (
                          <div className="text-sm">
                            <span className="font-medium">Resolution: </span>
                            <span className="text-green-600 dark:text-green-400">{finding.fix}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Test Session Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">Test User</p>
                    <p className="text-muted-foreground">tmotard (superadmin)</p>
                  </div>
                  <div>
                    <p className="font-medium">Test Date</p>
                    <p className="text-muted-foreground">{new Date().toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="font-medium">Departments Tested</p>
                    <p className="text-muted-foreground">NTAO, ASSETS, INVENTORY, FLEET</p>
                  </div>
                  <div>
                    <p className="font-medium">Areas Reviewed</p>
                    <p className="text-muted-foreground">Queue pages, Vehicle management, User filtering</p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium mb-2">Key Changes Made</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>Fixed 5 obsolete department field references across queue pages</li>
                    <li>Updated user filtering to use new departments array format</li>
                    <li>Corrected TPMS cache sync to use techRacfid (LDAP ID) instead of employeeId</li>
                    <li>TPMS cache now correctly contains 1,802 entries (up from 109)</li>
                    <li>Documented wording variations between Fleet and Vehicle terminology</li>
                  </ul>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium mb-2">Recommendations</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    <li>The termed_techs table can be removed in a future cleanup when confirmed no longer needed</li>
                    <li>Fleet vs Vehicle terminology is contextually appropriate and does not require standardization</li>
                    <li>Consider adding TypeScript strict mode to catch deprecated field usage earlier</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </MainContent>
  );
}
