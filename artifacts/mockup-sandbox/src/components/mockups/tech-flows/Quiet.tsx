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
import React from "react";

/* ---------------------------------- Systems ---------------------------------- */

type SystemKey = "tpms" | "holman" | "ams" | "snowflake" | "nexus";

const SYSTEMS: Record<
  SystemKey,
  { label: string; icon: typeof Truck; chip: string; dot: string; ring: string; soft: string }
> = {
  tpms: {
    label: "TPMS",
    icon: Truck,
    chip: "bg-sky-50 text-sky-600",
    dot: "bg-sky-300",
    ring: "border-l-sky-300",
    soft: "bg-sky-50/50",
  },
  holman: {
    label: "Holman",
    icon: Boxes,
    chip: "bg-amber-50 text-amber-600",
    dot: "bg-amber-300",
    ring: "border-l-amber-300",
    soft: "bg-amber-50/50",
  },
  ams: {
    label: "AMS",
    icon: Server,
    chip: "bg-violet-50 text-violet-600",
    dot: "bg-violet-300",
    ring: "border-l-violet-300",
    soft: "bg-violet-50/50",
  },
  snowflake: {
    label: "Snowflake",
    icon: Snowflake,
    chip: "bg-cyan-50 text-cyan-600",
    dot: "bg-cyan-300",
    ring: "border-l-cyan-300",
    soft: "bg-cyan-50/50",
  },
  nexus: {
    label: "Nexus PG",
    icon: Database,
    chip: "bg-emerald-50 text-emerald-600",
    dot: "bg-emerald-300",
    ring: "border-l-emerald-300",
    soft: "bg-emerald-50/50",
  },
};

function SystemBadge({ system }: { system: SystemKey }) {
  const s = SYSTEMS[system];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-wide ${s.chip}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {s.label}
    </span>
  );
}

/* --------------------------------- Flow nodes -------------------------------- */

