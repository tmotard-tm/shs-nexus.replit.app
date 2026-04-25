import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Search,
  ArrowUpDown,
  ClipboardList,
  Database,
  Sparkles,
  Pencil,
  Check,
  X,
  Upload,
  FileUp,
  AlertCircle,
  RefreshCw,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { DistrictCostCenter } from "@shared/schema";

const districtRegex = /^\d{4,7}$/;
const costCenterRegex = /^[A-Za-z0-9]{5}$/;

const createSchema = z.object({
  district: z.string().trim().regex(districtRegex, "District must be 4 to 7 digits"),
  costCenter: z.string().trim().regex(costCenterRegex, "Cost Center must be exactly 5 alphanumeric characters"),
});
type CreateFormData = z.infer<typeof createSchema>;

function padDistrict(input: string): string {
  const digits = String(input ?? "").trim().replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(7, "0").slice(-7);
}

function defaultCostCenterFor(districtRaw: string): string {
  const padded = padDistrict(districtRaw);
  if (!padded) return "";
  const last4 = padded.slice(-4);
  return ("0" + last4).slice(-5);
}

function formatTimestamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

type SortField = "district" | "costCenter";
type SortDir = "asc" | "desc";

type BulkRowStatus = "new" | "update" | "unchanged" | "error";

interface BulkRow {
  rowNumber: number;
  rawDistrict: string;
  rawCostCenter: string;
  district: string;
  costCenter: string;
  status: BulkRowStatus;
  message?: string;
  previousCostCenter?: string;
}

interface BulkImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  submitted: number;
  errors: { row: number; district: string; costCenter: string; message: string }[];
}

function pickField(row: Record<string, any>, candidates: string[]): string {
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (candidates.includes(norm)) {
      const v = row[key];
      return v == null ? "" : String(v);
    }
  }
  return "";
}

function parseCsvText(text: string): { rawDistrict: string; rawCostCenter: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try header-based parse first
  const headerParse = Papa.parse<Record<string, any>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const districtKeys = ["district", "districtno", "districtnumber", "dist"];
  const costCenterKeys = ["costcenter", "cc", "costcentre", "centercost"];

  const headerFields = (headerParse.meta?.fields ?? []).map((f) =>
    f.trim().toLowerCase().replace(/[\s_-]+/g, ""),
  );
  const hasDistrictHeader = headerFields.some((f) => districtKeys.includes(f));
  const hasCostCenterHeader = headerFields.some((f) => costCenterKeys.includes(f));

  if (hasDistrictHeader && hasCostCenterHeader && headerParse.data.length > 0) {
    return headerParse.data.map((row) => ({
      rawDistrict: pickField(row, districtKeys),
      rawCostCenter: pickField(row, costCenterKeys),
    }));
  }

  // Fall back to header-less two-column parse
  const flatParse = Papa.parse<string[]>(trimmed, {
    header: false,
    skipEmptyLines: true,
  });
  return flatParse.data
    .map((cols) => ({
      rawDistrict: String(cols?.[0] ?? "").trim(),
      rawCostCenter: String(cols?.[1] ?? "").trim(),
    }))
    .filter((r) => r.rawDistrict || r.rawCostCenter);
}

