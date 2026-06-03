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
  { label: string; icon: typeof Truck; chip: string; dot: string; ring: string; soft: string }
> = {
  tpms: {
    label: "TPMS",
    icon: Truck,
    chip: "bg-sky-100 text-sky-800 border-sky-300",
    dot: "bg-sky-500",
    ring: "border-l-sky-500",
    soft: "bg-sky-50",
  },
  holman: {
    label: "Holman",
    icon: Boxes,
    chip: "bg-amber-100 text-amber-800 border-amber-300",
    dot: "bg-amber-500",
    ring: "border-l-amber-500",
    soft: "bg-amber-50",
  },
  ams: {
    label: "AMS",
    icon: Server,
    chip: "bg-violet-100 text-violet-800 border-violet-300",
    dot: "bg-violet-500",
    ring: "border-l-violet-500",
    soft: "bg-violet-50",
  },
  snowflake: {
    label: "Snowflake",
    icon: Snowflake,
    chip: "bg-cyan-100 text-cyan-800 border-cyan-300",
    dot: "bg-cyan-500",
    ring: "border-l-cyan-500",
    soft: "bg-cyan-50",
  },
  nexus: {
    label: "Nexus PG",
    icon: Database,
    chip: "bg-emerald-100 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-500",
    ring: "border-l-emerald-500",
    soft: "bg-emerald-50",
  },
};

function SystemBadge({ system }: { system: SystemKey }) {
  const s = SYSTEMS[system];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}
    >
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

/* --------------------------------- Flow nodes -------------------------------- */

