import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  RotateCcw,
  Loader2,
  User,
  Save,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

interface TechProfile {
  id: string;
  techId: string;
  enterpriseId: string;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  pdcNo: string | null;
  techManagerLdapId: string | null;
  techManagerName: string | null;
  truckNo: string | null;
  mobilePhone: string | null;
  email: string | null;
  shippingAddresses: any[];
  shippingSchedule: Record<string, boolean>;
  deMinimis: boolean;
  extendedHolds: any[];
  techReplenishment: Record<string, any>;
  syncedAt: string;
  lastTpmsUpdatedAt: string | null;
  _isLive?: boolean;
}

interface ChangeLogEntry {
  id: number;
  userId: string;
  username: string | null;
  techId: string;
  enterpriseId: string | null;
  fieldChanged: string;
  valueBefore: string | null;
  valueAfter: string | null;
  source: string;
  confirmedAt: string | null;
  confirmedByTpms: boolean;
  createdAt: string;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function TechProfiles() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useState({
    district: "",
    lastName: "",
    firstName: "",
    techManagerId: "",
    pdc: "",
    enterpriseId: "",
    truckNo: "",
    techId: "",
  });
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [selectedTech, setSelectedTech] = useState<TechProfile | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<TechProfile>>({});

  const buildSearchQuery = () => {
    const params = new URLSearchParams();
    if (searchParams.district) params.set("district", searchParams.district);
    if (searchParams.lastName) params.set("lastName", searchParams.lastName);
    if (searchParams.firstName) params.set("firstName", searchParams.firstName);
    if (searchParams.techManagerId) params.set("techManagerId", searchParams.techManagerId);
    if (searchParams.pdc) params.set("pdc", searchParams.pdc);
    if (searchParams.enterpriseId) params.set("enterpriseId", searchParams.enterpriseId);
    if (searchParams.truckNo) params.set("truckNo", searchParams.truckNo);
    if (searchParams.techId) params.set("techId", searchParams.techId);
    return params.toString();
  };

