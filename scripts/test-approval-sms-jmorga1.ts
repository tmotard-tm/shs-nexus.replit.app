/**
 * One-shot manual test: sends the same approval SMS that JMORGA1 (James Morgan)
 * would receive if a New Rentals request were Approved right now. Exercises the
 * real dispatcher template-load + sender-override path so the From shows up as
 * VRM_APPROVAL_TWILIO_FROM (the shared 877 shop line) instead of the FS reg line.
 */
import { sendTwilioMessage } from "../server/fleet-scope-reg-messaging";
import { db } from "../server/db";
import { vrmRepairTracker, vrmNotificationTemplates } from "../shared/vrm-schema";
import { sql, and, isNotNull, ne, desc, eq } from "drizzle-orm";

async function main() {
  const ldap = "JMORGA1";

  const [row] = await db
    .select({ techName: vrmRepairTracker.techName, techPhone: vrmRepairTracker.techPhone })
    .from(vrmRepairTracker)
    .where(
      and(
        sql`UPPER(${vrmRepairTracker.techLdap}) = ${ldap}`,
        isNotNull(vrmRepairTracker.techPhone),
        ne(vrmRepairTracker.techPhone, ""),
      ),
    )
    .orderBy(desc(vrmRepairTracker.id))
    .limit(1);

  if (!row?.techPhone) throw new Error(`No phone on file for ${ldap}`);

  const techName = row.techName?.trim() || ldap;
  const techFirst = techName.split(/[\s,]+/)[0] || ldap;

  // Mirror loadTemplateMap for sms_template_approve
  const [tmplRow] = await db
    .select({ body: vrmNotificationTemplates.body })
    .from(vrmNotificationTemplates)
    .where(eq(vrmNotificationTemplates.key, "sms_template_approve"))
    .limit(1);
  const template = (tmplRow?.body ?? "").trim();

  const APPROVAL_SMS_BODY =
    "Your recent Rental request has been approved, please contact ARI/Holman " +
    "to confirm the reservation. If this is an error please contact the fleet " +
    "team ASAP via SHSAI.\n\n" +
    "Remember that Rentals issued by Fleet are for work use only and off the " +
    "clock rental usage is not permitted. Any violation to this policy may " +
    "result in disciplinary action. Stay Safe and thank you for all you do!";

  const todayLocalDate = () => {
    const d = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(d);
  };

  const vars: Record<string, string> = {
    tech_first_name: techFirst,
    tech_full_name: techName,
    tech_ldap: ldap,
    decision_date: todayLocalDate(),
  };
  const render = (s: string) =>
    s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => (k in vars ? vars[k] : `{{${k}}}`));
  const body = template ? render(template) : APPROVAL_SMS_BODY;

  // Normalize to E.164
  const digits = row.techPhone.replace(/\D+/g, "");
  const to = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

  const senderOverride = {
    accountSid: process.env.VRM_APPROVAL_TWILIO_ACCOUNT_SID ?? process.env.FS_TWILIO_ACCOUNT_SID,
    authToken: process.env.VRM_APPROVAL_TWILIO_AUTH_TOKEN ?? process.env.FS_TWILIO_AUTH_TOKEN,
    from: process.env.VRM_APPROVAL_TWILIO_FROM,
  };

  console.log("──────────────────────────────────────────────────────");
  console.log(`LDAP:       ${ldap}`);
  console.log(`Tech name:  ${techName}`);
  console.log(`To:         ${to}`);
  console.log(`From:       ${senderOverride.from}`);
  console.log(`Source:     ${template ? "Settings-configured template" : "Built-in APPROVAL_SMS_BODY fallback"}`);
  console.log("Body:");
  console.log(body);
  console.log("──────────────────────────────────────────────────────");

  const sid = await sendTwilioMessage(to, body, undefined, senderOverride);
  console.log(`✅ Sent. Twilio SID: ${sid}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err?.message ?? err);
  console.error(err?.stack);
  process.exit(1);
});
