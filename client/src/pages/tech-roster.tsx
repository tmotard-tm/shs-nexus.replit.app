import { useState, useMemo } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Users, Search, Filter, ChevronDown, ChevronUp, RefreshCw, Clock, AlertCircle, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, Check } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { AllTech } from "@shared/schema";

function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return '-';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0,3)})${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1,4)})${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return phone;
}

function MultiSelectFilter({ 
  label, 
  options, 
  selected, 
  onChange,
  testId
}: { 
  label: string; 
  options: string[]; 
  selected: string[]; 
  onChange: (values: string[]) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = options.filter(opt => 
    opt.toLowerCase().includes(search.toLowerCase())
  );

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const selectAll = () => onChange([...options]);
  const clearAll = () => onChange([]);

  const displayLabel = selected.length === 0 
    ? `All ${label}` 
    : selected.length === 1 
      ? selected[0] 
      : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-left font-normal h-10"
          data-testid={testId}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder={`Search ${label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 border-b">
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={clearAll}>
            Clear
          </Button>
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filteredOptions.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2 text-center">No results</div>
          ) : (
            filteredOptions.map(option => (
              <div
                key={option}
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent"
                onClick={() => toggleOption(option)}
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded border ${selected.includes(option) ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                  {selected.includes(option) && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <span>{option}</span>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export default function TechRoster() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [districtFilter, setDistrictFilter] = useState<string[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: techs = [], isLoading } = useQuery<AllTech[]>({
    queryKey: ['/api/all-techs'],
  });

  const { data: syncStatus } = useQuery<{
    termedTechs: { lastSync: string | null; status: string; recordCount: number };
    allTechs: { lastSync: string | null; status: string; recordCount: number };
  }>({
    queryKey: ['/api/snowflake/sync/status'],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/sync/all-techs');
    },
    onSuccess: (result: any) => {
      toast({
        title: "Sync Complete",
        description: `Processed ${result.recordsProcessed} Employees (${result.recordsCreated} new, ${result.recordsUpdated} updated)`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/all-techs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/snowflake/sync/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Employee data",
        variant: "destructive",
      });
    },
  });

  const uniqueDistricts = useMemo(() => 
    Array.from(new Set(techs.map(t => t.districtNo).filter(Boolean))).sort() as string[]
  , [techs]);
  
  const uniqueStatuses = useMemo(() => 
    Array.from(new Set(techs.map(t => t.employmentStatus).filter(Boolean))).sort() as string[]
  , [techs]);

  const activeFiltersCount = [statusFilter, districtFilter].filter(f => f.length > 0).length;

  const filteredTechs = useMemo(() => techs.filter(tech => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      tech.techName?.toLowerCase().includes(searchLower) ||
      tech.employeeId?.toLowerCase().includes(searchLower) ||
      tech.techRacfid?.toLowerCase().includes(searchLower) ||
      tech.jobTitle?.toLowerCase().includes(searchLower) ||
      tech.truckLu?.toLowerCase().includes(searchLower) ||
      tech.cellPhone?.toLowerCase().includes(searchLower) ||
      tech.mainPhone?.toLowerCase().includes(searchLower) ||
      tech.homeCity?.toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter.length === 0 || statusFilter.includes(tech.employmentStatus || '');
    const matchesDistrict = districtFilter.length === 0 || districtFilter.includes(tech.districtNo || '');
    
    return matchesSearch && matchesStatus && matchesDistrict;
  }), [techs, searchQuery, statusFilter, districtFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTechs.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTechs = filteredTechs.slice((safePage - 1) * pageSize, safePage * pageSize);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setStatusFilter([]);
    setDistrictFilter([]);
    setCurrentPage(1);
  };

  const handleFilterChange = (setter: (v: string[]) => void) => (values: string[]) => {
    setter(values);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const buildCsvContent = (data: AllTech[]) => {
    const headers = [
      "Name", "Employee ID", "Enterprise ID", "Job Title", "District",
      "Planning Area", "Status", "Truck LU", "Cell Phone", "Main Phone",
      "Home Address", "City", "State", "Zip"
    ];
    const rows = data.map(tech => [
      tech.techName || '',
      tech.employeeId || '',
      tech.techRacfid || '',
      tech.jobTitle || '',
      tech.districtNo || '',
      tech.planningAreaName || '',
      tech.employmentStatus || '',
      tech.truckLu || '',
      tech.cellPhone || '',
      tech.mainPhone || '',
      tech.homeAddr1 || '',
      tech.homeCity || '',
      tech.homeState || '',
      tech.homePostal || '',
    ]);
    const escapeField = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    return [headers.join(','), ...rows.map(row => row.map(escapeField).join(','))].join('\n');
  };

  const exportCSV = () => {
    const csv = buildCsvContent(filteredTechs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-roster-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export Complete", description: `Exported ${filteredTechs.length} records to CSV` });
  };

  const exportExcel = () => {
    const csv = buildCsvContent(filteredTechs);
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-roster-${format(new Date(), 'yyyy-MM-dd')}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export Complete", description: `Exported ${filteredTechs.length} records to Excel` });
  };

  return (
    <MainContent>
      <TopBar 
        title="Employee Roster"
        breadcrumbs={["Home", "Fleet", "Employee Roster"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Users className="h-6 w-6 text-blue-600" />
                    <div>
                      <CardTitle data-testid="text-roster-title">Employee Roster</CardTitle>
                      <CardDescription>
                        Complete list of Employees synced from Snowflake
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {syncStatus?.allTechs && (
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {syncStatus.allTechs.lastSync 
                          ? (() => {
                              try {
                                const date = new Date(syncStatus.allTechs.lastSync);
                                return isNaN(date.getTime()) ? 'Invalid date' : `Last synced: ${format(date, 'MMM d, yyyy h:mm a')}`;
                              } catch {
                                return 'Invalid date';
                              }
                            })()
                          : 'Never synced'}
                      </div>
                    )}
                    <Button 
                      onClick={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending}
                      variant="outline"
                      data-testid="button-sync-techs"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                      {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, employee ID, Enterprise ID, job title, truck, phone, or city..."
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-techs"
                    />
                  </div>
                  <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="flex items-center gap-2" data-testid="button-toggle-filters">
                        <Filter className="h-4 w-4" />
                        Filters
                        {activeFiltersCount > 0 && (
                          <Badge variant="secondary" className="ml-1">{activeFiltersCount}</Badge>
                        )}
                        {isFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                  </Collapsible>
                </div>

                <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Employment Status</label>
                        <MultiSelectFilter
                          label="Statuses"
                          options={uniqueStatuses}
                          selected={statusFilter}
                          onChange={handleFilterChange(setStatusFilter)}
                          testId="select-status-filter"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">District</label>
                        <MultiSelectFilter
                          label="Districts"
                          options={uniqueDistricts}
                          selected={districtFilter}
                          onChange={handleFilterChange(setDistrictFilter)}
                          testId="select-district-filter"
                        />
                      </div>
                      <div className="col-span-2 flex items-end gap-2">
                        {activeFiltersCount > 0 && (
                          <div className="flex gap-1 flex-wrap items-center">
                            {statusFilter.map(s => (
                              <Badge key={s} variant="secondary" className="gap-1">
                                {s}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => { setStatusFilter(prev => prev.filter(v => v !== s)); setCurrentPage(1); }} />
                              </Badge>
                            ))}
                            {districtFilter.map(d => (
                              <Badge key={d} variant="secondary" className="gap-1">
                                {d}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => { setDistrictFilter(prev => prev.filter(v => v !== d)); setCurrentPage(1); }} />
                              </Badge>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" onClick={clearAllFilters} className="text-sm ml-auto" data-testid="button-clear-filters">
                          Clear All Filters
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Showing {paginatedTechs.length} of {filteredTechs.length} Employees{filteredTechs.length !== techs.length ? ` (${techs.length} total)` : ''}</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportCSV} disabled={filteredTechs.length === 0} data-testid="button-export-csv">
                      <Download className="h-4 w-4 mr-1" />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportExcel} disabled={filteredTechs.length === 0} data-testid="button-export-excel">
                      <Download className="h-4 w-4 mr-1" />
                      Excel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading Employees...</span>
                  </div>
                ) : filteredTechs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-semibold text-lg">No Employees Found</h3>
                    <p className="text-muted-foreground">
                      {techs.length === 0 
                        ? "Click 'Sync Now' to pull Employee data from Snowflake"
                        : "No Employees match your current filters"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1400px]">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left p-2 font-medium whitespace-nowrap">Name</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Employee ID</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Enterprise ID</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Job Title</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">District</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Planning Area</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Truck LU</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Cell Phone</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap">Main Phone</th>
                            <th className="text-left p-2 font-medium whitespace-nowrap min-w-[250px]">Home Address</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedTechs.map((tech) => (
                            <tr 
                              key={tech.id} 
                              className="border-b hover:bg-muted/30 transition-colors"
                              data-testid={`row-tech-${tech.employeeId}`}
                            >
                              <td className="p-2">
                                <div className="font-medium text-sm">{tech.techName}</div>
                              </td>
                              <td className="p-2 font-mono text-xs">{tech.employeeId}</td>
                              <td className="p-2 font-mono text-xs">{tech.techRacfid}</td>
                              <td className="p-2 text-xs">{tech.jobTitle || '-'}</td>
                              <td className="p-2 text-xs">{tech.districtNo || '-'}</td>
                              <td className="p-2 text-xs">{tech.planningAreaName || '-'}</td>
                              <td className="p-2">
                                <Badge 
                                  variant={tech.employmentStatus === 'A' ? 'default' : 'secondary'}
                                  className={`text-xs ${tech.employmentStatus === 'A' ? 'bg-green-100 text-green-800' : ''}`}
                                >
                                  {tech.employmentStatus === 'A' ? 'A' : tech.employmentStatus || '?'}
                                </Badge>
                              </td>
                              <td className="p-2 font-mono text-xs">{tech.truckLu || '-'}</td>
                              <td className="p-2 text-xs whitespace-nowrap">{formatPhoneNumber(tech.cellPhone)}</td>
                              <td className="p-2 text-xs whitespace-nowrap">{formatPhoneNumber(tech.mainPhone)}</td>
                              <td className="p-2 text-xs" title={[tech.homeAddr1, tech.homeAddr2, tech.homeCity, tech.homeState, tech.homePostal].filter(Boolean).join(', ')}>
                                {tech.homeAddr1 ? (
                                  <div className="space-y-0.5">
                                    <div>{tech.homeAddr1}{tech.homeAddr2 ? `, ${tech.homeAddr2}` : ''}</div>
                                    <div className="text-muted-foreground">{[tech.homeCity, tech.homeState, tech.homePostal].filter(Boolean).join(', ')}</div>
                                  </div>
                                ) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between px-4 py-3 border-t">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Rows per page:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                          className="border rounded px-2 py-1 text-sm bg-background"
                          data-testid="select-page-size"
                        >
                          {PAGE_SIZE_OPTIONS.map(size => (
                            <option key={size} value={size}>{size}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <span>
                          {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, filteredTechs.length)} of {filteredTechs.length}
                        </span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(1)} disabled={safePage === 1} data-testid="button-first-page">
                          <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1} data-testid="button-prev-page">
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="px-2">Page {safePage} of {totalPages}</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(safePage + 1)} disabled={safePage === totalPages} data-testid="button-next-page">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(totalPages)} disabled={safePage === totalPages} data-testid="button-last-page">
                          <ChevronsRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </MainContent>
  );
}