  const { data: searchResults = [], isLoading: searching } = useQuery<TechProfile[]>({
    queryKey: ["/api/tpms/techs", buildSearchQuery()],
    queryFn: async () => {
      const qs = buildSearchQuery();
      const url = qs ? `/api/tpms/techs?${qs}` : "/api/tpms/techs";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: searchTriggered,
  });

  // Determine if this is an Enterprise ID-only search with no local results
  const isEnterpriseIdOnlySearch = searchTriggered &&
    !!searchParams.enterpriseId &&
    !searchParams.district && !searchParams.lastName && !searchParams.firstName &&
    !searchParams.techManagerId && !searchParams.pdc && !searchParams.truckNo && !searchParams.techId;

  const { data: liveResult, isLoading: liveSearching } = useQuery<TechProfile | null>({
    queryKey: ["/api/tpms/techinfo", searchParams.enterpriseId],
    queryFn: async () => {
      const res = await fetch(`/api/tpms/techinfo/${encodeURIComponent(searchParams.enterpriseId.trim().toUpperCase())}`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      const d = json?.data;
      if (!d) return null;
      // Map TPMS API TechInfoResponse → TechProfile shape
      return {
        id: d.ldapId || d.techId || "",
        techId: d.techId || "",
        enterpriseId: (d.ldapId || "").toUpperCase(),
        firstName: d.firstName || null,
        lastName: d.lastName || null,
        districtNo: d.districtNo || null,
        pdcNo: null,
        techManagerLdapId: d.techManagerLdapId?.trim() || null,
        techManagerName: null,
        truckNo: d.truckNo?.trim() || null,
        mobilePhone: d.contactNo || null,
        email: d.email || null,
        shippingAddresses: d.addresses || [],
        shippingSchedule: {},
        deMinimis: false,
        extendedHolds: d.latestShippingHold ? [d.latestShippingHold] : [],
        techReplenishment: d.techReplenishment || {},
        syncedAt: new Date().toISOString(),
        lastTpmsUpdatedAt: null,
        _isLive: true,
      } as TechProfile;
    },
    enabled: isEnterpriseIdOnlySearch && !searching && searchResults.length === 0,
  });

  // Final display list: local results, or live result only when this is an Enterprise ID-only search.
  // Gating on isEnterpriseIdOnlySearch prevents stale liveResult from bleeding into
  // unrelated searches (useQuery caches the last live response even when disabled).
  const displayResults: TechProfile[] = searchResults.length > 0
    ? searchResults
    : (isEnterpriseIdOnlySearch && liveResult ? [liveResult] : []);
  const isLoadingAny = searching || (isEnterpriseIdOnlySearch && searchResults.length === 0 && liveSearching);

  const { data: changeHistoryData, isLoading: loadingHistory } = useQuery<{
    techId: string;
    cdcLog: ChangeLogEntry[];
    tpmsApiHistory: Array<{ entryDate: string; fieldChanged: string; valueBefore?: string; valueAfter?: string; changedBy?: string; source: string }>;
    currentTpmsState: any;
    tpmsStateSource: string;
    pendingCount: number;
  } | ChangeLogEntry[]>({
    queryKey: ["/api/tpms/techs", selectedTech?.techId, "change-history"],
    queryFn: async () => {
      const res = await fetch(`/api/tpms/techs/${selectedTech!.techId}/change-history`);
      if (!res.ok) throw new Error("Failed to load change history");
      return res.json();
    },
    enabled: !!selectedTech,
  });

  // Handle both old (array) and new (object) response shapes
  const changeHistory: ChangeLogEntry[] = Array.isArray(changeHistoryData)
    ? changeHistoryData
    : (changeHistoryData?.cdcLog ?? []);
  const tpmsApiHistory = Array.isArray(changeHistoryData) ? [] : (changeHistoryData?.tpmsApiHistory ?? []);
  const currentTpmsState = Array.isArray(changeHistoryData) ? null : changeHistoryData?.currentTpmsState;
  const tpmsStateSource = Array.isArray(changeHistoryData) ? 'none' : (changeHistoryData?.tpmsStateSource ?? 'none');
  const pendingCdcCount = Array.isArray(changeHistoryData) ? 0 : (changeHistoryData?.pendingCount ?? 0);

  const updateMutation = useMutation({
    mutationFn: async (data: { techId: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PUT", `/api/tpms/techs/${data.techId}`, data.updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated", description: "Changes saved and sent to TPMS." });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      setEditMode(false);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setSearchTriggered(true);
    queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
  };

  const handleReset = () => {
    setSearchParams({ district: "", lastName: "", firstName: "", techManagerId: "", pdc: "", enterpriseId: "", truckNo: "", techId: "" });
    setSearchTriggered(false);
  };

  const openProfile = (tech: TechProfile) => {
    setSelectedTech(tech);
    setEditData({ ...tech });
    setEditMode(false);
  };

  const handleSave = () => {
    if (!selectedTech) return;
    updateMutation.mutate({
      techId: selectedTech.techId,
      updates: {
        firstName: editData.firstName,
        lastName: editData.lastName,
        mobilePhone: editData.mobilePhone,
        email: editData.email,
        shippingSchedule: editData.shippingSchedule,
        deMinimis: editData.deMinimis,
        shippingAddresses: editData.shippingAddresses,
        extendedHolds: editData.extendedHolds,
        techReplenishment: editData.techReplenishment,
      },
    });
  };

  const addAddress = () => {
    setEditData(prev => ({
      ...prev,
      shippingAddresses: [
        ...(prev.shippingAddresses || []),
        { addressType: "ALTERNATE", shipToName: "", addrLine1: "", addrLine2: "", city: "", stateCd: "", zipCd: "" },
      ],
    }));
  };

  const removeAddress = (idx: number) => {
    setEditData(prev => ({
      ...prev,
      shippingAddresses: (prev.shippingAddresses || []).filter((_: any, i: number) => i !== idx),
    }));
  };

  const updateAddress = (idx: number, field: string, value: string) => {
    setEditData(prev => ({
      ...prev,
      shippingAddresses: (prev.shippingAddresses || []).map((addr: any, i: number) =>
        i === idx ? { ...addr, [field]: value } : addr
      ),
    }));
  };

  const addExtendedHold = () => {
    setEditData(prev => ({
      ...prev,
      extendedHolds: [
        ...(prev.extendedHolds || []),
        { beginDate: "", endDate: "", holdReason: "" },
      ],
    }));
  };

  const removeExtendedHold = (idx: number) => {
    setEditData(prev => ({
      ...prev,
      extendedHolds: (prev.extendedHolds || []).filter((_: any, i: number) => i !== idx),
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tech Profiles</h1>
          <p className="text-muted-foreground text-sm mt-1">Search and manage technician profiles</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find Technician</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">District</Label>
              <Input placeholder="District #" value={searchParams.district} onChange={e => setSearchParams(p => ({ ...p, district: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last Name</Label>
              <Input placeholder="Last name" value={searchParams.lastName} onChange={e => setSearchParams(p => ({ ...p, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">First Name</Label>
              <Input placeholder="First name" value={searchParams.firstName} onChange={e => setSearchParams(p => ({ ...p, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tech Mgr Enterprise ID</Label>
              <Input placeholder="Manager LDAP" value={searchParams.techManagerId} onChange={e => setSearchParams(p => ({ ...p, techManagerId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PDC</Label>
              <Input placeholder="PDC" value={searchParams.pdc} onChange={e => setSearchParams(p => ({ ...p, pdc: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tech Enterprise ID</Label>
              <Input placeholder="Enterprise ID" value={searchParams.enterpriseId} onChange={e => setSearchParams(p => ({ ...p, enterpriseId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Truck No</Label>
              <Input placeholder="Truck #" value={searchParams.truckNo} onChange={e => setSearchParams(p => ({ ...p, truckNo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tech ID</Label>
              <Input placeholder="Tech ID" value={searchParams.techId} onChange={e => setSearchParams(p => ({ ...p, techId: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              FIND
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              RESET
            </Button>
          </div>
        </CardContent>
      </Card>

      {searchTriggered && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Results
              <Badge variant="secondary">{displayResults.length}</Badge>
              {isEnterpriseIdOnlySearch && liveResult && searchResults.length === 0 && (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border border-blue-300">
                  Live TPMS lookup
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingAny ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : displayResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No technicians found matching your criteria.</p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Tech ID</TableHead>
                      <TableHead>Enterprise ID</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead>Truck No</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayResults.map((tech) => (
                      <TableRow
                        key={tech.id || tech.techId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openProfile(tech)}
                      >
                        <TableCell className="font-medium">
                          {tech.lastName}, {tech.firstName}
                        </TableCell>
                        <TableCell>{tech.techId}</TableCell>
                        <TableCell>{tech.enterpriseId}</TableCell>
                        <TableCell>{tech.districtNo}</TableCell>
                        <TableCell>{tech.truckNo || "—"}</TableCell>
                        <TableCell>{tech.mobilePhone || "—"}</TableCell>
                        <TableCell>
                          {tech._isLive && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border border-blue-300">
                              Live
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedTech} onOpenChange={(open) => { if (!open) setSelectedTech(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {selectedTech?.lastName}, {selectedTech?.firstName}
              <Badge variant="outline" className="ml-2">{selectedTech?.techId}</Badge>
              <Badge variant="secondary">{selectedTech?.enterpriseId}</Badge>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="profile" className="flex-1 min-h-0">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="history">Change History</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-4 overflow-auto max-h-[calc(90vh-180px)]">
              <ScrollArea className="h-full pr-4">
                <div className="space-y-6">
                  <div className="flex justify-end gap-2">
                    {editMode ? (
                      <>
                        <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                          {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                          SAVE
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setEditData({ ...selectedTech! }); }}>
                          <RotateCcw className="h-4 w-4 mr-1" /> RESET
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditMode(false); setSelectedTech(null); }}>
                          <X className="h-4 w-4 mr-1" /> CANCEL
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setEditMode(true)}>Edit Profile</Button>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">General</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Tech ID</Label>
                        <p className="text-sm">{selectedTech?.techId}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Enterprise ID</Label>
                        <p className="text-sm">{selectedTech?.enterpriseId}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">District</Label>
                        <p className="text-sm">{selectedTech?.districtNo || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">PDC</Label>
                        <p className="text-sm">{selectedTech?.pdcNo || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Tech Manager</Label>
                        <p className="text-sm">{selectedTech?.techManagerName || selectedTech?.techManagerLdapId || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Truck No</Label>
                        <p className="text-sm">{selectedTech?.truckNo || "—"}</p>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Contact Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">First Name</Label>
                        {editMode ? (
                          <Input value={editData.firstName || ""} onChange={e => setEditData(p => ({ ...p, firstName: e.target.value }))} />
                        ) : (
                          <p className="text-sm">{selectedTech?.firstName || "—"}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Last Name</Label>
                        {editMode ? (
                          <Input value={editData.lastName || ""} onChange={e => setEditData(p => ({ ...p, lastName: e.target.value }))} />
                        ) : (
                          <p className="text-sm">{selectedTech?.lastName || "—"}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Mobile Phone</Label>
                        {editMode ? (
                          <Input value={editData.mobilePhone || ""} onChange={e => setEditData(p => ({ ...p, mobilePhone: e.target.value }))} />
                        ) : (
                          <p className="text-sm">{selectedTech?.mobilePhone || "—"}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Email</Label>
                        {editMode ? (
                          <Input value={editData.email || ""} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} />
                        ) : (
                          <p className="text-sm">{selectedTech?.email || "—"}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">Shipping Information</h3>
                      {editMode && (
                        <Button size="sm" variant="outline" onClick={addAddress}>
                          <Plus className="h-3 w-3 mr-1" /> ADD ADDRESS
                        </Button>
                      )}
                    </div>
                    {(editMode ? editData.shippingAddresses : selectedTech?.shippingAddresses)?.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No shipping addresses on file.</p>
                    ) : (
                      <div className="border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Type</TableHead>
                              <TableHead>Ship To</TableHead>
                              <TableHead>Address</TableHead>
                              <TableHead>City</TableHead>
                              <TableHead>State</TableHead>
                              <TableHead>Zip</TableHead>
                              {editMode && <TableHead className="w-10"></TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(editMode ? editData.shippingAddresses : selectedTech?.shippingAddresses || []).map((addr: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  {editMode ? (
                                    <Input className="h-8 text-xs w-28" value={addr.addressType || ""} onChange={e => updateAddress(idx, "addressType", e.target.value)} />
                                  ) : (
                                    <Badge variant="outline" className="text-xs">{addr.addressType}</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {editMode ? (
                                    <Input className="h-8 text-xs" value={addr.shipToName || ""} onChange={e => updateAddress(idx, "shipToName", e.target.value)} />
                                  ) : (
                                    addr.shipToName || "—"
                                  )}
                                </TableCell>
                                <TableCell>
                                  {editMode ? (
                                    <div className="space-y-1">
                                      <Input className="h-8 text-xs" placeholder="Line 1" value={addr.addrLine1 || ""} onChange={e => updateAddress(idx, "addrLine1", e.target.value)} />
                                      <Input className="h-8 text-xs" placeholder="Line 2" value={addr.addrLine2 || ""} onChange={e => updateAddress(idx, "addrLine2", e.target.value)} />
                                    </div>
                                  ) : (
                                    <span className="text-sm">{[addr.addrLine1, addr.addrLine2].filter(Boolean).join(", ") || "—"}</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {editMode ? (
                                    <Input className="h-8 text-xs w-24" value={addr.city || ""} onChange={e => updateAddress(idx, "city", e.target.value)} />
                                  ) : (
                                    addr.city || "—"
                                  )}
                                </TableCell>
                                <TableCell>
                                  {editMode ? (
                                    <Input className="h-8 text-xs w-14" value={addr.stateCd || ""} onChange={e => updateAddress(idx, "stateCd", e.target.value)} />
                                  ) : (
                                    addr.stateCd || "—"
                                  )}
                                </TableCell>
                                <TableCell>
                                  {editMode ? (
                                    <Input className="h-8 text-xs w-20" value={addr.zipCd || ""} onChange={e => updateAddress(idx, "zipCd", e.target.value)} />
                                  ) : (
                                    addr.zipCd || "—"
                                  )}
                                </TableCell>
                                {editMode && (
                                  <TableCell>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeAddress(idx)}>
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </TableCell>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Part Shipping Schedule</h3>
                    <div className="flex gap-4 flex-wrap">
                      {DAYS.map(day => (
                        <div key={day} className="flex items-center gap-1.5">
                          <Checkbox
                            id={`day-${day}`}
                            checked={(editMode ? editData.shippingSchedule : selectedTech?.shippingSchedule)?.[day] || false}
                            onCheckedChange={(checked) => {
                              if (editMode) {
                                setEditData(p => ({
                                  ...p,
                                  shippingSchedule: { ...(p.shippingSchedule || {}), [day]: !!checked },
                                }));
                              }
                            }}
                            disabled={!editMode}
                          />
                          <Label htmlFor={`day-${day}`} className="text-sm">{day}</Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">Extended Hold Shipping Periods</h3>
                      {editMode && (
                        <Button size="sm" variant="outline" onClick={addExtendedHold}>
                          <Plus className="h-3 w-3 mr-1" /> ADD
                        </Button>
                      )}
                    </div>
                    {(editMode ? editData.extendedHolds : selectedTech?.extendedHolds)?.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No extended hold periods.</p>
                    ) : (
                      <div className="space-y-2">
                        {(editMode ? editData.extendedHolds : selectedTech?.extendedHolds || []).map((hold: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-3 border rounded-md p-2">
                            <div className="flex-1 grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Begin Date</Label>
                                {editMode ? (
                                  <Input type="date" className="h-8 text-xs" value={hold.beginDate || ""}
                                    onChange={e => {
                                      setEditData(p => ({
                                        ...p,
                                        extendedHolds: (p.extendedHolds || []).map((h: any, i: number) =>
                                          i === idx ? { ...h, beginDate: e.target.value } : h
                                        ),
                                      }));
                                    }}
                                  />
                                ) : (
                                  <p className="text-sm">{hold.beginDate || "—"}</p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">End Date</Label>
                                {editMode ? (
                                  <Input type="date" className="h-8 text-xs" value={hold.endDate || ""}
                                    onChange={e => {
                                      setEditData(p => ({
                                        ...p,
                                        extendedHolds: (p.extendedHolds || []).map((h: any, i: number) =>
                                          i === idx ? { ...h, endDate: e.target.value } : h
                                        ),
                                      }));
                                    }}
                                  />
                                ) : (
                                  <p className="text-sm">{hold.endDate || "—"}</p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Reason</Label>
                                {editMode ? (
                                  <Input className="h-8 text-xs" value={hold.holdReason || ""}
                                    onChange={e => {
                                      setEditData(p => ({
                                        ...p,
                                        extendedHolds: (p.extendedHolds || []).map((h: any, i: number) =>
                                          i === idx ? { ...h, holdReason: e.target.value } : h
                                        ),
                                      }));
                                    }}
                                  />
                                ) : (
                                  <p className="text-sm">{hold.holdReason || "—"}</p>
                                )}
                              </div>
                            </div>
                            {editMode && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeExtendedHold(idx)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3">De Minimis Rules</h3>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={(editMode ? editData.deMinimis : selectedTech?.deMinimis) || false}
                        onCheckedChange={(checked) => {
                          if (editMode) setEditData(p => ({ ...p, deMinimis: !!checked }));
                        }}
                        disabled={!editMode}
                      />
                      <Label className="text-sm">De Minimis Enabled</Label>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Tech Replenishment</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Primary Source</Label>
                        <p className="text-sm">{selectedTech?.techReplenishment?.primarySrc || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Provider</Label>
                        <p className="text-sm">{selectedTech?.techReplenishment?.providerName || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Store Location</Label>
                        <p className="text-sm">{selectedTech?.techReplenishment?.storeLocation || "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Override Primary Source</Label>
                        <p className="text-sm">{selectedTech?.techReplenishment?.overridePrimarySrc ? "Yes" : "No"}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="mt-4 overflow-auto max-h-[calc(90vh-180px)]">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* TPMS API Current State Baseline */}
                  {currentTpmsState && (
                    <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 text-xs">
                          TPMS API Baseline ({tpmsStateSource})
                        </Badge>
                        {pendingCdcCount > 0 && (
                          <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {pendingCdcCount} pending confirmation{pendingCdcCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {[
                          ['Name', `${currentTpmsState.firstName || ''} ${currentTpmsState.lastName || ''}`.trim()],
                          ['Tech ID', currentTpmsState.techId],
                          ['Enterprise ID', currentTpmsState.ldapId],
                          ['Truck No', currentTpmsState.truckNo],
                          ['District', currentTpmsState.districtNo],
                          ['Phone', currentTpmsState.contactNo],
                          ['Email', currentTpmsState.email],
                        ].map(([label, value]) => value ? (
                          <div key={label} className="flex gap-2">
                            <span className="text-muted-foreground shrink-0">{label}:</span>
                            <span className="font-medium truncate">{value}</span>
                          </div>
                        ) : null)}
                      </div>
                    </div>
                  )}

                  {/* TPMS API History entries (from getTechsUpdatedAfter) */}
                  {tpmsApiHistory.length > 0 && (
                    <div className="border rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        TPMS API History ({tpmsApiHistory.length})
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Field</TableHead>
                            <TableHead>Before</TableHead>
                            <TableHead>After</TableHead>
                            <TableHead>Changed By</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tpmsApiHistory.map((entry, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs whitespace-nowrap">
                                {new Date(entry.entryDate).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{entry.fieldChanged}</TableCell>
                              <TableCell className="text-sm max-w-32 truncate">{entry.valueBefore || "—"}</TableCell>
                              <TableCell className="text-sm max-w-32 truncate">{entry.valueAfter || "—"}</TableCell>
                              <TableCell className="text-sm">{entry.changedBy || "TPMS"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* CDC Log */}
                  {changeHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No local change history recorded for this technician.</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>User</TableHead>
                            <TableHead>Field</TableHead>
                            <TableHead>Before</TableHead>
                            <TableHead>After</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {changeHistory.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell className="text-xs whitespace-nowrap">
                                {new Date(entry.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-sm">{entry.username || entry.userId}</TableCell>
                              <TableCell className="font-mono text-xs">{entry.fieldChanged}</TableCell>
                              <TableCell className="text-sm max-w-32 truncate">{entry.valueBefore || "—"}</TableCell>
                              <TableCell className="text-sm max-w-32 truncate">{entry.valueAfter || "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{entry.source}</Badge>
                              </TableCell>
                              <TableCell>
                                {entry.confirmedByTpms ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmed
                                  </Badge>
                                ) : entry.confirmedAt ? (
                                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">
                                    <Clock className="h-3 w-3 mr-1" /> Reviewed
                                  </Badge>
                                ) : (
                                  <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                                    <AlertCircle className="h-3 w-3 mr-1" /> Pending
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
