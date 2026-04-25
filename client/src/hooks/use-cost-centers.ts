import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DistrictCostCenter } from "@shared/schema";

export function padDistrict(input: string | number | null | undefined): string {
  const digits = String(input ?? "").trim().replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(7, "0").slice(-7);
}

export function useCostCenters() {
  const { data: items = [], isLoading } = useQuery<DistrictCostCenter[]>({
    queryKey: ["/api/cost-centers"],
  });

  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of items) {
      if (item?.district && item?.costCenter) {
        m.set(padDistrict(item.district), item.costCenter);
      }
    }
    return m;
  }, [items]);

  const lookupCostCenter = useMemo(
    () =>
      (district: string | number | null | undefined): string | undefined => {
        const padded = padDistrict(district);
        if (!padded) return undefined;
        return map.get(padded);
      },
    [map],
  );

  return { items, isLoading, lookupCostCenter };
}
