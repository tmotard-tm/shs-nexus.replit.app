import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
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
};

const CONTACT_TYPE_COLORS: Record<string, string> = {
  tech: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  nearest_tech: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
};

interface DecommConversationsProps {
  vehicleData: DecommVehicleInfo[];
  initialTruckNumber?: string;
}

export function DecommConversations({ vehicleData, initialTruckNumber }: DecommConversationsProps) {
  const { toast } = useToast();
  const [selectedTruck, setSelectedTruck] = useState<string | null>(initialTruckNumber ?? null);
  const [messageBody, setMessageBody] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvSearch, setNewConvSearch] = useState("");
  const [contactType, setContactType] = useState<string>("tech");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

  const selectedVehicle = selectedTruck
    ? vehicleData.find((v) => v.truckNumber === selectedTruck)
    : null;

  const getContactOptions = useCallback((vehicle: DecommVehicleInfo | null | undefined) => {
    if (!vehicle) return [];
    const options: { type: string; name: string | null; phone: string | null }[] = [];
    if (vehicle.mobilePhone) {
      options.push({ type: "tech", name: vehicle.fullName, phone: vehicle.mobilePhone });
    }
    if (vehicle.nearestTechPhone) {
      options.push({ type: "nearest_tech", name: vehicle.nearestTechName, phone: vehicle.nearestTechPhone });
    }
    return options;
  }, []);

  const contactOptions = getContactOptions(selectedVehicle);
  const selectedContact = contactOptions.find(c => c.type === contactType) || contactOptions[0];

  useEffect(() => {
    if (contactOptions.length > 0 && !contactOptions.find(c => c.type === contactType)) {
      setContactType(contactOptions[0].type);
    }
  }, [contactOptions, contactType]);

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", "/api/fs/decomm-messages", {
        truckNumber: selectedTruck,
        contactType: selectedContact?.type || contactType,
        contactPhone: selectedContact?.phone,
        contactName: selectedContact?.name,
        body,
        triggerType: "manual",
      }),
    onSuccess: (data: any) => {
      setMessageBody("");
      if (data?.scheduled) {
        toast({ title: "Message Scheduled", description: data.message });
      } else {
        toast({ title: "Message sent" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-messages", selectedTruck] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decomm-conversations"] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send message",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (selectedTruck) {
      markReadMutation.mutate(selectedTruck);
    }
  }, [selectedTruck]);

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
          <Button
            size="sm"
            className="w-full"
            onClick={() => setNewConvOpen(true)}
            data-testid="button-new-decomm-conversation"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Conversation
          </Button>
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
                      <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-sm font-semibold truncate">
                        {conv.truckNumber.replace(/^0+/, "") || conv.truckNumber}
                      </span>
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
                    <span className="font-mono font-bold text-base">
                      #{selectedTruck.replace(/^0+/, "") || selectedTruck}
                    </span>
                    {selectedVehicle?.address && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {selectedVehicle.address}
                      </span>
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

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No messages yet. Select a contact below and send the first message.
                </div>
              ) : (
                messages.map((msg) => (
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
                          {CONTACT_TYPE_LABELS[msg.contactType] || msg.contactType}
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
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

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
                <div className="flex gap-2 items-end">
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
                    disabled={!messageBody.trim() || sendMutation.isPending || !selectedContact}
                    data-testid="button-decomm-send-message"
                  >
                    {sendMutation.isPending ? (
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
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by truck #, tech name, or phone..."
                value={newConvSearch}
                onChange={(e) => setNewConvSearch(e.target.value)}
                className="pl-8"
                autoFocus
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
    </div>
  );
}
