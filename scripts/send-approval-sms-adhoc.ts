import { sendTwilioMessage } from "../server/fleet-scope-reg-messaging";

const to = process.argv[2];
if (!to) {
  console.error("Usage: tsx scripts/send-approval-sms-adhoc.ts +1XXXXXXXXXX");
  process.exit(1);
}

const body =
  "Your recent Rental request has been approved, please contact ARI/Holman " +
  "to confirm the reservation. If this is an error please contact the fleet " +
  "team ASAP via SHSAI.\n\n" +
  "Remember that Rentals issued by Fleet are for work use only and off the " +
  "clock rental usage is not permitted. Any violation to this policy may " +
  "result in disciplinary action. Stay Safe and thank you for all you do!";

const override = {
  accountSid: process.env.VRM_APPROVAL_TWILIO_ACCOUNT_SID ?? process.env.FS_TWILIO_ACCOUNT_SID,
  authToken: process.env.VRM_APPROVAL_TWILIO_AUTH_TOKEN ?? process.env.FS_TWILIO_AUTH_TOKEN,
  from: process.env.VRM_APPROVAL_TWILIO_FROM,
};

sendTwilioMessage(to, body, undefined, override)
  .then((sid) => {
    console.log(`Sent to ${to} from ${override.from} — SID: ${sid}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed:", err?.message ?? err);
    process.exit(1);
  });
