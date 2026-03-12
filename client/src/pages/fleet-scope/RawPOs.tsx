import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronUp, FileText, AlertTriangle, Lightbulb } from "lucide-react";

type POData = {
  amount: number;
  po_date: string;
  po_number: string;
  status: string;
  vendor: string;
  vendor_address: string;
  vendor_phone: string;
  vendor_type?: string;
  event_id?: string;
  odometer?: string;
  line_items?: Array<{
    quantity: string;
    description: string;
    type: string;
    ata_code: string;
    correction: string;
    cause: string;
    cost: number;
    status: string;
  }>;
  notes?: Array<{
    note_date: string;
    note_text: string;
  }>;
  event_messages?: Array<{
    event_id: string;
    message: string;
  }>;
};

type EventMessage = {
  event_id: string;
  message_date: string;
  raw_header?: string;
  notes?: Array<{
    note_date: string;
    note_text: string;
  }>;
};

type ScraperVehicleData = {
  vehicle_number: string;
  status: string;
  location: string;
  primary_issue: string;
  priority: string;
  recommendation: string;
  reasoning: string;
  red_flags: string[];
  days_down: number;
  last_scraped: string;
  assessed_at: string;
  has_active_rental: boolean;
  has_open_repair_po: boolean;
  repair_pos: POData[];
  rental_pos: POData[];
  repair_vendor: { name: string; phone: string; address: string } | null;
  rental_vendor: { name: string; phone: string; address: string } | null;
  event_messages?: EventMessage[];
};

