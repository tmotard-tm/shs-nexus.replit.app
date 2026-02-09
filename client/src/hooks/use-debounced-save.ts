import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseDebouncedSaveOptions {
  itemId: string;
  module?: string;
  debounceMs?: number;
  onError?: (error: Error) => void;
}

interface ProgressData {
  taskToolsReturn?: boolean;
  taskIphoneReturn?: boolean;
  taskDisconnectedLine?: boolean;
  taskDisconnectedMPayment?: boolean;
  taskCloseSegnoOrders?: boolean;
  taskCreateShippingLabel?: boolean;
  carrier?: string | null;
  fleetRoutingDecision?: string | null;
}

export function useDebouncedSave({ itemId, module = 'tools', debounceMs = 500, onError }: UseDebouncedSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDataRef = useRef<ProgressData>({});

  const endpoint = `/api/${module}-queue/${itemId}/save-progress`;

  const mutation = useMutation({
    mutationFn: async (data: ProgressData) => {
      const response = await apiRequest("PATCH", endpoint, data);
      if (!response.ok) {
        throw new Error("Failed to save progress");
      }
      return response.json();
    },
    onSuccess: () => {
      setSaveStatus("saved");
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key.startsWith(`/api/${module}-queue`) ||
            key.startsWith("/api/queues")
          );
        },
      });
      setTimeout(() => {
        setSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, 2000);
    },
    onError: (error: Error) => {
      setSaveStatus("error");
      onError?.(error);
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    },
  });

  const flushPending = useCallback(() => {
    if (Object.keys(pendingDataRef.current).length > 0) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const dataToSave = { ...pendingDataRef.current };
      pendingDataRef.current = {};
      mutation.mutate(dataToSave);
    }
  }, [mutation]);

  const save = useCallback((data: ProgressData) => {
    pendingDataRef.current = { ...pendingDataRef.current, ...data };

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setSaveStatus("saving");
    
    timeoutRef.current = setTimeout(() => {
      const dataToSave = { ...pendingDataRef.current };
      pendingDataRef.current = {};
      mutation.mutate(dataToSave);
    }, debounceMs);
  }, [debounceMs, mutation]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (Object.keys(pendingDataRef.current).length > 0) {
        const dataToSave = { ...pendingDataRef.current };
        pendingDataRef.current = {};
        navigator.sendBeacon?.(
          endpoint,
          new Blob([JSON.stringify(dataToSave)], { type: 'application/json' })
        );
      }
    };
  }, [itemId]);

  return { save, saveStatus, isPending: mutation.isPending, flushPending };
}
