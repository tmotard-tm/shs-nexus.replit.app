type SystemName = 'holman' | 'tpms' | 'snowflake' | 'display';

export function normalizeEnterpriseId(id: string | null | undefined): string {
  if (!id) return '';
  return id.trim().toUpperCase();
}

export function toHolmanRef(n: string | number | null | undefined): string {
  const c = toCanonical(n);
  return c ? c.padStart(6, '0') : '';
}

export function toTpmsRef(n: string | number | null | undefined): string {
  const c = toCanonical(n);
  return c ? c.padStart(6, '0') : '';
}

export function toDisplayNumber(n: string | number | null | undefined): string {
  const c = toCanonical(n);
  return c ? c.padStart(5, '0') : '';
}

export function toCanonical(n: string | number | null | undefined): string {
  if (n == null) return '';
  const s = String(n).trim();
  if (!s) return '';
  return s.replace(/^0+/, '') || '0';
}

export function toSnowflakeRef(n: string | number | null | undefined): string {
  if (n == null) return '';
  return String(n).trim();
}

export function formatForSystem(n: string | number | null | undefined, system: SystemName): string {
  switch (system) {
    case 'holman': return toHolmanRef(n);
    case 'tpms': return toTpmsRef(n);
    case 'snowflake': return toSnowflakeRef(n);
    case 'display': return toDisplayNumber(n);
  }
}
