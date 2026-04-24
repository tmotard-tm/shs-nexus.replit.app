import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
} from "lucide-react";
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

  const { data: items = [], isLoading } = useQuery<DistrictCostCenter[]>({
    queryKey: ["/api/cost-centers"],
  });

  const COST_CENTER_KEY = ["/api/cost-centers"] as const;

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
      toast({
        title: "Defaults initialized",
        description: `${inserted} new district${inserted === 1 ? "" : "s"} added (${existing} already existed).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { district: "", costCenter: "" },
  });

  const districtWatch = form.watch("district");
  const onDistrictBlur = () => {
    const cc = form.getValues("costCenter");
    if (!cc && districtWatch && districtRegex.test(districtWatch.trim())) {
      const def = defaultCostCenterFor(districtWatch.trim());
      if (def) form.setValue("costCenter", def, { shouldValidate: false });
    }
  };

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
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (open) form.reset({ district: "", costCenter: "" });
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
                            onBlur={(e) => {
                              field.onBlur();
                              onDistrictBlur();
                              e.preventDefault();
                            }}
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
