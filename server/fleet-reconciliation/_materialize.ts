import { materialize, type RunKind } from './materializer';
import { toCanonical } from '../vehicle-number-utils';

/**
 * Dev CLI harness for the tier-3 materializer (T004).
 *   npx tsx server/fleet-reconciliation/_materialize.ts --kind=nightly
 *   npx tsx server/fleet-reconciliation/_materialize.ts --kind=dry_run --only=061385,036164
 *
 * NOTE: materialization performs NO external writes — it only QUEUES into the
 * reconciliation_* tables in the (env-local) Postgres. A `nightly` run with the
 * full fleet is EXPECTED to halt at G2 (proposals >> ceiling); use --only to
 * restrict to a small slice that stays under the ceiling and exercises persist.
 */
(async () => {
  const kindArg = process.argv.find((a) => a.startsWith('--kind='));
  const kind = (kindArg ? kindArg.split('=')[1] : 'nightly') as RunKind;
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlyTrucks = onlyArg
    ? new Set(
        onlyArg
          .split('=')[1]
          .split(',')
          .map((s) => toCanonical(s.trim()))
          .filter(Boolean),
      )
    : undefined;

  const res = await materialize({
    kind,
    onlyTrucks,
    requestedBy: 'cli-smoke',
    onPhase: (m) => console.error(m),
  });
  console.error('[materialize] RESULT:\n' + JSON.stringify(res, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('[materialize] FAILED:', e?.stack || e);
  process.exit(1);
});
