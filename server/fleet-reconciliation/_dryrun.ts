import { writeFileSync } from 'fs';
import { runDryRun } from './dry-run';

const OUT = process.env.DRYRUN_OUT || '/tmp/dryrun-report.json';

(async () => {
  const liveConfirm = process.argv.includes('--live');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const liveConfirmLimit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const report = await runDryRun({
    liveConfirm,
    liveConfirmLimit,
    sampleSize: 5,
    onPhase: (m) => console.error(m),
  });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.error(`[dry-run] report written to ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error('[dry-run] FAILED:', e?.stack || e);
  process.exit(1);
});
