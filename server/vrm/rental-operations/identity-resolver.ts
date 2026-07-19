/**
 * VRM Rental Operations — identity resolver (TS port of resolve_identity_v2.py).
 *
 * The open-rental feed gives ONLY a truck number + a renter NAME (no employee
 * ID). So we fuzzy-match the renter name against the canonical roster
 * (`all_techs`, every `employee_id` unique), pin the employee_id, then read
 * employment status. Truck is NOT an identity path.
 *
 * This module is a PURE function of its inputs (roster rows + onboarding rows +
 * renter name + rental start). No DB access here so it is unit-testable and
 * deterministic; the DB loading lives in the ingest layer.
 *
 * Proven behaviour (365 renters, converged): 349 RESOLVED (311 high / 38
 * fuzzy-medium) / 5 REVIEW / 11 EXCEPTION. The residual is CORRECT, not bugs:
 * stale-namesake catches (Joseph Locke terminated 2019 vs 2026 rental),
 * anglicized names, all-terminated candidates, genuine same-name ambiguity,
 * and renters truly not on the roster. Never render a guess as fact — REVIEW
 * and EXCEPTION carry evidence, not an asserted status.
 */

export interface RosterRow {
  employee_id: string;
  /** "LAST,FIRST MI" form as stored in all_techs.tech_name */
  tech_name: string;
  employment_status: string | null; // A / T / L / NEW / P / R / RPE / RCS
  effective_date: string | null; // YYYY-MM-DD (or Date-ish)
  last_day_worked: string | null;
  district_no?: string | null;
}

export interface OnboardingRow {
  employee_name: string; // "LAST,FIRST MI"
  enterprise_id: string | null;
  service_date: string | null;
}

export type ResolutionState = "RESOLVED" | "REVIEW" | "EXCEPTION";
export type ResolutionConfidence = "high" | "medium" | "low";

export interface CandidateEvidence {
  employee_id: string;
  tech_name: string;
  employment_status: string | null;
  event_date: string | null;
  compatible: boolean;
}

export interface IdentityResolution {
  state: ResolutionState;
  employee_id?: string | null;
  status?: string | null; // human-readable employment status
  status_date?: string | null;
  confidence?: ResolutionConfidence | null;
  method?: string | null; // exact | fuzzy | onboarding fallback
  reason?: string | null; // why REVIEW / EXCEPTION
  tech_name?: string | null;
  district_no?: string | null;
  candidates?: CandidateEvidence[];
}

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const JUNK = new Set([
  "SEARS", "SERVICE", "SERVICES", "HOLDINGS", "MANAGEMENT",
  "INC", "LLC", "CORP", "HOLDING",
]);

// Bidirectional nickname groups (incl. common Spanish variants).
const NICK_GROUPS: string[][] = [
  ["CHRIS", "CHRISTOPHER", "CHRISTOPHE"], ["JOSH", "JOSHUA"], ["VINCE", "VINCENT"],
  ["PHIL", "PHILLIP", "PHILIP"], ["BEN", "BENJAMIN", "BENJAMÍN"], ["MIKE", "MICHAEL", "MICKEY"],
  ["BOB", "ROB", "ROBERT", "BOBBY", "ROBBIE"], ["BILL", "WILL", "WILLIAM", "BILLY", "WILLIE"],
  ["JIM", "JAMES", "JIMMY", "JIMMIE"], ["TOM", "THOMAS", "TOMMY"], ["DAVE", "DAVID", "DAVEY"],
  ["JOE", "JOSEPH", "JOEY"], ["NICK", "NICHOLAS", "NICKY"], ["DAN", "DANIEL", "DANNY"],
  ["MATT", "MATTHEW"], ["TONY", "ANTHONY"], ["KEN", "KENNETH", "KENNY"], ["ED", "EDWARD", "EDDIE", "EDUARDO"],
  ["STEVE", "STEVEN", "STEPHEN"], ["RICK", "RICH", "RICHARD", "RICHIE", "RICKY"],
  ["ANDY", "DREW", "ANDREW"], ["SAM", "SAMUEL", "SAMMY"], ["ALEX", "ALEXANDER", "ALEJANDRO"],
  ["GABE", "GABRIEL"], ["NATE", "NATHAN", "NATHANIEL"], ["GREG", "GREGORY"], ["JEFF", "JEFFREY", "JEFFERY"],
  ["RON", "RONALD", "RONNIE"], ["DON", "DONALD", "DONNIE"], ["FRED", "FREDERICK", "FREDDIE"],
  ["CHUCK", "CHARLIE", "CHARLES"], ["PAT", "PATRICK"], ["PETE", "PETER"], ["RAY", "RAYMOND"],
  ["SAL", "SALVADOR", "SALVATORE"], ["MANNY", "MANUEL"], ["FRANK", "FRANCISCO", "FRANKLIN"],
  ["LEO", "LEONARD", "LEONARDO"], ["MARC", "MARCUS", "MARCOS"], ["JON", "JONATHAN", "JOHNATHAN"],
  ["ZACH", "ZACHARY"], ["CAL", "CALVIN"], ["GUS", "GUSTAVO"], ["ABE", "ABRAHAM"],
  ["VINCE", "VINCENT", "VICENTE"], ["XAVIER", "JAVIER"], ["JOHN", "JUAN", "JON"],
];

