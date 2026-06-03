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
  { label: string; icon: typeof Truck; chip: string; dot: string; ring: string; soft: string; text: string; bg: string }
> = {
  tpms: {
    label: "TPMS",
    icon: Truck,
    chip: "border-[#0ea5e9] text-[#0ea5e9] bg-[#0ea5e9]/10",
    dot: "bg-[#0ea5e9] shadow-[0_0_8px_#0ea5e9]",
    ring: "border-l-[#0ea5e9]",
    soft: "bg-[#0ea5e9]/5 border-[#0ea5e9]/30",
    text: "text-[#0ea5e9]",
    bg: "bg-[#0ea5e9]/10",
  },
  holman: {
    label: "Holman",
    icon: Boxes,
    chip: "border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/10",
    dot: "bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]",
    ring: "border-l-[#f59e0b]",
    soft: "bg-[#f59e0b]/5 border-[#f59e0b]/30",
    text: "text-[#f59e0b]",
    bg: "bg-[#f59e0b]/10",
  },
  ams: {
    label: "AMS",
    icon: Server,
    chip: "border-[#c084fc] text-[#c084fc] bg-[#c084fc]/10",
    dot: "bg-[#c084fc] shadow-[0_0_8px_#c084fc]",
    ring: "border-l-[#c084fc]",
    soft: "bg-[#c084fc]/5 border-[#c084fc]/30",
    text: "text-[#c084fc]",
    bg: "bg-[#c084fc]/10",
  },
  snowflake: {
    label: "Snowflake",
    icon: Snowflake,
    chip: "border-[#2dd4bf] text-[#2dd4bf] bg-[#2dd4bf]/10",
    dot: "bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf]",
    ring: "border-l-[#2dd4bf]",
    soft: "bg-[#2dd4bf]/5 border-[#2dd4bf]/30",
    text: "text-[#2dd4bf]",
    bg: "bg-[#2dd4bf]/10",
  },
  nexus: {
    label: "Nexus PG",
    icon: Database,
    chip: "border-[#10b981] text-[#10b981] bg-[#10b981]/10",
    dot: "bg-[#10b981] shadow-[0_0_8px_#10b981]",
    ring: "border-l-[#10b981]",
    soft: "bg-[#10b981]/5 border-[#10b981]/30",
    text: "text-[#10b981]",
    bg: "bg-[#10b981]/10",
  },
};

