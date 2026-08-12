/**
 * VRM Rental Operations — identity resolver (TS port of resolve_identity_v2.py).
 *
 * The open-rental feed gives ONLY a truck number + a renter NAME (no employee
 * ID). So we fuzzy-match the renter name against the canonical roster
 * (`all_techs`, every `employee_id` unique), pin the employee_id, then read
 * employment status.
 *
 * TRUCK IS NOW AN IDENTITY PATH (Tyler 2026-07-31). It was excluded on the
 * reasoning that a truck number is not an identity. In practice it is the
 * BETTER key: the renter name is typed by hand at Enterprise and arrives
 * truncated ("CHRISTOPHE LOW"), doubled ("DAVID ARDILAARDILA"), run together
 * ("LORENZO ALFONZOGAMINO"), anglicized ("JACK SHEN" for Guoxiong Shen),
 * misspelled ("BOULEY" for BOULAY), and once with the surname missing entirely
 * ("ANGEL SR" for Correa Sr, Angel L). The truck number is a system value and
 * TPMS maps it to a technician independently.
 *
 * On 2026-07-31 that was 11 of 13 unresolved open rentals, every one confirmed
 * by an ACTIVE technician whose TPMS and roster truck agreed.
 *
 * The truck never silently overrides the name: agreement raises confidence,
 * disagreement produces REVIEW carrying both, and the truck decides alone only
 * when the name found nobody usable.
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
  /** Home state, used only to break same-name ties against the pickup state. */
  home_state?: string | null;
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

/**
 * The technician the RENTAL'S TRUCK belongs to, resolved by the caller (the
 * ingest layer owns DB access; this module stays pure).
 */
export interface TruckTech {
  employee_id: string;
  tech_name: string;
  employment_status: string | null;
  effective_date: string | null;
  last_day_worked: string | null;
  district_no?: string | null;
  /** which source(s) produced the truck -> technician link */
  source: "both" | "tpms" | "roster";
  /**
   * False when TPMS knows this technician but `all_techs` has no row for them —
   * a rehire on a new enterprise ID, or a new hire the roster feed has not
   * picked up yet. 16 such technicians were live on 2026-07-31.
   */
  rosterKnown?: boolean;
  /** TPMS last-seen, the only liveness signal available for a rosterKnown=false tech. */
  lastSeenAt?: string | null;
  /** TPMS enterprise id (LDAP), for evidence only — NEVER an employee_id. */
  enterpriseId?: string | null;
  /** TPMS and the roster name DIFFERENT technicians for this truck */
  conflict?: boolean;
}

export interface ResolverInputs {
  renter: string;
  rentalStart: string | null;
  rosterIndex: NormRoster[];
  onboarding?: OnboardingRow[];
  /** null when the truck maps to nobody */
  truckTech?: TruckTech | null;
  /** Where the rental was picked up. Breaks same-name ties; safe to omit. */
  pickupState?: string | null;
}

/** Employment-compatibility check shared by the name and truck paths. */
function statusCompatible(employment_status: string | null, ev: Date | null, rs: Date | null): boolean {
  if (employment_status && ACTIVE_ISH.has(employment_status)) return true;
  if (!ev || !rs) return true;
  return ev.getTime() >= rs.getTime() - GRACE_DAYS * 86_400_000;
}

/**
 * Reconcile the renter NAME against the rental TRUCK.
 *
 * Order of trust: agreement > truck-alone > name-alone. A conflict never picks
 * a winner. Attaching the wrong technician is worse than leaving it unresolved,
 * because it charges somebody else's spend and points outreach at the wrong man.
 */
