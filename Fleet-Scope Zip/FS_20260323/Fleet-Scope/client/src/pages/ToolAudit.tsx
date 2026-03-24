import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import searsLogo from "@assets/image_1764154330093.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ArrowLeft,
  Wrench,
  Camera,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ChevronDown,
  ChevronRight,
  Loader2,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";

interface ConditionReportAnswer {
  note: string | null;
  sectionTitle: string;
  questionTitle: string;
  pictureUrl: string | null;
  questionTypeDescription: string;
  freetextValue: string | null;
  dropdownValue: {
    name: string;
    isFailure: boolean | null;
  } | null;
  multipleChoiceValue: string[] | null;
  dateValue: string | null;
}

interface ConditionReport {
  id?: number;
  vehicleId?: number;
  createdDate?: string;
  modifiedDate?: string;
  answers: ConditionReportAnswer[];
}

interface ToolAuditItem {
  toolName: string;
  systemNumber: string | null;
  section: string;
  count: number | null;
  hasPhoto: boolean;
  isFailure: boolean | null;
  pictureUrl: string | null;
  note: string | null;
}

export default function ToolAudit() {
  const { assetId } = useParams<{ assetId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conditionReport, setConditionReport] = useState<ConditionReport | null>(null);
  const [tools, setTools] = useState<ToolAuditItem[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['ToolAudit']));
  
  // Define which sections are vehicle condition vs tool audit
  const vehicleConditionSections = new Set([
    'Admin',
    'Driver Front Outside',
    'Driver Front Inside', 
    'Front',
    'Underside',
    'Passenger Front Outside',
    'Passenger Rear Outside',
    'Back',
    'Cargo',
    'Drivers Rear Outside',
    'Other'
  ]);
  
  // Tool audit sections (everything else with tool-related content)
  const toolAuditSections = new Set([
    'All Industries',
    'Cooking',
    'HVAC',
    'Laundry',
    'Lawn & Garden',
    'Microwave',
    'Refrigeration',
    'Refrigeration /HVAC',
    'Refrigeration/HVAC',
    'Water Heater',
    'Hand Tools',
    'Refrigerant Tank'
  ]);
  
  // Function to determine if a section is tool-related
  const isToolSection = (section: string): boolean => {
    // Check exact match first
    if (toolAuditSections.has(section)) return true;
    // Check if starts with known tool section prefixes
    if (section.startsWith('Hand Tools')) return true;
    if (section.startsWith('All Industries')) return true;
    // Check if it's NOT a vehicle condition section and has tool-related questions
    return !vehicleConditionSections.has(section);
  };

  useEffect(() => {
    if (assetId) {
      fetchConditionReport(assetId);
    }
  }, [assetId]);

  const fetchConditionReport = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/pmf/conditionreport/${id}`);
      const data = await response.json();
      
      if (data.success && data.conditionreport) {
        const reports = Array.isArray(data.conditionreport) 
          ? data.conditionreport 
          : [data.conditionreport];
        
        // Handle case where reports is empty
        if (!reports || reports.length === 0) {
          setError('No condition report data found for this vehicle');
          return;
        }
        
        // Combine all answers from all reports, using the most recent report's metadata
        // Tool audit questions are often in a separate report from vehicle condition
        const allAnswers: ConditionReportAnswer[] = [];
        reports.forEach((report: ConditionReport) => {
          if (report && Array.isArray(report.answers)) {
            allAnswers.push(...report.answers);
          }
        });
        
        // Use the first report's metadata but combined answers
        const reportWithAnswers: ConditionReport = {
          ...reports[0],
          answers: allAnswers
        };
        
        setConditionReport(reportWithAnswers);
        
        // Parse tools from the answers - only from tool audit sections
        const parsedTools: ToolAuditItem[] = [];
        if (reportWithAnswers.answers && reportWithAnswers.answers.length > 0) {
          for (const answer of reportWithAnswers.answers) {
            const section = answer.sectionTitle || 'Other';
            // Only process answers from tool audit sections
            if (answer.questionTitle && isToolSection(section)) {
              // Extract tool name from between single quotes (e.g., 'Wire Brush - 10-1/4 Inch')
              const quotedNameMatch = answer.questionTitle.match(/'([^']+)'/);
              // Only add if it looks like a tool question (has quoted name or specific patterns)
              if (quotedNameMatch || 
                  answer.questionTitle.includes('Weigh the Refrigerant') ||
                  answer.questionTitle.includes('tools that exist')) {
                const skuMatch = answer.questionTitle.match(/\.?\s*([A-Z]{2}-\d{3})\s*$/);
                parsedTools.push({
                  toolName: quotedNameMatch ? quotedNameMatch[1] : answer.questionTitle,
                  systemNumber: skuMatch ? skuMatch[1] : null,
                  section: section,
                  count: answer.freetextValue ? parseInt(answer.freetextValue, 10) || null : null,
                  hasPhoto: !!answer.pictureUrl,
                  isFailure: answer.dropdownValue?.isFailure ?? null,
                  pictureUrl: answer.pictureUrl,
                  note: answer.note,
                });
              }
            }
          }
        }
        setTools(parsedTools);
      } else {
        setError(data.error || 'No condition report found for this vehicle');
      }
    } catch (err: any) {
      console.error('Error fetching condition report:', err);
      setError(err.message || 'Failed to fetch condition report');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Determine if a tool is present based on:
  // - Photo + null status = Present (Yes)
  // - isFailure === false (check mark) = Present (Yes)
  // - isFailure === true (hazard sign) = NOT Present (No)
  const isToolPresent = (tool: ToolAuditItem): boolean | null => {
    // If there's a hazard sign (failure), tool is NOT present
    if (tool.isFailure === true) {
      return false;
    }
    // If there's a check mark (not failure), tool IS present
    if (tool.isFailure === false) {
      return true;
    }
    // If status is null but there's a photo, tool IS present
    if (tool.isFailure === null && tool.hasPhoto) {
      return true;
    }
    // Unknown/not checked
    return null;
  };

  // Export tool audit data to XLSX
  const exportToExcel = () => {
    if (tools.length === 0) return;

    // Prepare data for export
    const exportData = tools.map(tool => ({
      'Section': tool.section,
      'Tool Name': tool.toolName,
      'SKU_ID': tool.systemNumber || '',
      'Count': tool.count ?? '',
      'Has Photo': tool.hasPhoto ? 'Yes' : 'No',
      'Photo URL': tool.pictureUrl || '',
      'Status': tool.isFailure === true ? 'Failure' : tool.isFailure === false ? 'Pass' : 'Not Checked',
      'Tool Present': (() => {
        const present = isToolPresent(tool);
        if (present === true) return 'Yes';
        if (present === false) return 'No';
        return 'Unknown';
      })(),
      'Notes': tool.note || '',
    }));

    // Create summary row
    const presentCount = tools.filter(t => isToolPresent(t) === true).length;
    const notPresentCount = tools.filter(t => isToolPresent(t) === false).length;
    const unknownCount = tools.filter(t => isToolPresent(t) === null).length;

    // Create workbook with tool details
    const wb = XLSX.utils.book_new();
    
    // Add tools sheet
    const toolsWs = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, toolsWs, 'Tool Audit');

    // Add summary sheet
    const summaryData = [
      { 'Metric': 'Asset ID', 'Value': assetId },
      { 'Metric': 'Report Date', 'Value': conditionReport?.createdDate ? formatDate(conditionReport.createdDate) : 'N/A' },
      { 'Metric': 'Total Tools', 'Value': tools.length },
      { 'Metric': 'Tools Present', 'Value': presentCount },
      { 'Metric': 'Tools Not Present', 'Value': notPresentCount },
      { 'Metric': 'Unknown Status', 'Value': unknownCount },
      { 'Metric': 'With Photos', 'Value': tools.filter(t => t.hasPhoto).length },
    ];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // Generate filename with asset ID and date
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `ToolAudit_${assetId}_${dateStr}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
  };

  // Group tools by section
  const toolsBySection = tools.reduce((acc, tool) => {
    if (!acc[tool.section]) {
      acc[tool.section] = [];
    }
    acc[tool.section].push(tool);
    return acc;
  }, {} as Record<string, ToolAuditItem[]>);

  // Group all answers by section for full report - separate vehicle condition from tool audit
  const vehicleConditionAnswers: Record<string, ConditionReportAnswer[]> = {};
  const toolAuditAnswers: Record<string, ConditionReportAnswer[]> = {};
  
  conditionReport?.answers?.forEach(answer => {
    const section = answer.sectionTitle || 'Other';
    if (vehicleConditionSections.has(section)) {
      if (!vehicleConditionAnswers[section]) {
        vehicleConditionAnswers[section] = [];
      }
      vehicleConditionAnswers[section].push(answer);
    } else {
      if (!toolAuditAnswers[section]) {
        toolAuditAnswers[section] = [];
      }
      toolAuditAnswers[section].push(answer);
    }
  });
  
  // Count totals for each section
  const vehicleConditionCount = Object.values(vehicleConditionAnswers).flat().length;
  const toolAuditCount = Object.values(toolAuditAnswers).flat().length;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/pmf">
              <Button variant="ghost" size="sm" data-testid="button-back-pmf">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to PMF
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <img src={searsLogo} alt="Sears Logo" className="h-8" />
              <h1 className="text-xl font-semibold">Tool Audit & Condition Report</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Asset ID: {assetId}</span>
            {!loading && !error && tools.length > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={exportToExcel}
                data-testid="button-export-xlsx"
              >
                <Download className="h-4 w-4 mr-2" />
                Export XLSX
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 max-w-6xl mx-auto">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                <h2 className="text-lg font-semibold mb-2">Unable to Load Report</h2>
                <p className="text-muted-foreground">{error}</p>
                <Button 
                  className="mt-4" 
                  onClick={() => assetId && fetchConditionReport(assetId)}
                  data-testid="button-retry"
                >
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Report Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Report Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Asset ID</p>
                    <p className="font-medium">{assetId}</p>
                  </div>
                  {conditionReport?.createdDate && (
                    <div>
                      <p className="text-sm text-muted-foreground">Report Date</p>
                      <p className="font-medium">{formatDate(conditionReport.createdDate)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Total Items</p>
                    <p className="font-medium">{conditionReport?.answers?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Items with Photos</p>
                    <p className="font-medium">{tools.filter(t => t.hasPhoto).length}</p>
                  </div>
                </div>
                {tools.length > 0 && (
                  <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Tools Present</p>
                      <p className="font-medium text-green-600">{tools.filter(t => isToolPresent(t) === true).length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Tools Not Present</p>
                      <p className="font-medium text-red-600">{tools.filter(t => isToolPresent(t) === false).length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Unknown Status</p>
                      <p className="font-medium text-muted-foreground">{tools.filter(t => isToolPresent(t) === null).length}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tool Audit Section */}
            <Card>
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleSection('ToolAudit')}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-5 w-5" />
                    Tool Audit ({tools.length} items)
                  </div>
                  {expandedSections.has('ToolAudit') ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </CardTitle>
              </CardHeader>
              {expandedSections.has('ToolAudit') && (
                <CardContent>
                  {Object.entries(toolsBySection).length > 0 ? (
                    <div className="space-y-6">
                      {Object.entries(toolsBySection).map(([section, sectionTools]) => (
                        <div key={section}>
                          <h3 className="font-medium text-sm text-muted-foreground mb-2 uppercase tracking-wide">
                            {section}
                          </h3>
                          <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left py-2 px-3">Tool Name</th>
                                  <th className="text-left py-2 px-3">SKU_ID</th>
                                  <th className="text-left py-2 px-3">Count</th>
                                  <th className="text-center py-2 px-3">Photo</th>
                                  <th className="text-center py-2 px-3">Status</th>
                                  <th className="text-center py-2 px-3">Present</th>
                                  <th className="text-left py-2 px-3">Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sectionTools.map((tool, idx) => (
                                  <tr key={idx} className="border-t hover:bg-muted/30">
                                    <td className="py-2 px-3">{tool.toolName}</td>
                                    <td className="py-2 px-3 font-mono text-xs">
                                      {tool.systemNumber || '-'}
                                    </td>
                                    <td className="py-2 px-3">{tool.count ?? '-'}</td>
                                    <td className="py-2 px-3 text-center">
                                      {tool.hasPhoto ? (
                                        tool.pictureUrl ? (
                                          <a 
                                            href={tool.pictureUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline"
                                          >
                                            <Camera className="h-4 w-4 inline" />
                                          </a>
                                        ) : (
                                          <Camera className="h-4 w-4 inline text-green-600" />
                                        )
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {tool.isFailure === true ? (
                                        <AlertTriangle className="h-4 w-4 inline text-red-600" />
                                      ) : tool.isFailure === false ? (
                                        <CheckCircle2 className="h-4 w-4 inline text-green-600" />
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {(() => {
                                        const present = isToolPresent(tool);
                                        if (present === true) return <span className="text-green-600 font-medium">Yes</span>;
                                        if (present === false) return <span className="text-red-600 font-medium">No</span>;
                                        return <span className="text-muted-foreground">-</span>;
                                      })()}
                                    </td>
                                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                                      {tool.note || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No tool audit data available
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Vehicle Condition Section */}
            <Card>
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleSection('VehicleCondition')}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Vehicle Condition ({vehicleConditionCount} items)
                  </div>
                  {expandedSections.has('VehicleCondition') ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </CardTitle>
              </CardHeader>
              {expandedSections.has('VehicleCondition') && (
                <CardContent>
                  {Object.entries(vehicleConditionAnswers).length > 0 ? (
                    <div className="space-y-6">
                      {Object.entries(vehicleConditionAnswers).map(([section, answers]) => (
                        <div key={section}>
                          <h3 className="font-medium text-sm text-muted-foreground mb-2 uppercase tracking-wide">
                            {section} ({answers.length})
                          </h3>
                          <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left py-2 px-3">Question</th>
                                  <th className="text-left py-2 px-3">Value</th>
                                  <th className="text-center py-2 px-3">Photo</th>
                                  <th className="text-left py-2 px-3">Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {answers.map((answer, idx) => (
                                  <tr key={idx} className="border-t hover:bg-muted/30">
                                    <td className="py-2 px-3 max-w-[300px]">
                                      {answer.questionTitle || '-'}
                                    </td>
                                    <td className="py-2 px-3">
                                      {answer.dropdownValue?.name || 
                                       answer.freetextValue || 
                                       (Array.isArray(answer.multipleChoiceValue) && answer.multipleChoiceValue.length > 0 
                                         ? answer.multipleChoiceValue.join(', ') 
                                         : null) || 
                                       (answer.dateValue ? formatDate(answer.dateValue) : '-')}
                                      {answer.dropdownValue?.isFailure && (
                                        <AlertTriangle className="h-3 w-3 inline ml-1 text-red-600" />
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {answer.pictureUrl ? (
                                        <a 
                                          href={answer.pictureUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline"
                                        >
                                          <Camera className="h-4 w-4 inline" />
                                        </a>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                                      {answer.note || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No vehicle condition data available
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Full Tool Audit Report (raw data) */}
            <Card>
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleSection('FullToolReport')}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Full Tool Report ({toolAuditCount} items)
                  </div>
                  {expandedSections.has('FullToolReport') ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </CardTitle>
              </CardHeader>
              {expandedSections.has('FullToolReport') && (
                <CardContent>
                  {Object.entries(toolAuditAnswers).length > 0 ? (
                    <div className="space-y-6">
                      {Object.entries(toolAuditAnswers).map(([section, answers]) => (
                        <div key={section}>
                          <h3 className="font-medium text-sm text-muted-foreground mb-2 uppercase tracking-wide">
                            {section} ({answers.length})
                          </h3>
                          <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left py-2 px-3">Question</th>
                                  <th className="text-left py-2 px-3">Type</th>
                                  <th className="text-left py-2 px-3">Value</th>
                                  <th className="text-center py-2 px-3">Photo</th>
                                  <th className="text-left py-2 px-3">Notes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {answers.map((answer, idx) => (
                                  <tr key={idx} className="border-t hover:bg-muted/30">
                                    <td className="py-2 px-3 max-w-[300px]">
                                      {answer.questionTitle || '-'}
                                    </td>
                                    <td className="py-2 px-3 text-xs text-muted-foreground">
                                      {answer.questionTypeDescription || '-'}
                                    </td>
                                    <td className="py-2 px-3">
                                      {answer.dropdownValue?.name || 
                                       answer.freetextValue || 
                                       (Array.isArray(answer.multipleChoiceValue) && answer.multipleChoiceValue.length > 0 
                                         ? answer.multipleChoiceValue.join(', ') 
                                         : null) || 
                                       (answer.dateValue ? formatDate(answer.dateValue) : '-')}
                                      {answer.dropdownValue?.isFailure && (
                                        <AlertTriangle className="h-3 w-3 inline ml-1 text-red-600" />
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {answer.pictureUrl ? (
                                        <a 
                                          href={answer.pictureUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline"
                                        >
                                          <Camera className="h-4 w-4 inline" />
                                        </a>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                                      {answer.note || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No condition report data available
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Raw JSON Data (for debugging/advanced users) */}
            <Card>
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleSection('RawData')}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Raw API Response
                  </div>
                  {expandedSections.has('RawData') ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </CardTitle>
              </CardHeader>
              {expandedSections.has('RawData') && (
                <CardContent>
                  <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs max-h-[400px]">
                    {JSON.stringify(conditionReport, null, 2)}
                  </pre>
                </CardContent>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
