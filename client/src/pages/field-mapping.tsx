import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Handle,
  Position,
  Panel,
  MiniMap,
  MarkerType,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Database,
  Plus,
  Save,
  RefreshCw,
  Key,
  Link2,
  Table,
  Cloud,
  FileJson,
  Layers,
  Search,
  Server,
  Snowflake,
  FileUp,
} from 'lucide-react';
import type { IntegrationDataSource, DataSourceField, MappingSet } from '@shared/schema';

const sourceTypeIcons: Record<string, typeof Database> = {
  snowflake: Cloud,
  holman: Link2,
  internal: Database,
  page_object: FileJson,
  tpms: Table,
  db_table: Database,
  api_endpoint: Server,
  snowflake_query: Snowflake,
  file_import: FileUp,
};

const sourceTypeColors: Record<string, string> = {
  snowflake: 'bg-blue-500',
  holman: 'bg-green-500',
  internal: 'bg-purple-500',
  page_object: 'bg-orange-500',
  tpms: 'bg-cyan-500',
  db_table: 'bg-emerald-600',
  api_endpoint: 'bg-indigo-500',
  snowflake_query: 'bg-sky-500',
  file_import: 'bg-amber-500',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  db_table: 'DB Tables',
  api_endpoint: 'API Endpoints',
  snowflake_query: 'Snowflake Queries',
  file_import: 'File Imports',
  snowflake: 'Snowflake',
  holman: 'Holman',
  internal: 'Internal',
  page_object: 'Page',
  tpms: 'TPMS',
};

type NodeData = {
  source: IntegrationDataSource;
  fields: DataSourceField[];
  dimmed?: boolean;
  stale?: boolean;
};

function isStale(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    return !!JSON.parse(metadata).stale;
  } catch {
    return false;
  }
}

