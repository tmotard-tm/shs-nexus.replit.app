import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { AlertCircle, ChevronDown, ChevronRight, Send, Clock, CheckCircle2, XCircle } from "lucide-react";

// ─── Endpoint collection ──────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface BodyField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: "text" | "boolean";
}

interface Endpoint {
  id: string;
  group: "Debug" | "Trucks" | "Assignments";
  method: HttpMethod;
  name: string;
  description: string;
  path: string;
  pathParams: string[];
  bodyFields: BodyField[];
}

const ENDPOINTS: Endpoint[] = [
  {
    id: "debug-auth",
    group: "Debug",
    method: "GET",
    name: "Test Auth & Token",
    description: "Forces a fresh token fetch from the auth endpoint and returns diagnostic info: token URL, HTTP status, raw response excerpt, whether the token was extracted, its length, and when the cache expires. No secrets are exposed.",
    path: "/api/wms/debug/auth",
    pathParams: [],
    bodyFields: [],
  },
  {
    id: "list-trucks",
    group: "Trucks",
    method: "GET",
    name: "List All Trucks",
    description: "Returns all truck locations registered under the Nexus use-case in NetSuite.",
    path: "/api/wms/trucks",
    pathParams: [],
    bodyFields: [],
  },
  {
    id: "create-truck",
    group: "Trucks",
    method: "POST",
    name: "Create Truck Location",
    description: "Creates a new truck location in NetSuite. Returns a NetSuite ID on success.",
    path: "/api/wms/trucks",
    pathParams: [],
    bodyFields: [
      { key: "name", label: "Name", placeholder: "Truck 1234", required: true, type: "text" },
      { key: "description", label: "Description", placeholder: "Zone A delivery truck", type: "text" },
      { key: "subsidiary", label: "Subsidiary", placeholder: "1093", type: "text" },
      { key: "parentLocation", label: "Parent Location", placeholder: "Main Warehouse", type: "text" },
      { key: "isActive", label: "Active", placeholder: "", type: "boolean" },
    ],
  },
  {
    id: "get-truck",
    group: "Trucks",
    method: "GET",
    name: "Get Truck by ID",
    description: "Fetches a single truck location record by its internal truck ID.",
    path: "/api/wms/trucks/:truckId",
    pathParams: ["truckId"],
    bodyFields: [],
  },
  {
    id: "update-truck",
    group: "Trucks",
    method: "POST",
    name: "Update Truck Location",
    description: "Updates an existing truck location record in NetSuite.",
    path: "/api/wms/trucks/:truckId",
    pathParams: ["truckId"],
    bodyFields: [
      { key: "name", label: "Name", placeholder: "Truck 1234", required: true, type: "text" },
      { key: "locationId", label: "Location ID", placeholder: "TRUCK-1234", required: true, type: "text" },
      { key: "description", label: "Description", placeholder: "Zone A delivery truck", type: "text" },
      { key: "subsidiary", label: "Subsidiary", placeholder: "1093", type: "text" },
      { key: "parentLocation", label: "Parent Location", placeholder: "Main Warehouse", type: "text" },
      { key: "isActive", label: "Active", placeholder: "", type: "boolean" },
    ],
  },
  {
    id: "delete-truck",
    group: "Trucks",
    method: "DELETE",
    name: "Delete Truck Location",
    description: "Disables the truck location in NetSuite. This cannot be undone from Nexus.",
    path: "/api/wms/trucks/:truckId",
    pathParams: ["truckId"],
    bodyFields: [],
  },
  {
    id: "create-assignment",
    group: "Assignments",
    method: "POST",
    name: "Create Assignment",
    description: "Assigns a technician to a truck location in NetSuite.",
    path: "/api/wms/assignments",
    pathParams: [],
    bodyFields: [
      { key: "techId", label: "Tech ID", placeholder: "11024631241", required: true, type: "text" },
      { key: "truckId", label: "Truck ID", placeholder: "TRUCK-1234", required: true, type: "text" },
    ],
  },
  {
    id: "get-assignment",
    group: "Assignments",
    method: "GET",
    name: "Get Assignment",
    description: "Looks up the current truck assignment for a technician by their enterprise ID.",
    path: "/api/wms/assignments/:techId",
    pathParams: ["techId"],
    bodyFields: [],
  },
  {
    id: "update-assignment",
    group: "Assignments",
    method: "PUT",
    name: "Update Assignment",
    description: "Updates the truck assignment for an existing tech record.",
    path: "/api/wms/assignments/:techId",
    pathParams: ["techId"],
    bodyFields: [
      { key: "techId", label: "Tech ID", placeholder: "11024631241", required: true, type: "text" },
      { key: "truckId", label: "Truck ID", placeholder: "TRUCK-1234", required: true, type: "text" },
    ],
  },
  {
    id: "delete-assignment",
    group: "Assignments",
    method: "DELETE",
    name: "Delete Assignment",
    description: "Removes the tech-to-truck assignment from NetSuite.",
    path: "/api/wms/assignments/:techId",
    pathParams: ["techId"],
    bodyFields: [],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  POST:   "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  PUT:    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const METHOD_BORDER: Record<HttpMethod, string> = {
  GET:    "border-l-emerald-500",
  POST:   "border-l-blue-500",
  PUT:    "border-l-amber-500",
  DELETE: "border-l-red-500",
};

function MethodBadge({ method, sm }: { method: HttpMethod; sm?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono font-semibold rounded",
        METHOD_COLORS[method],
        sm ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
      )}
    >
      {method}
    </span>
  );
}