export function resolveIdentity(inputs: ResolverInputs): IdentityResolution {
  const byName = resolveByName(inputs);
  const truck = inputs.truckTech ?? null;
  if (!truck) return byName;

  const rs = toDate(inputs.rentalStart);
  const truckEvent = eventDate({
    employee_id: truck.employee_id,
    tech_name: truck.tech_name,
    employment_status: truck.employment_status,
    effective_date: truck.effective_date,
    last_day_worked: truck.last_day_worked,
  });
  // A roster-unknown tech has no employment record to be incompatible with;
  // TPMS having seen them is the liveness signal instead.
  const truckOk = truck.rosterKnown === false
    ? true
    : statusCompatible(truck.employment_status, truckEvent, rs);
  const truckEvidence: CandidateEvidence[] = [{
    employee_id: truck.employee_id,
    tech_name: truck.tech_name,
    employment_status: truck.employment_status,
    event_date: dateStr(truckEvent),
    compatible: truckOk,
  }];

  const nameId = byName.state === "RESOLVED" ? (byName.employee_id ?? null) : null;

  // ── The truck may RESCUE, never CONTRADICT ────────────────────────────────
  // A first pass let a truck/name disagreement force REVIEW. Simulated against
  // the whole open book it turned dozens of confident name matches into REVIEW,
  // because THE RENTAL TRUCK IS OFTEN NOT THE RENTER'S OWN TRUCK — a rental is
  // frequently booked under a different unit than the technician is assigned.
  // So a disagreement is normal, not evidence of a bad match, and a resolved
  // name always wins.
  if (nameId) {
    // Agreement is still worth something: it can only raise confidence.
    return truck.employee_id === nameId
      ? { ...byName, confidence: "high", method: `${byName.method ?? "name"}+truck` }
      : byName;
  }

  // From here the name found nobody usable — the case the truck exists for.
  if (truck.conflict) {
    return {
      ...byName,
      state: "REVIEW",
      confidence: "low",
      reason: `${byName.reason ?? "no name match"}; the rental truck maps to more than one technician (TPMS and the roster disagree)`,
      candidates: [...(byName.candidates ?? []), ...truckEvidence],
    };
  }
  if (!truckOk) {
    return {
      ...byName,
      reason: `${byName.reason ?? "no name match"}; rental truck belongs to ${truck.tech_name}, whose ${STATUS[truck.employment_status ?? ""] ?? truck.employment_status} ${dateStr(truckEvent)} predates the rental`,
      candidates: [...(byName.candidates ?? []), ...truckEvidence],
    };
  }

  // CORROBORATION. Because the rental truck is not reliably the renter's own
  // truck, a truck hit alone is not proof. Require the truck technician's name
  // to echo the renter name somewhere. Without this guard "MARK ADAMS" resolved
  // to OWENS,RONALD purely because his truck carried the rental — a confidently
  // wrong answer, which is the one outcome this module refuses to produce.
  if (!namesCorroborate(renterOf(inputs), truck.tech_name)) {
    return {
      ...byName,
      state: "REVIEW",
      confidence: "low",
      reason: `${byName.reason ?? "no name match"}; the rental truck belongs to ${truck.tech_name}, whose name does not echo the renter — needs a human`,
      candidates: [...(byName.candidates ?? []), ...truckEvidence],
    };
  }

  // ── Known to TPMS, absent from the roster ─────────────────────────────────
  // These are real, working technicians: rehires whose new enterprise ID the
  // roster feed has not absorbed, or new hires not yet synced. We can name them,
  // and naming them beats "no match" on the page.
  //
  // But employee_id STAYS NULL. `resolved_employee_id` is joined to
  // all_techs.employee_id in nine places, three of them INNER JOINs (PO history,
  // scrape targeting, rightsize sync). Writing a TPMS LDAP there would silently
  // DROP these rentals out of those queries — strictly worse than an unresolved
  // row, which at least shows up. So this returns REVIEW with the identity as
  // evidence, and the real fix stays upstream in the roster feed.
  if (truck.rosterKnown === false) {
    const seen = truck.lastSeenAt ? String(truck.lastSeenAt).slice(0, 10) : null;
    return {
      state: "REVIEW",
      employee_id: null,
      confidence: "medium",
      method: "truck (tpms, not on roster)",
      tech_name: truck.tech_name,
      district_no: truck.district_no ?? null,
      reason: `rental truck belongs to ${truck.tech_name} (TPMS ${truck.enterpriseId ?? "?"}${seen ? `, seen ${seen}` : ""}), who is NOT in all_techs — rehire on a new enterprise id or an unsynced new hire. Named from TPMS; no employee_id assigned because downstream joins would drop the row.`,
      candidates: truckEvidence,
    };
  }

  return {
    state: "RESOLVED",
    employee_id: truck.employee_id,
    status: STATUS[truck.employment_status ?? ""] ?? truck.employment_status,
    status_date: dateStr(truckEvent),
    confidence: truck.source === "both" ? "high" : "medium",
    method: `truck (${truck.source})`,
    tech_name: truck.tech_name,
    district_no: truck.district_no ?? null,
    reason: "renter name did not match the roster; resolved from the rental truck, corroborated by name",
    candidates: truckEvidence,
  };
}

/** The renter string off the inputs, for corroboration. */
function renterOf(inputs: ResolverInputs): string {
  return String(inputs.renter ?? "");
}

