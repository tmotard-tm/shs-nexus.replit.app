const url = (process.env.EVENT_REQUEST_URL || "").replace(/\/+$/, "") + "/api/pending-exports";
const token = (process.env.DCA_TASK_API_TOKEN || "").trim();

const body = {
  submittedBy: "JMORGA1 (tyler.morgan@transformco.com)",
  submitterEmail: "tyler.morgan@transformco.com",
  projectName: "Enterprise Contract Change - ACADET - 082526",
  rowCount: "1",
  projectNotes:
    "30 minutes requested first thing in the morning. If there is a conflict, the time can be moved during normal business hours for Enterprise.",
  exportData: [
    {
      TechnicianId: "ACADET",
      ActivityType: "46",
      Date: "2026-08-25",
      StartTime: "08:00",
      Duration: 30,
      LocationType: "Supplied",
      LocationValue: "11434",
      TravelBehavior: "Both",
      Notes:
        "Location: Enterprise Jamaica St. Albans, 13007 MERRICK BLVD,JAMAICA,11434-4131. Enterprise billing swap from Holman contract to direct billing contract.",
      CheckJobs: "FALSE",
      CheckStdActs: "FALSE",
      CheckFrozen: "TRUE",
      RequestedStartDate: "2026-08-25",
      RequestedCompletionDate: "2026-08-25",
      endDateFixed: true,
      RepeatOnDays: "",
      StartTimeRequest: "08:00",
      Unit: "7744",
    },
  ],
};

(async () => {
  console.log("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("HTTP", res.status, res.statusText);
  console.log("--- RESPONSE HEADERS ---");
  res.headers.forEach((v, k) => console.log(`${k}: ${v}`));
  console.log("--- RESPONSE BODY ---");
  console.log(text.slice(0, 3000));
})().catch((e) => console.log("ERR", String(e).slice(0, 400)));
