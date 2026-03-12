import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  RotateCcw,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
} from "lucide-react";

type WizardStep = "find" | "change" | "confirm";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface ScheduleResult {
  techId: string;
  enterpriseId: string;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  deMinimis: boolean;
  shippingSchedule: Record<string, boolean>;
  selected?: boolean;
}

export default function ShippingSchedules() {
  const { toast } = useToast();
  const [wizardStep, setWizardStep] = useState<WizardStep>("find");

  const [searchParams, setSearchParams] = useState({
    district: "",
    pdc: "",
    techId: "",
    deMinimis: "ALL",
    shippingDay: "ALL",
  });

  const [searchTriggered, setSearchTriggered] = useState(false);
  const [results, setResults] = useState<ScheduleResult[]>([]);
  const [newSchedule, setNewSchedule] = useState<Record<string, boolean>>({
    Su: false, Mo: false, Tu: false, We: false, Th: false, Fr: false, Sa: false,
  });

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (searchParams.district) params.set("district", searchParams.district);
    if (searchParams.pdc) params.set("pdc", searchParams.pdc);
    if (searchParams.techId) params.set("techId", searchParams.techId);
    if (searchParams.deMinimis !== "ALL") params.set("deMinimis", searchParams.deMinimis);
    if (searchParams.shippingDay !== "ALL") params.set("shippingDay", searchParams.shippingDay);
    return params.toString();
  };

  const searchQuery = useQuery<ScheduleResult[]>({
    queryKey: ["/api/tpms/shipping-schedules", buildQuery()],
    queryFn: async () => {
      const qs = buildQuery();
      const url = qs ? `/api/tpms/shipping-schedules?${qs}` : "/api/tpms/shipping-schedules";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: searchTriggered,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { techs: ScheduleResult[]; schedule: Record<string, boolean> }) => {
      const res = await apiRequest("PUT", "/api/tpms/shipping-schedules", {
        techIds: data.techs.map(t => t.techId),
        schedule: data.schedule,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedules updated", description: "Shipping schedules updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/shipping-schedules"] });
      resetAll();
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setSearchTriggered(true);
    setResults([]);
  };

  const resetAll = () => {
    setWizardStep("find");
    setSearchParams({ district: "", pdc: "", techId: "", deMinimis: "ALL", shippingDay: "ALL" });
    setSearchTriggered(false);
    setResults([]);
    setNewSchedule({ Su: false, Mo: false, Tu: false, We: false, Th: false, Fr: false, Sa: false });
  };

  useEffect(() => {
    if (searchQuery.data && searchQuery.data.length > 0) {
      setResults(searchQuery.data.map(t => ({ ...t, selected: false })));
    }
  }, [searchQuery.data]);

  const toggleSelection = (idx: number) => {
    setResults(prev => prev.map((t, i) => i === idx ? { ...t, selected: !t.selected } : t));
  };

  const selectedTechs = results.filter(t => t.selected);

  const handleConfirm = () => {
    updateMutation.mutate({ techs: selectedTechs, schedule: newSchedule });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shipping Schedules</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage part shipping schedules for technicians</p>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        {["find", "change", "confirm"].map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
              wizardStep === step ? "bg-primary text-primary-foreground" :
              ["find", "change", "confirm"].indexOf(wizardStep) > idx ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
              "bg-muted text-muted-foreground"
            }`}>
              {["find", "change", "confirm"].indexOf(wizardStep) > idx ? <Check className="h-4 w-4" /> : idx + 1}
            </div>
            <span className="text-sm font-medium capitalize">{step === "find" ? "Find" : step === "change" ? "Change Schedule" : "Confirm"}</span>
            {idx < 2 && <ArrowRight className="h-4 w-4 text-muted-foreground mx-2" />}
          </div>
        ))}
      </div>

      {wizardStep === "find" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Search Technicians</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">District</Label>
                  <Input placeholder="District" value={searchParams.district} onChange={e => setSearchParams(p => ({ ...p, district: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">PDC</Label>
                  <Input placeholder="PDC" value={searchParams.pdc} onChange={e => setSearchParams(p => ({ ...p, pdc: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tech ID</Label>
                  <Input placeholder="Tech ID" value={searchParams.techId} onChange={e => setSearchParams(p => ({ ...p, techId: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">De Minimis</Label>
                  <Select value={searchParams.deMinimis} onValueChange={v => setSearchParams(p => ({ ...p, deMinimis: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">ALL</SelectItem>
                      <SelectItem value="YES">YES</SelectItem>
                      <SelectItem value="NO">NO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Part Shipping Schedule</Label>
                  <Select value={searchParams.shippingDay} onValueChange={v => setSearchParams(p => ({ ...p, shippingDay: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">ALL</SelectItem>
                      {DAYS.map(day => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button onClick={handleSearch} disabled={searchQuery.isLoading}>
                  {searchQuery.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  FIND
                </Button>
                <Button variant="outline" onClick={resetAll}>
                  <RotateCcw className="h-4 w-4 mr-2" /> RESET
                </Button>
              </div>
            </CardContent>
          </Card>

          {results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  Results <Badge variant="secondary">{results.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={results.every(t => t.selected)}
                            onCheckedChange={(checked) => {
                              setResults(prev => prev.map(t => ({ ...t, selected: !!checked })));
                            }}
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>District-Tech ID</TableHead>
                        <TableHead>De Minimis</TableHead>
                        {DAYS.map(day => (
                          <TableHead key={day} className="text-center w-10">{day}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((tech, idx) => (
                        <TableRow key={tech.techId}>
                          <TableCell>
                            <Checkbox checked={tech.selected} onCheckedChange={() => toggleSelection(idx)} />
                          </TableCell>
                          <TableCell className="font-medium">{tech.lastName}, {tech.firstName}</TableCell>
                          <TableCell>{tech.districtNo}-{tech.techId}</TableCell>
                          <TableCell>
                            <Checkbox checked={tech.deMinimis} disabled />
                          </TableCell>
                          {DAYS.map(day => (
                            <TableCell key={day} className="text-center">
                              <Checkbox checked={tech.shippingSchedule?.[day] || false} disabled />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between mt-4">
                  <Badge variant="secondary">{selectedTechs.length} selected</Badge>
                  <Button disabled={selectedTechs.length === 0} onClick={() => setWizardStep("change")}>
                    Next: Change Schedule <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {wizardStep === "change" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Shipping Schedule</CardTitle>
            <CardDescription>Select the days for the new shipping schedule to apply to {selectedTechs.length} technician(s).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 flex-wrap py-4">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-2">
                  <Checkbox
                    id={`new-${day}`}
                    checked={newSchedule[day]}
                    onCheckedChange={(checked) => setNewSchedule(p => ({ ...p, [day]: !!checked }))}
                  />
                  <Label htmlFor={`new-${day}`} className="text-base font-medium">{day}</Label>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setWizardStep("find")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={() => setWizardStep("confirm")}>
                Next: Confirm <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {wizardStep === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Confirm Schedule Change</CardTitle>
            <CardDescription>Review and confirm the schedule change for {selectedTechs.length} technician(s).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 border rounded-md p-4">
              <h4 className="text-sm font-semibold mb-2">New Schedule</h4>
              <div className="flex gap-3">
                {DAYS.map(day => (
                  <Badge key={day} variant={newSchedule[day] ? "default" : "outline"} className="text-sm">
                    {day}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Affected Technicians ({selectedTechs.length})</h4>
              <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>District-Tech ID</TableHead>
                      <TableHead>Current Schedule</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTechs.map(tech => (
                      <TableRow key={tech.techId}>
                        <TableCell>{tech.lastName}, {tech.firstName}</TableCell>
                        <TableCell>{tech.districtNo}-{tech.techId}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {DAYS.map(day => (
                              <Badge key={day} variant={tech.shippingSchedule?.[day] ? "default" : "outline"} className="text-xs px-1.5">
                                {day}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setWizardStep("change")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={handleConfirm} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                CONFIRM CHANGE
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
