/**
 * Task #636 — guarded external writes for the Create Vehicle flow.
 *
 * Every path that can create a vehicle in Holman, WMS or TPMS goes through the
 * orchestrators below. They take their side effects as injected dependencies for
 * one reason: the fail-closed rule ("a duplicate check that cannot complete
 * refuses the write") is only real if it can be proven, and proving it means
 * running the flow with a failing probe and asserting that nothing was called.
 *
 * No database, no HTTP, no imports from the route layer — routes adapt their
 * services to these interfaces.
 */

import { classifyHolmanSubmitResponse } from "./vehicle-create-gate.js";

/**
 * The answer to "does this record already exist?" — with `checked` separating
 * "the system answered no" from "we could not ask." Collapsing those two is
 * exactly how blind duplicate creates happen.
 */
export interface ExistenceProbe {
  checked: boolean;
  found: boolean;
  error?: string;
  vehicle?: any;
}

export interface Refusal {
  code: string;
  error: string;
}

// ── WMS (+ TPMS) create ──────────────────────────────────────────────────────

export interface WmsCreateDeps {
  /** Authoritative existence probe. A 404 is `{checked:true,found:false}`; any
   *  other failure is `{checked:false}` and must stop the write. */
  lookupTruck: (paddedVehicle: string) => Promise<ExistenceProbe>;
  createTruck: (payload: any) => Promise<any>;
  /** null when TPMS is not configured — the TPMS step is then skipped. */
  addTruck: ((payload: any) => Promise<any>) | null;
}

export interface WmsCreateOutcome {
  refusal?: Refusal;
  wms: { success: boolean; error?: string; alreadyExisted?: boolean; response?: any };
  tpms: { success: boolean; skipped?: boolean; error?: string; response?: any };
}

const looksLikeAlreadyExists = (message: string, status?: number): boolean =>
  status === 409 || /already.?exists/i.test(message) || /duplicate/i.test(message);

export async function runGuardedWmsCreate(
  deps: WmsCreateDeps,
  args: { paddedVehicle: string; wmsPayload: any; tpmsPayload: any },
): Promise<WmsCreateOutcome> {
  const probe = await deps.lookupTruck(args.paddedVehicle);

  // FAIL CLOSED. Creating blind after a failed lookup is how duplicate trucks
  // get into WMS — and TPMS silently accepts the duplicate as a success.
  if (!probe.checked) {
    return {
      refusal: {
        code: "wms_check_unavailable",
        error: `Cannot verify whether truck ${args.paddedVehicle} already exists in WMS (${probe.error || "lookup failed"}). The create was refused rather than risk a duplicate. Try again shortly.`,
      },
      wms: { success: false, error: "WMS duplicate check unavailable — nothing was sent." },
      tpms: { success: false, skipped: true },
    };
  }

  let wms: WmsCreateOutcome["wms"];
  if (probe.found) {
    wms = { success: true, alreadyExisted: true };
  } else {
    try {
      const response = await deps.createTruck(args.wmsPayload);
      wms = { success: true, response };
    } catch (err: any) {
      const message: string = err?.wmsMessage || (err instanceof Error ? err.message : String(err));
      if (looksLikeAlreadyExists(message, err?.status)) {
        // Lost a race with a concurrent create — the truck exists, which is the
        // state we wanted.
        wms = { success: true, alreadyExisted: true, response: { raceDuplicate: message } };
      } else {
        wms = { success: false, error: message };
      }
    }
  }

  let tpms: WmsCreateOutcome["tpms"] = { success: true, skipped: true };
  if (wms.success) {
    if (!deps.addTruck) {
      tpms = { success: true, skipped: true };
    } else {
      try {
        const response = await deps.addTruck(args.tpmsPayload);
        tpms = { success: true, response };
      } catch (err: any) {
        const message: string = err instanceof Error ? err.message : String(err);
        tpms = looksLikeAlreadyExists(message)
          ? { success: true, response: { alreadyExists: message } }
          : { success: false, error: message };
      }
    }
  }

  return { wms, tpms };
}