/**
 * Does the truck technician's name echo the renter name?
 *
 * Deliberately loose, because the renter names this rescues are damaged:
 * substring either direction catches "GAMINO" inside "ALFONZOGAMINO", and an
 * edit distance of 1 catches "BOULEY" vs "BOULAY". Deliberately not empty,
 * because that is what stops a rental attaching to whoever happens to hold the
 * truck.
 */
function namesCorroborate(renter: string, techName: string): boolean {
  const norm = (v: string) => String(v ?? "").toUpperCase().replace(/[^A-Z ]/g, " ")
    .split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3 && !SUFFIXES.has(t));
  const a = norm(renter);
  const b = norm(techName);
  if (!a.length || !b.length) return false;
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      if (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))) return true;
      if (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 1 && editDistance1(x, y)) return true;
    }
  }
  return false;
}

/** True when two strings differ by at most one edit. */
function editDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const [s1, s2] = a.length <= b.length ? [a, b] : [b, a];
  if (s2.length - s1.length > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < s1.length && j < s2.length) {
    if (s1[i] === s2[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (s1.length === s2.length) { i++; j++; } else { j++; }
  }
  return true;
}

function resolveByName(inputs: ResolverInputs): IdentityResolution {
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
    // Multiple compatible same-name matches. Rank on evidence, do not guess.
    //
    // This used to take the most recent `effective_date` and it was not merely
    // weak, it was biased toward the wrong answer. `effective_date` is the date
    // of the last STATUS CHANGE, and termination is a status change. A
    // long-tenured active technician carries their hire date; someone who left
    // last month carries their termination date. Recency therefore handed the
    // rental to whoever had most recently departed.
    //
    // Observed on vehicle 46467: SCOTT E GREEN (terminated 2026-05-20, home NY)
    // beat SCOTT A GREEN (active since 2014-11-24, home MD) for a rental picked
    // up in Randallstown MD, ten miles from Scott A and 350 from Scott E.
    const STATUS_RANK: Record<string, number> = {
      A: 0, L: 1, R: 1, NEW: 2, P: 2, RPE: 2, RCS: 2, T: 9,
    };
    const rank = (t: RosterRow) =>
      STATUS_RANK[(t.employment_status ?? "").trim().toUpperCase()] ?? 5;

    const pickup = (inputs.pickupState ?? "").trim().toUpperCase();
    const homeMiss = (t: RosterRow) =>
      pickup && (t.home_state ?? "").trim().toUpperCase() === pickup ? 0 : 1;

    const truckId = inputs.truckTech?.employee_id ?? null;
    const notTruck = (t: RosterRow) => (truckId && t.employee_id === truckId ? 0 : 1);

    const ranked = [...compat].sort((a, b) =>
      // 1. the truck itself is the strongest evidence available
      (notTruck(a) - notTruck(b))
      // 2. someone who still works here is likelier to be holding a rental
      || (rank(a) - rank(b))
      // 3. a rental picked up in your home state is probably yours
      || (homeMiss(a) - homeMiss(b))
      // 4. recency last, and only so the result is deterministic
      || ((eventDate(b)?.getTime() ?? 0) - (eventDate(a)?.getTime() ?? 0))
    );

    const best = ranked[0];
    const next = ranked[1];
    const why: string[] = [];
    if (truckId && best.employee_id === truckId) why.push("assigned to the rental truck");
    if (rank(best) !== rank(next)) why.push(`${STATUS[best.employment_status ?? ""] ?? best.employment_status} outranks ${STATUS[next.employment_status ?? ""] ?? next.employment_status}`);
    if (homeMiss(best) !== homeMiss(next)) why.push(`home state matches pickup ${pickup}`);

    // Separated by real evidence is a judgement; separated by nothing is a coin
    // flip, and the confidence field should say which one this was.
    const decisive = why.length > 0;
    return {
      state: "REVIEW",
      employee_id: best.employee_id,
      status: STATUS[best.employment_status ?? ""] ?? best.employment_status,
      status_date: dateStr(eventDate(best)),
      confidence: decisive ? "medium" : "low",
      method,
      tech_name: best.tech_name,
      district_no: best.district_no ?? null,
      reason: decisive
        ? `${compat.length} same-name compatible; picked on ${why.join(" + ")}; confirm`
        : `${compat.length} same-name compatible and NOTHING separates them; needs a human`,
      candidates: evidence(cands),
    };
  }
  return {
    state: "EXCEPTION",
    reason: "same-name candidates but none compatible with an active rental",
    candidates: evidence(cands),
  };
}
