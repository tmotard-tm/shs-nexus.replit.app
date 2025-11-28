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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { 
  Database, 
  Plus, 
  Save, 
  Trash2, 
  RefreshCw, 
  Key, 
  Link2,
  Table,
  Cloud,
  FileJson,
  Layers,
  Settings,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';
import type { IntegrationDataSource, DataSourceField, MappingSet } from '@shared/schema';

const sourceTypeIcons: Record<string, typeof Database> = {
  snowflake: Cloud,
  holman: Link2,
  internal: Database,
  page_object: FileJson,
};

const sourceTypeColors: Record<string, string> = {
  snowflake: 'bg-blue-500',
  holman: 'bg-green-500',
  internal: 'bg-purple-500',
  page_object: 'bg-orange-500',
};

function DataSourceNode({ data }: { data: { source: IntegrationDataSource; fields: DataSourceField[] } }) {
  const Icon = sourceTypeIcons[data.source.sourceType] || Database;
  const colorClass = sourceTypeColors[data.source.sourceType] || 'bg-gray-500';

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg min-w-[250px] max-w-[300px]">
      <div className={`${colorClass} text-white px-3 py-2 rounded-t-lg flex items-center gap-2`}>
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm truncate">{data.source.displayName}</span>
      </div>
      <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
        {data.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1">No fields defined</p>
        ) : (
          data.fields.map((field, index) => (
            <div 
              key={field.id} 
              className="relative flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted rounded group"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${field.id}-target`}
                className="!w-2 !h-2 !bg-primary !border-2 !border-background"
              />
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {field.isPrimaryKey && <Key className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
                {field.isForeignKey && <Link2 className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                <span className="truncate">{field.displayName}</span>
              </div>
              <Badge variant="outline" className="text-[10px] px-1 py-0 flex-shrink-0">
                {field.dataType}
              </Badge>
              <Handle
                type="source"
                position={Position.Right}
                id={`${field.id}-source`}
                className="!w-2 !h-2 !bg-primary !border-2 !border-background"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  dataSource: DataSourceNode,
};

export default function FieldMapping() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedMappingSet, setSelectedMappingSet] = useState<string | null>(null);
  const [isCreateSetOpen, setIsCreateSetOpen] = useState(false);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetDescription, setNewSetDescription] = useState('');
  const [selectedSourceToAdd, setSelectedSourceToAdd] = useState<string>('');

  const { data: sources = [], isLoading: sourcesLoading } = useQuery<IntegrationDataSource[]>({
    queryKey: ['/api/mapping/sources'],
  });

  const { data: mappingSets = [], isLoading: setsLoading } = useQuery<MappingSet[]>({
    queryKey: ['/api/mapping/sets'],
  });

  const { data: currentSet, isLoading: currentSetLoading } = useQuery<MappingSet & { nodes: any[]; mappings: any[] }>({
    queryKey: ['/api/mapping/sets', selectedMappingSet],
    enabled: !!selectedMappingSet,
  });

  const seedSourcesMutation = useMutation({
    mutationFn: () => apiRequest('/api/mapping/seed-sources', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sources'] });
      toast({ title: 'Data sources seeded successfully' });
    },
    onError: (error: any) => {
      toast({ title: 'Error seeding sources', description: error.message, variant: 'destructive' });
    },
  });

  const createMappingSetMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) => 
      apiRequest('/api/mapping/sets', { method: 'POST', body: JSON.stringify(data) }),
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
    mutationFn: (data: { nodes: any[] }) => 
      apiRequest(`/api/mapping/sets/${selectedMappingSet}/nodes`, { 
        method: 'PUT', 
        body: JSON.stringify(data) 
      }),
    onSuccess: () => {
      toast({ title: 'Layout saved' });
    },
    onError: (error: any) => {
      toast({ title: 'Error saving layout', description: error.message, variant: 'destructive' });
    },
  });

  const saveMappingsMutation = useMutation({
    mutationFn: (data: { mappings: any[] }) => 
      apiRequest(`/api/mapping/sets/${selectedMappingSet}/mappings`, { 
        method: 'PUT', 
        body: JSON.stringify(data) 
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mapping/sets', selectedMappingSet] });
      toast({ title: 'Mappings saved' });
    },
    onError: (error: any) => {
      toast({ title: 'Error saving mappings', description: error.message, variant: 'destructive' });
    },
  });

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      setEdges((eds) => addEdge({
        ...connection,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'hsl(var(--primary))' },
      }, eds));
    }
  }, [setEdges]);

  const loadSourceFields = async (sourceId: string): Promise<DataSourceField[]> => {
    try {
      const response = await fetch(`/api/mapping/sources/${sourceId}/fields`, {
        credentials: 'include',
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Error loading fields:', error);
    }
    return [];
  };

  const addSourceToCanvas = useCallback(async (sourceId: string) => {
    const source = sources.find(s => s.id === sourceId);
    if (!source) return;

    const existingNode = nodes.find(n => n.data.source.id === sourceId);
    if (existingNode) {
      toast({ title: 'Source already on canvas', variant: 'destructive' });
      return;
    }

    const fields = await loadSourceFields(sourceId);
    
    const newNode: Node = {
      id: `source-${sourceId}`,
      type: 'dataSource',
      position: { 
        x: 100 + (nodes.length % 3) * 350, 
        y: 100 + Math.floor(nodes.length / 3) * 400 
      },
      data: { source, fields },
    };

    setNodes((nds) => [...nds, newNode]);
    setIsAddSourceOpen(false);
    setSelectedSourceToAdd('');
  }, [sources, nodes, setNodes, toast]);

  const saveCurrentState = useCallback(() => {
    if (!selectedMappingSet) {
      toast({ title: 'Please select a mapping set first', variant: 'destructive' });
      return;
    }

    const nodesToSave = nodes.map(node => ({
      sourceId: node.data.source.id,
      positionX: node.position.x.toString(),
      positionY: node.position.y.toString(),
      isExpanded: true,
    }));

    const mappingsToSave = edges.map(edge => {
      const sourceFieldId = edge.sourceHandle?.replace('-source', '') || '';
      const targetFieldId = edge.targetHandle?.replace('-target', '') || '';
      return {
        sourceFieldId,
        targetFieldId,
        direction: 'push',
      };
    }).filter(m => m.sourceFieldId && m.targetFieldId);

    saveNodesMutation.mutate({ nodes: nodesToSave });
    saveMappingsMutation.mutate({ mappings: mappingsToSave });
  }, [selectedMappingSet, nodes, edges, saveNodesMutation, saveMappingsMutation, toast]);

  useEffect(() => {
    const loadSetData = async () => {
      if (currentSet && currentSet.nodes) {
        const loadedNodes: Node[] = [];
        
        for (const savedNode of currentSet.nodes) {
          const source = sources.find(s => s.id === savedNode.sourceId);
          if (source) {
            const fields = await loadSourceFields(source.id);
            loadedNodes.push({
              id: `source-${source.id}`,
              type: 'dataSource',
              position: { 
                x: parseFloat(savedNode.positionX) || 100, 
                y: parseFloat(savedNode.positionY) || 100 
              },
              data: { source, fields },
            });
          }
        }
        
        setNodes(loadedNodes);

        if (currentSet.mappings) {
          const loadedEdges: Edge[] = currentSet.mappings.map((mapping: any, index: number) => ({
            id: `edge-${index}`,
            source: loadedNodes.find(n => 
              n.data.fields?.some((f: DataSourceField) => f.id === mapping.sourceFieldId)
            )?.id || '',
            target: loadedNodes.find(n => 
              n.data.fields?.some((f: DataSourceField) => f.id === mapping.targetFieldId)
            )?.id || '',
            sourceHandle: `${mapping.sourceFieldId}-source`,
            targetHandle: `${mapping.targetFieldId}-target`,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: 'hsl(var(--primary))' },
          })).filter((e: Edge) => e.source && e.target);

          setEdges(loadedEdges);
        }
      }
    };

    if (currentSet && sources.length > 0) {
      loadSetData();
    }
  }, [currentSet, sources, setNodes, setEdges]);

  const availableSourcesToAdd = sources.filter(
    s => !nodes.some(n => n.data.source.id === s.id)
  );

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" />
            Field Mapping
          </h1>
          <p className="text-muted-foreground">
            Visually map fields between databases and integrations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => seedSourcesMutation.mutate()}
            disabled={seedSourcesMutation.isPending}
            data-testid="button-seed-sources"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${seedSourcesMutation.isPending ? 'animate-spin' : ''}`} />
            Seed Sources
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label>Mapping Set:</Label>
          <Select value={selectedMappingSet || ''} onValueChange={setSelectedMappingSet}>
            <SelectTrigger className="w-[250px]" data-testid="select-mapping-set">
              <SelectValue placeholder="Select a mapping set" />
            </SelectTrigger>
            <SelectContent>
              {mappingSets.map((set) => (
                <SelectItem key={set.id} value={set.id}>
                  {set.name}
                </SelectItem>
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
            <DialogHeader>
              <DialogTitle>Create Mapping Set</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input 
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                  placeholder="e.g., Offboarding Data Flow"
                  data-testid="input-set-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input 
                  value={newSetDescription}
                  onChange={(e) => setNewSetDescription(e.target.value)}
                  placeholder="Describe the purpose of this mapping"
                  data-testid="input-set-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => createMappingSetMutation.mutate({ 
                  name: newSetName, 
                  description: newSetDescription 
                })}
                disabled={!newSetName || createMappingSetMutation.isPending}
                data-testid="button-confirm-create-set"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isAddSourceOpen} onOpenChange={setIsAddSourceOpen}>
          <DialogTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              disabled={!selectedMappingSet}
              data-testid="button-add-source"
            >
              <Database className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Data Source to Canvas</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Select value={selectedSourceToAdd} onValueChange={setSelectedSourceToAdd}>
                <SelectTrigger data-testid="select-source-to-add">
                  <SelectValue placeholder="Select a data source" />
                </SelectTrigger>
                <SelectContent>
                  {availableSourcesToAdd.map((source) => {
                    const Icon = sourceTypeIcons[source.sourceType] || Database;
                    return (
                      <SelectItem key={source.id} value={source.id}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {source.displayName}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => addSourceToCanvas(selectedSourceToAdd)}
                disabled={!selectedSourceToAdd}
                data-testid="button-confirm-add-source"
              >
                Add to Canvas
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex-1" />

        <Button 
          onClick={saveCurrentState}
          disabled={!selectedMappingSet || saveNodesMutation.isPending || saveMappingsMutation.isPending}
          data-testid="button-save-mapping"
        >
          <Save className="h-4 w-4 mr-2" />
          Save Mapping
        </Button>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0 h-full">
          {!selectedMappingSet ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-4">
                <Layers className="h-16 w-16 mx-auto opacity-50" />
                <p>Select or create a mapping set to get started</p>
                <Button variant="outline" onClick={() => setIsCreateSetOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Mapping Set
                </Button>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              className="bg-muted/30"
            >
              <Background />
              <Controls />
              <MiniMap 
                nodeColor={(node) => {
                  const colorClass = sourceTypeColors[node.data?.source?.sourceType] || 'bg-gray-500';
                  return colorClass.replace('bg-', '').replace('-500', '');
                }}
              />
              <Panel position="top-right" className="bg-card/90 backdrop-blur p-2 rounded-lg shadow-lg">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-blue-500" />
                    <span>Snowflake</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-green-500" />
                    <span>Holman</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-purple-500" />
                    <span>Internal</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-orange-500" />
                    <span>Page</span>
                  </div>
                </div>
              </Panel>
              {nodes.length === 0 && (
                <Panel position="top-left" className="bg-card/90 backdrop-blur p-4 rounded-lg shadow-lg m-4">
                  <p className="text-sm text-muted-foreground">
                    Click "Add Source" to add data sources to the canvas, then drag connections between fields.
                  </p>
                </Panel>
              )}
            </ReactFlow>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Available Data Sources</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => {
              const Icon = sourceTypeIcons[source.sourceType] || Database;
              const isOnCanvas = nodes.some(n => n.data.source.id === source.id);
              return (
                <Badge 
                  key={source.id} 
                  variant={isOnCanvas ? "default" : "outline"}
                  className="flex items-center gap-1 cursor-pointer"
                  onClick={() => !isOnCanvas && selectedMappingSet && addSourceToCanvas(source.id)}
                  data-testid={`badge-source-${source.name}`}
                >
                  <Icon className="h-3 w-3" />
                  {source.displayName}
                  {isOnCanvas && <span className="text-[10px]">(on canvas)</span>}
                </Badge>
              );
            })}
            {sources.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No data sources yet. Click "Seed Sources" to add default sources.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