function EventMessageCard({ em, defaultExpanded = false }: { em: EventMessage; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasNotes = em.notes && em.notes.length > 0;

  return (
    <div className="border rounded-md" data-testid={`event-message-${em.event_id}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover-elevate"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-event-${em.event_id}`}
      >
        <span className="text-sm font-medium">Event ID: {em.event_id}</span>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <span className="text-sm text-muted-foreground">Message: {em.message_date}</span>
          {hasNotes && (expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
        </div>
      </button>
      {expanded && hasNotes && (
        <div className="border-t px-4 py-3">
          <div className="border rounded-md overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase w-[160px]">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Notes</th>
                </tr>
              </thead>
              <tbody>
                {em.notes!.map((note, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{note.note_date}</td>
                    <td className="px-3 py-2">{note.note_text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function POCard({ po, defaultExpanded = false }: { po: POData; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const vendorType = po.vendor_type || "";
  const amount = Number(po.amount) || 0;
  const summaryLine = [
    po.vendor,
    vendorType ? `Vendor Type: ${vendorType}` : null,
    `Amount: $${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    po.status?.toUpperCase() === "CLOSED" ? "PAID" : "",
    po.po_date,
    po.status,
  ].filter(Boolean).join(" ");

  return (
    <div className="border rounded-md" data-testid={`po-card-${po.po_number}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover-elevate rounded-md"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-po-${po.po_number}`}
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">PO #{po.po_number}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{summaryLine}</div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <span className="text-base font-semibold text-orange-500">
            ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Event ID</div>
              <div className="text-sm mt-0.5">{po.event_id || "N/A"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Odometer</div>
              <div className="text-sm mt-0.5">{po.odometer || "N/A"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendor</div>
              <div className="text-sm mt-0.5">{po.vendor || "N/A"}</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendor Phone</div>
            <div className="text-sm mt-0.5">{po.vendor_phone || "N/A"}</div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendor Address</div>
            <div className="text-sm mt-0.5">{po.vendor_address || "N/A"}</div>
          </div>

          {po.line_items && po.line_items.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Line Items</h4>
              <div className="border rounded-md overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">ATA Code</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Correction</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Cause</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Cost</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.line_items.map((item, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{item.quantity}</td>
                        <td className="px-3 py-2">{item.description}</td>
                        <td className="px-3 py-2">{item.type}</td>
                        <td className="px-3 py-2">{item.ata_code}</td>
                        <td className="px-3 py-2">{item.correction}</td>
                        <td className="px-3 py-2">{item.cause}</td>
                        <td className="px-3 py-2 text-right">${(Number(item.cost) || 0).toFixed(2)}</td>
                        <td className="px-3 py-2">{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {po.notes && po.notes.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Notes</h4>
              <div className="border rounded-md overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase w-[100px]">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.notes.map((note, i) => (
                      <tr key={i} className="border-t align-top">
                        <td className="px-3 py-2 whitespace-nowrap">{note.note_date}</td>
                        <td className="px-3 py-2">{note.note_text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RawPOs() {
  const params = useParams<{ truckNumber: string }>();
  const truckNumber = params.truckNumber || "";

  const { data, isLoading, error } = useQuery<ScraperVehicleData>({
    queryKey: ["/api/fs/trucks/scraper-detail", truckNumber],
    queryFn: async () => {
      const res = await fetch(`/api/trucks/scraper-detail/${truckNumber}`);
      if (!res.ok) throw new Error("Vehicle not found in scraper");
      return res.json();
    },
    enabled: !!truckNumber,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <FileText className="h-10 w-10" />
        <p className="text-lg font-medium">No scraper data found for vehicle {truckNumber}</p>
        <p className="text-sm">This vehicle may not have been scraped yet.</p>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    IN_REPAIR: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    REPAIR_COMPLETE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    IN_AUTHORIZATION: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    DECLINED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    DISPUTED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    ABANDONED: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
  };

  const priorityColor: Record<string, string> = {
    HIGH: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };

  const allPOs = [
    ...(data.repair_pos || []).map(p => ({ ...p, category: "Repair" as const })),
    ...(data.rental_pos || []).map(p => ({ ...p, category: "Rental" as const })),
  ];

  const totalRepairAmount = (data.repair_pos || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalRentalAmount = (data.rental_pos || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const topLevelEventMessages = data.event_messages || [];

  return (
    <div className="flex flex-col h-full overflow-auto p-4 sm:p-6 gap-5 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-raw-pos-title">
            Raw POs — Vehicle {truckNumber}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge className={`${statusColor[data.status] || "bg-muted text-muted-foreground"} border-0`} data-testid="badge-vehicle-status">
              {data.status?.replace(/_/g, " ") || "Unknown"}
            </Badge>
            {data.priority && (
              <Badge className={`${priorityColor[data.priority] || "bg-muted text-muted-foreground"} border-0`} data-testid="badge-priority">
                {data.priority}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {data.days_down} days down
            </span>
            {data.last_scraped && (
              <span className="text-xs text-muted-foreground">
                Last scraped: {new Date(data.last_scraped).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {data.primary_issue && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Primary Issue</div>
            <div className="text-sm">{data.primary_issue}</div>
          </CardContent>
        </Card>
      )}

      {data.recommendation && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">AI Recommendation</span>
            </div>
            <div className="text-sm" data-testid="text-recommendation">{data.recommendation}</div>
          </CardContent>
        </Card>
      )}

      {data.red_flags && data.red_flags.length > 0 && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Red Flags ({data.red_flags.length})</span>
            </div>
            <ul className="space-y-1">
              {data.red_flags.map((flag, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-red-500 mt-0.5 shrink-0">•</span>
                  <span>{flag}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm text-muted-foreground">
          Repair POs: <span className="font-medium text-foreground">{data.repair_pos?.length || 0}</span>
          {totalRepairAmount > 0 && (
            <span className="ml-1 text-orange-500 font-semibold">
              (${totalRepairAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          Rental POs: <span className="font-medium text-foreground">{data.rental_pos?.length || 0}</span>
          {totalRentalAmount > 0 && (
            <span className="ml-1 text-orange-500 font-semibold">
              (${totalRentalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </span>
          )}
        </span>
      </div>

      {(data.repair_pos?.length || 0) > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2" data-testid="text-repair-pos-heading">Repair Purchase Orders</h2>
          <div className="space-y-2">
            {data.repair_pos.map((po, i) => (
              <POCard key={po.po_number || i} po={po} defaultExpanded={i === 0} />
            ))}
          </div>
        </div>
      )}

      {(data.rental_pos?.length || 0) > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2" data-testid="text-rental-pos-heading">Rental Purchase Orders</h2>
          <div className="space-y-2">
            {data.rental_pos.map((po, i) => (
              <POCard key={po.po_number || i} po={po} />
            ))}
          </div>
        </div>
      )}

      {topLevelEventMessages.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2" data-testid="text-event-messages-heading">Event Messages ({topLevelEventMessages.length})</h2>
          <div className="space-y-2">
            {topLevelEventMessages.map((em, i) => (
              <EventMessageCard key={`${em.event_id}-${i}`} em={em} defaultExpanded={i === 0} />
            ))}
          </div>
        </div>
      )}

      {data.reasoning && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">AI Reasoning</div>
            <div className="text-sm text-muted-foreground leading-relaxed" data-testid="text-reasoning">{data.reasoning}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