const NICK: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const g of NICK_GROUPS) {
    for (const n of g) {
      if (!m.has(n)) m.set(n, new Set());
      for (const x of g) m.get(n)!.add(x);
    }
  }
  return m;
})();

const STATUS: Record<string, string> = {
  A: "Active", T: "Terminated", L: "On Leave", NEW: "New", P: "Pending",
  R: "Rehire", RPE: "Rehire pending", RCS: "Rehire contingent",
};

const ACTIVE_ISH = new Set(["A", "NEW", "P", "R", "RPE", "RCS"]);

/** Guarded Levenshtein: bail to 3 when the length gap alone exceeds 2. */
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
      ));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** difflib.SequenceMatcher.ratio() — Ratcliff/Obershelp, no autojunk (strings
 * here are short surnames, far below difflib's 200-char autojunk threshold). */
function seqRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const b2j = new Map<string, number[]>();
  for (let i = 0; i < b.length; i++) {
    if (!b2j.has(b[i])) b2j.set(b[i], []);
    b2j.get(b[i])!.push(i);
  }
  let matches = 0;
  const stack: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (stack.length) {
    const [alo, ahi, blo, bhi] = stack.pop()!;
    // find longest matching block within a[alo:ahi], b[blo:bhi]
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len = newj2len;
    }
    if (bestsize > 0) {
      matches += bestsize;
      if (alo < besti && blo < bestj) stack.push([alo, besti, blo, bestj]);
      if (besti + bestsize < ahi && bestj + bestsize < bhi) {
        stack.push([besti + bestsize, ahi, bestj + bestsize, bhi]);
      }
    }
  }
  return (2.0 * matches) / (a.length + b.length);
}

function normTokens(s: string | null | undefined): string[] {
  const toks = (s || "").toUpperCase().replace(/[^A-ZÀ-Ÿ]+/gi, " ").trim().split(/\s+/).filter(Boolean);
  const kept = toks.filter((t) => !SUFFIXES.has(t) && !JUNK.has(t));
  return kept.length ? kept : toks;
}

function firstMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (NICK.get(a)?.has(b)) return true;
  // guarded edit-distance: same first letter, both >=5 chars, <=2 edits
  // (spelling variants KAMERON/KAMRON, BRANDEN/BRENDAN, TERRANCE/TERENCE);
  // always paired with a strong last-name match, so safe.
  return a[0] === b[0] && Math.min(a.length, b.length) >= 5 && lev(a, b) <= 2;
}

function lastMatch(renterRest: string[], rosterRest: string[]): boolean {
  const rTokens = renterRest.filter((t) => t.length >= 4);
  const oSet = new Set(rosterRest.filter((t) => t.length >= 4));
  if (rTokens.some((t) => oSet.has(t))) return true;
  const rf = renterRest.join("");
  const of = rosterRest.join("");
  if (rf.length >= 6 && of.length >= 6 && (rf.includes(of) || of.includes(rf))) return true;
  if (rf.length >= 6 && of.length >= 6 && seqRatio(rf, of) >= 0.86) return true;
  return false;
}

function rosterDisplay(techName: string): string {
  const parts = (techName || "").split(",");
  return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : (techName || "");
}