function classifyBulkRows(
  raw: { rawDistrict: string; rawCostCenter: string }[],
  existing: DistrictCostCenter[],
): BulkRow[] {
  const existingMap = new Map(existing.map((e) => [e.district, e.costCenter]));
  const seenInBatch = new Map<string, number>();

  return raw.map((r, idx) => {
    const rowNumber = idx + 1;
    const rawDistrict = (r.rawDistrict ?? "").trim();
    const rawCostCenter = (r.rawCostCenter ?? "").trim();

    if (!rawDistrict && !rawCostCenter) {
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district: "",
        costCenter: rawCostCenter,
        status: "error" as const,
        message: "Empty row",
      };
    }

    if (!districtRegex.test(rawDistrict)) {
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district: rawDistrict,
        costCenter: rawCostCenter,
        status: "error" as const,
        message: "District must be 4 to 7 digits",
      };
    }

    const district = padDistrict(rawDistrict);

    if (!costCenterRegex.test(rawCostCenter)) {
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district,
        costCenter: rawCostCenter,
        status: "error" as const,
        message: "Cost Center must be exactly 5 alphanumeric characters",
      };
    }

    const previousInBatch = seenInBatch.get(district);
    if (previousInBatch !== undefined) {
      seenInBatch.set(district, rowNumber);
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district,
        costCenter: rawCostCenter,
        status: "error" as const,
        message: `Duplicate of row ${previousInBatch} in this batch`,
      };
    }
    seenInBatch.set(district, rowNumber);

    const prev = existingMap.get(district);
    if (prev === undefined) {
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district,
        costCenter: rawCostCenter,
        status: "new" as const,
      };
    }
    if (prev === rawCostCenter) {
      return {
        rowNumber,
        rawDistrict,
        rawCostCenter,
        district,
        costCenter: rawCostCenter,
        status: "unchanged" as const,
        previousCostCenter: prev,
      };
    }
    return {
      rowNumber,
      rawDistrict,
      rawCostCenter,
      district,
      costCenter: rawCostCenter,
      status: "update" as const,
      previousCostCenter: prev,
    };
  });
}

