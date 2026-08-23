/**
 * Task 762 verification: getVehicleLocation must return numeric LAT/LNG on
 * the Snowflake path (SAMSARA_STREAM has LATITUDE/LONGITUDE, not LAT/LNG).
 */
import { getSnowflakeService } from '../server/snowflake-service';
import { getSamsaraService } from '../server/samsara-service';

async function main() {
  const sf = getSnowflakeService();
  // Grab a recently-reporting vehicle name so the fresh (non-stale) path runs
  const rows = await sf.executeQuery(
    `SELECT VEHICLE_NAME, TIME FROM bi_analytics.app_samsara.SAMSARA_STREAM
     WHERE TIME >= DATEADD(hour, -3, CURRENT_TIMESTAMP()) LIMIT 1`
  );
  if (rows.length === 0) {
    console.log('No fresh stream rows in the last 3h; falling back to any row');
    const any = await sf.executeQuery(
      `SELECT VEHICLE_NAME FROM bi_analytics.app_samsara.SAMSARA_STREAM LIMIT 1`
    );
    rows.push(any[0]);
  }
  const name = rows[0].VEHICLE_NAME;
  console.log(`Testing getVehicleLocation('${name}')`);

  const svc = getSamsaraService();
  const loc = await svc.getVehicleLocation(name, 9999);
  if (!loc) throw new Error('getVehicleLocation returned null for a known stream vehicle');
  console.log(`source=${loc.source} LAT=${loc.LAT} LNG=${loc.LNG} TIME=${loc.TIME} SPEED_MPH=${loc.SPEED_MPH} GEO=${loc.REVERSE_GEO_FULL}`);
  if (typeof loc.LAT !== 'number' || typeof loc.LNG !== 'number') {
    throw new Error(`LAT/LNG not numeric: LAT=${loc.LAT} (${typeof loc.LAT}), LNG=${loc.LNG} (${typeof loc.LNG})`);
  }
  console.log('PASS: normalized LAT/LNG present on Snowflake-sourced location');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
