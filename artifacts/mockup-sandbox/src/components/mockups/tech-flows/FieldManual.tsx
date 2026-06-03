import React from "react";
import {
  ArrowDown,
  Database,
  Truck,
  Boxes,
  Snowflake,
  Server,
  GitBranch,
  CheckCircle2,
  XCircle,
  Mail,
  Lock,
  RefreshCw,
  AlertTriangle,
  FileJson,
  ChevronRight,
} from "lucide-react";

/* ---------------------------------- Systems ---------------------------------- */

type SystemKey = "tpms" | "holman" | "ams" | "snowflake" | "nexus";

const SYSTEMS: Record<
  SystemKey,
  { label: string; icon: typeof Truck; chip: string; dot: string; ring: string; soft: string; hex: string }
> = {
  tpms: {
    label: "TPMS",
    icon: Truck,
    chip: "bg-[#e5e9ec] text-[#4a5f70] border-[#c8d1d9]",
    dot: "bg-[#7c93a6]",
    ring: "border-l-[#7c93a6]",
    soft: "bg-[#f4f6f8]",
    hex: "#7c93a6",
  },
  holman: {
    label: "Holman",
    icon: Boxes,
    chip: "bg-[#f2eadc] text-[#7a6543] border-[#e0cfba]",
    dot: "bg-[#b39974]",
    ring: "border-l-[#b39974]",
    soft: "bg-[#f9f6f2]",
    hex: "#b39974",
  },
  ams: {
    label: "AMS",
    icon: Server,
    chip: "bg-[#e8e4ed] text-[#5c4d6b] border-[#cecad6]",
    dot: "bg-[#8a7b99]",
    ring: "border-l-[#8a7b99]",
    soft: "bg-[#f5f3f7]",
    hex: "#8a7b99",
  },
  snowflake: {
    label: "Snowflake",
    icon: Snowflake,
    chip: "bg-[#e1ecec] text-[#406869] border-[#c1d9d9]",
    dot: "bg-[#6b9999]",
    ring: "border-l-[#6b9999]",
    soft: "bg-[#f0f6f6]",
    hex: "#6b9999",
  },
  nexus: {
    label: "Nexus PG",
    icon: Database,
    chip: "bg-[#e3ede5] text-[#426b48] border-[#c5d8c8]",
    dot: "bg-[#6c9674]",
    ring: "border-l-[#6c9674]",
    soft: "bg-[#f1f6f2]",
    hex: "#6c9674",
  },
};

function SystemBadge({ system }: { system: SystemKey }) {
  const s = SYSTEMS[system];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-widest font-medium ${s.chip} font-sans`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {s.label}
    </span>
  );
}

/* --------------------------------- Flow nodes -------------------------------- */

function Terminal({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "good" | "bad" }) {
  const tones = {
    dark: "bg-[#2b2b2b] text-[#fbfaf8] border-[#1a1a1a]",
    good: "bg-[#4a5f4a] text-[#fbfaf8] border-[#2f3d2f]",
    bad: "bg-[#8a4b4b] text-[#fbfaf8] border-[#5e3333]",
  };
  return (
    <div className="flex justify-center">
      <div className={`border px-5 py-2 font-mono text-[13px] tracking-tight ${tones[tone]}`}>
        {children}
      </div>
    </div>
  );
}

function Step({
  title,
  detail,
  system,
  icon: Icon,
}: {
  title: string;
  detail?: React.ReactNode;
  system?: SystemKey;
  icon?: typeof Truck;
}) {
  const accent = system ? SYSTEMS[system].ring : "border-l-[#d1d1d1]";
  return (
    <div className={`border border-[#d1d1d1] border-l-4 bg-[#fbfaf8] p-5 ${accent}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon && <Icon className="mt-1 h-4 w-4 shrink-0 text-[#8a8a8a]" strokeWidth={1.5} />}
          <div>
            <div className="font-serif text-[15px] font-semibold text-[#2b2b2b] leading-tight">{title}</div>
            {detail && <div className="mt-1.5 font-serif text-[14px] leading-relaxed text-[#5c5c5c]">{detail}</div>}
          </div>
        </div>
        {system && <SystemBadge system={system} />}
      </div>
    </div>
  );
}