export default function CostCenterManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<DistrictCostCenter | null>(null);
  const [editingDistrict, setEditingDistrict] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("district");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[] | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: items = [], isLoading } = useQuery<DistrictCostCenter[]>({
    queryKey: ["/api/cost-centers"],
  });

  const COST_CENTER_KEY = ["/api/cost-centers"] as const;
  const AUTO_SEED_STATUS_KEY = ["/api/cost-centers/auto-seed-status"] as const;

  const { data: autoSeedStatus } = useQuery<{
    lastAutoSeed: string | null;
    intervalMs: number;
  }>({
    queryKey: AUTO_SEED_STATUS_KEY,
    refetchInterval: 60_000,
  });

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const lastAutoSeedRelative = useMemo(() => {
    if (!autoSeedStatus?.lastAutoSeed) return null;
    const d = new Date(autoSeedStatus.lastAutoSeed);
    if (isNaN(d.getTime())) return null;
    void nowTick;
    return formatDistanceToNow(d, { addSuffix: true });
  }, [autoSeedStatus?.lastAutoSeed, nowTick]);

  const lastAutoSeedAbsolute = useMemo(() => {
    if (!autoSeedStatus?.lastAutoSeed) return null;
    const d = new Date(autoSeedStatus.lastAutoSeed);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString();
  }, [autoSeedStatus?.lastAutoSeed]);

  const createMutation = useMutation({
    mutationFn: (data: CreateFormData) => apiRequest("POST", "/api/cost-centers", data),
    onMutate: async (data: CreateFormData) => {
      await queryClient.cancelQueries({ queryKey: COST_CENTER_KEY });
      const previous = queryClient.getQueryData<DistrictCostCenter[]>(COST_CENTER_KEY);
      const padded = padDistrict(data.district) || data.district;
      const optimistic: DistrictCostCenter = {
        district: padded,
        costCenter: data.costCenter,
        updatedAt: new Date(),
        updatedBy: null,
      };
      queryClient.setQueryData<DistrictCostCenter[]>(COST_CENTER_KEY, (old = []) => {
        const without = old.filter((r) => r.district !== padded);
        return [...without, optimistic];
      });
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(COST_CENTER_KEY, ctx.previous);
      if (error.message.startsWith("409:")) {
        form.setError("district", {
          type: "manual",
          message: "This district is already mapped. Edit the existing row instead.",
        });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSuccess: () => {
      setIsCreateOpen(false);
      toast({ title: "District added", description: "The cost center has been saved." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ district, costCenter }: { district: string; costCenter: string }) =>
      apiRequest("PATCH", `/api/cost-centers/${district}`, { costCenter }),
    onMutate: async ({ district, costCenter }) => {
      await queryClient.cancelQueries({ queryKey: COST_CENTER_KEY });
      const previous = queryClient.getQueryData<DistrictCostCenter[]>(COST_CENTER_KEY);
      queryClient.setQueryData<DistrictCostCenter[]>(COST_CENTER_KEY, (old = []) =>
        old.map((r) => (r.district === district ? { ...r, costCenter, updatedAt: new Date() } : r))
      );
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(COST_CENTER_KEY, ctx.previous);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSuccess: () => {
      setEditingDistrict(null);
      setEditingValue("");
      setEditingError(null);
      toast({ title: "Updated", description: "Cost center updated." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (district: string) => apiRequest("DELETE", `/api/cost-centers/${district}`),
    onMutate: async (district: string) => {
      await queryClient.cancelQueries({ queryKey: COST_CENTER_KEY });
      const previous = queryClient.getQueryData<DistrictCostCenter[]>(COST_CENTER_KEY);
      queryClient.setQueryData<DistrictCostCenter[]>(COST_CENTER_KEY, (old = []) =>
        old.filter((r) => r.district !== district)
      );
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(COST_CENTER_KEY, ctx.previous);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSuccess: () => {
      setDeleting(null);
      toast({ title: "Removed", description: "District removed." });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cost-centers/init-defaults");
      return (await res.json()) as { inserted: number; existing: number };
    },
    onSuccess: ({ inserted, existing }) => {
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
      queryClient.invalidateQueries({ queryKey: AUTO_SEED_STATUS_KEY });
      toast({
        title: "Defaults initialized",
        description: `${inserted} new district${inserted === 1 ? "" : "s"} added (${existing} already existed).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const triggerAutoSeedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cost-centers/trigger-auto-seed");
      return (await res.json()) as {
        inserted: number;
        existing: number;
        lastAutoSeed: string | null;
      };
    },
    onSuccess: ({ inserted, existing }) => {
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
      queryClient.invalidateQueries({ queryKey: AUTO_SEED_STATUS_KEY });
      toast({
        title: "Auto-seed complete",
        description:
          `${inserted} new district${inserted === 1 ? "" : "s"} added; ` +
          `${existing} already present.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-seed failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async (records: { district: string; costCenter: string }[]) => {
      const res = await apiRequest("POST", "/api/cost-centers/bulk", { records });
      return (await res.json()) as BulkImportResult;
    },
    onSuccess: (result) => {
      setBulkResult(result);
      queryClient.invalidateQueries({ queryKey: COST_CENTER_KEY });
      toast({
        title: "Bulk import complete",
        description: `${result.inserted} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk import failed", description: error.message, variant: "destructive" });
    },
  });

  const resetBulk = () => {
    setBulkText("");
    setBulkRows(null);
    setBulkResult(null);
    setBulkFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleBulkPreview = () => {
    const parsed = parseCsvText(bulkText);
    if (parsed.length === 0) {
      toast({
        title: "Nothing to preview",
        description: "Paste CSV data or upload a file first.",
        variant: "destructive",
      });
      return;
    }
    const classified = classifyBulkRows(parsed, items);
    setBulkRows(classified);
    setBulkResult(null);
  };

  const handleBulkFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      setBulkText(text);
      setBulkFileName(file.name);
      const parsed = parseCsvText(text);
      const classified = classifyBulkRows(parsed, items);
      setBulkRows(classified);
      setBulkResult(null);
    };
    reader.onerror = () => {
      toast({
        title: "Could not read file",
        description: "Please try a different CSV file.",
        variant: "destructive",
      });
    };
    reader.readAsText(file);
  };

  const handleBulkApply = () => {
    if (!bulkRows) return;
    const toApply = bulkRows
      .filter((r) => r.status === "new" || r.status === "update")
      .map((r) => ({ district: r.district, costCenter: r.costCenter }));
    if (toApply.length === 0) {
      toast({
        title: "Nothing to apply",
        description: "There are no rows that would change anything.",
        variant: "destructive",
      });
      return;
    }
    bulkMutation.mutate(toApply);
  };

  const bulkSummary = useMemo(() => {
    if (!bulkRows) return null;
    return {
      total: bulkRows.length,
      newCount: bulkRows.filter((r) => r.status === "new").length,
      updateCount: bulkRows.filter((r) => r.status === "update").length,
      unchangedCount: bulkRows.filter((r) => r.status === "unchanged").length,
      errorCount: bulkRows.filter((r) => r.status === "error").length,
    };
  }, [bulkRows]);

  const form = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { district: "", costCenter: "" },
  });

  const districtWatch = form.watch("district");
  const costCenterWatch = form.watch("costCenter");
  const [userTouchedCostCenter, setUserTouchedCostCenter] = useState(false);

  useEffect(() => {
    if (userTouchedCostCenter) return;
    const trimmed = (districtWatch ?? "").trim();
    if (!trimmed || !districtRegex.test(trimmed)) return;
    const def = defaultCostCenterFor(trimmed);
    if (def && def !== costCenterWatch) {
      form.setValue("costCenter", def, { shouldValidate: false });
    }
  }, [districtWatch, costCenterWatch, userTouchedCostCenter, form]);

  const onSubmit = (data: CreateFormData) => {
    createMutation.mutate(data);
  };

  const startEdit = (row: DistrictCostCenter) => {
    setEditingDistrict(row.district);
    setEditingValue(row.costCenter);
    setEditingError(null);
  };

  const cancelEdit = () => {
    setEditingDistrict(null);
    setEditingValue("");
    setEditingError(null);
  };

  const commitEdit = (row: DistrictCostCenter) => {
    const trimmed = editingValue.trim();
    if (!costCenterRegex.test(trimmed)) {
      setEditingError("Must be exactly 5 alphanumeric characters");
      return;
    }
    if (trimmed === row.costCenter) {
      cancelEdit();
      return;
    }
    updateMutation.mutate({ district: row.district, costCenter: trimmed });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filteredSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (!q) return true;
      return (
        it.district.toLowerCase().includes(q) ||
        it.costCenter.toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = (a[sortField] || "").toString();
      const bv = (b[sortField] || "").toString();
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [items, searchQuery, sortField, sortDir]);

  const stats = {
    total: items.length,
    custom: items.filter((it) => it.costCenter !== defaultCostCenterFor(it.district)).length,
  };

  const isEmpty = !isLoading && items.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            data-testid="button-back"
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">District Cost Centers</h1>
            <p className="text-muted-foreground">
              Map every district to its accounting cost center.
            </p>
            <p
              className="text-xs text-muted-foreground mt-1 flex items-center gap-1"
              data-testid="text-last-auto-seed"
              title={lastAutoSeedAbsolute ?? undefined}
            >
              <Clock className="h-3 w-3" />
              <span>
                Last auto-refreshed:{" "}
                <span className="font-medium">
                  {lastAutoSeedRelative ?? "never (will run on next scheduler tick)"}
                </span>
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => triggerAutoSeedMutation.mutate()}
            disabled={triggerAutoSeedMutation.isPending}
            data-testid="button-trigger-auto-seed"
            title="Run the same daily auto-seed job now"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${triggerAutoSeedMutation.isPending ? "animate-spin" : ""}`}
            />
            {triggerAutoSeedMutation.isPending ? "Running..." : "Run auto-seed now"}
          </Button>
          <Button
            variant="outline"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-init-defaults"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {seedMutation.isPending ? "Initializing..." : "Initialize Defaults"}
          </Button>
          <Dialog
            open={isBulkOpen}
            onOpenChange={(open) => {
              setIsBulkOpen(open);
              if (!open) resetBulk();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-open-bulk-import">
                <Upload className="mr-2 h-4 w-4" />
                Bulk Import
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[820px] max-h-[90vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle>Bulk Import Cost Centers</DialogTitle>
                <DialogDescription>
                  Paste CSV data or upload a file with two columns: <code>district</code> and{" "}
                  <code>cost_center</code>. We'll show a preview before anything is saved.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      data-testid="input-bulk-file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBulkFile(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-bulk-upload"
                    >
                      <FileUp className="mr-2 h-4 w-4" />
                      Upload CSV
                    </Button>
                    {bulkFileName && (
                      <span className="text-xs text-muted-foreground">
                        {bulkFileName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      or paste below — header row optional
                    </span>
                  </div>
                  <Textarea
                    value={bulkText}
                    onChange={(e) => {
                      setBulkText(e.target.value);
                      setBulkRows(null);
                      setBulkResult(null);
                    }}
                    placeholder={"district,cost_center\n4766,04766\n5012,05012"}
                    className="font-mono text-xs min-h-[140px]"
                    data-testid="textarea-bulk-csv"
                  />
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-muted-foreground">
                      Districts will be padded to 7 digits. Cost center must be exactly 5
                      alphanumeric characters.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleBulkPreview}
                      data-testid="button-bulk-preview"
                    >
                      Preview
                    </Button>
                  </div>
                </div>

                {bulkSummary && (
                  <div className="flex flex-wrap gap-2 text-xs" data-testid="bulk-summary">
                    <Badge variant="secondary">Total: {bulkSummary.total}</Badge>
                    <Badge className="bg-green-600 hover:bg-green-700">
                      New: {bulkSummary.newCount}
                    </Badge>
                    <Badge className="bg-blue-600 hover:bg-blue-700">
                      Update: {bulkSummary.updateCount}
                    </Badge>
                    <Badge variant="outline">Unchanged: {bulkSummary.unchangedCount}</Badge>
                    <Badge variant="destructive">Errors: {bulkSummary.errorCount}</Badge>
                  </div>
                )}

                {bulkResult && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1" data-testid="bulk-result">
                    <p className="font-medium">Import complete</p>
                    <p className="text-muted-foreground">
                      {bulkResult.inserted} inserted, {bulkResult.updated} updated,{" "}
                      {bulkResult.unchanged} unchanged, {bulkResult.skipped} skipped (out of{" "}
                      {bulkResult.submitted} submitted).
                    </p>
                    {bulkResult.errors.length > 0 && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Some rows were skipped. See the preview below for details.
                      </p>
                    )}
                  </div>
                )}

                {bulkRows && bulkRows.length > 0 && (
                  <div className="border rounded-md overflow-hidden">
                    <div className="max-h-[320px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>District</TableHead>
                            <TableHead>Cost Center</TableHead>
                            <TableHead>Change</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bulkRows.map((row) => (
                            <TableRow
                              key={`${row.rowNumber}-${row.district || row.rawDistrict}`}
                              data-testid={`bulk-row-${row.rowNumber}`}
                            >
                              <TableCell className="text-xs text-muted-foreground">
                                {row.rowNumber}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.district || row.rawDistrict || "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.costCenter || row.rawCostCenter || "—"}
                              </TableCell>
                              <TableCell className="text-xs">
                                {row.status === "update" && row.previousCostCenter ? (
                                  <span className="font-mono">
                                    <span className="line-through text-muted-foreground">
                                      {row.previousCostCenter}
                                    </span>{" "}
                                    → <span className="text-blue-600 dark:text-blue-400">
                                      {row.costCenter}
                                    </span>
                                  </span>
                                ) : row.status === "new" ? (
                                  <span className="text-green-600 dark:text-green-400">
                                    new mapping
                                  </span>
                                ) : row.status === "unchanged" ? (
                                  <span className="text-muted-foreground">no change</span>
                                ) : (
                                  <span className="text-destructive">{row.message}</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {row.status === "new" && (
                                  <Badge className="bg-green-600 hover:bg-green-700">New</Badge>
                                )}
                                {row.status === "update" && (
                                  <Badge className="bg-blue-600 hover:bg-blue-700">Update</Badge>
                                )}
                                {row.status === "unchanged" && (
                                  <Badge variant="outline">Unchanged</Badge>
                                )}
                                {row.status === "error" && (
                                  <Badge variant="destructive">Error</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="border-t pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetBulk}
                  disabled={bulkMutation.isPending}
                  data-testid="button-bulk-reset"
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsBulkOpen(false)}
                  disabled={bulkMutation.isPending}
                  data-testid="button-bulk-close"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={handleBulkApply}
                  disabled={
                    bulkMutation.isPending ||
                    !bulkSummary ||
                    bulkSummary.newCount + bulkSummary.updateCount === 0
                  }
                  data-testid="button-bulk-apply"
                >
                  {bulkMutation.isPending
                    ? "Applying..."
                    : bulkSummary
                      ? `Apply ${bulkSummary.newCount + bulkSummary.updateCount} change${bulkSummary.newCount + bulkSummary.updateCount === 1 ? "" : "s"}`
                      : "Apply"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (open) {
                form.reset({ district: "", costCenter: "" });
                setUserTouchedCostCenter(false);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button data-testid="button-create-cost-center">
                <Plus className="mr-2 h-4 w-4" />
                Add District
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>Add District Cost Center</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="district"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>District Number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. 4766 or 0004766"
                            data-testid="input-district"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground">
                          Stored as 7-digit zero-padded (e.g. 0004766).
                        </p>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="costCenter"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Center</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="5 characters (e.g. 04766)"
                            maxLength={5}
                            data-testid="input-cost-center"
                            {...field}
                            onChange={(e) => {
                              setUserTouchedCostCenter(true);
                              field.onChange(e);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                        {districtWatch && districtRegex.test(districtWatch.trim()) && (
                          <p className="text-xs text-muted-foreground">
                            Default for this district: {defaultCostCenterFor(districtWatch.trim())}
                          </p>
                        )}
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setIsCreateOpen(false)}
                      data-testid="button-cancel-create"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      data-testid="button-submit-create"
                    >
                      {createMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Districts</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-districts">
              {stats.total}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Overrides</CardTitle>
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-custom-overrides">
              {stats.custom}
            </div>
            <p className="text-xs text-muted-foreground">
              Cost center differs from "0 + last 4 digits" rule.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Default Rule</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono">"0" + last 4 digits</div>
            <p className="text-xs text-muted-foreground">
              e.g. district 0004766 → cost center 04766
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mappings</CardTitle>
          <CardDescription>
            Search by district or cost center. Click a cost center to edit it inline.
          </CardDescription>
          <div className="relative w-full md:w-80 mt-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search district or cost center..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="input-search"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2 py-2" data-testid="loading-skeleton">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-muted-foreground">
                No districts mapped yet. Click "Initialize Defaults" to populate from live data,
                or "Add District" to create one manually.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("district")}
                        data-testid="button-sort-district"
                      >
                        District <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("costCenter")}
                        data-testid="button-sort-cost-center"
                      >
                        Cost Center <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSorted.map((row) => {
                    const displayDistrict = row.district.replace(/^0+/, "") || row.district;
                    const isEditing = editingDistrict === row.district;
                    const def = defaultCostCenterFor(row.district);
                    const isCustom = row.costCenter !== def;
                    return (
                      <TableRow key={row.district} data-testid={`row-${row.district}`}>
                        <TableCell className="font-mono">
                          <div className="flex flex-col">
                            <span data-testid={`text-district-${row.district}`}>
                              {displayDistrict}
                            </span>
                            <span className="text-xs text-muted-foreground">{row.district}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  value={editingValue}
                                  maxLength={5}
                                  onChange={(e) => {
                                    setEditingValue(e.target.value);
                                    setEditingError(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit(row);
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                  onBlur={(e) => {
                                    // Don't commit if blur is caused by clicking the
                                    // save/cancel buttons inside this row — they handle it.
                                    const next = e.relatedTarget as HTMLElement | null;
                                    if (
                                      next?.getAttribute?.("data-testid") ===
                                        `button-save-${row.district}` ||
                                      next?.getAttribute?.("data-testid") ===
                                        `button-cancel-edit-${row.district}`
                                    ) {
                                      return;
                                    }
                                    commitEdit(row);
                                  }}
                                  className="h-8 w-28 font-mono"
                                  data-testid={`input-edit-${row.district}`}
                                />
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => commitEdit(row)}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-save-${row.district}`}
                                >
                                  <Check className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={cancelEdit}
                                  data-testid={`button-cancel-edit-${row.district}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              {editingError && (
                                <span className="text-xs text-destructive">{editingError}</span>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="font-mono text-left hover:underline flex items-center gap-2"
                              onClick={() => startEdit(row)}
                              data-testid={`button-edit-${row.district}`}
                            >
                              <span>{row.costCenter}</span>
                              {isCustom && (
                                <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                  override
                                </span>
                              )}
                              <Pencil className="h-3 w-3 opacity-40" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex flex-col">
                            <span>{formatTimestamp(row.updatedAt)}</span>
                            {row.updatedBy && (
                              <span className="text-xs">by {row.updatedBy}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleting(row)}
                            data-testid={`button-delete-${row.district}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredSorted.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No mappings match your search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove district mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  This will remove the cost center mapping for district{" "}
                  <span className="font-mono font-semibold">{deleting.district}</span> (currently{" "}
                  <span className="font-mono font-semibold">{deleting.costCenter}</span>). You can
                  re-add it or initialize defaults again to bring it back.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.district)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