function resolvedPath(path: string, params: Record<string, string>) {
  return path.replace(/:([a-zA-Z]+)/g, (_, key) => params[key] || `:${key}`);
}

function statusColor(status: number | null) {
  if (status === null) return "text-muted-foreground";
  if (status < 300) return "text-emerald-600 dark:text-emerald-400";
  if (status < 500) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function formatJson(obj: unknown) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

// ─── Config-check banner ──────────────────────────────────────────────────────

function ConfigBanner() {
  const [checked, setChecked] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useState(() => {
    fetch("/api/wms/trucks", { credentials: "include" })
      .then((r) => {
        setConfigured(r.status !== 503);
        setChecked(true);
      })
      .catch(() => {
        setConfigured(false);
        setChecked(true);
      });
  });

  if (!checked || configured !== false) return null;

  return (
    <Alert className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-700 dark:text-amber-400">
        <strong>WMS Engine not configured.</strong> Set{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">WMS_ENGINE_BASE_URL</code>,{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">WMS_ENGINE_AUTH_ENDPOINT</code>, and{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">WMS_ENGINE_AUTHORIZATION</code> to enable this integration.
      </AlertDescription>
    </Alert>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WmsEnginePage() {
  const groups = ["Debug", "Trucks", "Assignments"] as const;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Debug: true, Trucks: true, Assignments: true });
  const [selected, setSelected] = useState<Endpoint>(ENDPOINTS[0]);

  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [bodyValues, setBodyValues] = useState<Record<string, string | boolean>>({});

  const [response, setResponse] = useState<unknown>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function selectEndpoint(ep: Endpoint) {
    setSelected(ep);
    setPathParams({});
    setBodyValues(
      Object.fromEntries(
        ep.bodyFields.map((f) => [f.key, f.type === "boolean" ? true : ""])
      )
    );
    setResponse(null);
    setResponseStatus(null);
    setResponseMs(null);
    setSendError(null);
  }

  function toggleGroup(g: string) {
    setOpenGroups((prev) => ({ ...prev, [g]: !prev[g] }));
  }

  async function sendRequest() {
    setSendError(null);
    setResponse(null);
    setResponseStatus(null);
    setResponseMs(null);
    setIsSending(true);

    const url = resolvedPath(selected.path, pathParams);
    const hasBody = selected.bodyFields.length > 0;
    const body = hasBody ? JSON.stringify(bodyValues) : undefined;

    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method: selected.method,
        credentials: "include",
        headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const ms = Math.round(performance.now() - t0);
      setResponseMs(ms);
      setResponseStatus(res.status);

      const text = await res.text();
      try {
        setResponse(JSON.parse(text));
      } catch {
        setResponse(text);
      }
    } catch (err: any) {
      const ms = Math.round(performance.now() - t0);
      setResponseMs(ms);
      setSendError(err?.message || "Network error");
    } finally {
      setIsSending(false);
    }
  }

  const displayPath = resolvedPath(selected.path, pathParams);

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-120px)]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">WMS Engine</h1>
        <p className="text-sm text-muted-foreground">
          NetSuite truck location and tech assignment API — <code className="text-xs">useCaseId: Nexus</code>
        </p>
      </div>

      <ConfigBanner />

      <div className="flex flex-1 gap-0 border rounded-lg overflow-hidden min-h-0">

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 border-r bg-muted/30 flex flex-col">
          <div className="px-3 py-2.5 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Collection</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-2">
              {groups.map((group) => (
                <div key={group}>
                  <button
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => toggleGroup(group)}
                  >
                    {openGroups[group]
                      ? <ChevronDown className="h-3 w-3" />
                      : <ChevronRight className="h-3 w-3" />}
                    {group.toUpperCase()}
                  </button>

                  {openGroups[group] && (
                    <div className="mb-1">
                      {ENDPOINTS.filter((ep) => ep.group === group).map((ep) => (
                        <button
                          key={ep.id}
                          onClick={() => selectEndpoint(ep)}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-l-2 transition-colors",
                            selected.id === ep.id
                              ? cn("border-l-2 bg-accent text-accent-foreground font-medium", METHOD_BORDER[ep.method])
                              : "border-l-transparent hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <MethodBadge method={ep.method} sm />
                          <span className="truncate">{ep.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* ── Main workspace ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Request bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
            <MethodBadge method={selected.method} />
            <code className="flex-1 text-sm font-mono text-muted-foreground truncate">{displayPath}</code>
            <Button size="sm" onClick={sendRequest} disabled={isSending} className="shrink-0">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {isSending ? "Sending…" : "Send"}
            </Button>
          </div>

          <div className="flex flex-1 min-h-0">

            {/* ── Left: inputs ─────────────────────────────────────── */}
            <div className="w-80 shrink-0 border-r flex flex-col min-h-0">
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-5">

                  {/* Description */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm text-muted-foreground leading-snug">{selected.description}</p>
                  </div>

                  {/* Path params */}
                  {selected.pathParams.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Path Parameters</p>
                      <div className="space-y-2">
                        {selected.pathParams.map((param) => (
                          <div key={param}>
                            <Label className="text-xs mb-1 block">
                              {param} <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              className="h-8 text-sm font-mono"
                              placeholder={`:${param}`}
                              value={pathParams[param] || ""}
                              onChange={(e) =>
                                setPathParams((p) => ({ ...p, [param]: e.target.value }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Body */}
                  {selected.bodyFields.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Request Body
                      </p>
                      <div className="space-y-2">
                        {/* useCaseId read-only */}
                        <div>
                          <Label className="text-xs mb-1 block text-muted-foreground">useCaseId</Label>
                          <div className="h-8 px-3 flex items-center text-sm font-mono rounded-md border bg-muted/50 text-muted-foreground">
                            Nexus
                          </div>
                        </div>
                        <Separator className="my-1" />
                        {selected.bodyFields.map((field) =>
                          field.type === "boolean" ? (
                            <div key={field.key} className="flex items-center justify-between rounded-md border px-3 h-9">
                              <Label className="text-xs">{field.label}</Label>
                              <Switch
                                checked={bodyValues[field.key] === true}
                                onCheckedChange={(v) =>
                                  setBodyValues((b) => ({ ...b, [field.key]: v }))
                                }
                              />
                            </div>
                          ) : (
                            <div key={field.key}>
                              <Label className="text-xs mb-1 block">
                                {field.label}
                                {field.required && <span className="text-destructive ml-0.5">*</span>}
                              </Label>
                              <Input
                                className="h-8 text-sm"
                                placeholder={field.placeholder}
                                value={(bodyValues[field.key] as string) || ""}
                                onChange={(e) =>
                                  setBodyValues((b) => ({ ...b, [field.key]: e.target.value }))
                                }
                              />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {selected.pathParams.length === 0 && selected.bodyFields.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No parameters required for this request.</p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* ── Right: response ───────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {/* Response meta bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20 min-h-[36px]">
                {responseStatus !== null && (
                  <>
                    <span className={cn("flex items-center gap-1 text-xs font-semibold", statusColor(responseStatus))}>
                      {responseStatus < 300
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <XCircle className="h-3.5 w-3.5" />}
                      {responseStatus}
                    </span>
                    <Separator orientation="vertical" className="h-3.5" />
                  </>
                )}
                {responseMs !== null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {responseMs} ms
                  </span>
                )}
                {!responseStatus && !isSending && (
                  <span className="text-xs text-muted-foreground">Hit Send to see the response</span>
                )}
                {isSending && (
                  <span className="text-xs text-muted-foreground animate-pulse">Waiting for response…</span>
                )}
              </div>

              {/* Response body */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {sendError && (
                    <div className="flex items-start gap-2 text-destructive text-sm">
                      <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{sendError}</span>
                    </div>
                  )}
                  {response !== null && (
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                      {formatJson(response)}
                    </pre>
                  )}
                  {!sendError && response === null && !isSending && (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50 select-none">
                      <Send className="h-10 w-10 mb-3 opacity-30" />
                      <p className="text-sm">Response will appear here</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
