import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, CalendarDays, Check } from "lucide-react";

type Tech = {
  id: string;
  techId: string | null;
  enterpriseId: string | null;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  truckNo: string | null;
  shippingSchedule: any | null;
  selected?: boolean;
};

type DaySchedule = { Su: boolean; Mo: boolean; Tu: boolean; We: boolean; Th: boolean; Fr: boolean; Sa: boolean };

const defaultDays: DaySchedule = { Su: false, Mo: false, Tu: false, We: false, Th: false, Fr: false, Sa: false };
const DAY_LABELS: { key: keyof DaySchedule; label: string }[] = [
  { key: "Su", label: "Sun" },
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

export default function TpmsShippingSchedules() {
  const { toast } = useToast();
  const [step, setStep] = useState<"find" | "change" | "confirm">("find");
  const [filters, setFilters] = useState({ district: "", pdc: "", techId: "", deMinimis: "ALL", shippingDay: "ALL" });
  const [doSearch, setDoSearch] = useState(false);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [schedule, setSchedule] = useState<DaySchedule>(defaultDays);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (filters.district) p.set("district", filters.district);
    if (filters.pdc) p.set("pdc", filters.pdc);
    if (filters.techId) p.set("techId", filters.techId);
    if (filters.deMinimis !== "ALL") p.set("deMinimis", filters.deMinimis);
    if (filters.shippingDay !== "ALL") p.set("shippingDay", filters.shippingDay);
    return p.toString();
  };

  const { data: fetchedTechs, isFetching } = useQuery<Tech[]>({
    queryKey: ["/api/tpms/shipping-schedules", buildParams()],
    queryFn: async () => {
      const q = buildParams();
      const url = q ? `/api/tpms/shipping-schedules?${q}` : "/api/tpms/shipping-schedules";
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Search failed");
      return r.json();
    },
    enabled: doSearch,
  });

  useEffect(() => {
    if (fetchedTechs && fetchedTechs.length > 0) {
      setTechs(fetchedTechs.map((t) => ({ ...t, selected: false })));
    }
  }, [fetchedTechs]);

  const updateMutation = useMutation({
    mutationFn: async ({ techs: selected, schedule: sched }: { techs: Tech[]; schedule: DaySchedule }) => {
      const r = await apiRequest("PUT", "/api/tpms/shipping-schedules", {
        techIds: selected.map((t) => t.techId),
        schedule: sched,
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Schedules updated", description: "Shipping schedules updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/shipping-schedules"] });
      handleReset();
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setDoSearch(true);
    setTechs([]);
  };

  const handleReset = () => {
    setStep("find");
    setFilters({ district: "", pdc: "", techId: "", deMinimis: "ALL", shippingDay: "ALL" });
    setDoSearch(false);
    setTechs([]);
    setSchedule(defaultDays);
  };

  const toggleSelect = (idx: number) => {
    setTechs((prev) => prev.map((t, i) => (i === idx ? { ...t, selected: !t.selected } : t)));
  };

  const selected = techs.filter((t) => t.selected);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shipping Schedules</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage part shipping schedules for technicians</p>
      </div>

      <div className="flex items-center gap-4 mb-4">
        {(["find", "change", "confirm"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : ["find", "change", "confirm"].indexOf(step) > i
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {["find", "change", "confirm"].indexOf(step) > i ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-sm font-medium capitalize">{s}</span>
          </div>
        ))}
      </div>

      {step === "find" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Find Technicians</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">District</Label>
                <Input
                  placeholder="District #"
                  value={filters.district}
                  onChange={(e) => setFilters((p) => ({ ...p, district: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">PDC</Label>
                <Input
                  placeholder="PDC #"
                  value={filters.pdc}
                  onChange={(e) => setFilters((p) => ({ ...p, pdc: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tech ID</Label>
                <Input
                  placeholder="Tech ID"
                  value={filters.techId}
                  onChange={(e) => setFilters((p) => ({ ...p, techId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">De Minimis</Label>
                <Select value={filters.deMinimis} onValueChange={(v) => setFilters((p) => ({ ...p, deMinimis: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Shipping Day</Label>
                <Select value={filters.shippingDay} onValueChange={(v) => setFilters((p) => ({ ...p, shippingDay: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Days</SelectItem>
                    <SelectItem value="Su">Sunday</SelectItem>
                    <SelectItem value="Mo">Monday</SelectItem>
                    <SelectItem value="Tu">Tuesday</SelectItem>
                    <SelectItem value="We">Wednesday</SelectItem>
                    <SelectItem value="Th">Thursday</SelectItem>
                    <SelectItem value="Fr">Friday</SelectItem>
                    <SelectItem value="Sa">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSearch} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Find Technicians
              </Button>
              <Button variant="outline" onClick={handleReset}>Reset</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "find" && doSearch && (
        <div className="space-y-3">
          {isFetching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : techs.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{techs.length} technician{techs.length !== 1 ? "s" : ""} found</p>
              <div className="grid gap-3 md:grid-cols-2">
                {techs.map((tech, idx) => (
                  <Card
                    key={tech.id}
                    className={`cursor-pointer transition-all ${tech.selected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => toggleSelect(idx)}
                  >
                    <CardContent className="pt-4 flex items-start gap-3">
                      <Checkbox checked={!!tech.selected} className="mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{tech.firstName} {tech.lastName}</p>
                        <p className="text-xs text-muted-foreground">{tech.enterpriseId} · Truck #{tech.truckNo} · Dist {tech.districtNo}</p>
                        {tech.shippingSchedule && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Schedule: {Object.entries(tech.shippingSchedule).filter(([, v]) => v).map(([k]) => k).join(", ") || "None"}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {selected.length > 0 && (
                <Button onClick={() => setStep("change")}>
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Change Schedule for {selected.length} Technician{selected.length !== 1 ? "s" : ""}
                </Button>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No technicians found.</p>
            </div>
          )}
        </div>
      )}

      {step === "change" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Shipping Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the days shipments should be delivered for {selected.length} selected technician{selected.length !== 1 ? "s" : ""}:
            </p>
            <div className="flex gap-3 flex-wrap">
              {DAY_LABELS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox
                    checked={schedule[key]}
                    onCheckedChange={(v) => setSchedule((p) => ({ ...p, [key]: !!v }))}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => setStep("confirm")}>
                <Check className="h-4 w-4 mr-2" />
                Review Changes
              </Button>
              <Button variant="outline" onClick={() => setStep("find")}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Confirm Schedule Change</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4 space-y-2">
              <p className="text-sm font-medium">
                New schedule: {Object.entries(schedule).filter(([, v]) => v).map(([k]) => k).join(", ") || "No days selected"}
              </p>
              <p className="text-sm text-muted-foreground">
                Applied to {selected.length} technician{selected.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="grid gap-2 max-h-48 overflow-y-auto">
              {selected.map((t) => (
                <div key={t.id} className="text-sm text-muted-foreground">
                  {t.firstName} {t.lastName} ({t.enterpriseId})
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => updateMutation.mutate({ techs: selected, schedule })} disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Confirm & Update
              </Button>
              <Button variant="outline" onClick={() => setStep("change")}>Back</Button>
              <Button variant="ghost" onClick={handleReset}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
