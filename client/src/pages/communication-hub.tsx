import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { 
  Mail, 
  MessageSquare, 
  Shield, 
  History, 
  Plus, 
  Edit2, 
  Trash2, 
  Eye, 
  Send,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Radio,
  Phone
} from "lucide-react";
import { format } from "date-fns";

type CommunicationMode = 'simulated' | 'whitelisted' | 'live';

interface CommunicationTemplate {
  id: string;
  name: string;
  description: string | null;
  type: string;
  mode: string;
  subject: string | null;
  htmlContent: string | null;
  textContent: string;
  variables: string[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WhitelistEntry {
  id: string;
  type: string;
  value: string;
  description: string | null;
  createdAt: string;
}

interface CommunicationLog {
  id: string;
  templateName: string;
  type: string;
  mode: string;
  status: string;
  intendedRecipient: string;
  actualRecipient: string | null;
  subject: string | null;
  contentPreview: string | null;
  errorMessage: string | null;
  sentAt: string;
}

function getModeColor(mode: string): string {
  switch (mode) {
    case 'simulated': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'whitelisted': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'live': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'sent': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'simulated': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'blocked': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'sent': return <Check className="h-3 w-3" />;
    case 'simulated': return <Radio className="h-3 w-3" />;
    case 'blocked': return <Shield className="h-3 w-3" />;
    case 'failed': return <X className="h-3 w-3" />;
    default: return null;
  }
}

function ResizableHistoryTable({ logs, getModeColor, getStatusColor, getStatusIcon }: {
  logs: CommunicationLog[];
  getModeColor: (mode: string) => string;
  getStatusColor: (status: string) => string;
  getStatusIcon: (status: string) => any;
}) {
  const defaultWidths = [140, 180, 260, 110, 180, 300];
  const [colWidths, setColWidths] = useState(defaultWidths);
  const resizingCol = useRef<number | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((colIndex: number, e: { clientX: number; preventDefault: () => void }) => {
    e.preventDefault();
    resizingCol.current = colIndex;
    startX.current = e.clientX;
    startWidth.current = colWidths[colIndex];

    const onMouseMove = (ev: MouseEvent) => {
      if (resizingCol.current === null) return;
      const diff = ev.clientX - startX.current;
      const newWidth = Math.max(60, startWidth.current + diff);
      setColWidths(prev => {
        const next = [...prev];
        next[resizingCol.current!] = newWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths]);

  const headers = ['Time', 'Template', 'Recipient', 'Mode', 'Status', 'Subject'];

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ tableLayout: 'fixed', minWidth: colWidths.reduce((a, b) => a + b, 0) }}>
          <thead>
            <tr className="border-b bg-muted/50">
              {headers.map((header, i) => (
                <th
                  key={header}
                  className="relative text-left font-semibold text-sm text-muted-foreground px-4 py-3"
                  style={{ width: colWidths[i] }}
                >
                  {header}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400/40 transition-colors"
                    onMouseDown={(e) => onMouseDown(i, e)}
                    style={{ zIndex: 1 }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap" style={{ width: colWidths[0] }}>
                  {format(new Date(log.sentAt), 'MMM d, h:mm a')}
                </td>
                <td className="px-4 py-3" style={{ width: colWidths[1] }}>
                  <Badge variant="outline" className="flex items-center gap-1.5 w-fit text-sm py-1 px-2">
                    {log.type === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    {log.templateName}
                  </Badge>
                </td>
                <td className="px-4 py-3" style={{ width: colWidths[2] }}>
                  <div className="font-mono text-sm break-all">{log.intendedRecipient}</div>
                  {log.actualRecipient && log.actualRecipient !== log.intendedRecipient && (
                    <div className="text-sm text-muted-foreground mt-0.5">Sent to: {log.actualRecipient}</div>
                  )}
                </td>
                <td className="px-4 py-3" style={{ width: colWidths[3] }}>
                  <Badge className={`${getModeColor(log.mode)} text-sm py-1 px-2`}>{log.mode}</Badge>
                </td>
                <td className="px-4 py-3" style={{ width: colWidths[4] }}>
                  <Badge className={`${getStatusColor(log.status)} flex items-center gap-1.5 w-fit text-sm py-1 px-2`}>
                    {getStatusIcon(log.status)}
                    {log.status}
                  </Badge>
                  {log.errorMessage && (
                    <div className="text-sm text-red-500 mt-1">{log.errorMessage}</div>
                  )}
                </td>
                <td className="px-4 py-3" style={{ width: colWidths[5] }} title={log.subject || undefined}>
                  <div className="break-words">{log.subject || '-'}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CommunicationHub() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("templates");
  const [editingTemplate, setEditingTemplate] = useState<CommunicationTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<CommunicationTemplate | null>(null);
  const [isAddWhitelistOpen, setIsAddWhitelistOpen] = useState(false);
  const [newWhitelistEntry, setNewWhitelistEntry] = useState({ type: 'email', value: '', description: '' });

  const { data: templates = [], isLoading: templatesLoading, refetch: refetchTemplates } = useQuery<CommunicationTemplate[]>({
    queryKey: ['/api/communication/templates'],
  });

  const { data: whitelist = [], isLoading: whitelistLoading, refetch: refetchWhitelist } = useQuery<WhitelistEntry[]>({
    queryKey: ['/api/communication/whitelist'],
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<CommunicationLog[]>({
    queryKey: ['/api/communication/logs'],
  });

  const seedTemplatesMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/communication/templates/seed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/communication/templates'] });
      toast({ title: "Templates seeded successfully" });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<CommunicationTemplate> }) =>
      apiRequest('PATCH', `/api/communication/templates/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/communication/templates'] });
      setEditingTemplate(null);
      toast({ title: "Template updated successfully" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/communication/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/communication/templates'] });
      toast({ title: "Template deleted" });
    },
  });

  const addWhitelistMutation = useMutation({
    mutationFn: (entry: { type: string; value: string; description: string }) =>
      apiRequest('POST', '/api/communication/whitelist', entry),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/communication/whitelist'] });
      setIsAddWhitelistOpen(false);
      setNewWhitelistEntry({ type: 'email', value: '', description: '' });
      toast({ title: "Added to whitelist" });
    },
  });

  const removeWhitelistMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/communication/whitelist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/communication/whitelist'] });
      toast({ title: "Removed from whitelist" });
    },
  });

  const handleModeChange = (templateId: string, newMode: CommunicationMode) => {
    updateTemplateMutation.mutate({ id: templateId, updates: { mode: newMode } });
  };

  const handleToggleActive = (templateId: string, isActive: boolean) => {
    updateTemplateMutation.mutate({ id: templateId, updates: { isActive } });
  };

  return (
    <div className="container mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Mail className="h-8 w-8 text-blue-600" />
            Communication Hub
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage email and SMS templates, whitelists, and view message history
          </p>
        </div>
        {templates.length === 0 && (
          <Button onClick={() => seedTemplatesMutation.mutate()} disabled={seedTemplatesMutation.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${seedTemplatesMutation.isPending ? 'animate-spin' : ''}`} />
            Seed Default Templates
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
                <Mail className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{templates.length}</p>
                <p className="text-sm text-muted-foreground">Templates</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg dark:bg-yellow-900">
                <Shield className="h-5 w-5 text-yellow-600 dark:text-yellow-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{whitelist.length}</p>
                <p className="text-sm text-muted-foreground">Whitelisted</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900">
                <History className="h-5 w-5 text-green-600 dark:text-green-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{logs.length}</p>
                <p className="text-sm text-muted-foreground">Messages Logged</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="templates" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="whitelist" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Whitelist
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Send History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          {templatesLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Loading templates...</CardContent></Card>
          ) : templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Templates Yet</h3>
                <p className="text-muted-foreground mb-4">Click "Seed Default Templates" to add the standard message templates.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <Card key={template.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                          {template.type === 'email' ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                          {template.name}
                        </CardTitle>
                        <CardDescription>{template.description}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getModeColor(template.mode)}>{template.mode}</Badge>
                        <Badge variant={template.isActive ? "default" : "secondary"}>
                          {template.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        {template.subject && (
                          <div className="mb-2">
                            <Label className="text-xs text-muted-foreground">Subject</Label>
                            <p className="text-sm font-medium">{template.subject}</p>
                          </div>
                        )}
                        {template.variables && template.variables.length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Variables</Label>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {template.variables.map((v) => (
                                <Badge key={v} variant="outline" className="text-xs">{"{{" + v + "}}"}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Select value={template.mode} onValueChange={(v) => handleModeChange(template.id, v as CommunicationMode)}>
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="simulated">
                              <span className="flex items-center gap-2">
                                <Radio className="h-3 w-3 text-blue-500" /> Simulated
                              </span>
                            </SelectItem>
                            <SelectItem value="whitelisted">
                              <span className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-yellow-500" /> Whitelisted
                              </span>
                            </SelectItem>
                            <SelectItem value="live">
                              <span className="flex items-center gap-2">
                                <AlertTriangle className="h-3 w-3 text-green-500" /> Live
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <Switch 
                            checked={template.isActive} 
                            onCheckedChange={(checked) => handleToggleActive(template.id, checked)}
                          />
                          <Button variant="outline" size="icon" onClick={() => setPreviewTemplate(template)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => setEditingTemplate(template)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="whitelist" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Approved Recipients</h3>
              <p className="text-sm text-muted-foreground">Messages in "Whitelisted" mode will only be sent to these addresses.</p>
            </div>
            <Button onClick={() => setIsAddWhitelistOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Entry
            </Button>
          </div>

          {whitelistLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Loading whitelist...</CardContent></Card>
          ) : whitelist.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Whitelisted Recipients</h3>
                <p className="text-muted-foreground">Add emails or phone numbers to the whitelist to enable "Whitelisted" mode sending.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {whitelist.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="outline" className="flex items-center gap-1 w-fit">
                          {entry.type === 'email' ? <Mail className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                          {entry.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{entry.value}</TableCell>
                      <TableCell className="text-muted-foreground">{entry.description || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{format(new Date(entry.createdAt), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-red-500 hover:text-red-700"
                          onClick={() => removeWhitelistMutation.mutate(entry.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Message History</h3>
              <p className="text-sm text-muted-foreground">All sent, simulated, and blocked messages are logged here.</p>
            </div>
            <Button variant="outline" onClick={() => refetchLogs()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>

          {logsLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Loading history...</CardContent></Card>
          ) : logs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Messages Yet</h3>
                <p className="text-muted-foreground">Messages will appear here once the system starts sending communications.</p>
              </CardContent>
            </Card>
          ) : (
            <ResizableHistoryTable logs={logs} getModeColor={getModeColor} getStatusColor={getStatusColor} getStatusIcon={getStatusIcon} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isAddWhitelistOpen} onOpenChange={setIsAddWhitelistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Whitelist</DialogTitle>
            <DialogDescription>
              Add an email address or phone number to the approved recipients list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={newWhitelistEntry.type} onValueChange={(v) => setNewWhitelistEntry({ ...newWhitelistEntry, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{newWhitelistEntry.type === 'email' ? 'Email Address' : 'Phone Number'}</Label>
              <Input 
                value={newWhitelistEntry.value}
                onChange={(e) => setNewWhitelistEntry({ ...newWhitelistEntry, value: e.target.value })}
                placeholder={newWhitelistEntry.type === 'email' ? 'user@example.com' : '+1234567890'}
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input 
                value={newWhitelistEntry.description}
                onChange={(e) => setNewWhitelistEntry({ ...newWhitelistEntry, description: e.target.value })}
                placeholder="Why is this whitelisted?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddWhitelistOpen(false)}>Cancel</Button>
            <Button onClick={() => addWhitelistMutation.mutate(newWhitelistEntry)} disabled={!newWhitelistEntry.value}>
              Add to Whitelist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Preview: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Subject</Label>
                <p className="font-medium">{previewTemplate.subject || 'No subject'}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">HTML Preview</Label>
                <div 
                  className="border rounded-lg p-4 bg-white"
                  dangerouslySetInnerHTML={{ __html: previewTemplate.htmlContent || previewTemplate.textContent }}
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Plain Text</Label>
                <pre className="border rounded-lg p-4 bg-muted text-sm whitespace-pre-wrap">{previewTemplate.textContent}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTemplate} onOpenChange={() => setEditingTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template: {editingTemplate?.name}</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <TemplateEditor 
              template={editingTemplate} 
              onSave={(updates) => {
                updateTemplateMutation.mutate({ id: editingTemplate.id, updates });
              }}
              onCancel={() => setEditingTemplate(null)}
              isSaving={updateTemplateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateEditor({ 
  template, 
  onSave, 
  onCancel,
  isSaving 
}: { 
  template: CommunicationTemplate; 
  onSave: (updates: Partial<CommunicationTemplate>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [subject, setSubject] = useState(template.subject || '');
  const [htmlContent, setHtmlContent] = useState(template.htmlContent || '');
  const [textContent, setTextContent] = useState(template.textContent);
  const [description, setDescription] = useState(template.description || '');

  return (
    <div className="space-y-4">
      <div>
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {template.type === 'email' && (
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      {template.type === 'email' && (
        <div>
          <Label>HTML Content</Label>
          <Textarea 
            value={htmlContent} 
            onChange={(e) => setHtmlContent(e.target.value)}
            className="font-mono text-sm min-h-[300px]"
          />
        </div>
      )}
      <div>
        <Label>Plain Text Content</Label>
        <Textarea 
          value={textContent} 
          onChange={(e) => setTextContent(e.target.value)}
          className="font-mono text-sm min-h-[200px]"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button 
          onClick={() => onSave({ 
            description, 
            subject: template.type === 'email' ? subject : null,
            htmlContent: template.type === 'email' ? htmlContent : null,
            textContent 
          })}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