function SystemBadge({ system }: { system: SystemKey }) {
  const s = SYSTEMS[system];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${s.chip}`}
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

/* --------------------------------- Flow nodes -------------------------------- */

function Terminal({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "good" | "bad" }) {
  const tones = {
    dark: "bg-[#0f172a] text-[#38bdf8] border-[#38bdf8]/40 shadow-[0_0_15px_rgba(56,189,248,0.15)]",
    good: "bg-[#064e3b] text-[#34d399] border-[#34d399]/40 shadow-[0_0_15px_rgba(52,211,153,0.15)]",
    bad: "bg-[#7f1d1d] text-[#f87171] border-[#f87171]/40 shadow-[0_0_15px_rgba(248,113,113,0.15)]",
  };
  return (
    <div className="flex justify-center my-2 relative z-10">
      <div className={`border px-4 py-2 text-xs font-bold tracking-wide ${tones[tone]}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
  const accent = system ? SYSTEMS[system].ring : "border-l-[#334155]";
  const bgAccent = system ? SYSTEMS[system].soft : "bg-[#0f172a]/80";
  const borderCore = system ? "border-[#1e293b]" : "border-[#1e293b]";
  
  return (
    <div
      className={`relative z-10 border border-l-4 p-3.5 backdrop-blur-sm ${borderCore} ${accent} ${bgAccent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#64748b]" />}
          <div>
            <div className="text-[13px] font-semibold text-[#f1f5f9] tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{title}</div>
            {detail && <div className="mt-1.5 text-[12px] leading-relaxed text-[#94a3b8]">{detail}</div>}
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
        className={`flex items-start gap-2 border px-2.5 py-2 text-[11px] font-medium ${
          isBad
            ? "border-[#ef4444]/30 bg-[#7f1d1d]/20 text-[#fca5a5]"
            : "border-[#64748b]/30 bg-[#1e293b]/50 text-[#cbd5e1]"
        }`}
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <span
          className={`px-1 py-0.5 text-[9px] font-bold uppercase leading-none mt-0.5 ${
            kind === "no" ? "bg-[#ef4444]/20 text-[#fca5a5]" : "bg-[#10b981]/20 text-[#6ee7b7]"
          }`}
        >
          {kind}
        </span>
        <div className="flex-1 mt-0.5">
          <span className="flex items-center gap-1.5">
            {isBad && <XCircle className="h-3.5 w-3.5 shrink-0 text-[#f87171]" />}
            <span>{b.label}</span>
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="relative z-10 border border-[#f59e0b]/50 bg-[#f59e0b]/10 p-4 shadow-[0_0_20px_rgba(245,158,11,0.05)] backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="h-4 w-4 text-[#fcd34d]" />
        <div className="text-[13px] font-bold text-[#fde68a]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          ? {question}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {branch(no, "no")}
        {branch(yes, "yes")}
      </div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-2 relative">
      <div className="absolute top-0 bottom-0 w-px bg-[#334155] -z-10"></div>
      {label && (
        <span className="mb-1 bg-[#0f172a] border border-[#334155] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] z-10" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </span>
      )}
      <ArrowDown className="h-4 w-4 text-[#475569] bg-[#050a15] z-10" />
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
    info: "border-[#38bdf8]/30 bg-[#0ea5e9]/10 text-[#bae6fd]",
    warn: "border-[#fbbf24]/30 bg-[#f59e0b]/10 text-[#fde68a]",
    good: "border-[#34d399]/30 bg-[#10b981]/10 text-[#a7f3d0]",
  };
  const iconColors = {
    info: "text-[#38bdf8]",
    warn: "text-[#fbbf24]",
    good: "text-[#34d399]",
  }
  return (
    <div className={`relative z-10 border px-3.5 py-3 text-[12px] leading-relaxed backdrop-blur-sm ${tones[tone]}`}>
      <div className="mb-1.5 flex items-center gap-2 font-bold tracking-wide uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {Icon && <Icon className={`h-3.5 w-3.5 ${iconColors[tone]}`} />}
        {title}
      </div>
      <div className="text-[#cbd5e1] opacity-90">{children}</div>
    </div>
  );
}

function ParallelGroup({ steps }: { steps: { system: SystemKey; title: string; detail?: string }[] }) {
  return (
    <div className="relative z-10 border border-dashed border-[#475569] bg-[#0f172a]/50 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <RefreshCw className="h-3.5 w-3.5" />
        Run in parallel
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s) => {
          const sys = SYSTEMS[s.system];
          const Icon = sys.icon;
          return (
            <div
              key={s.title}
              className={`border border-[#1e293b] border-l-4 bg-[#050a15] p-3 ${sys.ring}`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className="h-3.5 w-3.5 text-[#64748b]" />
                <SystemBadge system={s.system} />
              </div>
              <div className="text-[11px] font-bold text-[#f8fafc]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{s.title}</div>
              {s.detail && <div className="mt-1 text-[11px] text-[#64748b] leading-relaxed">{s.detail}</div>}
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
    <div className="mb-6 flex items-start gap-4 border-b border-[#334155] pb-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#38bdf8]/50 bg-[#0ea5e9]/20 text-sm font-bold text-[#38bdf8] shadow-[0_0_10px_rgba(14,165,233,0.2)]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {number}
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-wide text-[#f8fafc] uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>// {subtitle}</p>}
      </div>
    </div>
  );
}

function CodeBlock({ title, json }: { title: string; json: object }) {
  return (
    <div className="overflow-hidden border border-[#1e293b] bg-[#020617]">
      <div className="flex items-center gap-2 border-b border-[#1e293b] bg-[#0f172a] px-3 py-2">
        <FileJson className="h-3.5 w-3.5 text-[#38bdf8]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{title}</span>
      </div>
      <pre className="overflow-x-auto p-4 text-[11px] leading-relaxed text-[#38bdf8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
    <div className="border border-[#1e293b] bg-[#050a15] text-[12px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-[#1e293b] bg-[#0f172a] text-[10px] font-bold uppercase tracking-widest text-[#64748b]">
        <div className="px-3 py-2.5">Step</div>
        <div className="border-l border-[#1e293b] px-3 py-2.5 text-[#34d399]">Provides · read</div>
        <div className="border-l border-[#1e293b] px-3 py-2.5 text-[#38bdf8]">Receives · write</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.step}
          className={`grid grid-cols-[1.2fr_1fr_1fr] border-b border-[#1e293b] last:border-0 ${i % 2 ? "bg-[#0f172a]/40" : ""}`}
        >
          <div className="px-3 py-3 font-medium text-[#cbd5e1] flex items-center leading-snug">{r.step}</div>
          <div className="border-l border-[#1e293b] px-3 py-3 text-[#94a3b8] flex items-center">{r.provides}</div>
          <div className="border-l border-[#1e293b] px-3 py-3 text-[#94a3b8] flex items-center">{r.receives}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- Page ----------------------------------- */

export function Blueprint() {
  return (
    <div 
      className="min-h-screen relative bg-[#050a15] px-6 py-12 text-[#e2e8f0] antialiased"
      style={{
        backgroundImage: `
          linear-gradient(rgba(14, 165, 233, 0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(14, 165, 233, 0.05) 1px, transparent 1px)
        `,
        backgroundSize: "20px 20px"
      }}
    >
      <style dangerouslySetInlineStyle={{
        __html: `
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        `
      }} />

      <div className="mx-auto max-w-5xl relative">
        {/* Header */}
        <header className="mb-12 border-b border-[#334155] pb-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="border border-[#10b981] bg-[#10b981]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#10b981] shadow-[0_0_10px_rgba(16,185,129,0.2)]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Nexus
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#475569]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Fleet Operations // SYS.ARCH.V1
            </span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[#f8fafc] uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Assign / Unassign Tech
          </h1>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            End-to-end orchestration of technician-to-vehicle assignment across TPMS, Holman, AMS, and
            Nexus (PostgreSQL) — the decision logic and which systems provide vs. receive data at each
            step.
          </p>
        </header>

        {/* Legend */}
        <div className="mb-12 border border-[#1e293b] bg-[#0f172a]/80 p-5 backdrop-blur-md">
          <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#64748b]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <div className="h-px w-4 bg-[#64748b]"></div>
            Systems Legend
            <div className="h-px w-full flex-1 bg-[#1e293b]"></div>
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
                <div key={k} className={`border border-[#1e293b] bg-[#050a15] p-3.5`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    <Icon className={`h-4 w-4 ${s.text}`} />
                    <span className="text-[12px] font-bold tracking-wide uppercase text-[#e2e8f0]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{s.label}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#64748b]">{blurb[k]}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================= ASSIGN ============================= */}
        <section className="mb-16">
          <SectionTitle
            number="1"
            title="Assign Tech"
            subtitle="POST /api/fleet-ops/assign — fans out into up to 3 operations before the main assign"
          />

          {/* Fan-out summary */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {[
              { n: "1", t: "Auto-unassign", d: "Pull the incoming tech off any prior truck." },
              { n: "2", t: "Displacement-unassign", d: "Clear whoever occupies the target truck." },
              { n: "3", t: "Main assign", d: "TPMS + Holman + AMS, then one DB write-through." },
            ].map((x) => (
              <div key={x.n} className="border border-[#1e293b] bg-[#0f172a]/60 p-4 relative backdrop-blur-sm">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                  <span className="text-4xl font-black italic" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{x.n}</span>
                </div>
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className="flex h-5 w-5 items-center justify-center border border-[#38bdf8]/50 bg-[#38bdf8]/10 text-[10px] font-bold text-[#38bdf8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {x.n}
                  </span>
                  <span className="text-[12px] font-bold text-[#f8fafc] uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{x.t}</span>
                </div>
                <p className="text-[11px] text-[#94a3b8] leading-relaxed relative z-10">{x.d}</p>
              </div>
            ))}
          </div>

          {/* Main flow */}
          <div className="mx-auto max-w-2xl relative">
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
            <Callout title="TPMS post-assign verify" tone="good" icon={CheckCircle2}>
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
            <div className="my-2 flex justify-center">
              <Callout title="Skip-email name lookup" tone="warn" icon={Mail}>
                On skip, the tech name is read from Snowflake <code>all_techs</code> for the email.
              </Callout>
            </div>
            <Arrow />
            <div className="relative z-10 border border-[#10b981]/50 bg-[#10b981]/10 p-4 shadow-[0_0_15px_rgba(16,185,129,0.1)] backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#10b981]" />
                  <span className="text-[13px] font-bold text-[#34d399] tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>WRITE-THROUGH CACHES</span>
                </div>
                <SystemBadge system="nexus" />
              </div>
              <p className="text-[12px] text-[#6ee7b7] opacity-80">
                Single DB transaction — plan all mutations, then commit atomically. (detailed below)
              </p>
            </div>
            <Arrow />
            <Step title="buildResult — OperationResult" icon={ChevronRight} />
            <Arrow />
            <div className="grid grid-cols-3 gap-3">
              <Terminal tone="good">200 · all success</Terminal>
              <Terminal tone="dark">207 · partial</Terminal>
              <Terminal tone="bad">500 · none</Terminal>
            </div>
          </div>

          {/* Pre-unassign subroutine */}
          <div className="mt-12 border border-[#1e293b] bg-[#0f172a] p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-2 w-2 bg-[#fcd34d] shadow-[0_0_5px_#fcd34d]"></div>
              <h3 className="text-[12px] font-bold tracking-wider text-[#f8fafc] uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Auto-unassign / Displacement-unassign subroutine
              </h3>
            </div>
            <p className="mb-5 text-[11px] text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Both pre-steps share the same shape — only the target truck + tech differ.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 text-[11px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {[
                "Create fleet_operation_log (unassign, pending)",
                "Parallel: callTpms · callHolman · callAms unassign",
                "writeThroughCaches (action=unassign, source=auto_unassign | displacement)",
                "logAllEvents",
              ].map((s, i, arr) => (
                <div key={s} className="flex items-center gap-2.5">
                  <span className="border border-[#334155] bg-[#050a15] px-3 py-1.5 text-[#cbd5e1]">
                    {s}
                  </span>
                  {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-[#475569]" />}
                </div>
              ))}
            </div>
          </div>

          {/* Write-through transaction */}
          <div className="mt-8 border border-[#10b981]/30 bg-[#064e3b]/30 p-6 backdrop-blur-sm">
            <div className="mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#10b981]" />
              <h3 className="text-[12px] font-bold tracking-wider text-[#34d399] uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Write-through transaction — single DB tx
              </h3>
            </div>
            <p className="mb-6 text-[11px] text-[#a7f3d0]/70" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              A partial failure can never leave one tech pointing at a truck while the prior holder
              still claims it.
            </p>
            <div className="mx-auto max-w-2xl">
              <Terminal tone="good">db.transaction · BEGIN</Terminal>
              <Arrow />
              <div className="space-y-3">
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
          <div className="mt-12 mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1e293b]"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Provides vs. Receives — Assign
            </h3>
            <div className="h-px flex-1 bg-[#1e293b]"></div>
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
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="tpms" /> <span className="text-[#38bdf8]">getTechInfo</span>
                  </span>
                ),
                receives: "—",
              },
              {
                step: "TPMS assign",
                provides: "request body",
                receives: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="tpms" /> <span className="text-[#38bdf8]">PUT /techinfo</span>
                  </span>
                ),
              },
              {
                step: "Holman assign",
                provides: "request body",
                receives: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="holman" /> <span className="text-[#38bdf8]">submission (async confirm)</span>
                  </span>
                ),
              },
              {
                step: "AMS assign",
                provides: (
                  <span className="flex items-center gap-1.5">
                    body · <SystemBadge system="snowflake" /> <span className="text-[#38bdf8]">on skip</span>
                  </span>
                ),
                receives: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="ams" /> <span className="text-[#38bdf8]">VIN↔tech (or skip + email)</span>
                  </span>
                ),
              },
              {
                step: "Write-through",
                provides: "plan from above",
                receives: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="nexus" /> <span className="text-[#38bdf8]">all caches + canonical + history + op log</span>
                  </span>
                ),
              },
            ]}
          />

          {/* Payloads */}
          <div className="mt-10 mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1e293b]"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Sample payloads — Assign
            </h3>
            <div className="h-px flex-1 bg-[#1e293b]"></div>
          </div>
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
        <section className="mb-16">
          <SectionTitle
            number="2"
            title="Unassign Tech"
            subtitle="Two entry points — same goal (clear truck + audit), different reach into external systems"
          />

          {/* Entry comparison */}
          <div className="mb-10 grid gap-4 lg:grid-cols-2">
            <div className="border border-[#334155] bg-[#0f172a] p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center border border-[#94a3b8] bg-[#1e293b] text-[11px] font-bold text-[#e2e8f0]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  A
                </span>
                <span className="text-[13px] font-bold text-[#f8fafc] uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Lightweight · Nexus-only</span>
              </div>
              <p className="text-[11px] text-[#38bdf8] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                DELETE /api/vehicle-assignments/:techRacfid → <code className="text-[#e2e8f0]">unassignVehicle</code>
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#94a3b8] uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                External systems: <span className="font-bold text-[#e2e8f0]">none</span> · returns{" "}
                <span className="border border-[#334155] bg-[#050a15] px-1.5 py-0.5 text-[#38bdf8]">AggregatedVehicleAssignment</span>
              </div>
            </div>
            <div className="border border-[#0ea5e9]/50 bg-[#0ea5e9]/10 p-5 shadow-[0_0_15px_rgba(14,165,233,0.1)]">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center border border-[#0ea5e9] bg-[#0ea5e9]/20 text-[11px] font-bold text-[#0ea5e9]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  B
                </span>
                <span className="text-[13px] font-bold text-[#bae6fd] uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Cross-system</span>
              </div>
              <p className="text-[11px] text-[#38bdf8] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                POST /api/fleet-ops/unassign → <code className="text-[#e2e8f0]">unassignTech</code>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SystemBadge system="tpms" />
                <SystemBadge system="holman" />
                <SystemBadge system="ams" />
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>· returns OperationResult</span>
              </div>
            </div>
          </div>

          {/* Two flows side by side */}
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Entry A */}
            <div className="border border-[#1e293b] bg-[#0f172a]/80 p-6 backdrop-blur-md">
              <h3 className="mb-6 flex items-center gap-2 text-[12px] font-bold text-[#f8fafc] tracking-wide uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                <span className="flex h-5 w-5 items-center justify-center border border-[#94a3b8] text-[10px] text-[#e2e8f0]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
            <div className="border border-[#0ea5e9]/30 bg-[#020617] p-6 shadow-[0_0_20px_rgba(14,165,233,0.05)]">
              <h3 className="mb-6 flex items-center gap-2 text-[12px] font-bold text-[#bae6fd] tracking-wide uppercase" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                <span className="flex h-5 w-5 items-center justify-center border border-[#0ea5e9] bg-[#0ea5e9]/20 text-[10px] text-[#0ea5e9]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
              <div className="relative z-10 border border-[#10b981]/50 bg-[#10b981]/10 p-3 shadow-[0_0_15px_rgba(16,185,129,0.1)] backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <Database className="h-3.5 w-3.5 text-[#10b981]" />
                  <span className="text-[11px] font-bold text-[#34d399] tracking-widest uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    WRITE-THROUGH CACHES · single tx
                  </span>
                </div>
                <p className="text-[11px] text-[#6ee7b7] opacity-80" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
                <Terminal tone="dark">207</Terminal>
                <Terminal tone="bad">500</Terminal>
              </div>
              <div className="mt-6">
                <Callout title="Holman confirm — asynchronous" tone="warn" icon={AlertTriangle}>
                  <span className="text-[#94a3b8]">
                    The submission is verified later from the Holman fleet sync — an{" "}
                    <code className="text-[#fde68a]">assignedStatus</code> containing "unassign" (or a blank tech) marks it confirmed,
                    then propagates to fleet_operation_log.
                  </span>
                </Callout>
              </div>
            </div>
          </div>

          {/* Provides / receives */}
          <div className="mt-12 mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1e293b]"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Provides vs. Receives — Unassign
            </h3>
            <div className="h-px flex-1 bg-[#1e293b]"></div>
          </div>
          <ProvidesReceives
            rows={[
              {
                step: "Validate assignment exists (A)",
                provides: <span className="text-[#38bdf8]">tech_vehicle_assignments</span>,
                receives: "—",
              },
              {
                step: "Nexus clear (A & B)",
                provides: "prior row",
                receives: <span className="text-[#38bdf8]">tech_vehicle_assignments (null, inactive)</span>,
              },
              {
                step: "Audit append (A & B)",
                provides: "prior truck",
                receives: <span className="text-[#38bdf8]">tech_vehicle_assignment_history (unassigned)</span>,
              },
              {
                step: "Response enrichment (A)",
                provides: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="snowflake" /> <span className="text-[#38bdf8]">all_techs</span>
                  </span>
                ),
                receives: "—",
              },
              {
                step: "TPMS unassign (B)",
                provides: "request",
                receives: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="tpms" /> <span className="text-[#38bdf8]">PUT /techinfo (truckNo="")</span>
                  </span>
                ),
              },
              {
                step: "Holman confirm (B)",
                provides: (
                  <span className="flex items-center gap-1.5">
                    <SystemBadge system="holman" /> <span className="text-[#38bdf8]">fleet sync</span>
                  </span>
                ),
                receives: <span className="text-[#38bdf8]">holman_submissions, fleet_operation_log</span>,
              },
            ]}
          />

          {/* Payloads */}
          <div className="mt-10 mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1e293b]"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Sample payloads — Unassign
            </h3>
            <div className="h-px flex-1 bg-[#1e293b]"></div>
          </div>
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

        <footer className="border-t border-[#1e293b] pt-6 pb-12 text-center text-[11px] text-[#475569] uppercase tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Documents the flows as they exist in code at build time — no assign/unassign logic is changed.
        </footer>
      </div>
    </div>
  );
}
