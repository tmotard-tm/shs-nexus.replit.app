import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Pencil, Check, X, History, Mail, AlertTriangle } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

interface RateConfig {
  key: string;
  value: string;
  label: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface RateConfigHistory {
  id: number;
  key: string;
  previousValue: string | null;
  newValue: string;
  changedBy: string | null;
  changedAt: string;
}

const RATE_LABELS: Record<string, string> = {
  fuel_per_complete: "Fuel per complete",
  rental_per_day: "Rental per day",
};

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
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/rates/history"] });
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

// ─── Supervisor Email Overrides (item 6) ─────────────────────────────────────

interface SupervisorOverride {
  supervisorLdap: string;
  supervisorName: string | null;
  techCount: number;
  tpmsEmail: string | null;
  overrideEmail: string | null;
  overrideUpdatedBy: string | null;
  overrideUpdatedAt: string | null;
}

function SupervisorOverrideRow({ row }: { row: SupervisorOverride }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.overrideEmail ?? "");

  const mutation = useMutation({
    mutationFn: (email: string) =>
      apiRequest("PUT", `/api/vrm/settings/supervisor-overrides/${encodeURIComponent(row.supervisorLdap)}`, {
        email,
        supervisorName: row.supervisorName,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/supervisor-overrides"] });
      setEditing(false);
    },
  });

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.trim());

  function handleSave() {
    if (!isValidEmail) return;
    mutation.mutate(draft.trim());
  }
  function handleCancel() {
    setDraft(row.overrideEmail ?? "");
    setEditing(false);
  }

  const cellStyle: React.CSSProperties = {
    padding: "12px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    fontFamily: fonts.dmSans,
    color: colors.ink,
    fontSize: 13,
    verticalAlign: "middle",
  };

  return (
    <tr>
      <td style={cellStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{row.supervisorName ?? "—"}</span>
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
            {row.supervisorLdap}
          </span>
        </div>
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 999,
            background: "#FEF3C7",
            color: "#78350F",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={11} />
          No phone — email required
        </span>
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>{row.techCount}</td>
      <td style={cellStyle}>
        {editing ? (
          <input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="supervisor@shs.com"
            style={{
              width: "100%",
              padding: "6px 10px",
              border: `1px solid ${isValidEmail || draft === "" ? colors.accent : colors.red}`,
              borderRadius: 4,
              fontFamily: fonts.dmSans,
              fontSize: 13,
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
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {row.overrideEmail ? (
              <span style={{ fontFamily: fonts.dmSans, color: colors.ink }}>{row.overrideEmail}</span>
            ) : (
              <span style={{ color: colors.inkMuted, fontStyle: "italic" }}>No override set</span>
            )}
            {row.tpmsEmail && row.tpmsEmail !== row.overrideEmail && (
              <span style={{ fontSize: 11, color: colors.inkMuted }}>
                TPMS: {row.tpmsEmail}
              </span>
            )}
            {row.overrideUpdatedAt && row.overrideEmail && (
              <span style={{ fontSize: 11, color: colors.inkMuted }}>
                Updated {fmtDate(row.overrideUpdatedAt)}
                {row.overrideUpdatedBy ? ` · ${row.overrideUpdatedBy}` : ""}
              </span>
            )}
          </div>
        )}
      </td>
      <td style={{ ...cellStyle, width: 120 }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={mutation.isPending || !isValidEmail}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 4,
                border: "none",
                background: isValidEmail ? colors.green : colors.rule,
                color: "#fff",
                fontFamily: fonts.dmSans,
                fontSize: 12,
                cursor: isValidEmail ? "pointer" : "not-allowed",
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
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setDraft(row.overrideEmail ?? "");
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
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <Pencil size={12} />
            {row.overrideEmail ? "Edit" : "Add email"}
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

  const { data: history = [], isLoading: historyLoading } = useQuery<RateConfigHistory[]>({
    queryKey: ["/api/vrm/settings/rates/history"],
  });

  const { data: supOverrideEnvelope, isLoading: supLoading, error: supError } = useQuery<{
    supervisors: SupervisorOverride[];
  }>({
    queryKey: ["/api/vrm/settings/supervisor-overrides"],
  });
  const supervisors = supOverrideEnvelope?.supervisors ?? [];

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

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36, display: "flex", alignItems: "center", gap: 8 }}>
        <History size={16} color={colors.accent} />
        Change History
      </h2>

      <div style={cardStyle}>
        {historyLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading history…
          </div>
        )}
        {!historyLoading && history.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            No changes recorded yet.
          </div>
        )}
        {!historyLoading && history.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Previous Value</th>
                <th style={thStyle}>New Value</th>
                <th style={thStyle}>Changed By</th>
                <th style={thStyle}>Changed At</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.ink, fontSize: 14 }}>
                    {RATE_LABELS[row.key] ?? row.key}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.jetbrains, color: colors.inkMuted, fontSize: 14 }}>
                    {row.previousValue != null ? `$${Number(row.previousValue).toFixed(2)}` : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.jetbrains, color: colors.ink, fontSize: 14 }}>
                    ${Number(row.newValue).toFixed(2)}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.inkMuted, fontSize: 13 }}>
                    {row.changedBy ?? <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.inkMuted, fontSize: 12 }}>
                    {fmtDate(row.changedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36, display: "flex", alignItems: "center", gap: 8 }}>
        <Mail size={16} color={colors.accent} />
        Supervisor Email Overrides
      </h2>
      <p style={{ fontSize: 13, color: colors.inkMuted, marginTop: 0, marginBottom: 16 }}>
        Supervisors below have no phone number on file in TPMS, so denial-notification SMS can&apos;t reach them.
        Add an email to ensure they receive the deny notification. The override email replaces the TPMS email
        on the next snapshot rebuild and at notification dispatch time.
      </p>

      <div style={cardStyle}>
        {supLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading supervisors…
          </div>
        )}
        {supError && (
          <div style={{ padding: 32, textAlign: "center", color: colors.red, fontSize: 14 }}>
            Failed to load supervisor list.
          </div>
        )}
        {!supLoading && !supError && supervisors.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            No supervisors are missing a phone number — no overrides needed.
          </div>
        )}
        {!supLoading && !supError && supervisors.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Supervisor</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Tech Count</th>
                <th style={thStyle}>Override Email</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {supervisors.map((row) => (
                <SupervisorOverrideRow key={row.supervisorLdap} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
