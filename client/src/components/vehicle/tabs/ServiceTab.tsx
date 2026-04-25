import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Wrench, MapPin, Phone, User, Calendar, FileText,
  PhoneCall, PhoneForwarded, Loader2, Lightbulb, Car, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  InfoRow,
  EditableInfoRow,
  type TruckPanelData,
} from "@/components/vehicle/_helpers";

interface ScraperEntry {
  status: string;
  lastScraped: string;
  location: string;
  primaryIssue: string;
  priority: string;
  repairVendorPhone: string;
  repairVendorAddress: string;
  recommendation: string;
}

interface SuggestedVehicle {
  vehicleNumber: string;
  truckStatus: string | null;
  interior: string | null;
  distanceMiles: number | null;
  locationSource: string | null;
  locationAddress: string | null;
  hasCheckEngine: boolean;
}

interface SuggestedReplacementsData {
  matchFound: boolean;
  techName: string | null;
  jobTitle: string | null;
  suggestions: SuggestedVehicle[];
}

function SuggestedReplacements({ truckNumber }: { truckNumber: string | number | null | undefined }) {
  const vn = truckNumber ? String(truckNumber).replace(/^0+/, "") || String(truckNumber) : null;
  const { data, isLoading } = useQuery<SuggestedReplacementsData>({
    queryKey: ["/api/fs/rental/suggested-replacements", vn],
    enabled: !!vn,
  });

  if (!vn) return null;

  const techLine =
    data?.techName || data?.jobTitle ? (
      <p className="text-xs text-muted-foreground mb-2">
        {data.techName && (
          <>
            <span className="font-medium text-foreground">{data.techName}</span>
            {data.jobTitle ? " · " : ""}
          </>
        )}
        {data.jobTitle && <span className="italic">{data.jobTitle}</span>}
      </p>
    ) : null;

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <Car className="w-4 h-4 text-muted-foreground" />
        Suggested Replacements
      </h3>
      <div className="rounded-md border p-3">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data?.matchFound ? (
          <p className="text-xs text-muted-foreground italic">No tech match found</p>
        ) : data.suggestions.length === 0 ? (
          <div className="space-y-1">
            {techLine}
            <p className="text-xs text-muted-foreground italic">
              No unassigned vehicles available for this skill set
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {techLine}
            {data.suggestions.map((v) => (
              <div
                key={v.vehicleNumber}
                className="flex items-center gap-x-2 rounded-sm bg-muted/50 px-2 py-1.5"
              >
                <button
                  type="button"
                  className="font-mono text-sm font-semibold w-14 shrink-0 text-left hover:underline cursor-pointer"
                  onClick={() => window.open(`/fleet-management?openTruck=${v.vehicleNumber}`, "_blank")}
                >
                  {v.vehicleNumber}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{v.interior || "N/A"}</p>
                  {v.distanceMiles !== null && (
                    <p className="text-xs text-muted-foreground/70 truncate">
                      {v.distanceMiles} mi{v.locationSource ? ` · ${v.locationSource}` : ""}
                    </p>
                  )}
                  {v.locationAddress && (
                    <p className="text-xs text-muted-foreground/70 truncate">{v.locationAddress}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <Badge variant="outline" className="text-xs py-0 px-1.5 h-5">
                    {v.truckStatus || "Unknown"}
                  </Badge>
                  {v.hasCheckEngine && (
                    <Badge className="bg-orange-600 text-white text-xs py-0 px-1.5 h-5 flex items-center gap-0.5 border-none">
                      <Wrench className="h-2.5 w-2.5" />
                      Check Engine
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function ServiceTab({ truck }: { truck: TruckPanelData }) {
  const { toast } = useToast();
  const [refreshingShopCall, setRefreshingShopCall] = useState(false);
  const [refreshingTechCall, setRefreshingTechCall] = useState(false);

  const { data: scraperStatusMap } = useQuery<Record<string, ScraperEntry>>({
    queryKey: ["/api/fs/trucks/scraper-status"],
    queryFn: async () => {
      try {
        const directRes = await fetch(
          "https://web-scraper-tool-seanchen37.replit.app/api/public/vehicles",
          { signal: AbortSignal.timeout(15000) },
        );
        if (directRes.ok) {
          const result = await directRes.json();
          const vehicles = result.vehicles || [];
          const vehicleMap: Record<string, ScraperEntry> = {};
          for (const v of vehicles) {
            const num = (v.vehicle_number || "").toString().padStart(6, "0");
            vehicleMap[num] = {
              status: v.status || "",
              lastScraped: v.last_scraped || "",
              location: v.location || "",
              primaryIssue: v.primary_issue || "",
              priority: v.priority || "",
              repairVendorPhone: v.repair_vendor?.phone || "",
              repairVendorAddress: v.repair_vendor?.address || "",
              recommendation: v.recommendation || "",
            };
          }
          return vehicleMap;
        }
      } catch {
        console.log("[Scraper] Direct fetch failed, falling back to server proxy");
      }
      const res = await fetch("/api/fs/trucks/scraper-status");
      if (!res.ok) throw new Error("Failed to fetch scraper status");
      return res.json();
    },
  });

  const truckNum = (truck.truckNumber || "").toString().padStart(6, "0");
  const scraperInfo = scraperStatusMap?.[truckNum];
  const fullAddress = scraperInfo?.repairVendorAddress || "";

  const handleRefreshShopCall = async () => {
    setRefreshingShopCall(true);
    try {
      const res = await apiRequest("POST", "/api/fs/elevenlabs/backfill", {
        truckNumber: truck.truckNumber,
        callType: "repair",
        ...(truck.lastCallConversationId ? { conversationId: truck.lastCallConversationId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Refresh failed");
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truck.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      toast({ title: "Shop call refreshed", description: `Status: ${data.status}` });
    } catch (err: any) {
      toast({
        title: "Could not refresh shop call",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRefreshingShopCall(false);
    }
  };

  const handleRefreshTechCall = async () => {
    setRefreshingTechCall(true);
    try {
      const res = await apiRequest("POST", "/api/fs/elevenlabs/backfill", {
        truckNumber: truck.truckNumber,
        callType: "tech",
        ...(truck.lastTechCallConversationId
          ? { conversationId: truck.lastTechCallConversationId }
          : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Refresh failed");
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truck.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      toast({ title: "Tech call refreshed", description: `Status: ${data.status}` });
    } catch (err: any) {
      toast({
        title: "Could not refresh tech call",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRefreshingTechCall(false);
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          Repair Information
        </h3>
        <div className="rounded-md border p-3 space-y-0.5">
          <div className="grid grid-cols-2 gap-x-4">
            <EditableInfoRow
              label="Repair Shop"
              value={truck.repairAddress}
              icon={<MapPin className="w-3.5 h-3.5" />}
              fieldName="repairAddress"
              truckId={truck.id}
              placeholder="Enter repair shop name or address..."
              testIdPrefix="panel-repair-shop"
            />
            <EditableInfoRow
              label="Phone"
              value={truck.repairPhone}
              icon={<Phone className="w-3.5 h-3.5" />}
              fieldName="repairPhone"
              truckId={truck.id}
              placeholder="Enter phone number..."
              testIdPrefix="panel-repair-phone"
            />
          </div>
          {fullAddress && (
            <InfoRow
              label="Vendor Address"
              value={fullAddress}
              icon={<MapPin className="w-3.5 h-3.5" />}
              testId="panel-vendor-address"
            />
          )}
          <EditableInfoRow
            label="Contact"
            value={truck.contactName}
            icon={<User className="w-3.5 h-3.5" />}
            fieldName="contactName"
            truckId={truck.id}
            placeholder="Enter contact name..."
            testIdPrefix="panel-contact-name"
          />
          <InfoRow
            label="Date In Repair"
            value={truck.datePutInRepair}
            icon={<Calendar className="w-3.5 h-3.5" />}
          />
          <InfoRow
            label="Decision"
            value={truck.repairOrSaleDecision}
            icon={<FileText className="w-3.5 h-3.5" />}
          />
          {truck.confirmedDeclinedRepair && (
            <InfoRow
              label="Declined Repair Notes"
              value={truck.confirmedDeclinedRepair}
              icon={<FileText className="w-3.5 h-3.5" />}
            />
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <PhoneCall className="w-4 h-4 text-muted-foreground" />
          Latest Shop Call
          <button
            onClick={handleRefreshShopCall}
            disabled={refreshingShopCall}
            className="ml-auto text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            title="Refresh shop call status"
            data-testid="button-refresh-shop-call"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingShopCall ? "animate-spin" : ""}`} />
          </button>
        </h3>
        <div className="rounded-md border p-3 space-y-1.5">
          {truck.lastCallDate ? (
            <>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {format(new Date(truck.lastCallDate), "MMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
              {truck.lastCallSummary ? (
                <p className="text-sm leading-relaxed" data-testid="panel-call-summary">
                  {truck.lastCallSummary}
                </p>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="text-sm italic">Analyzing call...</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic" data-testid="panel-call-none">
              No calls recorded yet
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <PhoneForwarded className="w-4 h-4 text-muted-foreground" />
          Latest Tech Call
          <button
            onClick={handleRefreshTechCall}
            disabled={refreshingTechCall}
            className="ml-auto text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            title="Refresh tech call status"
            data-testid="button-refresh-tech-call"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingTechCall ? "animate-spin" : ""}`} />
          </button>
        </h3>
        <div className="rounded-md border p-3 space-y-1.5">
          {truck.lastTechCallDate ? (
            <>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {format(new Date(truck.lastTechCallDate), "MMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
              {truck.lastTechCallSummary ? (
                <p className="text-sm leading-relaxed" data-testid="panel-tech-call-summary">
                  {truck.lastTechCallSummary}
                </p>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="text-sm italic">Analyzing call...</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic" data-testid="panel-tech-call-none">
              No tech calls recorded yet
            </p>
          )}
        </div>
      </section>

      {scraperInfo?.recommendation && (
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            AI Recommendation
          </h3>
          <div className="rounded-md border p-3">
            <p className="text-sm text-muted-foreground leading-relaxed" data-testid="panel-ai-recommendation">
              {scraperInfo.recommendation}
            </p>
          </div>
        </section>
      )}

      <SuggestedReplacements truckNumber={truck.truckNumber} />
    </div>
  );
}