function toDate(v: string | null | undefined): Date | null {
  const m = String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function dateStr(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function eventDate(t: RosterRow): Date | null {
  return t.employment_status === "L"
    ? (toDate(t.last_day_worked) || toDate(t.effective_date))
    : toDate(t.effective_date);
}

interface NormRoster { first: string; rest: string[]; row: RosterRow }

/** Pre-normalize the roster once per ingest run for O(renters * roster) matching. */
export function buildRosterIndex(roster: RosterRow[]): NormRoster[] {
  const out: NormRoster[] = [];
  for (const row of roster) {
    const tn = normTokens(rosterDisplay(row.tech_name));
    if (tn.length < 2) continue;
    out.push({ first: tn[0], rest: tn.slice(1), row });
  }
  return out;
}

function findCandidates(renter: string, index: NormRoster[]): { cands: RosterRow[]; method: "exact" | "fuzzy" | null } {
  const nm = normTokens(renter);
  if (nm.length < 2) return { cands: [], method: null };
  const rfirst = nm[0];
  const rrest = nm.slice(1);
  const exact: RosterRow[] = [];
  const fuzzy: RosterRow[] = [];
  for (const cand of index) {
    if (firstMatch(rfirst, cand.first) && lastMatch(rrest, cand.rest)) {
      const isExact = rfirst === cand.first && rrest[rrest.length - 1] === cand.rest[cand.rest.length - 1];
      (isExact ? exact : fuzzy).push(cand.row);
    }
  }
  if (exact.length) return { cands: exact, method: "exact" };
  if (fuzzy.length) return { cands: fuzzy, method: "fuzzy" };
  return { cands: [], method: null };
}

const GRACE_DAYS = 120;

export interface ResolverInputs {
  renter: string;
  rentalStart: string | null;
  rosterIndex: NormRoster[];
  onboarding?: OnboardingRow[];
}

export function resolveIdentity(inputs: ResolverInputs): IdentityResolution {
  const { renter, rentalStart, rosterIndex, onboarding = [] } = inputs;
  const { cands, method } = findCandidates(renter, rosterIndex);
  const rs = toDate(rentalStart);

  if (!cands.length) {
    // onboarding fallback (very-recent hires not yet in all_techs)
    const rnorm = normTokens(renter);
    for (const h of onboarding) {
      const hn = rosterDisplay(h.employee_name);
      const hnorm = normTokens(hn);
      if (hnorm.length >= 2 && rnorm.length >= 2
        && firstMatch(rnorm[0], hnorm[0]) && lastMatch(rnorm.slice(1), hnorm.slice(1))) {
        return {
          state: "RESOLVED",
          employee_id: h.enterprise_id,
          status: "New (onboarding)",
          status_date: String(h.service_date ?? "").slice(0, 10),
          confidence: "medium",
          method: "onboarding fallback",
          tech_name: h.employee_name,
        };
      }
    }
    return {
      state: "EXCEPTION",
      reason: "no roster or onboarding match (renter not on roster / anglicized name / dummy truck)",
    };
  }

  const compatible = (t: RosterRow): boolean => {
    if (t.employment_status && ACTIVE_ISH.has(t.employment_status)) return true;
    const ev = eventDate(t);
    if (!ev || !rs) return true;
    return ev.getTime() >= rs.getTime() - GRACE_DAYS * 86_400_000;
  };

  const evidence = (list: RosterRow[]): CandidateEvidence[] => list.map((t) => ({
    employee_id: t.employee_id,
    tech_name: t.tech_name,
    employment_status: t.employment_status,
    event_date: dateStr(eventDate(t)),
    compatible: compatible(t),
  }));

  const compat = cands.filter(compatible);
  const conf: ResolutionConfidence = method === "exact" && cands.length === 1 ? "high" : "medium";

  if (cands.length === 1 && !compat.length) {
    const t = cands[0];
    return {
      state: "EXCEPTION",
      reason: `only match is a stale ${STATUS[t.employment_status ?? ""] ?? t.employment_status} ${dateStr(eventDate(t))} predating rental ${dateStr(rs)} (different person)`,
      candidates: evidence(cands),
    };
  }
  if (compat.length === 1) {
    const t = compat[0];
    return {
      state: "RESOLVED",
      employee_id: t.employee_id,
      status: STATUS[t.employment_status ?? ""] ?? t.employment_status,
      status_date: dateStr(eventDate(t)),
      confidence: conf,
      method,
      tech_name: t.tech_name,
      district_no: t.district_no ?? null,
      candidates: evidence(cands),
    };
  }
  if (compat.length > 1) {
    // multiple compatible same-name — pick most-recent-activity but flag REVIEW
    const best = compat.reduce((a, b) => {
      const ea = eventDate(a)?.getTime() ?? 0;
      const eb = eventDate(b)?.getTime() ?? 0;
      return eb > ea ? b : a;
    });
    return {
      state: "REVIEW",
      employee_id: best.employee_id,
      status: STATUS[best.employment_status ?? ""] ?? best.employment_status,
      status_date: dateStr(eventDate(best)),
      confidence: "low",
      method,
      tech_name: best.tech_name,
      district_no: best.district_no ?? null,
      reason: `${compat.length} same-name compatible; picked most-recent, needs review`,
      candidates: evidence(cands),
    };
  }
  return {
    state: "EXCEPTION",
    reason: "same-name candidates but none compatible with an active rental",
    candidates: evidence(cands),
  };
}
