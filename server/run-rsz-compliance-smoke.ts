import { computeCompliance, initRightsizeComplianceSchema, modelKey, SEDAN_RATE_CEILING } from "./vrm/rightsize/compliance";

(async () => {
  console.log("modelKey('25 FORD ESCA') =", JSON.stringify(modelKey("25 FORD ESCA")));
  console.log("modelKey('2026 NISN SENT') =", JSON.stringify(modelKey("2026 NISN SENT")));
  console.log("ceiling =", SEDAN_RATE_CEILING);
  await initRightsizeComplianceSchema();
  const { rows, kpis } = await computeCompliance();
  console.log("rows:", rows.length);
  console.log("kpis:", JSON.stringify(kpis, null, 1));
  process.exit(0);
})().catch(e => { console.error("SMOKE FAILED:", e?.message || e); process.exit(1); });
