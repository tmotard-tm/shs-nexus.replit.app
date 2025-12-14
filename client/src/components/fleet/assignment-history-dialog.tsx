import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, History, Calendar, User, Truck } from "lucide-react";
import { format } from "date-fns";

interface AssignmentHistoryEntry {
  id: number;
  techRacfid: string;
  truckNo: string;
  action: string;
  notes?: string;
  performedBy?: string;
  createdAt: string;
}

interface AssignmentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  techRacfid: string;
  techName: string;
}

export function AssignmentHistoryDialog({ 
  open, 
  onOpenChange, 
  techRacfid, 
  techName 
}: AssignmentHistoryDialogProps) {
  const { data: historyResult, isLoading } = useQuery<{ success: boolean; data: AssignmentHistoryEntry[] }>({
    queryKey: ['/api/vehicle-assignments/history', techRacfid],
    enabled: open && !!techRacfid,
  });

  const history = historyResult?.data || [];

  const getActionBadge = (action: string) => {
    switch (action.toLowerCase()) {
      case 'assign':
      case 'assigned':
        return <Badge className="bg-green-100 text-green-800">Assigned</Badge>;
      case 'unassign':
      case 'unassigned':
        return <Badge className="bg-red-100 text-red-800">Unassigned</Badge>;
      case 'transfer':
        return <Badge className="bg-blue-100 text-blue-800">Transferred</Badge>;
      case 'sync':
        return <Badge className="bg-purple-100 text-purple-800">Synced</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Assignment History
          </DialogTitle>
          <DialogDescription>
            Vehicle assignment history for {techName} ({techRacfid})
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading history...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No assignment history found for this technician.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((entry) => (
              <div 
                key={entry.id} 
                className="border rounded-lg p-4 space-y-2"
                data-testid={`history-entry-${entry.id}`}
              >
                <div className="flex items-center justify-between">
                  {getActionBadge(entry.action)}
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Tech:</span>
                    <span className="font-mono">{entry.techRacfid}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Truck:</span>
                    <span className="font-mono">{entry.truckNo || '-'}</span>
                  </div>
                </div>
                
                {entry.notes && (
                  <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
                    {entry.notes}
                  </div>
                )}
                
                {entry.performedBy && (
                  <div className="text-xs text-muted-foreground">
                    Performed by: {entry.performedBy}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