function DataSourceNode({ data }: { data: NodeData }) {
  const Icon = sourceTypeIcons[data.source.sourceType] || Database;
  const colorClass = sourceTypeColors[data.source.sourceType] || 'bg-gray-500';
  const conn = (() => {
    try {
      return data.source.connectionInfo ? JSON.parse(data.source.connectionInfo) : null;
    } catch {
      return null;
    }
  })();

  return (
    <div
      className={`bg-card border border-border rounded-lg shadow-lg min-w-[280px] max-w-[340px] transition-opacity ${
        data.dimmed ? 'opacity-30' : 'opacity-100'
      }`}
    >
      <div className={`${colorClass} text-white px-3 py-2 rounded-t-lg flex items-center gap-2`}>
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm truncate flex-1">{data.source.displayName}</span>
        {data.stale && (
          <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100 text-[10px] border-yellow-400">
            stale
          </Badge>
        )}
      </div>
      {conn && (data.source.sourceType === 'api_endpoint' || data.source.sourceType === 'snowflake_query' || data.source.sourceType === 'file_import') && (
        <div className="px-3 py-1 border-b border-border text-[10px] text-muted-foreground truncate">
          {data.source.sourceType === 'api_endpoint' && `${conn.method} ${conn.path}`}
          {data.source.sourceType === 'snowflake_query' && `FROM ${conn.fromTable}`}
          {data.source.sourceType === 'file_import' && `${conn.parser} → ${conn.route}`}
        </div>
      )}
      <div className="p-2 space-y-0.5 max-h-[350px] overflow-y-auto">
        {data.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1">No fields defined</p>
        ) : (
          data.fields.map((field) => {
            const fieldStale = isStale(field.metadata);
            return (
              <div
                key={field.id}
                className={`relative flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-muted/50 rounded-sm group transition-colors ${
                  fieldStale ? 'opacity-50' : ''
                }`}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${field.id}-target`}
                  isConnectable={true}
                  className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!bg-primary/80 hover:!scale-125 transition-transform !-left-1.5"
                  style={{ pointerEvents: 'auto' }}
                />
                <div className="flex items-center gap-1.5 flex-1 min-w-0 pointer-events-none select-none">
                  {field.isPrimaryKey && <Key className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
                  {field.isForeignKey && <Link2 className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                  <span className="truncate font-medium">{field.displayName}</span>
                  {fieldStale && <span className="text-[9px] text-yellow-600">(stale)</span>}
                </div>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 pointer-events-none">
                  {field.dataType}
                </Badge>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${field.id}-source`}
                  isConnectable={true}
                  className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!bg-primary/80 hover:!scale-125 transition-transform !-right-1.5"
                  style={{ pointerEvents: 'auto' }}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const nodeTypes = { dataSource: DataSourceNode };

type AppNode = Node<NodeData>;
type AppEdge = Edge;

const ALL_FILTER_TYPES = ['db_table', 'api_endpoint', 'snowflake_query', 'file_import', 'snowflake', 'holman', 'internal', 'page_object', 'tpms'];

export default function FieldMapping() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>([]);
  const [selectedMappingSet, setSelectedMappingSet] = useState<string | null>(null);
  const [isCreateSetOpen, setIsCreateSetOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetDescription, setNewSetDescription] = useState('');

  const [searchText, setSearchText] = useState('');
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(ALL_FILTER_TYPES));

  const { data: sources = [] } = useQuery<IntegrationDataSource[]>({
    queryKey: ['/api/mapping/sources'],
  });

  const { data: mappingSets = [] } = useQuery<MappingSet[]>({
    queryKey: ['/api/mapping/sets'],
  });

  const { data: currentSet } = useQuery<MappingSet & { nodes: any[]; mappings: any[] }>({
    queryKey: ['/api/mapping/sets', selectedMappingSet],
    enabled: !!selectedMappingSet,
  });

  const refreshDiscoveryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/field-mapping/refresh-discovery');
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sources'] });
      if (selectedMappingSet) {
        queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets', selectedMappingSet] });
      }
      const c = data.counts || {};
      toast({
        title: 'Discovery complete',
        description: `${c.db_table ?? 0} tables · ${c.api_endpoint ?? 0} endpoints · ${c.snowflake_query ?? 0} SQL queries · ${c.file_import ?? 0} imports`,
      });
    },
    onError: (error: any) => {
      toast({ title: 'Discovery failed', description: error.message, variant: 'destructive' });
    },
  });

  const createMappingSetMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await apiRequest('POST', '/api/mapping/sets', data);
      return res.json() as Promise<MappingSet>;
    },
    onSuccess: (newSet: MappingSet) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets'] });
      setSelectedMappingSet(newSet.id);
      setIsCreateSetOpen(false);
      setNewSetName('');
      setNewSetDescription('');
      toast({ title: 'Mapping set created' });
    },
    onError: (error: any) => {
      toast({ title: 'Error creating mapping set', description: error.message, variant: 'destructive' });
    },
  });

  const saveNodesMutation = useMutation({
    mutationFn: async (data: { nodes: any[] }) => {
      const res = await apiRequest('PUT', `/api/mapping/sets/${selectedMappingSet}/nodes`, data);
      return res.json();
    },
    onSuccess: () => toast({ title: 'Layout saved' }),
    onError: (error: any) => toast({ title: 'Error saving layout', description: error.message, variant: 'destructive' }),
  });

  const createMappingMutation = useMutation({
    mutationFn: async (data: { sourceFieldId: string; targetFieldId: string; direction: string }) => {
      const res = await apiRequest('POST', `/api/mapping/sets/${selectedMappingSet}/mappings`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets', selectedMappingSet] });
      toast({ title: 'Mapping saved' });
    },
    onError: (error: any) => {
      toast({ title: 'Error saving mapping', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const res = await apiRequest('DELETE', `/api/mapping/mappings/${mappingId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets', selectedMappingSet] });
      toast({ title: 'Mapping deleted' });
    },
    onError: (error: any) => {
      toast({ title: 'Error deleting mapping', description: error.message, variant: 'destructive' });
    },
  });

  const updateMappingDirectionMutation = useMutation({
    mutationFn: async ({ mappingId, direction }: { mappingId: string; direction: string }) => {
      // Convenient: re-create via DELETE + POST? Use a dedicated PATCH if it exists; otherwise
      // upsert via PUT /api/mapping/sets/:id/mappings. Simpler: hit the existing bulk PUT with
      // the full set of mappings preserving IDs is not supported, so we expose direction via
      // DELETE+POST.
      await apiRequest('DELETE', `/api/mapping/mappings/${mappingId}`);
      // POST will be issued by caller after we know source/target field ids.
      return { mappingId, direction };
    },
  });

  const [editingEdge, setEditingEdge] = useState<AppEdge | null>(null);
  const [editingDirection, setEditingDirection] = useState<string>('push');

  const onEdgesDelete = useCallback(
    (deletedEdges: AppEdge[]) => {
      for (const edge of deletedEdges) {
        const mappingId = (edge.data as any)?.mappingId;
        if (mappingId) deleteMappingMutation.mutate(mappingId);
      }
    },
    [deleteMappingMutation]
  );

  const onEdgeClick = useCallback((_evt: any, edge: AppEdge) => {
    setEditingEdge(edge);
    setEditingDirection(((edge.data as any)?.direction as string) || 'push');
  }, []);

  const saveEdgeDirection = useCallback(() => {
    if (!editingEdge || !selectedMappingSet) return;
    const mappingId = (editingEdge.data as any)?.mappingId;
    const sourceFieldId = editingEdge.sourceHandle?.replace(/-source$/, '');
    const targetFieldId = editingEdge.targetHandle?.replace(/-target$/, '');
    if (!mappingId || !sourceFieldId || !targetFieldId) {
      setEditingEdge(null);
      return;
    }
    (async () => {
      try {
        await apiRequest('DELETE', `/api/mapping/mappings/${mappingId}`);
        await apiRequest('POST', `/api/mapping/sets/${selectedMappingSet}/mappings`, {
          sourceFieldId,
          targetFieldId,
          direction: editingDirection,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets', selectedMappingSet] });
        toast({ title: `Direction set to ${editingDirection}` });
      } catch (e: any) {
        toast({ title: 'Failed to update direction', description: e.message, variant: 'destructive' });
      } finally {
        setEditingEdge(null);
      }
    })();
  }, [editingEdge, editingDirection, selectedMappingSet, toast]);

  const deleteEditingEdge = useCallback(() => {
    if (!editingEdge) return;
    const mappingId = (editingEdge.data as any)?.mappingId;
    if (mappingId) deleteMappingMutation.mutate(mappingId);
    setEdges((eds) => eds.filter((e) => e.id !== editingEdge.id));
    setEditingEdge(null);
  }, [editingEdge, deleteMappingMutation, setEdges]);

  const { data: discoveryStatus } = useQuery<Record<string, { lastRun: string | null; count: number }>>({
    queryKey: ['/api/field-mapping/discovery-status'],
    refetchOnWindowFocus: false,
  });

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (!connection.sourceHandle || !connection.targetHandle) return;
      const sourceFieldId = connection.sourceHandle.replace(/-source$/, '');
      const targetFieldId = connection.targetHandle.replace(/-target$/, '');
      if (!sourceFieldId || !targetFieldId) return;

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: 'hsl(var(--primary))' },
          },
          eds
        )
      );

      if (selectedMappingSet) {
        createMappingMutation.mutate({ sourceFieldId, targetFieldId, direction: 'push' });
      } else {
        toast({ title: 'Select a mapping set first to persist mappings', variant: 'destructive' });
      }
    },
    [setEdges, selectedMappingSet, createMappingMutation, toast]
  );

  const loadSourceFields = async (sourceId: string): Promise<DataSourceField[]> => {
    try {
      const response = await fetch(`/api/mapping/sources/${sourceId}/fields`, { credentials: 'include' });
      if (response.ok) return await response.json();
    } catch (error) {
      console.error('Error loading fields:', error);
    }
    return [];
  };

  // Auto-populate canvas with all sources when a mapping set is loaded
  useEffect(() => {
    const loadSetData = async () => {
      if (!currentSet || sources.length === 0) return;

      const positionsBySourceId = new Map<string, { x: number; y: number; isExpanded: boolean }>();
      for (const sn of currentSet.nodes || []) {
        positionsBySourceId.set(sn.sourceId, {
          x: parseFloat(sn.positionX) || 0,
          y: parseFloat(sn.positionY) || 0,
          isExpanded: sn.isExpanded !== false,
        });
      }

      // Determine which sources should be on canvas. Default = all known sources.
      const visibleSources = sources.filter((s) => enabledTypes.has(s.sourceType));

      const loadedNodes: AppNode[] = [];
      let idx = 0;
      for (const source of visibleSources) {
        const fields = await loadSourceFields(source.id);
        const saved = positionsBySourceId.get(source.id);
        loadedNodes.push({
          id: `source-${source.id}`,
          type: 'dataSource',
          position: saved
            ? { x: saved.x, y: saved.y }
            : { x: 80 + (idx % 5) * 360, y: 80 + Math.floor(idx / 5) * 420 },
          data: {
            source,
            fields,
            stale: isStale(source.metadata),
          },
        });
        idx++;
      }
      setNodes(loadedNodes);

      const loadedEdges: AppEdge[] = (currentSet.mappings || [])
        .map((mapping: any, i: number) => {
          const sourceNode = loadedNodes.find((n) => n.data.fields?.some((f) => f.id === mapping.sourceFieldId));
          const targetNode = loadedNodes.find((n) => n.data.fields?.some((f) => f.id === mapping.targetFieldId));
          if (!sourceNode || !targetNode) return null;
          return {
            id: `edge-${mapping.id || i}`,
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: `${mapping.sourceFieldId}-source`,
            targetHandle: `${mapping.targetFieldId}-target`,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: 'hsl(var(--primary))' },
            data: { mappingId: mapping.id, direction: mapping.direction },
          } as AppEdge;
        })
        .filter(Boolean) as AppEdge[];
      setEdges(loadedEdges);
    };

    loadSetData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSet, sources, enabledTypes]);

  // Apply search filter via dimming
  const dimmedNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.map((n) => {
      const match =
        n.data.source.name.toLowerCase().includes(q) ||
        n.data.source.displayName.toLowerCase().includes(q) ||
        n.data.fields.some(
          (f) => f.fieldName.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q)
        );
      return { ...n, data: { ...n.data, dimmed: !match } };
    });
  }, [nodes, searchText]);

  const saveLayout = useCallback(() => {
    if (!selectedMappingSet) return;
    const nodesToSave = nodes.map((node) => ({
      sourceId: node.data.source.id,
      positionX: node.position.x.toString(),
      positionY: node.position.y.toString(),
      isExpanded: true,
    }));
    saveNodesMutation.mutate({ nodes: nodesToSave });
  }, [selectedMappingSet, nodes, saveNodesMutation]);

  const toggleType = (t: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sources) counts[s.sourceType] = (counts[s.sourceType] || 0) + 1;
    return counts;
  }, [sources]);

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" />
            Data Lineage Canvas
          </h1>
          <p className="text-muted-foreground">
            Auto-discovered tables, endpoints, Snowflake queries, and file imports. Drag between handles to declare mappings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground text-right" data-testid="discovery-status">
            {discoveryStatus && Object.values(discoveryStatus).some((d) => d.lastRun) ? (
              <>
                {(['db_table', 'api_endpoint', 'snowflake_query', 'file_import'] as const).map((k) => (
                  <div key={k}>
                    {SOURCE_TYPE_LABELS[k]}: {discoveryStatus[k]?.count ?? 0}
                    {discoveryStatus[k]?.lastRun && (
                      <span className="ml-1 opacity-70">
                        ({new Date(discoveryStatus[k]!.lastRun!).toLocaleTimeString()})
                      </span>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <span>No discovery run yet</span>
            )}
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={() => refreshDiscoveryMutation.mutate()}
            disabled={refreshDiscoveryMutation.isPending}
            data-testid="button-refresh-discovery"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshDiscoveryMutation.isPending ? 'animate-spin' : ''}`} />
            Refresh from code
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label>Mapping Set:</Label>
          <Select value={selectedMappingSet || ''} onValueChange={setSelectedMappingSet}>
            <SelectTrigger className="w-[250px]" data-testid="select-mapping-set">
              <SelectValue placeholder="Select a mapping set" />
            </SelectTrigger>
            <SelectContent>
              {mappingSets.map((set) => (
                <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isCreateSetOpen} onOpenChange={setIsCreateSetOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-create-set">
              <Plus className="h-4 w-4 mr-2" />
              New Set
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Mapping Set</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={newSetName} onChange={(e) => setNewSetName(e.target.value)} placeholder="e.g., Vehicle Lineage" data-testid="input-set-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={newSetDescription} onChange={(e) => setNewSetDescription(e.target.value)} data-testid="input-set-description" />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMappingSetMutation.mutate({ name: newSetName, description: newSetDescription })}
                disabled={!newSetName || createMappingSetMutation.isPending}
                data-testid="button-confirm-create-set"
              >Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search nodes / fields…"
            className="pl-8 w-[260px]"
            data-testid="input-search"
          />
        </div>

        <div className="flex-1" />

        <Button onClick={saveLayout} disabled={!selectedMappingSet || saveNodesMutation.isPending} variant="outline" data-testid="button-save-layout">
          <Save className="h-4 w-4 mr-2" />
          Save Layout
        </Button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <Card className="w-[220px] flex-shrink-0">
          <CardHeader className="py-3"><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
          <CardContent className="space-y-2 py-2">
            {ALL_FILTER_TYPES.filter((t) => (typeCounts[t] ?? 0) > 0).map((t) => {
              const Icon = sourceTypeIcons[t] || Database;
              return (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`filter-${t}`}>
                  <Checkbox checked={enabledTypes.has(t)} onCheckedChange={() => toggleType(t)} />
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1">{SOURCE_TYPE_LABELS[t] || t}</span>
                  <span className="text-xs text-muted-foreground">{typeCounts[t] ?? 0}</span>
                </label>
              );
            })}
            {sources.length === 0 && (
              <p className="text-xs text-muted-foreground">No sources discovered yet. Click "Refresh from code".</p>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardContent className="p-0 h-full">
            {!selectedMappingSet ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center space-y-4">
                  <Layers className="h-16 w-16 mx-auto opacity-50" />
                  <p>Select or create a mapping set to view the lineage canvas</p>
                  <Button variant="outline" onClick={() => setIsCreateSetOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create New Mapping Set
                  </Button>
                </div>
              </div>
            ) : (
              <ReactFlow
                nodes={dimmedNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgesDelete={onEdgesDelete}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                fitView
                className="bg-muted/30"
                connectionLineType={ConnectionLineType.SmoothStep}
                connectionLineStyle={{ stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                defaultEdgeOptions={{
                  type: 'smoothstep',
                  animated: true,
                  markerEnd: { type: MarkerType.ArrowClosed },
                  style: { stroke: 'hsl(var(--primary))' },
                }}
                snapToGrid
                snapGrid={[10, 10]}
              >
                <Background />
                <Controls />
                <MiniMap
                  nodeColor={(node) => {
                    const nodeData = node.data as NodeData | undefined;
                    const colorClass = sourceTypeColors[nodeData?.source?.sourceType || ''] || 'bg-gray-500';
                    return colorClass.replace('bg-', '').replace('-500', '').replace('-600', '');
                  }}
                />
                <Panel position="top-right" className="bg-card/90 backdrop-blur p-2 rounded-lg shadow-lg">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap max-w-[420px]">
                    {(['db_table', 'api_endpoint', 'snowflake_query', 'file_import'] as const).map((t) => (
                      <div key={t} className="flex items-center gap-1">
                        <div className={`w-3 h-3 rounded ${sourceTypeColors[t]}`} />
                        <span>{SOURCE_TYPE_LABELS[t]}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
                {nodes.length === 0 && (
                  <Panel position="top-left" className="bg-card/90 backdrop-blur p-4 rounded-lg shadow-lg m-4">
                    <p className="text-sm text-muted-foreground">
                      No sources visible. Click "Refresh from code" or adjust filters.
                    </p>
                  </Panel>
                )}
              </ReactFlow>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingEdge} onOpenChange={(o) => !o && setEditingEdge(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Mapping</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={editingDirection} onValueChange={setEditingDirection}>
                <SelectTrigger data-testid="select-edge-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="push">push (source → target)</SelectItem>
                  <SelectItem value="pull">pull (target → source)</SelectItem>
                  <SelectItem value="bidirectional">bidirectional</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={deleteEditingEdge} data-testid="button-delete-edge">
              Delete Mapping
            </Button>
            <Button onClick={saveEdgeDirection} data-testid="button-save-edge-direction">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
