import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Pencil, Check, X } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

interface RateConfig {
  key: string;
  value: string;
  label: string;
  updatedAt: string;
  updatedBy: string | null;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function RateRow({ row }: { row: RateConfig }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.value);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      apiRequest("PUT", `/api/vrm/settings/rates/${row.key}`, { value: Number(value) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/rates"] });
      setEditing(false);
    },
  });

  function handleSave() {
    const n = Number(draft);
    if (isNaN(n) || n < 0) return;
    mutation.mutate(draft);
  }

  function handleCancel() {
    setDraft(row.value);
    setEditing(false);
  }

  const cellStyle: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    fontFamily: fonts.dmSans,
    color: colors.ink,
    fontSize: 14,
    verticalAlign: "middle",
  };

  return (
    <tr>
      <td style={cellStyle}>{row.label}</td>
      <td style={{ ...cellStyle, fontFamily: fonts.jetbrains }}>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: colors.inkMuted }}>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                width: 90,
                padding: "4px 8px",
                border: `1px solid ${colors.accent}`,
                borderRadius: 4,
                fontFamily: fonts.jetbrains,
                fontSize: 14,
                color: colors.ink,
                background: colors.surface,
                outline: "none",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
          </div>
        ) : (
          <span>${Number(row.value).toFixed(2)}</span>
        )}
      </td>
      <td style={{ ...cellStyle, color: colors.inkMuted, fontSize: 12 }}>
        {row.updatedAt ? fmtDate(row.updatedAt) : "—"}
        {row.updatedBy ? ` · ${row.updatedBy}` : ""}
      </td>
      <td style={{ ...cellStyle, width: 100 }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 4,
                border: "none",
                background: colors.green,
                color: "#fff",
                fontFamily: fonts.dmSans,
                fontSize: 13,
                cursor: "pointer",
                opacity: mutation.isPending ? 0.6 : 1,
              }}
            >
              <Check size={12} />
              Save
            </button>
            <button
              onClick={handleCancel}
              disabled={mutation.isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: 4,
                border: `1px solid ${colors.rule}`,
                background: "transparent",
                color: colors.inkMuted,
                fontFamily: fonts.dmSans,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setDraft(row.value);
              setEditing(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              fontFamily: fonts.dmSans,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

export default function Settings() {
  const { data: rates = [], isLoading, error } = useQuery<RateConfig[]>({
    queryKey: ["/api/vrm/settings/rates"],
  });

  const containerStyle: React.CSSProperties = {
    padding: "32px 40px",
    maxWidth: 820,
    fontFamily: fonts.dmSans,
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: fonts.syne,
    fontSize: 22,
    fontWeight: 700,
    color: colors.ink,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  const subheadStyle: React.CSSProperties = {
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 6,
    marginBottom: 28,
  };

  const cardStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.rule}`,
    borderRadius: 8,
    overflow: "hidden",
  };

  const thStyle: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "left",
    fontFamily: fonts.dmSans,
    fontSize: 12,
    fontWeight: 600,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    background: colors.background,
    borderBottom: `1px solid ${colors.rule}`,
  };

  return (
    <div style={containerStyle}>
      <h1 style={headingStyle}>
        <Settings2 size={20} color={colors.accent} />
        Settings
      </h1>
      <p style={subheadStyle}>
        Manage the financial rate assumptions used in profitability calculations. Changes take effect on the next evaluation run — no redeployment needed.
      </p>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 0 }}>
        Financial Rate Assumptions
      </h2>

      <div style={cardStyle}>
        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading rates…
          </div>
        )}
        {error && (
          <div style={{ padding: 32, textAlign: "center", color: colors.red, fontSize: 14 }}>
            Failed to load rate config.
          </div>
        )}
        {!isLoading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Current Value</th>
                <th style={thStyle}>Last Updated</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((row) => (
                <RateRow key={row.key} row={row} />
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
                    No rate configuration found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 12, color: colors.inkMuted, marginTop: 16 }}>
        These values replace hardcoded constants in the Snowflake profitability query. The fuel rate is applied per completed service order; the rental rate is applied per working day.
      </p>
    </div>
  );
}
