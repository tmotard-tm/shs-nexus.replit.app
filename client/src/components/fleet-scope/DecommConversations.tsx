import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  Phone,
  Truck,
  Clock,
  X,
  User,
  Users,
  MapPin,
  Download,
  Image,
  Upload,
  FileSpreadsheet,
  Paperclip,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { readExcelFile } from "@/lib/xlsx-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DecommMessage {
  id: string;
  truckNumber: string;
  contactType: string;
  contactName: string | null;
  contactPhone: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  twilioSid: string | null;
  sentAt: string | null;
  readAt: string | null;
  sentBy: string | null;
  senderName: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  ccForLdap: string | null;
}

interface DecommConversation {
  truckNumber: string;
  contactPhone: string;
  contactType: string;
  contactName: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface DecommVehicleInfo {
  id: number;
  truckNumber: string;
  vin: string | null;
  address: string | null;
  zipCode: string | null;
  fullName: string | null;
  mobilePhone: string | null;
  managerName: string | null;
  managerPhone: string | null;
  nearestTechName: string | null;
  nearestTechPhone: string | null;
  techMatchSource: string | null;
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

const CONTACT_TYPE_LABELS: Record<string, string> = {
  tech: "Tech",
  manager: "Manager",
  nearest_tech: "Nearest Tech",
  adhoc: "Direct",
};

const CONTACT_TYPE_COLORS: Record<string, string> = {
  tech: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  nearest_tech: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  adhoc: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
};

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

interface DecommConversationsProps {
  vehicleData: DecommVehicleInfo[];
  initialTruckNumber?: string;
}

// Task #228: Batch Text always sends to BOTH the tech and the manager. The
// recipient row therefore carries two independent send targets, each with
// its own status, name, phone, source, and per-row checkbox.
type BatchTechStatus = 'ready' | 'no_phone';
type BatchManagerStatus =
  | 'ready'
  | 'no_phone'
  | 'no_manager_ent_id'
  | 'self_managed'
  | 'same_as_tech';

interface BatchTarget<S extends string> {
  name: string | null;
  phone: string | null;
  status: S;
  source: 'snapshot' | 'tpms_live' | null;
  enabled: boolean;
}

interface BatchRecipient {
  ldap: string;
  truckNumber: string;
  vin: string;
  address: string;
  zipCode: string;
  fullName: string;
  customVars: Record<string, string>;
  matchedVia?: 'tech' | 'manager' | 'nearest_tech' | 'truck' | null;
  isManager?: boolean;
  tech: BatchTarget<BatchTechStatus>;
  manager: BatchTarget<BatchManagerStatus> & { entId: string | null };
}

interface BatchUnresolved {
  ldap: string;
  reason: string;
}

type BatchSendOutcome =
  | 'sent'
  | 'failed'
  | 'duplicate'
  | 'no_phone'
  | 'same_as_tech'
  | 'self_managed'
  | 'no_manager_ent_id'
  | 'disabled';

interface BatchResult {
  truckNumber: string;
  ldap?: string;
  tech: { status: BatchSendOutcome; error?: string; phone?: string };
  manager: { status: BatchSendOutcome; error?: string; phone?: string };
}

interface BatchImportRow {
  ldap: string;
  customVars: Record<string, string>;
  truckNumber?: string;
}

export function DecommConversations({ vehicleData, initialTruckNumber }: DecommConversationsProps) {
  const { toast } = useToast();
  const [selectedTruck, setSelectedTruck] = useState<string | null>(initialTruckNumber ?? null);
  const [messageBody, setMessageBody] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvSearch, setNewConvSearch] = useState("");
  const [contactType, setContactType] = useState<string>("tech");
  const techEndRef = useRef<HTMLDivElement>(null);
  const managerEndRef = useRef<HTMLDivElement>(null);
  const techScrollRef = useRef<HTMLDivElement>(null);
  const managerScrollRef = useRef<HTMLDivElement>(null);
  const [techNewCount, setTechNewCount] = useState(0);
  const [mgrNewCount, setMgrNewCount] = useState(0);
  const prevTechMsgCount = useRef(0);
  const prevMgrMsgCount = useRef(0);
  const prevHasBothColumns = useRef(false);
  const perTruckCounts = useRef<Map<string, { tech: number; mgr: number }>>(
    (() => {
      try {
        const raw = sessionStorage.getItem("decomm_badge_counts");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const entries = Object.entries(parsed).filter(
              ([k, v]) =>
                typeof k === "string" &&
                v !== null &&
                typeof v === "object" &&
                typeof (v as any).tech === "number" &&
                typeof (v as any).mgr === "number"
            ) as [string, { tech: number; mgr: number }][];
            return new Map(entries);
          }
        }
      } catch {}
      return new Map();
    })()
  );
  const prevSelectedTruckRef = useRef<string | null>(null);
  const justSwitchedTruck = useRef(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchStep, setBatchStep] = useState<"import" | "compose" | "preview" | "results">("import");
  const [batchRecipients, setBatchRecipients] = useState<BatchRecipient[]>([]);
  const [batchUnresolved, setBatchUnresolved] = useState<BatchUnresolved[]>([]);
  const [batchTemplate, setBatchTemplate] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchResolving, setBatchResolving] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const batchTemplateRef = useRef<HTMLTextAreaElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);
  const [batchImportRows, setBatchImportRows] = useState<BatchImportRow[]>([]);
  const [batchDynamicHeaders, setBatchDynamicHeaders] = useState<string[]>([]);
  const [batchFileName, setBatchFileName] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  const [adhocContacts, setAdhocContacts] = useState<Record<string, { phone: string; name: string | null }>>({});
  const [adhocPhoneInput, setAdhocPhoneInput] = useState("");
  const [adhocNameInput, setAdhocNameInput] = useState("");

  const mediaFileRef = useRef<HTMLInputElement>(null);
  const [pendingMedia, setPendingMedia] = useState<{ dataUrl: string; mediaType: string; filename: string; size: number } | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const isAdhocTruck = (t: string | null | undefined) => !!t && t.startsWith("ADHOC-");

  useEffect(() => {
    if (initialTruckNumber) {
      setSelectedTruck(initialTruckNumber);
    }
  }, [initialTruckNumber]);

  const { data: conversations = [], refetch: refetchConversations } = useQuery<DecommConversation[]>({
    queryKey: ["/api/fs/decomm-conversations"],
    refetchInterval: 30000,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<DecommMessage[]>({
    queryKey: ["/api/fs/decomm-messages", selectedTruck],
    enabled: !!selectedTruck,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (truckNumber: string) =>
      apiRequest("PATCH", `/api/fs/decomm-messages/read/${truckNumber}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
    },
  });

  const selectedVehicle = selectedTruck && !isAdhocTruck(selectedTruck)
    ? vehicleData.find((v) => v.truckNumber === selectedTruck)
    : null;

  const adhocSelectedContact = (() => {
    if (!isAdhocTruck(selectedTruck)) return null;
    const stored = adhocContacts[selectedTruck!];
    if (stored) return { type: "adhoc", name: stored.name, phone: stored.phone };
    const fromConv = conversations.find((c) => c.truckNumber === selectedTruck);
    if (fromConv) return { type: "adhoc", name: fromConv.contactName, phone: fromConv.contactPhone };
    const digits = selectedTruck!.replace(/^ADHOC-/, "");
    return { type: "adhoc", name: null, phone: `+1${digits}` };
  })();

  const getContactOptions = useCallback((vehicle: DecommVehicleInfo | null | undefined) => {
    if (!vehicle) return [];
    const options: { type: string; name: string | null; phone: string | null }[] = [];
    if (vehicle.mobilePhone) {
      options.push({ type: "tech", name: vehicle.fullName, phone: vehicle.mobilePhone });
    }
    if (vehicle.managerPhone) {
      options.push({ type: "manager", name: vehicle.managerName, phone: vehicle.managerPhone });
    }
    if (vehicle.nearestTechPhone) {
      options.push({ type: "nearest_tech", name: vehicle.nearestTechName, phone: vehicle.nearestTechPhone });
    }
    return options;
  }, []);

  const contactOptions = adhocSelectedContact
    ? [adhocSelectedContact]
    : getContactOptions(selectedVehicle);
  const selectedContact = contactOptions.find(c => c.type === contactType) || contactOptions[0];

  useEffect(() => {
    if (contactOptions.length > 0 && !contactOptions.find(c => c.type === contactType)) {
      setContactType(contactOptions[0].type);
    }
  }, [contactOptions, contactType]);

  const retryMediaMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const resp = await apiRequest("POST", `/api/fs/decomm-messages/${messageId}/retry-media`, {});
      return resp.json();
    },
    onSuccess: () => {
      toast({ title: "Photo recovered", description: "Pulled the attachment from Twilio." });
      if (selectedTruck) {
        queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-messages", selectedTruck] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't recover photo", description: err?.message || "Twilio retry failed", variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      let mediaStorageKey: string | undefined;
      let mediaType: string | undefined;
      if (pendingMedia) {
        setUploadingMedia(true);
        try {
          const upResp = await apiRequest("POST", "/api/fs/decomm-messages/upload-media", {
            dataUrl: pendingMedia.dataUrl,
            filename: pendingMedia.filename,
          });
          const upData = await upResp.json();
          mediaStorageKey = upData.storageKey;
          mediaType = upData.mediaType;
        } finally {
          setUploadingMedia(false);
        }
      }
      return apiRequest("POST", "/api/fs/decomm-messages", {
        truckNumber: isAdhocTruck(selectedTruck) ? null : selectedTruck,
        contactType: selectedContact?.type || contactType,
        contactPhone: selectedContact?.phone,
        contactName: selectedContact?.name,
        body,
        triggerType: "manual",
        mediaStorageKey,
        mediaType,
      });
    },
    onSuccess: (data: any) => {
      setMessageBody("");
      setPendingMedia(null);
      if (mediaFileRef.current) mediaFileRef.current.value = "";
      if (data?.scheduled) {
        toast({ title: "Message Scheduled", description: data.message });
      } else {
        toast({ title: "Message sent" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-messages", selectedTruck] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-locked-trucks"] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send message",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleMediaPick = (file: File) => {
    const MAX = 5 * 1024 * 1024;
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.type.toLowerCase())) {
      toast({ title: "Unsupported file type", description: "Please choose a JPG, PNG, GIF, WebP, or HEIC image.", variant: "destructive" });
      return;
    }
    if (file.size > MAX) {
      toast({ title: "File too large", description: `Maximum size is ${MAX / 1024 / 1024} MB.`, variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingMedia({
        dataUrl: reader.result as string,
        mediaType: file.type,
        filename: file.name,
        size: file.size,
      });
    };
    reader.onerror = () => {
      toast({ title: "Could not read file", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  const selectedTruckRef = useRef<string | null>(null);
  selectedTruckRef.current = selectedTruck;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/fs-ws`;
    let retryDelay = 2000;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.source === "decomm" || data.type === "reg_message") {
            queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-locked-trucks"] });
            if (data.truckNumber === selectedTruckRef.current) {
              queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-messages", selectedTruckRef.current] });
            }
          }
        } catch (e) {}
      };

      ws.onopen = () => { retryDelay = 2000; };
      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, 30000);
        }
      };
      ws.onerror = () => { ws.close(); };
    };

    connect();
    return () => { destroyed = true; wsRef.current?.close(); };
  }, []);

  const isAtBottom = (el: HTMLDivElement | null) => {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    const techMsgs = messages.filter(m => m.contactType === 'tech' || m.contactType === 'nearest_tech');
    const mgrMsgs = messages.filter(m => m.contactType === 'manager');
    const hasBothColumns = techMsgs.length > 0 && mgrMsgs.length > 0;

    if (justSwitchedTruck.current) {
      prevTechMsgCount.current = hasBothColumns ? techMsgs.length : messages.length;
      prevMgrMsgCount.current = hasBothColumns ? mgrMsgs.length : 0;
      prevHasBothColumns.current = hasBothColumns;
      // Keep the flag active until real messages arrive so that the first
      // non-empty load (which may change hasBothColumns from false → true)
      // does not hit the layout-change reset branch and wipe restored counts.
      if (messages.length > 0) {
        justSwitchedTruck.current = false;
      }
      techEndRef.current?.scrollIntoView({ behavior: "smooth" });
      managerEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (hasBothColumns !== prevHasBothColumns.current) {
      prevTechMsgCount.current = hasBothColumns ? techMsgs.length : messages.length;
      prevMgrMsgCount.current = hasBothColumns ? mgrMsgs.length : 0;
      prevHasBothColumns.current = hasBothColumns;
      setTechNewCount(0);
      setMgrNewCount(0);
      techEndRef.current?.scrollIntoView({ behavior: "smooth" });
      managerEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (hasBothColumns) {
      const newTech = techMsgs.length - prevTechMsgCount.current;
      const newMgr = mgrMsgs.length - prevMgrMsgCount.current;

      if (isAtBottom(techScrollRef.current)) {
        techEndRef.current?.scrollIntoView({ behavior: "smooth" });
        setTechNewCount(0);
      } else if (newTech > 0) {
        setTechNewCount(c => c + newTech);
      }

      if (isAtBottom(managerScrollRef.current)) {
        managerEndRef.current?.scrollIntoView({ behavior: "smooth" });
        setMgrNewCount(0);
      } else if (newMgr > 0) {
        setMgrNewCount(c => c + newMgr);
      }

      prevTechMsgCount.current = techMsgs.length;
      prevMgrMsgCount.current = mgrMsgs.length;
    } else {
      const newCount = messages.length - prevTechMsgCount.current;
      if (isAtBottom(techScrollRef.current)) {
        techEndRef.current?.scrollIntoView({ behavior: "smooth" });
        setTechNewCount(0);
      } else if (newCount > 0) {
        setTechNewCount(c => c + newCount);
      }
      prevTechMsgCount.current = messages.length;
      prevMgrMsgCount.current = 0;
    }
  }, [messages]);

  useEffect(() => {
    if (prevSelectedTruckRef.current) {
      perTruckCounts.current.set(prevSelectedTruckRef.current, {
        tech: techNewCount,
        mgr: mgrNewCount,
      });
      try {
        sessionStorage.setItem(
          "decomm_badge_counts",
          JSON.stringify(Object.fromEntries(perTruckCounts.current))
        );
      } catch {}
    }
    prevSelectedTruckRef.current = selectedTruck;

    if (selectedTruck) {
      markReadMutation.mutate(selectedTruck);
      const saved = perTruckCounts.current.get(selectedTruck);
      setTechNewCount(saved?.tech ?? 0);
      setMgrNewCount(saved?.mgr ?? 0);
    } else {
      setTechNewCount(0);
      setMgrNewCount(0);
    }
    justSwitchedTruck.current = true;
    prevTechMsgCount.current = 0;
    prevMgrMsgCount.current = 0;
  }, [selectedTruck]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTruck) return;
    perTruckCounts.current.set(selectedTruck, { tech: techNewCount, mgr: mgrNewCount });
    try {
      sessionStorage.setItem(
        "decomm_badge_counts",
        JSON.stringify(Object.fromEntries(perTruckCounts.current))
      );
    } catch {}
  }, [techNewCount, mgrNewCount, selectedTruck]);

  const handleTechScroll = useCallback(() => {
    if (isAtBottom(techScrollRef.current)) setTechNewCount(0);
  }, []);

  const handleMgrScroll = useCallback(() => {
    if (isAtBottom(managerScrollRef.current)) setMgrNewCount(0);
  }, []);

  const handleSelectTruck = (truckNumber: string) => {
    setSelectedTruck(truckNumber);
    setMessageBody("");
  };

  const handleSend = () => {
    const body = messageBody.trim();
    if (!body || !selectedTruck || !selectedContact) return;
    sendMutation.mutate(body);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBatchOpen = () => {
    setBatchOpen(true);
    setBatchStep("import");
    setBatchImportRows([]);
    setBatchDynamicHeaders([]);
    setBatchFileName("");
    setBatchRecipients([]);
    setBatchUnresolved([]);
    setBatchTemplate("");
    setBatchResults([]);
    if (batchFileRef.current) batchFileRef.current.value = "";
  };

  const handleBatchFileImport = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const rows = await readExcelFile(buffer);
      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No data rows found in the spreadsheet.", variant: "destructive" });
        return;
      }

      const headers = Object.keys(rows[0]);
      if (headers.length === 0) {
        toast({ title: "No columns", description: "Could not detect column headers.", variant: "destructive" });
        return;
      }

      const ldapHeader = headers[0];
      const dynamicHeaders = headers.slice(1);

      // Detect a "Truck #" column (case-insensitive, trimmed) among the
      // dynamic columns.  Its value will be passed to the resolve endpoint to
      // pin the exact vehicle row when a tech appears on multiple trucks.
      const truckColHeader = dynamicHeaders.find(
        h => h.trim().toLowerCase() === "truck #",
      );

      const importRows: BatchImportRow[] = rows
        .filter(row => row[ldapHeader] && String(row[ldapHeader]).trim())
        .map(row => {
          const ldap = String(row[ldapHeader]).trim();
          const customVars: Record<string, string> = {};
          // Always inject the Column A value under its own header name so
          // operators can use {LDAP} (or whatever the column is called) in the
          // message template.
          customVars[ldapHeader] = ldap;
          dynamicHeaders.forEach(h => {
            customVars[h] = row[h] != null ? String(row[h]) : "";
          });
          // Extract and normalise the truck number (pad to 6 digits) so the
          // resolve call can narrow to the correct vehicle row.
          let truckNumber: string | undefined;
          if (truckColHeader) {
            const raw = String(row[truckColHeader] ?? "").trim();
            if (raw) {
              const digits = raw.replace(/\D/g, "");
              // Only set truckNumber when there are actual digits — non-numeric
              // cells (e.g. "N/A", "---") should not produce a 000000 pin.
              if (digits) truckNumber = digits.padStart(6, "0");
            }
          }
          return { ldap, customVars, truckNumber };
        });

      setBatchImportRows(importRows);
      // Include ldapHeader as the first insertable variable so operators can
      // use {LDAP} (or whatever Column A is named) in the message template.
      setBatchDynamicHeaders([ldapHeader, ...dynamicHeaders]);
      setBatchFileName(file.name);
      toast({ title: "File imported", description: `${importRows.length} rows with ${dynamicHeaders.length} variable column${dynamicHeaders.length !== 1 ? "s" : ""} detected.` });
    } catch (err: any) {
      toast({ title: "Import error", description: err.message, variant: "destructive" });
    }
  };

  const handleBatchResolve = async () => {
    if (batchImportRows.length === 0) return;

    setBatchResolving(true);
    try {
      // Send the new `rows` format so the server can narrow by truck number
      // when the XLSX included a "Truck #" column.
      const resp = await apiRequest("POST", "/api/fs/decomm-batch-resolve", {
        rows: batchImportRows.map(r => ({
          ldap: r.ldap,
          truckNumber: r.truckNumber,
        })),
      });
      const data = await resp.json();
      const resolvedRaw: any[] = data.resolved || [];

      // Build a lookup from LDAP+truckNumber (or LDAP alone) to import row so
      // we can restore customVars after the server resolves each row.
      const importByKey = new Map<string, BatchImportRow[]>();
      batchImportRows.forEach(ir => {
        const keys: string[] = [];
        if (ir.truckNumber) keys.push(`${ir.ldap.toUpperCase()}:${ir.truckNumber}`);
        keys.push(ir.ldap.toUpperCase());
        keys.forEach(k => {
          if (!importByKey.has(k)) importByKey.set(k, []);
          importByKey.get(k)!.push(ir);
        });
      });
      const keyCounters = new Map<string, number>();
      // Task #228: each resolved row carries `tech` and `manager` sub-objects from
      // the server. Default both .enabled to true so the operator's first action
      // (Send) covers both — the user can opt out of either side per-row.
      const resolved: BatchRecipient[] = resolvedRaw.map((r: any) => {
        const ldapKey = String(r.ldap || '').toUpperCase();
        const truckKey = r.truckNumber ? `${ldapKey}:${r.truckNumber}` : ldapKey;
        // Prefer the precise ldap+truck key; fall back to ldap-only.
        const lookupKey = (importByKey.has(truckKey) ? truckKey : ldapKey);
        const idx = keyCounters.get(lookupKey) || 0;
        keyCounters.set(lookupKey, idx + 1);
        const rows = importByKey.get(lookupKey) || [];
        const importRow = rows[idx] || rows[0];
        const tech = r.tech || { name: null, phone: null, status: 'no_phone', source: null };
        const manager = r.manager || { name: null, phone: null, entId: null, status: 'no_phone', source: null };
        return {
          ldap: r.ldap,
          truckNumber: r.truckNumber,
          vin: r.vin || '',
          address: r.address || '',
          zipCode: r.zipCode || '',
          fullName: r.fullName || '',
          customVars: importRow?.customVars || {},
          matchedVia: r.matchedVia ?? null,
          isManager: !!r.isManager,
          tech: {
            name: tech.name ?? null,
            phone: tech.phone ?? null,
            status: tech.status === 'ready' ? 'ready' : 'no_phone',
            source: tech.source ?? null,
            enabled: tech.status === 'ready',
          },
          manager: {
            name: manager.name ?? null,
            phone: manager.phone ?? null,
            entId: manager.entId ?? null,
            status: (manager.status as BatchManagerStatus) ?? 'no_phone',
            source: manager.source ?? null,
            enabled: manager.status === 'ready',
          },
        };
      });
      setBatchRecipients(resolved);
      const rawUnresolved = data.unresolved || [];
      const normalizedUnresolved: BatchUnresolved[] = rawUnresolved.map((u: any) =>
        typeof u === 'string' ? { ldap: u, reason: 'not_in_tpms_extract' } : u
      );
      setBatchUnresolved(normalizedUnresolved);
      setBatchStep("compose");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBatchResolving(false);
    }
  };

  const insertTemplateVar = (varStr: string) => {
    const el = batchTemplateRef.current;
    if (!el) {
      setBatchTemplate(prev => prev + varStr);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = batchTemplate.slice(0, start);
    const after = batchTemplate.slice(end);
    setBatchTemplate(before + varStr + after);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + varStr.length, start + varStr.length);
    }, 0);
  };

  const renderPreview = (template: string, r: BatchRecipient) => {
    let result = template;
    if (r.customVars) {
      for (const [key, val] of Object.entries(r.customVars)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`\\{${escaped}\\}`, 'gi'), val || '');
      }
    }
    return result;
  };

  const handleBatchSend = async () => {
    // Task #228: a row is sendable if EITHER its tech or manager target is
    // checked AND has a phone number. Rows with neither side ready are dropped.
    const validRecipients = batchRecipients.filter(r =>
      (r.tech.enabled && r.tech.phone) ||
      (r.manager.enabled && r.manager.phone && r.manager.status === 'ready'),
    );
    if (validRecipients.length === 0) {
      toast({ title: "No recipients ready to send", variant: "destructive" });
      return;
    }

    setBatchSending(true);
    try {
      const resp = await apiRequest("POST", "/api/fs/decomm-batch-text", {
        recipients: validRecipients,
        messageTemplate: batchTemplate,
      });
      const data = await resp.json();
      setBatchResults(data.results || []);
      setBatchStep("results");
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-locked-trucks"] });
      toast({
        title: "Batch text complete",
        description: `Tech: ${data.techSent || 0} sent / ${data.techFailed || 0} failed / ${data.techSkipped || 0} skipped · Manager: ${data.managerSent || 0} sent / ${data.managerFailed || 0} failed / ${data.managerSkipped || 0} skipped`,
      });
    } catch (err: any) {
      toast({ title: "Batch send failed", description: err.message, variant: "destructive" });
    } finally {
      setBatchSending(false);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const info = vehicleData.find((v) => v.truckNumber === c.truckNumber);
    return (
      c.truckNumber.includes(q) ||
      c.contactPhone?.includes(q) ||
      c.contactName?.toLowerCase().includes(q) ||
      info?.fullName?.toLowerCase().includes(q) ||
      false
    );
  });

  const availableTrucks = vehicleData.filter((v) => {
    const hasPhone = !!(v.mobilePhone || v.nearestTechPhone);
    if (!hasPhone) return false;
    if (!newConvSearch) return true;
    const q = newConvSearch.toLowerCase();
    return (
      v.truckNumber.includes(q) ||
      v.fullName?.toLowerCase().includes(q) ||
      v.nearestTechName?.toLowerCase().includes(q) ||
      v.mobilePhone?.includes(q) ||
      false
    );
  }).slice(0, 30);

  // Reusable message bubble — used in both single-column and split-column views.
  const renderMessageBubble = (msg: DecommMessage) => (
    <div
      key={msg.id}
      className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
      data-testid={`decomm-message-${msg.id}`}
    >
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
          msg.direction === "outbound"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {msg.direction === "outbound" && msg.senderName && (
            <span className="text-xs opacity-70">{msg.senderName}</span>
          )}
          <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
            msg.direction === "outbound"
              ? "border-primary-foreground/30 text-primary-foreground/80"
              : CONTACT_TYPE_COLORS[msg.contactType] || ""
          }`}>
            {msg.contactType === "manager" && msg.ccForLdap
              ? `Manager CC (${msg.ccForLdap})`
              : (CONTACT_TYPE_LABELS[msg.contactType] || msg.contactType)}
          </Badge>
        </div>
        {msg.mediaUrl && msg.mediaType?.startsWith('image/') && (
          <div className="mb-1.5">
            <a href={`/api/fs/mms-media/${msg.mediaUrl}`} target="_blank" rel="noopener noreferrer">
              <img
                src={`/api/fs/mms-media/${msg.mediaUrl}`}
                alt="MMS attachment"
                className="rounded max-w-full max-h-60 cursor-pointer hover:opacity-90 transition-opacity"
              />
            </a>
            <a
              href={`/api/fs/mms-media-download/${msg.mediaUrl}`}
              className={`inline-flex items-center gap-1 text-xs mt-1 hover:underline ${
                msg.direction === "outbound" ? "text-primary-foreground/80" : "text-muted-foreground"
              }`}
            >
              <Download className="h-3 w-3" />
              Download
            </a>
          </div>
        )}
        {msg.mediaUrl && !msg.mediaType?.startsWith('image/') && (
          <a
            href={`/api/fs/mms-media-download/${msg.mediaUrl}`}
            className={`inline-flex items-center gap-1.5 text-xs mb-1 px-2 py-1 rounded border hover:underline ${
              msg.direction === "outbound"
                ? "border-primary-foreground/30 text-primary-foreground/80"
                : "border-border text-muted-foreground"
            }`}
          >
            <Download className="h-3 w-3" />
            Download attachment ({msg.mediaType?.split('/')[1] || 'file'})
          </a>
        )}
        {!msg.mediaUrl && msg.status === 'media_failed' && (
          <div className={`flex flex-col gap-1 mb-1 px-2 py-1 rounded border italic ${
            msg.direction === "outbound"
              ? "border-primary-foreground/30 text-primary-foreground/80"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}>
            <span className="text-xs">📷 Photo attached but didn't save — try retry, otherwise ask sender to resend</span>
            {msg.direction === "inbound" && (
              <button
                type="button"
                onClick={() => retryMediaMutation.mutate(msg.id)}
                disabled={retryMediaMutation.isPending && retryMediaMutation.variables === msg.id}
                className="self-start inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-400 bg-white hover:bg-amber-100 not-italic disabled:opacity-50"
                data-testid={`button-retry-media-${msg.id}`}
              >
                {retryMediaMutation.isPending && retryMediaMutation.variables === msg.id ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Retrying…
                  </>
                ) : (
                  <>
                    <Download className="h-3 w-3" />
                    Retry download
                  </>
                )}
              </button>
            )}
          </div>
        )}
        {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
        <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
          <span className="text-xs opacity-60">
            {formatTime(msg.sentAt)}
          </span>
          {msg.direction === "outbound" && (
            <span className="text-xs opacity-60">
              {msg.status === "failed" ? "· Failed" : msg.status === "delivered" ? "· Delivered" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-180px)] gap-0 border rounded-lg overflow-hidden">
      <div className="w-72 flex-shrink-0 border-r flex flex-col bg-muted/30">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-decomm-conv-search"
            />
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => setNewConvOpen(true)}
              data-testid="button-new-decomm-conversation"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleBatchOpen}
              data-testid="button-batch-text"
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Batch Text
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {conversations.length === 0
                ? 'No conversations yet. Start one by clicking "New Conversation".'
                : "No matches found."}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const info = vehicleData.find((v) => v.truckNumber === conv.truckNumber);
              const isSelected = selectedTruck === conv.truckNumber;
              return (
                <div
                  key={conv.truckNumber}
                  onClick={() => handleSelectTruck(conv.truckNumber)}
                  className={`p-3 border-b cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                  data-testid={`decomm-conv-item-${conv.truckNumber}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isAdhocTruck(conv.truckNumber) ? (
                        <>
                          <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm font-semibold truncate">
                            {conv.contactName || formatPhone(conv.contactPhone)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="font-mono text-sm font-semibold truncate">
                            {conv.truckNumber.replace(/^0+/, "") || conv.truckNumber}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.unreadCount > 0 && (
                        <Badge className="text-xs px-1.5 py-0">
                          {conv.unreadCount}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {conv.contactName && (
                      <p className="text-xs text-muted-foreground truncate">{conv.contactName}</p>
                    )}
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS[conv.contactType] || ""}`}>
                      {CONTACT_TYPE_LABELS[conv.contactType] || conv.contactType}
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground/70 mt-1 truncate leading-4">
                    {conv.lastMessage}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selectedTruck ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a conversation or start a new one</p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-3 border-b bg-muted/20 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isAdhocTruck(selectedTruck) ? (
                      <>
                        <Badge variant="outline" className={`text-xs px-1.5 py-0.5 ${CONTACT_TYPE_COLORS.adhoc}`}>
                          Direct
                        </Badge>
                        <span className="font-semibold text-base">
                          {adhocSelectedContact?.name || "Direct text"}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {formatPhone(adhocSelectedContact?.phone)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono font-bold text-base">
                          #{selectedTruck.replace(/^0+/, "") || selectedTruck}
                        </span>
                        {selectedVehicle?.address && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {selectedVehicle.address}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {selectedVehicle?.fullName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Tech: {selectedVehicle.fullName}
                        {selectedVehicle.mobilePhone && <span className="font-mono">({selectedVehicle.mobilePhone})</span>}
                      </span>
                    )}
                    {selectedVehicle?.managerName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Mgr: {selectedVehicle.managerName}
                      </span>
                    )}
                    {selectedVehicle?.nearestTechName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        Nearest: {selectedVehicle.nearestTechName}
                        {selectedVehicle.nearestTechPhone && <span className="font-mono">({selectedVehicle.nearestTechPhone})</span>}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSelectedTruck(null)}
                data-testid="button-close-decomm-conversation"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {(() => {
              const techMsgs = messages.filter(m => m.contactType === 'tech' || m.contactType === 'nearest_tech');
              const mgrMsgs = messages.filter(m => m.contactType === 'manager');
              const hasBothColumns = techMsgs.length > 0 && mgrMsgs.length > 0;
              if (hasBothColumns) {
                const techContactName = techMsgs.find(m => m.contactName)?.contactName || selectedVehicle?.fullName || 'Tech';
                const mgrContactName = mgrMsgs.find(m => m.contactName)?.contactName || selectedVehicle?.managerName || 'Manager';
                return (
                  <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 flex flex-col min-w-0 border-r relative">
                      <div className="px-3 py-2 border-b bg-muted/10 flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CONTACT_TYPE_COLORS.tech}`}>Tech</Badge>
                        <span className="text-xs font-medium truncate">{techContactName}</span>
                      </div>
                      <div ref={techScrollRef} onScroll={handleTechScroll} className="flex-1 overflow-y-auto p-3 space-y-3">
                        {techMsgs.map(renderMessageBubble)}
                        <div ref={techEndRef} />
                      </div>
                      {techNewCount > 0 && (
                        <button
                          onClick={() => {
                            techEndRef.current?.scrollIntoView({ behavior: "smooth" });
                            setTechNewCount(0);
                          }}
                          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 transition-colors z-10"
                        >
                          {techNewCount === 1 ? "1 new message" : `${techNewCount} new messages`}
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col min-w-0 relative">
                      <div className="px-3 py-2 border-b bg-muted/10 flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CONTACT_TYPE_COLORS.manager}`}>Manager</Badge>
                        <span className="text-xs font-medium truncate">{mgrContactName}</span>
                      </div>
                      <div ref={managerScrollRef} onScroll={handleMgrScroll} className="flex-1 overflow-y-auto p-3 space-y-3">
                        {mgrMsgs.map(renderMessageBubble)}
                        <div ref={managerEndRef} />
                      </div>
                      {mgrNewCount > 0 && (
                        <button
                          onClick={() => {
                            managerEndRef.current?.scrollIntoView({ behavior: "smooth" });
                            setMgrNewCount(0);
                          }}
                          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 transition-colors z-10"
                        >
                          {mgrNewCount === 1 ? "1 new message" : `${mgrNewCount} new messages`}
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
                  <div ref={techScrollRef} onScroll={handleTechScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                      <div className="text-center text-sm text-muted-foreground py-8">
                        No messages yet. Select a contact below and send the first message.
                      </div>
                    ) : (
                      messages.map(renderMessageBubble)
                    )}
                    <div ref={techEndRef} />
                  </div>
                  {techNewCount > 0 && (
                    <button
                      onClick={() => {
                        techEndRef.current?.scrollIntoView({ behavior: "smooth" });
                        setTechNewCount(0);
                      }}
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-md hover:bg-primary/90 transition-colors z-10"
                    >
                      {techNewCount === 1 ? "1 new message" : `${techNewCount} new messages`}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })()}

            {contactOptions.length === 0 ? (
              <div className="px-3 py-2 bg-muted/40 border-t text-xs text-muted-foreground text-center">
                No phone numbers available for this truck — sync tech data first.
              </div>
            ) : (
              <div className="p-3 border-t space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Send to:</span>
                  <Select value={contactType} onValueChange={setContactType}>
                    <SelectTrigger className="h-7 text-xs w-[200px]" data-testid="select-decomm-contact-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {contactOptions.map((opt) => (
                        <SelectItem key={opt.type} value={opt.type}>
                          <span className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS[opt.type] || ""}`}>
                              {CONTACT_TYPE_LABELS[opt.type]}
                            </Badge>
                            <span className="truncate">{opt.name || "Unknown"}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedContact?.phone && (
                    <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {selectedContact.phone}
                    </span>
                  )}
                </div>
                {pendingMedia && (
                  <div className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                    <img
                      src={pendingMedia.dataUrl}
                      alt={pendingMedia.filename}
                      className="h-12 w-12 rounded object-cover border"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{pendingMedia.filename}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(pendingMedia.size / 1024).toFixed(0)} KB · {pendingMedia.mediaType}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        setPendingMedia(null);
                        if (mediaFileRef.current) mediaFileRef.current.value = "";
                      }}
                      data-testid="button-decomm-remove-media"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <input
                    ref={mediaFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleMediaPick(f);
                    }}
                    data-testid="input-decomm-media-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 flex-shrink-0"
                    onClick={() => mediaFileRef.current?.click()}
                    disabled={sendMutation.isPending || uploadingMedia}
                    title="Attach photo"
                    data-testid="button-decomm-attach-media"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <Textarea
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                    className="min-h-[60px] max-h-[120px] resize-none text-sm"
                    data-testid="textarea-decomm-message-input"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={(!messageBody.trim() && !pendingMedia) || sendMutation.isPending || uploadingMedia || !selectedContact}
                    data-testid="button-decomm-send-message"
                  >
                    {sendMutation.isPending || uploadingMedia ? (
                      <Clock className="w-4 h-4 animate-pulse" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={newConvOpen} onOpenChange={setNewConvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                Text any phone number
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Phone (e.g. 555-123-4567)"
                  value={adhocPhoneInput}
                  onChange={(e) => setAdhocPhoneInput(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-adhoc-phone"
                />
                <Input
                  placeholder="Contact name (optional)"
                  value={adhocNameInput}
                  onChange={(e) => setAdhocNameInput(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-adhoc-name"
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={adhocPhoneInput.replace(/\D/g, "").slice(-10).length !== 10}
                onClick={() => {
                  const digits = adhocPhoneInput.replace(/\D/g, "").slice(-10);
                  if (digits.length !== 10) {
                    toast({ title: "Invalid phone", description: "Enter a valid 10-digit US phone number.", variant: "destructive" });
                    return;
                  }
                  const truck = `ADHOC-${digits}`;
                  const name = adhocNameInput.trim() || null;
                  setAdhocContacts((prev) => ({ ...prev, [truck]: { phone: `+1${digits}`, name } }));
                  setContactType("adhoc");
                  setSelectedTruck(truck);
                  setMessageBody("");
                  setNewConvOpen(false);
                  setAdhocPhoneInput("");
                  setAdhocNameInput("");
                }}
                data-testid="button-open-adhoc-conversation"
              >
                Open conversation
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center">— or pick a truck —</div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by truck #, tech name, or phone..."
                value={newConvSearch}
                onChange={(e) => setNewConvSearch(e.target.value)}
                className="pl-8"
                data-testid="input-new-decomm-conv-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {availableTrucks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No trucks with phone numbers found</p>
              ) : (
                availableTrucks.map((v) => (
                  <div
                    key={v.truckNumber}
                    onClick={() => {
                      handleSelectTruck(v.truckNumber);
                      setNewConvOpen(false);
                      setNewConvSearch("");
                    }}
                    className="flex items-center justify-between p-2.5 rounded-md cursor-pointer hover:bg-muted/50 border"
                    data-testid={`new-decomm-conv-truck-${v.truckNumber}`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">
                          #{v.truckNumber.replace(/^0+/, "") || v.truckNumber}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {v.fullName && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" /> {v.fullName}
                          </span>
                        )}
                        {v.nearestTechName && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {v.nearestTechName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {v.mobilePhone && (
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS.tech}`}>
                          Tech
                        </Badge>
                      )}
                      {v.nearestTechPhone && (
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS.nearest_tech}`}>
                          Nearest
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={(open) => { if (!open) setBatchOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Batch Text
              {batchStep !== "import" && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  Step: {batchStep === "compose" ? "2 — Compose" : batchStep === "preview" ? "3 — Preview" : "4 — Results"}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {batchStep === "import" && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Import Spreadsheet</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Upload an XLSX file. Column A should contain the LDAP / Enterprise ID (used to look up the phone number).
                  Columns B, C, D, etc. will become dynamic variables you can insert into the message — their headers become the variable names.
                </p>
                <input
                  type="file"
                  ref={batchFileRef}
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleBatchFileImport(file);
                  }}
                  data-testid="batch-file-input"
                />
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => batchFileRef.current?.click()}
                >
                  {batchFileName ? (
                    <div className="space-y-2">
                      <FileSpreadsheet className="h-8 w-8 mx-auto text-green-600" />
                      <p className="text-sm font-medium">{batchFileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {batchImportRows.length} recipient{batchImportRows.length !== 1 ? "s" : ""} detected
                        {batchDynamicHeaders.length > 0 && (
                          <span> &middot; Variables: {batchDynamicHeaders.join(", ")}</span>
                        )}
                      </p>
                      <Button variant="outline" size="sm" className="text-xs" onClick={(e) => { e.stopPropagation(); batchFileRef.current?.click(); }}>
                        Replace File
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to upload an XLSX file</p>
                      <p className="text-xs text-muted-foreground">Column A = LDAP, remaining columns = dynamic variables</p>
                    </div>
                  )}
                </div>
              </div>

              {batchImportRows.length > 0 && batchDynamicHeaders.length > 0 && (
                <div className="max-h-32 overflow-y-auto border rounded-md text-xs">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5 font-medium">LDAP</th>
                        {batchDynamicHeaders.map(h => (
                          <th key={h} className="text-left p-1.5 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batchImportRows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1.5 font-mono">{row.ldap}</td>
                          {batchDynamicHeaders.map(h => (
                            <td key={h} className="p-1.5">{row.customVars[h] || "-"}</td>
                          ))}
                        </tr>
                      ))}
                      {batchImportRows.length > 10 && (
                        <tr className="border-t">
                          <td colSpan={batchDynamicHeaders.length + 1} className="p-1.5 text-center text-muted-foreground">
                            ...and {batchImportRows.length - 10} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-md border p-3 bg-muted/30 text-xs leading-relaxed">
                Each row will text <span className="font-medium">both the tech and their manager</span> automatically.
                Phone numbers come from the decommissioning snapshot (mobile phone, manager phone) and fall back to a live TPMS lookup.
                You can opt out of either side per-row on the next step.
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setBatchOpen(false)}>Cancel</Button>
                <Button
                  onClick={handleBatchResolve}
                  disabled={batchResolving || batchImportRows.length === 0}
                  data-testid="batch-resolve-btn"
                >
                  {batchResolving ? <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 animate-spin" /> Resolving...</span> : "Resolve & Continue"}
                </Button>
              </div>
            </div>
          )}

          {batchStep === "compose" && (
            <div className="space-y-4">
              {batchUnresolved.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">
                    {batchUnresolved.length} LDAP(s) could not be resolved:
                  </p>
                  <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                    {batchUnresolved.map((u, i) => (
                      <li key={`${u.ldap}-${i}`} className="font-mono">
                        {u.ldap}
                        <span className="ml-2 font-sans italic text-[11px]">
                          {u.reason === 'not_in_tpms_extract'
                            ? '— not found in TPMS_EXTRACT'
                            : u.reason === 'no_vehicle_match'
                              ? '— in TPMS_EXTRACT but no decommissioning vehicle references this LDAP'
                              : u.reason === 'no_vehicle_for_truck'
                                ? '— LDAP matched other vehicles but not the truck number in this row'
                                : u.reason === 'no_phone_for_contact_type'
                                  ? '— matched a vehicle, but no phone number available for the selected contact type'
                                  : u.reason === 'tpms_lookup_failed'
                                    ? '— Snowflake TPMS_EXTRACT lookup failed; please retry'
                                    : `— ${u.reason}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-1">
                  {batchRecipients.length} recipient{batchRecipients.length !== 1 ? "s" : ""} matched
                  <span className="text-xs text-muted-foreground ml-2">
                    · Tech ready: {batchRecipients.filter(r => r.tech.status === 'ready').length}
                    · Manager ready: {batchRecipients.filter(r => r.manager.status === 'ready').length}
                  </span>
                </p>
                <div className="max-h-72 overflow-y-auto border rounded-md text-xs">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5 font-medium">LDAP</th>
                        <th className="text-left p-1.5 font-medium">Truck #</th>
                        <th className="text-left p-1.5 font-medium w-12">Tech</th>
                        <th className="text-left p-1.5 font-medium">Tech contact</th>
                        <th className="text-left p-1.5 font-medium w-12">Mgr</th>
                        <th className="text-left p-1.5 font-medium">Manager contact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRecipients.map((r, i) => {
                        const techMissing = r.tech.status !== 'ready';
                        const mgrMissing = r.manager.status !== 'ready';
                        const rowDimmed = techMissing && mgrMissing;
                        return (
                          <tr key={i} className={`border-t ${rowDimmed ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                            <td className="p-1.5 font-mono whitespace-nowrap align-top">
                              <span className="inline-flex items-center gap-1">
                                {r.ldap}
                                {r.isManager && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 h-4 border-blue-400 text-blue-700 dark:text-blue-300 dark:border-blue-700"
                                    title="This recipient is themselves a manager (their enterprise ID appears as MANAGER_ENT_ID for at least one other tech)."
                                  >
                                    Is manager
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td className="p-1.5 font-mono align-top">{r.truckNumber.replace(/^0+/, "")}</td>

                            {/* Tech checkbox */}
                            <td className="p-1.5 align-top">
                              <Checkbox
                                checked={r.tech.enabled}
                                disabled={r.tech.status !== 'ready'}
                                onCheckedChange={(checked) => {
                                  setBatchRecipients(prev => prev.map((row, idx) =>
                                    idx === i ? { ...row, tech: { ...row.tech, enabled: checked === true } } : row,
                                  ));
                                }}
                                data-testid={`batch-tech-row-toggle-${i}`}
                              />
                            </td>
                            {/* Tech contact */}
                            <td className="p-1.5 align-top">
                              {r.tech.phone ? (
                                <div className="space-y-0.5">
                                  <div className="text-[11px]">{r.tech.name || r.fullName || "-"}</div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{r.tech.phone}</div>
                                  {r.tech.source === 'tpms_live' && (
                                    <div className="text-[10px] italic text-blue-700 dark:text-blue-300">
                                      live TPMS lookup
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-amber-600 text-[11px]">No phone</span>
                              )}
                            </td>

                            {/* Manager checkbox */}
                            <td className="p-1.5 align-top">
                              <Checkbox
                                checked={r.manager.enabled}
                                disabled={r.manager.status !== 'ready'}
                                onCheckedChange={(checked) => {
                                  setBatchRecipients(prev => prev.map((row, idx) =>
                                    idx === i ? { ...row, manager: { ...row.manager, enabled: checked === true } } : row,
                                  ));
                                }}
                                data-testid={`batch-mgr-row-toggle-${i}`}
                              />
                            </td>
                            {/* Manager contact */}
                            <td className="p-1.5 align-top">
                              {r.manager.status === 'self_managed' ? (
                                <span className="text-[10px] text-blue-700 dark:text-blue-300">
                                  Recipient is a manager — skipped
                                </span>
                              ) : r.manager.status === 'no_manager_ent_id' ? (
                                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                                  No manager on record
                                </span>
                              ) : r.manager.status === 'same_as_tech' ? (
                                <div className="space-y-0.5">
                                  <div className="text-[11px]">{r.manager.name || "-"}</div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{r.manager.phone}</div>
                                  <div className="text-[10px] text-amber-700 dark:text-amber-400">Same # as tech — skipped</div>
                                </div>
                              ) : r.manager.phone ? (
                                <div className="space-y-0.5">
                                  <div className="text-[11px]">{r.manager.name || "-"}</div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{r.manager.phone}</div>
                                  {r.manager.source === 'tpms_live' && (
                                    <div className="text-[10px] italic text-blue-700 dark:text-blue-300">
                                      live TPMS lookup
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] text-amber-700 dark:text-amber-400">No manager phone</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Message Template</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Click a variable below to insert it into your message. Variables come from the column headers in your uploaded spreadsheet and use single braces like {"{ColumnName}"}. Each row's value is substituted for the matching technician.
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {batchDynamicHeaders.map((h) => (
                    <Button
                      key={h}
                      variant="outline"
                      size="sm"
                      className="text-xs h-6 px-2 border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-700"
                      onClick={() => insertTemplateVar(`{${h}}`)}
                    >
                      <FileSpreadsheet className="w-3 h-3 mr-1" />
                      {h}
                    </Button>
                  ))}
                </div>
                <Textarea
                  ref={batchTemplateRef}
                  value={batchTemplate}
                  onChange={(e) => setBatchTemplate(e.target.value)}
                  placeholder={
                    batchDynamicHeaders.length > 0
                      ? `Hello {${batchDynamicHeaders[0]}}, we are asking you to decommission truck {${batchDynamicHeaders[1] || batchDynamicHeaders[0]}} at {${batchDynamicHeaders[2] || batchDynamicHeaders[0]}}...`
                      : "Add columns to your spreadsheet (e.g. TruckNumber, Address) and they will appear here as variables you can insert."
                  }
                  className="min-h-[120px] text-sm"
                  data-testid="batch-template-input"
                />
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setBatchStep("import")}>Back</Button>
                <Button
                  onClick={() => setBatchStep("preview")}
                  disabled={
                    !batchTemplate.trim()
                    || batchRecipients.filter(r =>
                        (r.tech.enabled && r.tech.phone)
                        || (r.manager.enabled && r.manager.phone && r.manager.status === 'ready'),
                      ).length === 0
                  }
                  data-testid="batch-preview-btn"
                >
                  Preview Messages
                </Button>
              </div>
            </div>
          )}

          {batchStep === "preview" && (() => {
            // Task #228: each row contributes UP TO TWO sends (tech + manager).
            // Only show preview cards for sides that are checked AND ready.
            const previewable = batchRecipients
              .map(r => ({
                r,
                techWillSend: r.tech.enabled && !!r.tech.phone,
                mgrWillSend: r.manager.enabled && !!r.manager.phone && r.manager.status === 'ready',
              }))
              .filter(p => p.techWillSend || p.mgrWillSend);
            const techCount = previewable.filter(p => p.techWillSend).length;
            const mgrCount = previewable.filter(p => p.mgrWillSend).length;
            const total = techCount + mgrCount;
            return (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">
                    Preview — {total} message{total !== 1 ? "s" : ""} will be sent
                    <span className="text-xs text-muted-foreground ml-1">
                      ({techCount} tech + {mgrCount} manager)
                    </span>
                  </p>
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {previewable.map(({ r, techWillSend, mgrWillSend }, i) => {
                      const techBody = renderPreview(batchTemplate, r);
                      const mgrBody = `[${r.ldap}] ${techBody}`;
                      return (
                        <div key={i} className="border rounded-md p-2.5 text-sm space-y-2">
                          {techWillSend && (
                            <div>
                              <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground flex-wrap">
                                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS.tech}`}>
                                  Tech
                                </Badge>
                                <span className="font-mono font-semibold">#{r.truckNumber.replace(/^0+/, "")}</span>
                                <span>{r.tech.name || r.fullName}</span>
                                <span className="font-mono">{r.tech.phone}</span>
                                {r.isManager && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-400 text-blue-700 dark:text-blue-300 dark:border-blue-700">
                                    Is manager
                                  </Badge>
                                )}
                              </div>
                              <p className="whitespace-pre-wrap text-sm bg-muted/30 rounded p-2">{techBody}</p>
                            </div>
                          )}
                          {mgrWillSend && (
                            <div className="border-l-2 border-blue-300 dark:border-blue-700 pl-2">
                              <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground flex-wrap">
                                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${CONTACT_TYPE_COLORS.manager}`}>
                                  Manager
                                </Badge>
                                <span className="font-mono font-semibold">#{r.truckNumber.replace(/^0+/, "")}</span>
                                <span>{r.manager.name || "-"}</span>
                                <span className="font-mono">{r.manager.phone}</span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm bg-blue-50 dark:bg-blue-950/30 rounded p-2">{mgrBody}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setBatchStep("compose")}>Back</Button>
                  <Button
                    onClick={handleBatchSend}
                    disabled={batchSending}
                    className="bg-primary"
                    data-testid="batch-send-btn"
                  >
                    {batchSending ? (
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 animate-spin" /> Sending...</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Send {total} Message{total !== 1 ? "s" : ""}</span>
                    )}
                  </Button>
                </div>
              </div>
            );
          })()}

          {batchStep === "results" && (() => {
            // Task #228: results are now per-row with separate tech/manager outcomes.
            const techSent = batchResults.filter(r => r.tech.status === "sent").length;
            const techFailed = batchResults.filter(r => r.tech.status === "failed").length;
            const techSkipped = batchResults.filter(r =>
              !["sent", "failed"].includes(r.tech.status),
            ).length;
            const mgrSent = batchResults.filter(r => r.manager.status === "sent").length;
            const mgrFailed = batchResults.filter(r => r.manager.status === "failed").length;
            const mgrSkipped = batchResults.filter(r =>
              !["sent", "failed"].includes(r.manager.status),
            ).length;
            const problemRows = batchResults.filter(r =>
              r.tech.status === "failed" || r.manager.status === "failed",
            );
            return (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Tech</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{techSent}</p>
                      <p className="text-xs text-muted-foreground">Sent</p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-red-600">{techFailed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-amber-600">{techSkipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Manager</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{mgrSent}</p>
                      <p className="text-xs text-muted-foreground">Sent</p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-red-600">{mgrFailed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-2xl font-bold text-amber-600">{mgrSkipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                    </div>
                  </div>
                </div>

                {problemRows.length > 0 && (
                  <div className="max-h-48 overflow-y-auto border rounded-md text-xs">
                    <table className="w-full">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-1.5 font-medium">Truck #</th>
                          <th className="text-left p-1.5 font-medium">LDAP</th>
                          <th className="text-left p-1.5 font-medium">Tech</th>
                          <th className="text-left p-1.5 font-medium">Manager</th>
                          <th className="text-left p-1.5 font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {problemRows.map((r, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-1.5 font-mono">{r.truckNumber}</td>
                            <td className="p-1.5 font-mono">{r.ldap || "-"}</td>
                            <td className="p-1.5">
                              <Badge
                                variant={r.tech.status === "failed" ? "destructive" : r.tech.status === "sent" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {r.tech.status}
                              </Badge>
                            </td>
                            <td className="p-1.5">
                              <Badge
                                variant={r.manager.status === "failed" ? "destructive" : r.manager.status === "sent" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {r.manager.status}
                              </Badge>
                            </td>
                            <td className="p-1.5 text-muted-foreground">
                              {r.tech.error || r.manager.error || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => setBatchOpen(false)}>Done</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
