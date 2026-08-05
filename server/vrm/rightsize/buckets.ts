import { computeCompliance } from "./compliance";
(async () => {
  const { kpis } = await computeCompliance();
  console.log(JSON.stringify({
    buckets: kpis.buckets,
    left: kpis.left,
    addressable: kpis.addressable,
    rightSized: kpis.rightSized,
    excludedTrade: kpis.excludedTrade,
    outOfScope: kpis.outOfScope,
  }, null, 2));
  process.exit(0);
})();