function Terminal({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "good" | "bad" }) {
  const tones = {
    dark: "bg-slate-400 text-white shadow-slate-200/50",
    good: "bg-[#81c7a8] text-white shadow-emerald-200/50",
    bad: "bg-[#e59b9b] text-white shadow-rose-200/50",
  };
  return (
    <div className="flex justify-center my-2">
      <div className={`rounded-full px-6 py-3 text-[13px] font-bold shadow-lg ${tones[tone]}`}>
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
  const accent = system ? SYSTEMS[system].ring : "border-l-slate-200";
  return (
    <div
      className={`rounded-3xl border border-slate-100 border-l-[6px] bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] ${accent}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50">
              <Icon className="h-5 w-5 text-slate-400" strokeWidth={2} />
            </div>
          )}
          <div className="pt-0.5">
            <div className="text-[15px] font-bold text-slate-700">{title}</div>
            {detail && <div className="mt-1.5 text-[14px] leading-relaxed text-slate-500">{detail}</div>}
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
        className={`flex items-center gap-3 rounded-2xl p-4 text-[13.5px] ${
          isBad
            ? "bg-rose-50/50 text-rose-600"
            : "bg-slate-50/50 text-slate-600"
        }`}
      >
        <span
          className={`flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-bold uppercase tracking-wider ${
            kind === "no" ? "bg-[#e59b9b] text-white" : "bg-[#81c7a8] text-white"
          }`}
        >
          {kind}
        </span>
        {isBad && <XCircle className="h-4 w-4" />}
        <span className="font-semibold">{b.label}</span>
      </div>
    );
  };
  return (
    <div className="rounded-3xl border border-[#f5e6cc] bg-[#fdfbf7] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100/50">
          <GitBranch className="h-5 w-5 text-amber-500" strokeWidth={2} />
        </div>
        <div className="text-[15px] font-bold text-amber-800/80">{question}</div>
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
    <div className="flex flex-col items-center py-3">
      {label && (
        <span className="mb-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      )}
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50">
        <ArrowDown className="h-4 w-4 text-slate-300" strokeWidth={3} />
      </div>
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
    info: "bg-slate-50 text-slate-600",
    warn: "bg-amber-50/50 text-amber-700/80",
    good: "bg-emerald-50/50 text-emerald-700/80",
  };
  const iconTones = {
    info: "text-slate-400",
    warn: "text-amber-500",
    good: "text-emerald-500",
  };
  return (
    <div className={`rounded-3xl px-6 py-5 text-[14px] leading-relaxed shadow-[0_8px_30px_rgb(0,0,0,0.02)] ${tones[tone]}`}>
      <div className="mb-1.5 flex items-center gap-2.5 font-bold">
        {Icon && <Icon className={`h-4 w-4 ${iconTones[tone]}`} strokeWidth={2.5} />}
        {title}
      </div>
      <div className="opacity-90">{children}</div>
    </div>
  );
}

function ParallelGroup({ steps }: { steps: { system: SystemKey; title: string; detail?: string }[] }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-[#f8fafc] p-6 shadow-inner">
      <div className="mb-5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-slate-400">
        <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
        Run in parallel
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => {
          const sys = SYSTEMS[s.system];
          const Icon = sys.icon;
          return (
            <div
              key={s.title}
              className={`rounded-3xl border border-slate-50 bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.03)]`}
            >
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${sys.soft}`}>
                    <Icon className={`h-5 w-5 ${sys.chip.split(' ')[1]}`} strokeWidth={2} />
                  </div>
                  <SystemBadge system={s.system} />
                </div>
                <div className="text-[14px] font-bold text-slate-700">{s.title}</div>
                {s.detail && <div className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">{s.detail}</div>}
              </div>
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
    <div className="mb-10 flex items-center gap-6 pb-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] bg-slate-200/50 text-2xl font-black text-slate-500 shadow-inner">
        {number}
      </div>
      <div>
        <h2 className="text-[28px] font-bold tracking-tight text-slate-700">{title}</h2>
        {subtitle && <p className="mt-1 text-[15px] font-medium text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

function CodeBlock({ title, json }: { title: string; json: object }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-[#f4f7f9] shadow-inner">
      <div className="flex items-center gap-3 bg-[#ecf1f4] px-6 py-4">
        <FileJson className="h-4 w-4 text-slate-400" strokeWidth={2.5} />
        <span className="text-[13px] font-bold tracking-wide text-slate-500">{title}</span>
      </div>
      <pre className="overflow-x-auto p-6 text-[13px] leading-loose text-slate-600 font-medium">
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
    <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.03)]">
      <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-[#f8fafc] text-[12px] font-bold uppercase tracking-widest text-slate-400">
        <div className="px-6 py-4">Step</div>
        <div className="px-6 py-4 text-[#81c7a8]">Provides · read</div>
        <div className="px-6 py-4 text-[#9bbde5]">Receives · write</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.step}
          className={`grid grid-cols-[1.2fr_1fr_1fr] text-[14px] items-center ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
        >
          <div className="px-6 py-5 font-bold text-slate-600">{r.step}</div>
          <div className="px-6 py-5 text-slate-500 font-medium">{r.provides}</div>
          <div className="px-6 py-5 text-slate-500 font-medium">{r.receives}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- Page ----------------------------------- */

export function Quiet() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');
        .font-quicksand {
          font-family: 'Quicksand', sans-serif;
        }
      `}</style>
      <div className="min-h-screen bg-[#fcfcfc] px-6 py-16 font-quicksand text-slate-700 antialiased selection:bg-slate-200">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <header className="mb-16 text-center">
            <div className="mb-4 inline-flex items-center gap-3 rounded-full bg-slate-100 px-4 py-1.5">
              <span className="rounded-full bg-slate-300 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm">
                Nexus
              </span>
              <span className="text-[12px] font-bold uppercase tracking-widest text-slate-400">
                Fleet Operations
              </span>
            </div>
            <h1 className="text-[40px] font-bold tracking-tight text-slate-700 mb-4">
              Assign / Unassign Tech
            </h1>
            <p className="mx-auto max-w-2xl text-[16px] font-medium leading-relaxed text-slate-400">
              End-to-end orchestration of technician-to-vehicle assignment across TPMS, Holman, AMS, and
              Nexus (PostgreSQL) — the decision logic and which systems provide vs. receive data at each
              step.
            </p>
          </header>

          {/* Legend */}
          <div className="mb-16 rounded-[2rem] bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50">
            <div className="mb-6 text-center text-[12px] font-bold uppercase tracking-widest text-slate-400">
              Systems
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                  <div key={k} className={`rounded-3xl p-5 ${s.soft}`}>
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                        <Icon className={`h-6 w-6 ${s.chip.split(' ')[1]}`} strokeWidth={2} />
                      </div>
                      <span className="text-[15px] font-bold text-slate-700">{s.label}</span>
                    </div>
                    <p className="mt-3 text-center text-[13px] font-medium leading-relaxed text-slate-500 opacity-90">{blurb[k]}</p>
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
            <div className="mb-12 grid gap-5 sm:grid-cols-3">
              {[
                { n: "1", t: "Auto-unassign", d: "Pull the incoming tech off any prior truck." },
                { n: "2", t: "Displacement-unassign", d: "Clear whoever occupies the target truck." },
                { n: "3", t: "Main assign", d: "TPMS + Holman + AMS, then one DB write-through." },
              ].map((x) => (
                <div key={x.n} className="rounded-[2rem] bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50">
                  <div className="flex items-center gap-4 mb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-[14px] font-bold text-slate-500">
                      {x.n}
                    </span>
                    <span className="text-[16px] font-bold text-slate-700">{x.t}</span>
                  </div>
                  <p className="text-[14px] font-medium leading-relaxed text-slate-400">{x.d}</p>
                </div>
              ))}
            </div>

            {/* Main flow */}
            <div className="mx-auto max-w-2xl">
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
              <div className="my-4 flex justify-center">
                <Callout title="Skip-email name lookup" tone="warn" icon={Mail}>
                  On skip, the tech name is read from Snowflake <code>all_techs</code> for the email.
                </Callout>
              </div>
              <Arrow />
              <div className="rounded-[2rem] bg-[#f0f9f5] p-8 shadow-inner border border-[#dff0e8]">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                    <Database className="h-6 w-6 text-[#81c7a8]" strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-[16px] font-bold text-[#5c987d] mb-1">WRITE-THROUGH CACHES</div>
                    <SystemBadge system="nexus" />
                  </div>
                  <p className="text-[14px] font-medium text-[#71a68e] leading-relaxed">
                    Single DB transaction — plan all mutations, then commit atomically. (detailed below)
                  </p>
                </div>
              </div>
              <Arrow />
              <Step title="buildResult — OperationResult" icon={ChevronRight} />
              <Arrow />
              <div className="grid grid-cols-3 gap-3">
                <Terminal tone="good">200 · all success</Terminal>
                <Terminal>207 · partial</Terminal>
                <Terminal tone="bad">500 · none</Terminal>
              </div>
            </div>

            {/* Pre-unassign subroutine */}
            <div className="mt-16 rounded-[2rem] bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50">
              <h3 className="mb-2 text-[18px] font-bold text-slate-700">
                Auto-unassign / Displacement-unassign subroutine
              </h3>
              <p className="mb-6 text-[15px] font-medium text-slate-400">
                Both pre-steps share the same shape — only the target truck + tech differ.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[14px]">
                {[
                  "Create fleet_operation_log (unassign, pending)",
                  "Parallel: callTpms · callHolman · callAms unassign",
                  "writeThroughCaches (action=unassign, source=auto_unassign | displacement)",
                  "logAllEvents",
                ].map((s, i, arr) => (
                  <React.Fragment key={s}>
                    <div className="rounded-2xl bg-slate-50 px-4 py-2.5 font-bold text-slate-500 shadow-sm border border-slate-100">
                      {s}
                    </div>
                    {i < arr.length - 1 && <ChevronRight className="h-5 w-5 text-slate-300" strokeWidth={2.5} />}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Write-through transaction */}
            <div className="mt-12 rounded-[2rem] bg-[#f0f9f5] p-10 shadow-inner border border-[#dff0e8]">
              <div className="mb-6 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm mb-4">
                  <Lock className="h-5 w-5 text-[#81c7a8]" strokeWidth={2} />
                </div>
                <h3 className="text-[20px] font-bold text-[#5c987d]">
                  Write-through transaction — single DB tx
                </h3>
                <p className="mt-2 text-[15px] font-medium text-[#71a68e]">
                  A partial failure can never leave one tech pointing at a truck while the prior holder
                  still claims it.
                </p>
              </div>
              <div className="mx-auto max-w-2xl">
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
            <div className="mt-16">
              <h3 className="mb-6 text-center text-[13px] font-bold uppercase tracking-widest text-slate-400">
                Provides vs. Receives — Assign
              </h3>
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
            </div>

            {/* Payloads */}
            <div className="mt-16">
              <h3 className="mb-6 text-center text-[13px] font-bold uppercase tracking-widest text-slate-400">
                Sample payloads — Assign
              </h3>
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
              <div className="rounded-[2rem] bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50">
                <div className="mb-4 flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-[18px] font-black text-slate-400">
                    A
                  </span>
                  <span className="text-[18px] font-bold text-slate-700">Lightweight · Nexus-only</span>
                </div>
                <p className="text-[15px] font-medium leading-relaxed text-slate-500">
                  DELETE /api/vehicle-assignments/:techRacfid → <code>unassignVehicle</code>
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] font-medium text-slate-400">
                  External systems: <span className="rounded-lg bg-slate-50 px-2.5 py-1 font-bold text-slate-500">none</span> · returns{" "}
                  <span className="rounded-lg bg-slate-50 px-2.5 py-1 font-bold text-slate-500">AggregatedVehicleAssignment</span>
                </div>
              </div>
              <div className="rounded-[2rem] bg-sky-50/50 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-sky-100/50">
                <div className="mb-4 flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-200/50 text-[18px] font-black text-sky-600">
                    B
                  </span>
                  <span className="text-[18px] font-bold text-slate-700">Cross-system</span>
                </div>
                <p className="text-[15px] font-medium leading-relaxed text-slate-500">
                  POST /api/fleet-ops/unassign → <code>unassignTech</code>
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <SystemBadge system="tpms" />
                  <SystemBadge system="holman" />
                  <SystemBadge system="ams" />
                  <span className="text-[14px] font-medium text-slate-400 ml-2">· returns OperationResult</span>
                </div>
              </div>
            </div>

            {/* Two flows side by side */}
            <div className="grid gap-8 lg:grid-cols-2">
              {/* Entry A */}
              <div className="rounded-[2.5rem] bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-50">
                <h3 className="mb-8 flex items-center justify-center gap-4 text-[16px] font-bold text-slate-600">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-[14px] font-black text-slate-400">
                    A
                  </span>
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
              <div className="rounded-[2.5rem] bg-sky-50/30 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-sky-50/50">
                <h3 className="mb-8 flex items-center justify-center gap-4 text-[16px] font-bold text-slate-600">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-[14px] font-black text-sky-500">
                    B
                  </span>
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
                <div className="rounded-3xl bg-[#f0f9f5] p-6 shadow-inner border border-[#dff0e8] text-center">
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <Database className="h-5 w-5 text-[#81c7a8]" strokeWidth={2} />
                    <span className="text-[14px] font-bold tracking-wide text-[#5c987d]">
                      WRITE-THROUGH CACHES · single tx
                    </span>
                  </div>
                  <p className="text-[13.5px] font-medium text-[#71a68e] leading-relaxed">
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
                    <code>assignedStatus</code> containing "unassign" (or a blank tech) marks it confirmed,
                    then propagates to fleet_operation_log.
                  </Callout>
                </div>
              </div>
            </div>

            {/* Provides / receives */}
            <div className="mt-16">
              <h3 className="mb-6 text-center text-[13px] font-bold uppercase tracking-widest text-slate-400">
                Provides vs. Receives — Unassign
              </h3>
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
            </div>

            {/* Payloads */}
            <div className="mt-16">
              <h3 className="mb-6 text-center text-[13px] font-bold uppercase tracking-widest text-slate-400">
                Sample payloads — Unassign
              </h3>
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
            </div>
          </section>

          <footer className="mt-20 border-t border-slate-200/60 pt-8 text-center text-[13px] font-medium text-slate-400">
            Documents the flows as they exist in code at build time — no assign/unassign logic is changed.
          </footer>
        </div>
      </div>
    </>
  );
}