function Decision({
  question,
  yes,
  no,
}: {
  question: string;
  yes?: { label: string; tone?: "bad" | "muted" };
  no?: { label: string; tone?: "bad" | "muted" };
}) {
  const branch = (b: { label: string; tone?: "bad" | "muted" } | undefined, kind: "yes" | "no") => {
    if (!b) return null;
    const isBad = b.tone === "bad";
    return (
      <div
        className={`flex items-start gap-2.5 border px-3 py-2.5 font-sans text-[12px] leading-snug ${
          isBad
            ? "border-[#e6d0d0] bg-[#fdf7f7] text-[#8a4b4b]"
            : "border-[#e5e5e5] bg-[#f5f5f5] text-[#5c5c5c]"
        }`}
      >
        <span
          className={`mt-0.5 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold ${
            kind === "no" ? "bg-[#ecd8d8] text-[#8a4b4b]" : "bg-[#d8ece5] text-[#4a5f4a]"
          }`}
        >
          {kind}
        </span>
        <span className="pt-0.5">{b.label}</span>
      </div>
    );
  };
  return (
    <div className="border border-[#d8d3c5] bg-[#fdfbf7] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <GitBranch className="h-4 w-4 text-[#a39b82]" strokeWidth={1.5} />
        <div className="font-serif text-[15px] font-semibold text-[#5c5545]">{question}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {branch(no, "no")}
        {branch(yes, "yes")}
      </div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-4">
      {label && (
        <span className="mb-2 bg-[#f4f2ee] px-2 py-0.5 font-sans text-[10px] uppercase tracking-widest text-[#8a8a8a] border border-[#e5e5e5]">
          {label}
        </span>
      )}
      <div className="h-6 w-px bg-[#d1d1d1]" />
      <ArrowDown className="h-3.5 w-3.5 text-[#d1d1d1] -mt-1" strokeWidth={2} />
    </div>
  );
}

function Callout({
  title,
  children,
  tone = "info",
  icon: Icon,
}: {
  title: string;
  children?: React.ReactNode;
  tone?: "info" | "warn" | "good";
  icon?: typeof Truck;
}) {
  const tones = {
    info: "border-[#e5e5e5] bg-[#f9f9f9] text-[#5c5c5c]",
    warn: "border-[#e6dfcc] bg-[#fcfaf5] text-[#7a6d4d]",
    good: "border-[#d8e6dc] bg-[#f5fbf7] text-[#4a6b52]",
  };
  return (
    <div className={`border p-4 font-serif text-[14px] leading-relaxed ${tones[tone]}`}>
      <div className="mb-2 flex items-center gap-2 font-semibold font-sans text-[12px] uppercase tracking-widest">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
        {title}
      </div>
      {children}
    </div>
  );
}

function ParallelGroup({ steps }: { steps: { system: SystemKey; title: string; detail?: string }[] }) {
  return (
    <div className="border border-dashed border-[#c0c0c0] bg-[#f4f4f4] p-4">
      <div className="mb-4 flex items-center gap-2 font-sans text-[10px] uppercase tracking-widest text-[#8a8a8a]">
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
        Run in parallel
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => {
          const sys = SYSTEMS[s.system];
          const Icon = sys.icon;
          return (
            <div
              key={s.title}
              className={`border border-[#d1d1d1] border-l-4 bg-[#fbfaf8] p-4 ${sys.ring}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <Icon className="h-4 w-4 text-[#8a8a8a]" strokeWidth={1.5} />
                <SystemBadge system={s.system} />
              </div>
              <div className="font-serif text-[14px] font-semibold text-[#2b2b2b] leading-snug">{s.title}</div>
              {s.detail && <div className="mt-1.5 font-serif text-[13px] text-[#5c5c5c] leading-relaxed">{s.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionTitle({
  number,
  title,
  subtitle,
}: {
  number: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-10 flex items-start gap-4 border-b border-[#2b2b2b] pb-6">
      <span className="font-serif text-3xl font-light text-[#2b2b2b] pt-1">§{number}</span>
      <div>
        <h2 className="font-serif text-3xl font-normal tracking-tight text-[#2b2b2b]">{title}</h2>
        {subtitle && <p className="mt-2 font-sans text-[13px] uppercase tracking-widest text-[#5c5c5c]">{subtitle}</p>}
      </div>
    </div>
  );
}

function CodeBlock({ title, json }: { title: string; json: object }) {
  return (
    <div className="border border-[#d1d1d1] bg-[#fbfaf8]">
      <div className="border-b border-[#e5e5e5] bg-[#f4f4f4] px-4 py-2 flex items-center gap-2">
        <FileJson className="h-3.5 w-3.5 text-[#8a8a8a]" strokeWidth={1.5} />
        <span className="font-sans text-[10px] uppercase tracking-widest text-[#5c5c5c]">{title}</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-[#404040]">
        <code>{JSON.stringify(json, null, 2)}</code>
      </pre>
    </div>
  );
}

function ProvidesReceives({
  rows,
}: {
  rows: { step: string; provides: React.ReactNode; receives: React.ReactNode }[];
}) {
  return (
    <div className="border border-[#2b2b2b] bg-[#fbfaf8]">
      <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-[#2b2b2b] bg-[#f4f4f4] font-sans text-[10px] uppercase tracking-widest text-[#2b2b2b]">
        <div className="px-4 py-3">Step</div>
        <div className="border-l border-[#d1d1d1] px-4 py-3 text-[#4a5f4a]">Provides · read</div>
        <div className="border-l border-[#d1d1d1] px-4 py-3 text-[#4a5f70]">Receives · write</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.step}
          className={`grid grid-cols-[1.2fr_1fr_1fr] font-serif text-[13.5px] ${
            i !== rows.length - 1 ? "border-b border-[#e5e5e5]" : ""
          }`}
        >
          <div className="px-4 py-3.5 font-medium text-[#2b2b2b]">{r.step}</div>
          <div className="border-l border-[#e5e5e5] px-4 py-3.5 text-[#5c5c5c] leading-relaxed">{r.provides}</div>
          <div className="border-l border-[#e5e5e5] px-4 py-3.5 text-[#5c5c5c] leading-relaxed">{r.receives}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- Page ----------------------------------- */

export function FieldManual() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@400;500;600;700&display=swap');
        .font-serif { font-family: 'Fraunces', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="min-h-screen bg-[#f3efe6] px-6 py-16 font-serif text-[#2b2b2b] antialiased selection:bg-[#e0cfba]">
        <div className="mx-auto max-w-[900px]">
          {/* Header */}
          <header className="mb-16 border-b-2 border-[#2b2b2b] pb-10">
            <div className="mb-8 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.2em] text-[#5c5c5c]">
              <span className="border border-[#2b2b2b] px-2 py-0.5 font-semibold text-[#2b2b2b]">
                Nexus
              </span>
              <span>Fleet Operations</span>
            </div>
            <h1 className="text-5xl font-normal tracking-tight text-[#2b2b2b] mb-6">
              Assign / Unassign Tech
            </h1>
            <p className="max-w-2xl text-[18px] leading-relaxed text-[#5c5c5c]">
              End-to-end orchestration of technician-to-vehicle assignment across TPMS, Holman, AMS, and
              Nexus (PostgreSQL) — the decision logic and which systems provide vs. receive data at each
              step.
            </p>
          </header>

          {/* Legend */}
          <div className="mb-16 border border-[#2b2b2b] bg-[#fbfaf8] p-8">
            <div className="mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2b2b2b]">
              Systems Reference
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              {(Object.keys(SYSTEMS) as SystemKey[]).map((k) => {
                const s = SYSTEMS[k];
                const Icon = s.icon;
                const blurb: Record<SystemKey, string> = {
                  tpms: "Source of truth for which truck a tech is on.",
                  holman: "Fleet system — assignment confirmed async.",
                  ams: "Asset mgmt (VIN ↔ tech); can skip + email.",
                  snowflake: "Read-only roster (all_techs).",
                  nexus: "Local caches, canonical row, audit + op log.",
                };
                return (
                  <div key={k} className="border-t border-[#d1d1d1] pt-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 ${s.dot}`} />
                      <span className="font-sans text-[12px] font-bold uppercase tracking-wide text-[#2b2b2b]">{s.label}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-[#5c5c5c]">{blurb[k]}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ============================= ASSIGN ============================= */}
          <section className="mb-24">
            <SectionTitle
              number="1"
              title="Assign Tech"
              subtitle="POST /api/fleet-ops/assign — fans out into up to 3 operations before the main assign"
            />

            {/* Fan-out summary */}
            <div className="mb-12 grid gap-6 sm:grid-cols-3">
              {[
                { n: "1", t: "Auto-unassign", d: "Pull the incoming tech off any prior truck." },
                { n: "2", t: "Displacement-unassign", d: "Clear whoever occupies the target truck." },
                { n: "3", t: "Main assign", d: "TPMS + Holman + AMS, then one DB write-through." },
              ].map((x) => (
                <div key={x.n} className="border-t-2 border-[#2b2b2b] pt-4">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="font-sans text-[14px] font-bold text-[#2b2b2b]">
                      {x.n}.
                    </span>
                    <span className="font-serif text-[16px] font-semibold text-[#2b2b2b]">{x.t}</span>
                  </div>
                  <p className="text-[14px] text-[#5c5c5c] leading-relaxed">{x.d}</p>
                </div>
              ))}
            </div>

            {/* Main flow */}
            <div className="mx-auto max-w-[640px]">
              <Terminal>POST /api/fleet-ops/assign</Terminal>
              <Arrow />
              <Decision
                question="truckNumber and ldapId present?"
                no={{ label: "400 — truckNumber and ldapId required", tone: "bad" }}
              />
              <Arrow label="yes" />
              <Step
                title="Normalize ldapId · look up Holman vehicle ref"
                detail="Resolve the target truck against the Holman cache."
                system="holman"
                icon={Boxes}
              />
              <Arrow />
              <Decision
                question="Vehicle row in holman_vehicles_cache?"
                yes={{ label: "acquireVehicleLock — 409 if already updating", tone: "muted" }}
                no={{ label: "No lock — proceed", tone: "muted" }}
              />
              <Arrow />
              <Step
                title="resolveCurrentTechTruck(ldapId)"
                detail="Read the tech's current truck via TPMS getTechInfo."
                system="tpms"
                icon={Truck}
              />
              <Arrow />
              <Decision
                question="On a different prior truck?"
                yes={{ label: "AUTO-UNASSIGN prior truck (subroutine)", tone: "muted" }}
              />
              <Arrow />
              <Step
                title="resolveTargetTruckOccupant(target)"
                detail="Who currently holds the target truck?"
                system="holman"
                icon={Boxes}
              />
              <Arrow />
              <Decision
                question="Target occupied by a different tech?"
                yes={{ label: "DISPLACEMENT-UNASSIGN occupant (subroutine)", tone: "muted" }}
                no={{ label: "Same tech → no-op for TPMS · empty → continue", tone: "muted" }}
              />
              <Arrow />
              <Step
                title="Create fleet_operation_log"
                detail="operationType = assign, all per-system statuses = pending."
                system="nexus"
                icon={Database}
              />
              <Arrow />
              <Decision
                question="tpmsAlreadyCurrent? (currentTruck == target)"
                yes={{ label: "TPMS skipped — already assigned in TPMS", tone: "muted" }}
                no={{ label: "callTpms assign — PUT /techinfo (truckNo = target)", tone: "muted" }}
              />
              <Arrow />
              <Callout title="TPMS post-assign verify" tone="info" icon={CheckCircle2}>
                On TPMS success, re-read getTechInfo and confirm it equals target (warns on mismatch only).
              </Callout>
              <Arrow label="then" />
              <ParallelGroup
                steps={[
                  { system: "holman", title: "callHolman assign", detail: "Create Holman submission" },
                  { system: "ams", title: "callAms assign", detail: "Upsert VIN → tech" },
                ]}
              />
              <Arrow />
              <Decision
                question="AMS tech missing? (not registered in AMS)"
                yes={{ label: "ams.status = skipped + email NFDT/cc — no cache write", tone: "muted" }}
              />
              <div className="my-6">
                <Callout title="Skip-email name lookup" tone="warn" icon={Mail}>
                  On skip, the tech name is read from Snowflake <code className="font-mono text-[13px] bg-[#f0ebd8] px-1 py-0.5">all_techs</code> for the email.
                </Callout>
              </div>
              <Arrow />
              <div className="border border-[#c5d8c8] bg-[#f1f6f2] p-6">
                <div className="mb-4 flex items-center justify-between border-b border-[#c5d8c8] pb-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-[#6c9674]" strokeWidth={1.5} />
                    <span className="font-sans text-[12px] font-bold uppercase tracking-widest text-[#426b48]">WRITE-THROUGH CACHES</span>
                  </div>
                  <SystemBadge system="nexus" />
                </div>
                <p className="font-serif text-[15px] leading-relaxed text-[#426b48]">
                  Single DB transaction — plan all mutations, then commit atomically. (detailed below)
                </p>
              </div>
              <Arrow />
              <Step title="buildResult — OperationResult" icon={ChevronRight} />
              <Arrow />
              <div className="grid grid-cols-3 gap-4">
                <Terminal tone="good">200 · all success</Terminal>
                <Terminal>207 · partial</Terminal>
                <Terminal tone="bad">500 · none</Terminal>
              </div>
            </div>

            {/* Pre-unassign subroutine */}
            <div className="mt-16 border-t border-b border-[#d1d1d1] py-8">
              <h3 className="mb-2 font-serif text-[18px] font-semibold text-[#2b2b2b]">
                Auto-unassign / Displacement-unassign subroutine
              </h3>
              <p className="mb-6 text-[14px] text-[#5c5c5c]">
                Both pre-steps share the same shape — only the target truck + tech differ.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {[
                  "Create fleet_operation_log (unassign, pending)",
                  "Parallel: callTpms · callHolman · callAms unassign",
                  "writeThroughCaches (action=unassign, source=auto_unassign | displacement)",
                  "logAllEvents",
                ].map((s, i, arr) => (
                  <div key={s} className="flex items-center gap-3">
                    <span className="border border-[#d1d1d1] bg-[#fbfaf8] px-3 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-[#2b2b2b]">
                      {s}
                    </span>
                    {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-[#a39b82]" strokeWidth={2} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Write-through transaction */}
            <div className="mt-16 border border-[#c5d8c8] bg-[#fbfaf8] p-8">
              <div className="mb-6 flex items-center gap-3 border-b border-[#c5d8c8] pb-4">
                <Lock className="h-5 w-5 text-[#6c9674]" strokeWidth={1.5} />
                <h3 className="font-serif text-[18px] font-semibold text-[#2b2b2b]">
                  Write-through transaction — single DB tx
                </h3>
              </div>
              <p className="mb-8 max-w-2xl text-[14px] leading-relaxed text-[#5c5c5c]">
                A partial failure can never leave one tech pointing at a truck while the prior holder
                still claims it.
              </p>
              <div className="mx-auto max-w-[640px]">
                <Terminal tone="good">db.transaction · BEGIN</Terminal>
                <Arrow />
                <div className="space-y-4">
                  <Step title="tpms_cached_assignments" detail="upsert / null-truck / delete" system="nexus" />
                  <Step title="tpms_last_known_truck_tech" detail="upsert / delete" system="nexus" />
                  <Step title="tpms_tech_profiles" detail="set truck_no" system="nexus" />
                </div>
                <Arrow />
                <Decision
                  question="Holman success or pending?"
                  yes={{ label: "holman_vehicles_cache upsert", tone: "muted" }}
                />
                <Arrow />
                <Decision
                  question="AMS success or pending?"
                  yes={{ label: "ams_vehicles_cache upsert", tone: "muted" }}
                />
                <Arrow />
                <Decision
                  question="TPMS blocking? (conflict or failed)"
                  no={{ label: "tech_vehicle_assignments upsert (truckNo + status)", tone: "muted" }}
                  yes={{ label: "Skip canonical row — keep prior state", tone: "muted" }}
                />
                <Arrow />
                <Step
                  title="tech_vehicle_assignment_history"
                  detail="append assigned/changed — or conflict/failed if blocked"
                  system="nexus"
                />
                <Arrow />
                <Decision
                  question="Displacing a prior holder and not TPMS-blocking?"
                  yes={{ label: "Clear prior holder row + history (source=displacement)", tone: "muted" }}
                />
                <Arrow />
                <Step
                  title="fleet_operation_log"
                  detail="update per-system status + completedAt"
                  system="nexus"
                />
                <Arrow />
                <Terminal tone="good">COMMIT</Terminal>
              </div>
            </div>

            {/* Provides / receives */}
            <div className="mt-16 mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2b2b2b]">
              Provides vs. Receives — Assign
            </div>
            <ProvidesReceives
              rows={[
                {
                  step: "Resolve vehicle ref / lock",
                  provides: <SystemBadge system="holman" />,
                  receives: "fleet_operation_log lock row",
                },
                {
                  step: "Resolve current / prior truck",
                  provides: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="tpms" /> getTechInfo
                    </span>
                  ),
                  receives: "—",
                },
                {
                  step: "TPMS assign",
                  provides: "request body",
                  receives: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="tpms" /> PUT /techinfo
                    </span>
                  ),
                },
                {
                  step: "Holman assign",
                  provides: "request body",
                  receives: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="holman" /> submission (async confirm)
                    </span>
                  ),
                },
                {
                  step: "AMS assign",
                  provides: (
                    <span className="flex items-center gap-2">
                      body · <SystemBadge system="snowflake" /> on skip
                    </span>
                  ),
                  receives: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="ams" /> VIN↔tech (or skip + email)
                    </span>
                  ),
                },
                {
                  step: "Write-through",
                  provides: "plan from above",
                  receives: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="nexus" /> all caches + canonical + history + op log
                    </span>
                  ),
                },
              ]}
            />

            {/* Payloads */}
            <div className="mt-16 mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2b2b2b]">
              Sample payloads — Assign
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <CodeBlock
                title="Request · POST /api/fleet-ops/assign"
                json={{
                  truckNumber: "46863",
                  ldapId: "KMICKEL",
                  districtNo: "1042",
                  techName: "Kyle Mickelson",
                  notes: "New route assignment",
                  assignmentType: "assigned",
                  amsStatusId: 1,
                }}
              />
              <CodeBlock
                title="Response · OperationResult (207 partial)"
                json={{
                  log: {
                    operationType: "assign",
                    truckNumber: "46863",
                    toLdap: "KMICKEL",
                    tpmsStatus: "success",
                    holmanStatus: "pending",
                    amsStatus: "success",
                    completedAt: "2026-06-03T14:22:08.512Z",
                  },
                  tpms: { status: "success", message: "Tech assigned to truck 046863" },
                  holman: { status: "pending", message: "Submitted — awaiting fleet sync" },
                  ams: { status: "success", message: "AMS updated for VIN 1FTBW2CM5KKB12345" },
                  overallSuccess: false,
                  partialSuccess: true,
                }}
              />
            </div>
          </section>

          {/* ============================ UNASSIGN ============================ */}
          <section className="mb-16">
            <SectionTitle
              number="2"
              title="Unassign Tech"
              subtitle="Two entry points — same goal (clear truck + audit), different reach into external systems"
            />

            {/* Entry comparison */}
            <div className="mb-12 grid gap-6 lg:grid-cols-2">
              <div className="border border-[#2b2b2b] bg-[#fbfaf8] p-6">
                <div className="mb-4 flex items-center gap-3 border-b border-[#e5e5e5] pb-3">
                  <span className="font-serif text-xl font-semibold text-[#2b2b2b]">A.</span>
                  <span className="font-serif text-[16px] font-semibold text-[#2b2b2b]">Lightweight · Nexus-only</span>
                </div>
                <p className="font-mono text-[12px] text-[#5c5c5c] mb-4">
                  DELETE /api/vehicle-assignments/:techRacfid → unassignVehicle
                </p>
                <div className="font-sans text-[12px] text-[#5c5c5c] leading-relaxed">
                  External systems: <span className="font-semibold text-[#2b2b2b]">none</span> · returns{" "}
                  <span className="font-mono text-[11px]">AggregatedVehicleAssignment</span>
                </div>
              </div>
              <div className="border border-[#c8d1d9] bg-[#f4f6f8] p-6">
                <div className="mb-4 flex items-center gap-3 border-b border-[#c8d1d9] pb-3">
                  <span className="font-serif text-xl font-semibold text-[#4a5f70]">B.</span>
                  <span className="font-serif text-[16px] font-semibold text-[#4a5f70]">Cross-system</span>
                </div>
                <p className="font-mono text-[12px] text-[#4a5f70] mb-4">
                  POST /api/fleet-ops/unassign → unassignTech
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SystemBadge system="tpms" />
                  <SystemBadge system="holman" />
                  <SystemBadge system="ams" />
                  <span className="font-sans text-[11px] text-[#4a5f70]">· returns OperationResult</span>
                </div>
              </div>
            </div>

            {/* Two flows side by side */}
            <div className="grid gap-10 lg:grid-cols-2">
              {/* Entry A */}
              <div className="border border-[#2b2b2b] bg-[#fbfaf8] p-8">
                <h3 className="mb-8 font-serif text-[18px] font-semibold text-[#2b2b2b] border-b border-[#e5e5e5] pb-4">
                  Entry A — lightweight (Nexus-only)
                </h3>
                <Terminal>DELETE /api/vehicle-assignments/:techRacfid</Terminal>
                <Arrow />
                <Decision
                  question="Caller role in developer / admin / agent?"
                  no={{ label: "403 — insufficient permissions", tone: "bad" }}
                />
                <Arrow label="yes" />
                <Step title="getTechVehicleAssignmentByTechRacfid" system="nexus" icon={Database} />
                <Arrow />
                <Decision
                  question="Assignment exists?"
                  no={{ label: "null → 404 Assignment not found", tone: "bad" }}
                  yes={{ label: "Capture previousTruckNo", tone: "muted" }}
                />
                <Arrow />
                <Step
                  title="Nexus clear · tech_vehicle_assignments"
                  detail="truckNo = null, status = inactive"
                  system="nexus"
                />
                <Arrow />
                <Step
                  title="Append tech_vehicle_assignment_history"
                  detail="changeType = unassigned, source = manual (when previousTruckNo set)"
                  system="nexus"
                />
                <Arrow />
                <Step
                  title="enrichAssignmentData → read all_techs"
                  detail="Truck is null after unassign, so enriched from Snowflake only (holman = false)."
                  system="snowflake"
                  icon={Snowflake}
                />
                <Arrow />
                <Terminal tone="good">200 · AggregatedVehicleAssignment</Terminal>
              </div>

              {/* Entry B */}
              <div className="border border-[#c8d1d9] bg-[#f4f6f8] p-8">
                <h3 className="mb-8 font-serif text-[18px] font-semibold text-[#4a5f70] border-b border-[#c8d1d9] pb-4">
                  Entry B — cross-system (TPMS + Holman confirm)
                </h3>
                <Terminal>POST /api/fleet-ops/unassign</Terminal>
                <Arrow />
                <Decision
                  question="truckNumber and ldapId present?"
                  no={{ label: "400 — required", tone: "bad" }}
                />
                <Arrow label="yes" />
                <Step title="lookupHolmanVehicleRef + acquireVehicleLock" system="holman" icon={Boxes} />
                <Arrow />
                <Decision
                  question="Lock acquired?"
                  no={{ label: "409 — vehicle is being updated", tone: "bad" }}
                  yes={{ label: "Create fleet_operation_log (unassign, pending)", tone: "muted" }}
                />
                <Arrow />
                <ParallelGroup
                  steps={[
                    { system: "tpms", title: "callTpms unassign", detail: "PUT /techinfo truckNo=\"\"" },
                    { system: "holman", title: "callHolman unassign", detail: "unassign submission" },
                    { system: "ams", title: "callAms unassign", detail: "clear VIN" },
                  ]}
                />
                <Arrow />
                <div className="border border-[#c5d8c8] bg-[#e3ede5] p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Database className="h-4 w-4 text-[#426b48]" strokeWidth={1.5} />
                    <span className="font-sans text-[11px] font-bold uppercase tracking-widest text-[#426b48]">
                      WRITE-THROUGH CACHES · single tx
                    </span>
                  </div>
                  <p className="font-serif text-[14px] text-[#426b48] leading-relaxed">
                    Nexus clear (truckNo=null, inactive) + history changeType=unassigned
                  </p>
                </div>
                <Arrow />
                <Step title="logAllEvents + update op log statuses" system="nexus" icon={Database} />
                <Arrow />
                <Step title="buildResult — OperationResult" icon={ChevronRight} />
                <Arrow />
                <div className="grid grid-cols-3 gap-3">
                  <Terminal tone="good">200</Terminal>
                  <Terminal>207</Terminal>
                  <Terminal tone="bad">500</Terminal>
                </div>
                <div className="mt-8">
                  <Callout title="Holman confirm — asynchronous" tone="warn" icon={AlertTriangle}>
                    The submission is verified later from the Holman fleet sync — an{" "}
                    <code className="font-mono bg-[#e6dfcc] px-1 py-0.5">assignedStatus</code> containing "unassign" (or a blank tech) marks it confirmed,
                    then propagates to fleet_operation_log.
                  </Callout>
                </div>
              </div>
            </div>

            {/* Provides / receives */}
            <div className="mt-16 mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2b2b2b]">
              Provides vs. Receives — Unassign
            </div>
            <ProvidesReceives
              rows={[
                {
                  step: "Validate assignment exists (A)",
                  provides: "tech_vehicle_assignments",
                  receives: "—",
                },
                {
                  step: "Nexus clear (A & B)",
                  provides: "prior row",
                  receives: "tech_vehicle_assignments (null, inactive)",
                },
                {
                  step: "Audit append (A & B)",
                  provides: "prior truck",
                  receives: "tech_vehicle_assignment_history (unassigned)",
                },
                {
                  step: "Response enrichment (A)",
                  provides: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="snowflake" /> all_techs
                    </span>
                  ),
                  receives: "—",
                },
                {
                  step: "TPMS unassign (B)",
                  provides: "request",
                  receives: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="tpms" /> PUT /techinfo (truckNo="")
                    </span>
                  ),
                },
                {
                  step: "Holman confirm (B)",
                  provides: (
                    <span className="flex items-center gap-2">
                      <SystemBadge system="holman" /> fleet sync
                    </span>
                  ),
                  receives: "holman_submissions, fleet_operation_log",
                },
              ]}
            />

            {/* Payloads */}
            <div className="mt-16 mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2b2b2b]">
              Sample payloads — Unassign
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <CodeBlock
                title="Entry A · Response — AggregatedVehicleAssignment"
                json={{
                  success: true,
                  data: {
                    techRacfid: "KMICKEL",
                    assignmentStatus: "inactive",
                    truckNo: null,
                    techName: "Kyle Mickelson",
                    districtNo: "1042",
                    employmentStatus: "Active",
                    dataSources: { snowflake: true, tpms: false, holman: false },
                  },
                }}
              />
              <CodeBlock
                title="Entry B · Response — OperationResult"
                json={{
                  log: {
                    operationType: "unassign",
                    truckNumber: "46863",
                    fromLdap: "KMICKEL",
                    tpmsStatus: "success",
                    holmanStatus: "pending",
                    amsStatus: "success",
                  },
                  tpms: { status: "success", message: "Tech unassigned (truckNo cleared)" },
                  holman: { status: "pending", message: "Unassign submitted — awaiting sync" },
                  ams: { status: "success", message: "AMS VIN cleared for tech" },
                  overallSuccess: false,
                  partialSuccess: true,
                }}
              />
            </div>
          </section>

          <footer className="border-t border-[#d1d1d1] pt-8 text-center font-serif text-[14px] text-[#8a8a8a] pb-16">
            Documents the flows as they exist in code at build time — no assign/unassign logic is changed.
          </footer>
        </div>
      </div>
    </>
  );
}
