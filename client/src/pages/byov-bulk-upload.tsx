import { useState, useCallback, useRef, useEffect } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  SkipForward,
  RotateCcw,
  Play,
  Download,
  History,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ---------------------------------------------------------------------------
// CSV parsing helpers (mirrors server/scripts/bulk-byov-create.ts)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

interface CsvRow {
  status: string;
  name: string;
  ldap: string;
  truckId: string;
  district: string;
  phone: string;
  dateEnrolled: string;
  regExpiration: string;
  vehicle: string;
  vin: string;
  licensePlate: string;
  plateState: string;
  cityState: string;
}

function parseCsv(text: string): { rows: CsvRow[]; error: string | null } {
  try {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { rows: [], error: "CSV has no data rows." };

    const header = parseCsvLine(lines[0]);
    const idxOf = (name: string) => {
      const i = header.findIndex((h) => h.toLowerCase().trim() === name.toLowerCase());
      return i;
    };

    const required = [
      "Status", "Name", "LDAP", "Truck ID", "District", "Phone Number",
      "Date Enrolled", "Registration Expiration", "Vehicle", "VIN",
      "License Plate", "Plate State", "City/State",
    ];

    const missing = required.filter((col) => idxOf(col) === -1);
    if (missing.length > 0) {
      return { rows: [], error: `Missing required columns: ${missing.join(", ")}` };
    }

    const iStatus     = idxOf("Status");
    const iName       = idxOf("Name");
    const iLdap       = idxOf("LDAP");
    const iTruck      = idxOf("Truck ID");
    const iDistrict   = idxOf("District");
    const iPhone      = idxOf("Phone Number");
    const iEnrolled   = idxOf("Date Enrolled");
    const iRegExp     = idxOf("Registration Expiration");
    const iVehicle    = idxOf("Vehicle");
    const iVin        = idxOf("VIN");
    const iPlate      = idxOf("License Plate");
    const iPlateState = idxOf("Plate State");
    const iCityState  = idxOf("City/State");

    const rows = lines.slice(1).map((line) => {
      const f = parseCsvLine(line);
      return {
        status:        f[iStatus]     ?? "",
        name:          f[iName]       ?? "",
        ldap:          f[iLdap]       ?? "",
        truckId:       f[iTruck]      ?? "",
        district:      f[iDistrict]   ?? "",
        phone:         f[iPhone]      ?? "",
        dateEnrolled:  f[iEnrolled]   ?? "",
        regExpiration: f[iRegExp]     ?? "",
        vehicle:       f[iVehicle]    ?? "",
        vin:           f[iVin]        ?? "",
        licensePlate:  f[iPlate]      ?? "",
        plateState:    f[iPlateState] ?? "",
        cityState:     f[iCityState]  ?? "",
      };
    });

    return { rows, error: null };
  } catch (err: any) {
    return { rows: [], error: err?.message ?? "Failed to parse CSV." };
  }
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function parseVehicle(vehicleStr: string): { modelYear: number | null; make: string; model: string } {
  const parts = vehicleStr.trim().split(/\s+/);
  if (parts.length === 0) return { modelYear: null, make: "", model: "" };
  const year = Number(parts[0]);
  const yearValid = !isNaN(year) && year > 1900 && year < 2100;
  if (!yearValid) return { modelYear: null, make: parts[0] ?? "", model: parts.slice(1).join(" ") };
  if (parts.length === 1) return { modelYear: year, make: "", model: "" };
  if (parts.length === 2) return { modelYear: year, make: parts[1], model: "" };
  return { modelYear: year, make: parts[1], model: parts.slice(2).join(" ") };
}

function parseName(nameStr: string): { firstName: string; lastName: string } {
  const parts = nameStr.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

function parseCityState(cityStateStr: string): { city: string; state: string; zip: string } {
  const str = cityStateStr.trim();
  const match = str.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) {
    return { city: match[1].trim(), state: match[2].trim().toUpperCase(), zip: match[3].trim() };
  }
  const commaIdx = str.lastIndexOf(",");
  if (commaIdx !== -1) {
    const city = str.slice(0, commaIdx).trim();
    const rest = str.slice(commaIdx + 1).trim().split(/\s+/);
    return { city, state: rest[0] ?? "", zip: rest[1] ?? "" };
  }
  return { city: str, state: "", zip: "" };
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionableRow extends CsvRow {
  id: string;
  needsHolman: boolean;
  needsWms: boolean;
  payload: Record<string, unknown>;
}

type RowStatus = "pending" | "running" | "success" | "error";

interface RowResult {
  status: RowStatus;
  holman?: { success: boolean; error?: string };
  wms?: { success: boolean; error?: string };
  apiError?: string;
}

// ---------------------------------------------------------------------------
// Build API payload from a CSV row
// ---------------------------------------------------------------------------

function buildApiPayload(
  row: CsvRow,
  needsHolman: boolean,
  needsWms: boolean,
): Record<string, unknown> {
  const { modelYear, make, model } = parseVehicle(row.vehicle);
  const { firstName, lastName } = parseName(row.name);
  const { city, state, zip } = parseCityState(row.cityState);
  const todayStr = new Date().toISOString().split("T")[0];
  const deliveryDate = parseDate(row.dateEnrolled) || todayStr;
  const regRenewalDate = parseDate(row.regExpiration);

  return {
    vehicleNumber: row.truckId.trim(),
    vin: row.vin.trim(),
    assetType: "AUTO",
    modelYear,
    make,
    model,
    firstName,
    lastName,
    enterpriseId: row.ldap.trim(),
    phone: row.phone.trim(),
    district: row.district.trim(),
    city,
    state,
    zip,
    deliveryAddress: "UNKNOWN",
    licensePlate: row.licensePlate.trim() || "UNKNOWN",
    plateState: row.plateState.trim(),
    plateType: "STANDARD",
    regRenewalDate,
    deliveryDate,
    onRoadDate: deliveryDate,
    createInHolman: needsHolman,
    createInWms: needsWms,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActionable(status: string): { needsHolman: boolean; needsWms: boolean } {
  const s = status.toLowerCase();
  return {
    needsHolman: s.includes("not in holman"),
    needsWms: s.includes("not in wms") || s.includes("not in mws"),
  };
}

const DELAY_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

/**
 * Determine whether a row's result is fully successful given which systems
 * were actually requested. Systems that were not requested (skipped: true)
 * do not count as failures.
 */
function rowFullySucceeded(result: RowResult, needsHolman: boolean, needsWms: boolean): boolean {
  if (result.status !== "success") return false;
  const holmanOk = !needsHolman || result.holman?.success === true;
  const wmsOk = !needsWms || result.wms?.success === true;
  return holmanOk && wmsOk;
}

function StatusBadge({
  result,
  needsHolman,
  needsWms,
}: {
  result: RowResult | undefined;
  needsHolman: boolean;
  needsWms: boolean;
}) {
  if (!result) return <Badge variant="outline" className="text-xs">Queued</Badge>;

  switch (result.status) {
    case "running":
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Creating…
        </Badge>
      );
    case "success": {
      const allOk = rowFullySucceeded(result, needsHolman, needsWms);
      const lines: { label: string; msg: string }[] = [];
      if (needsHolman) {
        lines.push({
          label: "Holman",
          msg: result.holman?.error ?? (result.holman?.success ? "OK" : "—"),
        });
      }
      if (needsWms) {
        lines.push({
          label: "WMS",
          msg: result.wms?.error ?? (result.wms?.success ? "OK" : "—"),
        });
      }
      return (
        <div className="flex flex-col gap-0.5">
          <Badge
            variant={allOk ? "default" : "secondary"}
            className={`text-xs gap-1 ${allOk ? "bg-green-600 hover:bg-green-700" : "bg-yellow-500 hover:bg-yellow-600"}`}
          >
            {allOk ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {allOk ? "Created" : "Partial"}
          </Badge>
          {lines.map((l) => (
            <span key={l.label} className="text-[10px] text-muted-foreground">{l.label}: {l.msg}</span>
          ))}
        </div>
      );
    }
    case "error":
      return (
        <div className="flex flex-col gap-0.5">
          <Badge variant="destructive" className="text-xs gap-1">
            <XCircle className="h-3 w-3" />
            Error
          </Badge>
          {result.apiError && (
            <span className="text-[10px] text-red-500 max-w-[180px] break-words">{result.apiError}</span>
          )}
        </div>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

interface PersistedRun {
  fileName: string;
  actionableRows: ActionableRow[];
  skippedCount: number;
  results: [string, RowResult][];
  runCompletedAt: string;
}

function getStorageKey(userId: number | string): string {
  return `byov-bulk-run-${userId}`;
}

function saveRun(
  userId: number | string,
  data: Omit<PersistedRun, "results"> & { results: Map<string, RowResult> },
): void {
  try {
    const payload: PersistedRun = {
      ...data,
      results: [...data.results.entries()],
    };
    localStorage.setItem(getStorageKey(userId), JSON.stringify(payload));
  } catch {
    // Ignore quota errors
  }
}

function loadRun(userId: number | string): PersistedRun | null {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedRun;
  } catch {
    return null;
  }
}

function clearRun(userId: number | string): void {
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ByovBulkUpload() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [actionableRows, setActionableRows] = useState<ActionableRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, RowResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [runCompletedAt, setRunCompletedAt] = useState<Date | null>(null);
  const [restoredRun, setRestoredRun] = useState(false);

  // Restore persisted run on mount (once the user is resolved)
  useEffect(() => {
    if (!user) return;
    const saved = loadRun(user.id);
    if (!saved) return;
    setFileName(saved.fileName);
    setActionableRows(saved.actionableRows);
    setSkippedCount(saved.skippedCount);
    setResults(new Map(saved.results));
    setRunCompletedAt(new Date(saved.runCompletedAt));
    // Mark all processed rows as selected so the table renders them correctly
    setSelectedIds(new Set(saved.results.map(([id]) => id)));
    setRestoredRun(true);
  }, [user]);

  const handleFileRead = useCallback((file: File) => {
    setFileName(file.name);
    setParseError(null);
    setActionableRows([]);
    setSelectedIds(new Set());
    setResults(new Map());
    setCompletedCount(0);
    setRunCompletedAt(null);
    setRestoredRun(false);
    if (user) clearRun(user.id);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows, error } = parseCsv(text);
      if (error) {
        setParseError(error);
        return;
      }

      const actionable: ActionableRow[] = [];
      let skipped = 0;
      rows.forEach((row, i) => {
        const { needsHolman, needsWms } = isActionable(row.status);
        if (needsHolman || needsWms) {
          actionable.push({
            ...row,
            id: `row-${i}`,
            needsHolman,
            needsWms,
            payload: buildApiPayload(row, needsHolman, needsWms),
          });
        } else {
          skipped++;
        }
      });

      setActionableRows(actionable);
      setSkippedCount(skipped);
      setSelectedIds(new Set(actionable.map((r) => r.id)));

      if (actionable.length === 0) {
        toast({
          title: "No actionable rows",
          description: "All rows already have complete status (no 'Not in Holman' or 'Not in WMS').",
        });
      }
    };

    // Read as latin1 to match the script's behavior
    reader.readAsText(file, "iso-8859-1");
  }, [toast, user]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
    e.target.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileRead(file);
    },
    [handleFileRead]
  );

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === actionableRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(actionableRows.map((r) => r.id)));
    }
  };

  const handleRun = async () => {
    const toProcess = actionableRows.filter((r) => selectedIds.has(r.id));
    if (toProcess.length === 0) return;

    setRunning(true);
    setCompletedCount(0);

    const freshResults = new Map<string, RowResult>();
    toProcess.forEach((r) => freshResults.set(r.id, { status: "pending" }));
    setResults(new Map(freshResults));

    for (let i = 0; i < toProcess.length; i++) {
      const row = toProcess[i];

      // Mark as running
      freshResults.set(row.id, { status: "running" });
      setResults(new Map(freshResults));

      try {
        const resp = await apiRequest("POST", "/api/byov/create", row.payload);
        const data = await resp.json();

        if (!resp.ok) {
          freshResults.set(row.id, {
            status: "error",
            apiError: data?.error ?? `HTTP ${resp.status}`,
          });
        } else {
          freshResults.set(row.id, {
            status: "success",
            holman: data.holman,
            wms: data.wms,
          });
        }
      } catch (err: any) {
        freshResults.set(row.id, {
          status: "error",
          apiError: err?.message ?? "Network error",
        });
      }

      setResults(new Map(freshResults));
      setCompletedCount(i + 1);

      if (i < toProcess.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    setRunning(false);
    const completedAt = new Date();
    setRunCompletedAt(completedAt);
    setRestoredRun(false);

    // Persist the run so it survives page reloads / navigation
    if (user) {
      saveRun(user.id, {
        fileName: fileName ?? "",
        actionableRows,
        skippedCount,
        results: freshResults,
        runCompletedAt: completedAt.toISOString(),
      });
    }

    const errCount = [...freshResults.values()].filter((r) => r.status === "error").length;
    const fullyOkCount = toProcess.filter((row) => {
      const r = freshResults.get(row.id);
      return r ? rowFullySucceeded(r, row.needsHolman, row.needsWms) : false;
    }).length;
    const partialCount = toProcess.filter((row) => {
      const r = freshResults.get(row.id);
      return r && r.status === "success" && !rowFullySucceeded(r, row.needsHolman, row.needsWms);
    }).length;
    const parts = [`${fullyOkCount} created`];
    if (partialCount > 0) parts.push(`${partialCount} partial`);
    if (errCount > 0) parts.push(`${errCount} failed`);
    toast({
      title: "Bulk creation complete",
      description: `${parts.join(", ")} out of ${toProcess.length} vehicles.`,
    });
  };

  const handleExportCsv = () => {
    const processedRows = actionableRows.filter((r) => results.has(r.id));
    const header = ["Vehicle #", "Technician", "Needs Holman", "Needs WMS", "Holman result", "WMS result", "Error"];

    const escapeField = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const csvRows = processedRows.map((row) => {
      const result = results.get(row.id)!;
      const holmanResult = !row.needsHolman
        ? "N/A"
        : result.holman?.success
        ? "OK"
        : result.holman?.error ?? (result.status === "error" ? "Error" : "—");
      const wmsResult = !row.needsWms
        ? "N/A"
        : result.wms?.success
        ? "OK"
        : result.wms?.error ?? (result.status === "error" ? "Error" : "—");
      const errorMsg = result.apiError ?? "";

      return [
        row.truckId.trim(),
        row.name.trim(),
        row.needsHolman ? "Yes" : "No",
        row.needsWms ? "Yes" : "No",
        holmanResult,
        wmsResult,
        errorMsg,
      ].map(escapeField).join(",");
    });

    const csv = [header.join(","), ...csvRows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const dateStr = (runCompletedAt ?? new Date()).toISOString().split("T")[0];
    const a = document.createElement("a");
    a.href = url;
    a.download = `byov-bulk-results-${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFileName(null);
    setParseError(null);
    setActionableRows([]);
    setSkippedCount(0);
    setSelectedIds(new Set());
    setResults(new Map());
    setCompletedCount(0);
    setRunning(false);
    setRunCompletedAt(null);
    setRestoredRun(false);
    if (user) clearRun(user.id);
  };

  const toProcess = actionableRows.filter((r) => selectedIds.has(r.id));
  const hasResults = results.size > 0;
  const isComplete = hasResults && !running;
  const progress = toProcess.length > 0 ? Math.round((completedCount / toProcess.length) * 100) : 0;

  return (
    <MainContent>
      <TopBar
        title="BYOV Bulk Upload"
        breadcrumbs={["Home", "Admin", "BYOV Bulk Upload"]}
      />

      <main className="p-6 space-y-6 max-w-6xl">
        {/* Upload zone */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload BYOV Status CSV
            </CardTitle>
            <CardDescription>
              Upload the BYOV Dashboard status export. Rows with "Not in Holman" or "Not in WMS" in their
              status will be previewed for creation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !running && fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}
                ${running ? "pointer-events-none opacity-50" : ""}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInputChange}
                disabled={running}
              />
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              {fileName ? (
                <div>
                  <p className="font-medium">{fileName}</p>
                  <p className="text-sm text-muted-foreground mt-1">Click or drop to replace</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">Drop CSV here or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Accepts BYOV Dashboard status export (.csv)
                  </p>
                </div>
              )}
            </div>

            {parseError && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}

            {fileName && !parseError && actionableRows.length === 0 && (
              <Alert className="mt-4">
                <SkipForward className="h-4 w-4" />
                <AlertDescription>
                  No actionable rows found — all vehicles already have a complete status.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Restored-run notice */}
        {restoredRun && runCompletedAt && (
          <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
            <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-800 dark:text-blue-300 flex items-center justify-between gap-4 flex-wrap">
              <span>
                Showing results from a previous run completed on{" "}
                <span className="font-medium">
                  {runCompletedAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{" "}
                  at {runCompletedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                . You can still export the results below, or upload a new file to start a new run.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/40 shrink-0"
              >
                <XCircle className="h-4 w-4" />
                Dismiss saved results
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Preview table */}
        {actionableRows.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Preview — {actionableRows.length} vehicle{actionableRows.length !== 1 ? "s" : ""} to create
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {skippedCount > 0 && (
                      <span>{skippedCount} row{skippedCount !== 1 ? "s" : ""} skipped (already complete). </span>
                    )}
                    Select vehicles to include in this batch, then click "Run".
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {isComplete && (
                    <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
                      <RotateCcw className="h-4 w-4" />
                      Start over
                    </Button>
                  )}
                  {!isComplete && (
                    <Button
                      size="sm"
                      disabled={running || toProcess.length === 0}
                      onClick={handleRun}
                      className="gap-1.5"
                    >
                      {running ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Running ({completedCount}/{toProcess.length})
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          Run ({toProcess.length} selected)
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {running && (
                <div className="mt-3 space-y-1">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {completedCount} of {toProcess.length} processed…
                  </p>
                </div>
              )}
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-6">
                        <Checkbox
                          checked={selectedIds.size === actionableRows.length && actionableRows.length > 0}
                          onCheckedChange={toggleAll}
                          disabled={running}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Vehicle #</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status needed</TableHead>
                      <TableHead>VIN</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actionableRows.map((row) => {
                      const result = results.get(row.id);
                      const isSelected = selectedIds.has(row.id);
                      const isRunningRow = result?.status === "running";

                      return (
                        <TableRow
                          key={row.id}
                          className={`
                            ${isRunningRow ? "bg-blue-50 dark:bg-blue-950/30" : ""}
                            ${result?.status === "success" ? "bg-green-50/50 dark:bg-green-950/20" : ""}
                            ${result?.status === "error" ? "bg-red-50/50 dark:bg-red-950/20" : ""}
                          `}
                        >
                          <TableCell className="pl-6">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRow(row.id)}
                              disabled={running || hasResults}
                              aria-label={`Select ${row.truckId}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono font-semibold">
                            {row.truckId.trim() || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{row.name.trim() || "—"}</div>
                            <div className="text-xs text-muted-foreground">{row.ldap.trim()}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {row.needsHolman && (
                                <Badge variant="outline" className="text-xs w-fit border-orange-400 text-orange-700 dark:text-orange-400">
                                  Not in Holman
                                </Badge>
                              )}
                              {row.needsWms && (
                                <Badge variant="outline" className="text-xs w-fit border-purple-400 text-purple-700 dark:text-purple-400">
                                  Not in WMS
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.vin.trim() || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.vehicle.trim() || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.district.trim() || "—"}
                          </TableCell>
                          <TableCell>
                            {isSelected || result ? (
                              <StatusBadge
                                result={result}
                                needsHolman={row.needsHolman}
                                needsWms={row.needsWms}
                              />
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Skipped
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary after run */}
        {isComplete && results.size > 0 && (() => {
          const processedRows = actionableRows.filter((r) => results.has(r.id));
          const fullyOk = processedRows.filter((r) => rowFullySucceeded(results.get(r.id)!, r.needsHolman, r.needsWms)).length;
          const partial = processedRows.filter((r) => {
            const res = results.get(r.id)!;
            return res.status === "success" && !rowFullySucceeded(res, r.needsHolman, r.needsWms);
          }).length;
          const errCount = processedRows.filter((r) => results.get(r.id)?.status === "error").length;

          const stats = [
            { label: "Total processed", value: results.size, icon: <FileText className="h-5 w-5 text-muted-foreground" /> },
            { label: "Succeeded", value: fullyOk, icon: <CheckCircle2 className="h-5 w-5 text-green-600" /> },
            { label: "Partial / warn", value: partial, icon: <AlertCircle className="h-5 w-5 text-yellow-500" /> },
            { label: "Errors", value: errCount, icon: <XCircle className="h-5 w-5 text-red-500" /> },
          ];

          return (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Run Summary</CardTitle>
                  <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
                    <Download className="h-4 w-4" />
                    Export results
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {stats.map((stat) => (
                    <div key={stat.label} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                      {stat.icon}
                      <div>
                        <div className="text-2xl font-bold">{stat.value}</div>
                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </main>
    </MainContent>
  );
}