function Terminal({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "good" | "bad" }) {
  const tones = {
    dark: "bg-slate-900 text-white",
    good: "bg-emerald-600 text-white",
    bad: "bg-rose-600 text-white",
  };
  return (
    <div className="flex justify-center">
      <div className={`rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm ${tones[tone]}`}>
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
  const accent = system ? SYSTEMS[system].ring : "border-l-slate-300";
  return (
    <div
      className={`rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            {detail && <div className="mt-1 text-[13px] leading-relaxed text-slate-500">{detail}</div>}
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
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
          isBad
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
      >
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            kind === "no" ? "bg-rose-200 text-rose-800" : "bg-emerald-200 text-emerald-800"
          }`}
        >
          {kind}
        </span>
        {isBad && <XCircle className="h-3.5 w-3.5" />}
        <span className="font-medium">{b.label}</span>
      </div>
    );
  };
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-amber-600" />
        <div className="text-sm font-semibold text-amber-900">{question}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {branch(no, "no")}
        {branch(yes, "yes")}
      </div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1.5">
      {label && (
        <span className="mb-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      <ArrowDown className="h-4 w-4 text-slate-300" />
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
    info: "border-slate-200 bg-slate-50 text-slate-600",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed ${tones[tone]}`}>
      <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </div>
      {children}
    </div>
  );
}

function ParallelGroup({ steps }: { steps: { system: SystemKey; title: string; detail?: string }[] }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <RefreshCw className="h-3.5 w-3.5" />
        Run in parallel
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {steps.map((s) => {
          const sys = SYSTEMS[s.system];
          const Icon = sys.icon;
          return (
            <div
              key={s.title}
              className={`rounded-lg border border-slate-200 border-l-4 bg-white p-3 shadow-sm ${sys.ring}`}
            >
              <div className="flex items-center justify-between">
                <Icon className="h-4 w-4 text-slate-400" />
                <SystemBadge system={s.system} />
              </div>
              <div className="mt-1.5 text-[13px] font-semibold text-slate-900">{s.title}</div>
              {s.detail && <div className="mt-0.5 text-[12px] text-slate-500">{s.detail}</div>}
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
    <div className="mb-5 flex items-end gap-3 border-b border-slate-200 pb-3">
      <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-lg font-black text-white">{number}</span>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function CodeBlock({ title, json }: { title: string; json: object }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-800 px-3 py-1.5">
        <FileJson className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[12px] font-semibold text-slate-300">{title}</span>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-slate-200">
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <div className="px-3 py-2">Step</div>
        <div className="border-l border-slate-200 px-3 py-2 text-emerald-600">Provides · read</div>
        <div className="border-l border-slate-200 px-3 py-2 text-sky-600">Receives · write</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.step}
          className={`grid grid-cols-[1.2fr_1fr_1fr] text-[12.5px] ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}
        >
          <div className="px-3 py-2 font-medium text-slate-800">{r.step}</div>
          <div className="border-l border-slate-100 px-3 py-2 text-slate-600">{r.provides}</div>
          <div className="border-l border-slate-100 px-3 py-2 text-slate-600">{r.receives}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- Page ----------------------------------- */

export function FlowView() {
  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10 font-sans text-slate-900 antialiased">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-white">
              Nexus
            </span>
            <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
              Fleet Operations
            </span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900">
            Assign / Unassign Tech
          </h1>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-600">
            End-to-end orchestration of technician-to-vehicle assignment across TPMS, Holman, AMS, and
            Nexus (PostgreSQL) — the decision logic and which systems provide vs. receive data at each
            step.
          </p>
        </header>

        {/* Legend */}
        <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Systems
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                <div key={k} className={`rounded-xl border border-slate-200 p-3 ${s.soft}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                    <Icon className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-bold text-slate-800">{s.label}</span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-slate-500">{blurb[k]}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================= ASSIGN ============================= */}
        <section className="mb-14">
          <SectionTitle
            number="1"
            title="Assign Tech"
            subtitle="POST /api/fleet-ops/assign — fans out into up to 3 operations before the main assign"
          />

          {/* Fan-out summary */}
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {[
              { n: "1", t: "Auto-unassign", d: "Pull the incoming tech off any prior truck." },
              { n: "2", t: "Displacement-unassign", d: "Clear whoever occupies the target truck." },
              { n: "3", t: "Main assign", d: "TPMS + Holman + AMS, then one DB write-through." },
            ].map((x) => (
              <div key={x.n} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[12px] font-bold text-white">
                    {x.n}
                  </span>
                  <span className="text-sm font-bold text-slate-900">{x.t}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-slate-500">{x.d}</p>
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
            <div className="my-1.5 flex justify-center">
              <Callout title="Skip-email name lookup" tone="warn" icon={Mail}>
                On skip, the tech name is read from Snowflake <code>all_techs</code> for the email.
              </Callout>
            </div>
            <Arrow />
            <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-900">WRITE-THROUGH CACHES</span>
                </div>
                <SystemBadge system="nexus" />
              </div>
              <p className="mt-1 text-[13px] text-emerald-800">
                Single DB transaction — plan all mutations, then commit atomically. (detailed below)
              </p>
            </div>
            <Arrow />
            <Step title="buildResult — OperationResult" icon={ChevronRight} />
            <Arrow />
            <div className="grid grid-cols-3 gap-2">
              <Terminal tone="good">200 · all success</Terminal>
              <Terminal>207 · partial</Terminal>
              <Terminal tone="bad">500 · none</Terminal>
            </div>
          </div>

          {/* Pre-unassign subroutine */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-slate-900">
              Auto-unassign / Displacement-unassign subroutine
            </h3>
            <p className="mb-4 text-[12.5px] text-slate-500">
              Both pre-steps share the same shape — only the target truck + tech differ.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              {[
                "Create fleet_operation_log (unassign, pending)",
                "Parallel: callTpms · callHolman · callAms unassign",
                "writeThroughCaches (action=unassign, source=auto_unassign | displacement)",
                "logAllEvents",
              ].map((s, i, arr) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-medium text-slate-700">
                    {s}
                  </span>
                  {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-slate-300" />}
                </div>
              ))}
            </div>
          </div>

          {/* Write-through transaction */}
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Write-through transaction — single DB tx
              </h3>
            </div>
            <p className="mb-4 text-[12.5px] text-slate-500">
              A partial failure can never leave one tech pointing at a truck while the prior holder
              still claims it.
            </p>
            <div className="mx-auto max-w-2xl">
              <Terminal tone="good">db.transaction · BEGIN</Terminal>
              <Arrow />
              <div className="space-y-2">
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
          <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">
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
                  <span className="flex items-center gap-1">
                    <SystemBadge system="tpms" /> getTechInfo
                  </span>
                ),
                receives: "—",
              },
              {
                step: "TPMS assign",
                provides: "request body",
                receives: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="tpms" /> PUT /techinfo
                  </span>
                ),
              },
              {
                step: "Holman assign",
                provides: "request body",
                receives: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="holman" /> submission (async confirm)
                  </span>
                ),
              },
              {
                step: "AMS assign",
                provides: (
                  <span className="flex items-center gap-1">
                    body · <SystemBadge system="snowflake" /> on skip
                  </span>
                ),
                receives: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="ams" /> VIN↔tech (or skip + email)
                  </span>
                ),
              },
              {
                step: "Write-through",
                provides: "plan from above",
                receives: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="nexus" /> all caches + canonical + history + op log
                  </span>
                ),
              },
            ]}
          />

          {/* Payloads */}
          <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">
            Sample payloads — Assign
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
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
        <section className="mb-10">
          <SectionTitle
            number="2"
            title="Unassign Tech"
            subtitle="Two entry points — same goal (clear truck + audit), different reach into external systems"
          />

          {/* Entry comparison */}
          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                  A
                </span>
                <span className="text-sm font-bold text-slate-900">Lightweight · Nexus-only</span>
              </div>
              <p className="text-[12.5px] text-slate-500">
                DELETE /api/vehicle-assignments/:techRacfid → <code>unassignVehicle</code>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                External systems: <span className="font-semibold text-slate-700">none</span> · returns{" "}
                <span className="font-mono">AggregatedVehicleAssignment</span>
              </div>
            </div>
            <div className="rounded-2xl border-2 border-sky-300 bg-sky-50/40 p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                  B
                </span>
                <span className="text-sm font-bold text-slate-900">Cross-system</span>
              </div>
              <p className="text-[12.5px] text-slate-500">
                POST /api/fleet-ops/unassign → <code>unassignTech</code>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <SystemBadge system="tpms" />
                <SystemBadge system="holman" />
                <SystemBadge system="ams" />
                <span className="text-[12px] text-slate-500">· returns OperationResult</span>
              </div>
            </div>
          </div>

          {/* Two flows side by side */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Entry A */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[12px] font-bold text-white">
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
            <div className="rounded-2xl border border-sky-200 bg-sky-50/30 p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-[12px] font-bold text-white">
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
              <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-600" />
                  <span className="text-[13px] font-bold text-emerald-900">
                    WRITE-THROUGH CACHES · single tx
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-emerald-800">
                  Nexus clear (truckNo=null, inactive) + history changeType=unassigned
                </p>
              </div>
              <Arrow />
              <Step title="logAllEvents + update op log statuses" system="nexus" icon={Database} />
              <Arrow />
              <Step title="buildResult — OperationResult" icon={ChevronRight} />
              <Arrow />
              <div className="grid grid-cols-3 gap-2">
                <Terminal tone="good">200</Terminal>
                <Terminal>207</Terminal>
                <Terminal tone="bad">500</Terminal>
              </div>
              <div className="mt-4">
                <Callout title="Holman confirm — asynchronous" tone="warn" icon={AlertTriangle}>
                  The submission is verified later from the Holman fleet sync — an{" "}
                  <code>assignedStatus</code> containing "unassign" (or a blank tech) marks it confirmed,
                  then propagates to fleet_operation_log.
                </Callout>
              </div>
            </div>
          </div>

          {/* Provides / receives */}
          <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">
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
                  <span className="flex items-center gap-1">
                    <SystemBadge system="snowflake" /> all_techs
                  </span>
                ),
                receives: "—",
              },
              {
                step: "TPMS unassign (B)",
                provides: "request",
                receives: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="tpms" /> PUT /techinfo (truckNo="")
                  </span>
                ),
              },
              {
                step: "Holman confirm (B)",
                provides: (
                  <span className="flex items-center gap-1">
                    <SystemBadge system="holman" /> fleet sync
                  </span>
                ),
                receives: "holman_submissions, fleet_operation_log",
              },
            ]}
          />

          {/* Payloads */}
          <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">
            Sample payloads — Unassign
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
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

        <footer className="border-t border-slate-200 pt-4 text-center text-[12px] text-slate-400">
          Documents the flows as they exist in code at build time — no assign/unassign logic is changed.
        </footer>
      </div>
    </div>
  );
}