// ── Holman submit ────────────────────────────────────────────────────────────

export interface HolmanSubmitDeps {
  lookupByNumber: (paddedVehicle: string) => Promise<ExistenceProbe>;
  submit: (payloads: any[]) => Promise<any>;
  now?: () => Date;
}

export interface HolmanSubmitOutcome {
  refusal?: Refusal;
  result: {
    success: boolean;
    pending?: boolean;
    error?: string;
    detail?: string;
    referenceToken?: string | null;
  };
  /** True only when a LIVE Holman read confirmed the record. The local cache
   *  mirror is gated on this — never on the submit response. */
  liveConfirmed: boolean;
  rawResponse: any;
  submittedAt: Date | null;
}

export async function runGuardedHolmanSubmit(
  deps: HolmanSubmitDeps,
  args: { paddedVehicle: string; payload: any },
): Promise<HolmanSubmitOutcome> {
  const clock = deps.now ?? (() => new Date());

  const preCheck = await deps.lookupByNumber(args.paddedVehicle);
  if (!preCheck.checked) {
    return {
      refusal: {
        code: "number_check_unavailable",
        error: `Cannot verify whether vehicle ${args.paddedVehicle} already exists in Holman (${preCheck.error || "lookup failed"}). The submission was refused rather than risk a duplicate. Try again shortly.`,
      },
      result: { success: false, error: "Holman duplicate check unavailable — nothing was submitted." },
      liveConfirmed: false,
      rawResponse: { preCheck: "unavailable", error: preCheck.error ?? null },
      submittedAt: null,
    };
  }

  if (preCheck.found) {
    return {
      result: { success: true, detail: "Vehicle already present in Holman (confirmed by live lookup)." },
      liveConfirmed: true,
      rawResponse: {
        preCheck: "already-exists",
        holmanVehicleNumber: preCheck.vehicle?.holmanVehicleNumber ?? null,
      },
      submittedAt: null,
    };
  }

  const submittedAt = clock();
  try {
    const rawResponse = await deps.submit([args.payload]);
    // Acceptance comes from the response body, never from "the call returned."
    const acceptance = classifyHolmanSubmitResponse(rawResponse);
    if (acceptance.outcome === "accepted") {
      return {
        result: { success: true, detail: acceptance.detail, referenceToken: acceptance.referenceToken },
        liveConfirmed: false,
        rawResponse,
        submittedAt,
      };
    }
    if (acceptance.outcome === "rejected") {
      return {
        result: { success: false, error: acceptance.detail, referenceToken: acceptance.referenceToken },
        liveConfirmed: false,
        rawResponse,
        submittedAt,
      };
    }
    return {
      result: {
        success: false,
        pending: true,
        error: `${acceptance.detail} Pending verification — confirm in Holman before retrying.`,
        referenceToken: acceptance.referenceToken,
      },
      liveConfirmed: false,
      rawResponse,
      submittedAt,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Holman submission failed";
    if (!looksLikeAlreadyExists(message)) {
      return {
        result: { success: false, error: message },
        liveConfirmed: false,
        rawResponse: { error: message },
        submittedAt,
      };
    }
    // Verify the duplicate claim instead of trusting the error text.
    const confirm = await deps.lookupByNumber(args.paddedVehicle);
    if (confirm.checked && confirm.found) {
      return {
        result: { success: true, detail: "Vehicle already present in Holman (confirmed after duplicate error)." },
        liveConfirmed: true,
        rawResponse: { error: message, confirmed: true },
        submittedAt,
      };
    }
    return {
      result: {
        success: false,
        pending: true,
        error: `Holman reported a duplicate but the record could not be confirmed (${message}). Pending verification.`,
      },
      liveConfirmed: false,
      rawResponse: { error: message, confirmed: false },
      submittedAt,
    };
  }
}
