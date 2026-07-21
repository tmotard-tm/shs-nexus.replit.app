/**
 * The seam between the Fleet Communications inbound webhook and the Rightsize
 * tracker.
 *
 * This module exists so that the Twilio path can never be broken by the
 * tracker. Twilio's inbound handler is the front door for every technician
 * reply the whole module depends on; a rightsize failure - a bad classifier
 * deploy, a Bedrock outage, a locked table - must never delay it, fail it, or
 * bubble an error back to Twilio (which would make Twilio retry and, worse,
 * make the reply look undelivered).
 *
 * So: fire and forget. Synchronous throws are caught, async rejections are
 * caught, nothing is awaited, nothing is rethrown, and the 30-minute batch
 * sweep in ./sync.ts remains the safety net that picks up whatever this drops.
 *
 * Deliberately free of any database import: ./sync.ts is loaded lazily so this
 * module (and the inbound handler that calls it) stay cheap and testable.
 */

export type RightsizeRunner = (messageId: string) => Promise<unknown>;

const defaultRunner: RightsizeRunner = (messageId) =>
  import("./sync").then((m) => m.classifyInboundNow(messageId));

/**
 * Classify a just-persisted inbound message NOW instead of waiting up to 30
 * minutes for the next sweep. Returns immediately; never throws.
 *
 * @param messageId fs_comms_messages.id of the newly persisted inbound row
 * @param run       injection seam for tests; defaults to the real pipeline
 */
export function fireRightsizeClassification(messageId: string, run: RightsizeRunner = defaultRunner): void {
  if (!messageId) return;
  try {
    Promise.resolve(run(messageId)).catch((err: any) => {
      console.error("[VRM/Rightsize] realtime classify failed:", err?.message || err);
    });
  } catch (err: any) {
    // A synchronous throw (bad import, bad argument) is just as swallowed.
    console.error("[VRM/Rightsize] realtime classify threw:", err?.message || err);
  }
}
