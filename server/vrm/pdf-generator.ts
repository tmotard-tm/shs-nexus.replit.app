/**
 * VRM audit PDF generator using pdfkit.
 * Produces a consultant-style waterfall PDF for any tech.
 */
import PDFDocument from "pdfkit";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { vrmTechs, vrmOutreachLog, vrmEscalations } from "../../shared/vrm-schema";

interface AuditData {
  tech: {
    name: string; ldap: string; market: string | null; dcaName: string | null;
    tenureMonths: number | null; rentalStartDate: string | null;
    gate1AdjustedNet: string | null; gate1Classification: string | null;
    gate2Exempt: boolean; newHireExempt: boolean;
    dcaReviewOutcome: string | null; dcaReviewNotes: string | null;
    currentStatus: string;
  };
  outreach: Array<{ actionType: string; outcome: string | null; performedByName: string | null; createdAt: string }>;
  escalation: {
    reason: string | null; carlOutcomeNotes: string | null; status: string;
    createdAt: string; rentalStopDate: string | null;
  } | null;
}

async function loadAuditData(techId: string): Promise<AuditData> {
  const [tech] = await db.select().from(vrmTechs).where(eq(vrmTechs.id, techId)).limit(1);
  if (!tech) throw new Error(`Tech ${techId} not found`);

  const outreach = await db.select().from(vrmOutreachLog).where(eq(vrmOutreachLog.techId, techId)).orderBy(desc(vrmOutreachLog.createdAt));

  const escalations = await db.select().from(vrmEscalations).where(eq(vrmEscalations.techId, techId)).orderBy(desc(vrmEscalations.createdAt)).limit(1);
  const escalation = escalations[0] ?? null;

  return {
    tech: {
      name: tech.name, ldap: tech.ldap, market: tech.market, dcaName: tech.dcaName,
      tenureMonths: tech.tenureMonths, rentalStartDate: tech.rentalStartDate as string | null,
      gate1AdjustedNet: tech.gate1AdjustedNet as string | null,
      gate1Classification: tech.gate1Classification,
      gate2Exempt: tech.gate2Exempt, newHireExempt: tech.newHireExempt,
      dcaReviewOutcome: tech.dcaReviewOutcome, dcaReviewNotes: tech.dcaReviewNotes,
      currentStatus: tech.currentStatus,
    },
    outreach: outreach.map((o) => ({
      actionType: o.actionType,
      outcome: o.outcome,
      performedByName: o.performedByName,
      createdAt: o.createdAt.toISOString(),
    })),
    escalation: escalation ? {
      reason: escalation.reason,
      carlOutcomeNotes: escalation.carlOutcomeNotes,
      status: escalation.status,
      createdAt: escalation.createdAt.toISOString(),
      rentalStopDate: escalation.rentalStopDate as string | null,
    } : null,
  };
}

function actionLabel(t: string) {
  const m: Record<string, string> = {
    text_sent: "Text Sent",
    call_completed: "Call Completed",
    carl_escalated: "Escalated to Carl",
    epv_issued: "EPV Issued",
    byov_enrolled: "BYOV Enrolled",
    exception_opened: "Exception Opened",
  };
  return m[t] ?? t;
}

function fmtTs(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function generateAuditPdf(techId: string): Promise<Buffer> {
  const data = await loadAuditData(techId);
  const { tech, outreach, escalation } = data;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const INK = "#0F1117";
    const MUTED = "#8891A4";
    const RULE = "#E8EAEF";
    const RED = "#DC2626";
    const GREEN = "#0D9668";
    const ACCENT = "#1A56DB";

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(20).font("Helvetica-Bold").fillColor(INK).text("Rental Reduction — Tech Audit Report", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(`Generated ${new Date().toLocaleString()} — Transformco Fleet Ops`);
    doc.moveDown(1);
    doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor(RULE).stroke();
    doc.moveDown(0.8);

    // ── Tech identity ────────────────────────────────────────────────────────
    doc.fontSize(16).font("Helvetica-Bold").fillColor(INK).text(tech.name);
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(`LDAP: ${tech.ldap}  ·  Market: ${tech.market ?? "—"}  ·  DCA: ${tech.dcaName ?? "—"}`);
    doc.fontSize(10).fillColor(MUTED).text(`Status: ${tech.currentStatus.replace(/_/g, " ").toUpperCase()}  ·  Tenure: ${tech.tenureMonths ?? "—"} months  ·  Rental Start: ${tech.rentalStartDate ?? "—"}`);
    doc.moveDown(1);

    // ── Gate 1 ────────────────────────────────────────────────────────────────
    doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text("Gate 1 — Adjusted Net");
    doc.moveDown(0.3);
    const net = tech.gate1AdjustedNet ? Number(tech.gate1AdjustedNet) : null;
    const netColor = tech.gate1Classification === "underwater" ? RED : tech.gate1Classification === "marginal" ? "#B45309" : GREEN;
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text("Adjusted Net: ", { continued: true });
    doc.fillColor(net !== null ? netColor : MUTED).text(
      net !== null ? `${net < 0 ? "−" : "+"}$${Math.abs(net).toLocaleString()}` : "Not calculated",
      { continued: true }
    );
    doc.fillColor(MUTED).text(`  Classification: ${tech.gate1Classification ?? "—"}`);
    doc.moveDown(0.8);

    // ── Gate 2 ────────────────────────────────────────────────────────────────
    doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text("Gate 2 — Scorecard");
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(
      tech.newHireExempt ? "New Hire Exempt (< 6 months tenure)"
      : tech.gate2Exempt ? "Exempt — Scorecard (T4/T5)"
      : "Assessed — in scope"
    );
    doc.moveDown(0.8);

    // ── DCA Review ────────────────────────────────────────────────────────────
    doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text("DCA Review");
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(`Outcome: ${tech.dcaReviewOutcome ?? "Pending"}`);
    if (tech.dcaReviewNotes) doc.text(`Notes: ${tech.dcaReviewNotes}`);
    doc.moveDown(0.8);

    // ── Outreach log ──────────────────────────────────────────────────────────
    doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text("Full Outreach Log");
    doc.moveDown(0.3);
    if (outreach.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(MUTED).text("No outreach entries recorded");
    } else {
      for (const entry of outreach) {
        doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text(actionLabel(entry.actionType), { continued: true });
        doc.font("Helvetica").fillColor(MUTED).text(`  — ${fmtTs(entry.createdAt)}${entry.performedByName ? ` by ${entry.performedByName}` : ""}`);
        if (entry.outcome) doc.fontSize(9).fillColor(MUTED).text(`   ${entry.outcome}`);
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(0.5);

    // ── Escalation ────────────────────────────────────────────────────────────
    if (escalation) {
      doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor(RULE).stroke();
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text("Escalation Details");
      doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(`Status: ${escalation.status.replace(/_/g, " ").toUpperCase()}  ·  Opened: ${fmtTs(escalation.createdAt)}`);
      if (escalation.reason) doc.text(`Reason: ${escalation.reason}`);
      if (escalation.carlOutcomeNotes) doc.text(`Carl's Notes: ${escalation.carlOutcomeNotes}`);
      if (escalation.rentalStopDate) {
        doc.fillColor(RED).text(`Rental Stop Date: ${escalation.rentalStopDate}`);
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(MUTED).text(
      `Confidential — Transformco Fleet Operations — ${new Date().toLocaleDateString()}`,
      48, doc.page.height - 40,
      { align: "center" }
    );

    doc.end();
  });
}
