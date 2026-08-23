/**
 * Task 762 probe: verify live column lists of every bi_analytics.app_samsara
 * table used by server/samsara-service.ts, then exercise each service method
 * to surface any invalid-identifier errors.
 */
import { getSnowflakeService } from '../server/snowflake-service';
import { getSamsaraService } from '../server/samsara-service';

const TABLES = [
  'SAMSARA_VEHICLES',
  'SAMSARA_DRIVERS',
  'SAMSARA_VEHICLE_ASSIGN',
  'SAMSARA_DRIVER_SAFETY_SCORES',
  'SAMSARA_ODOMETER',
  'SAMSARA_TRIPS',
  'SAMSARA_MAINTENANCE',
  'SAMSARA_FUEL_ENERGY_DAILY',
  'SAMSARA_SAFETY',
  'SAMSARA_SPEEDING',
  'SAMSARA_IDLING',
  'SAMSARA_DEVICES',
  'SAMSARA_GATEWAYS',
  'SAMSARA_STREAM',
];

async function main() {
  const sf = getSnowflakeService();

  for (const table of TABLES) {
    try {
      const rows = await sf.executeQuery(`SELECT * FROM bi_analytics.app_samsara.${table} LIMIT 1`);
      if (rows.length === 0) {
        // Empty table — fall back to DESCRIBE for the column list
        const desc = await sf.executeQuery(`DESCRIBE TABLE bi_analytics.app_samsara.${table}`);
        console.log(`${table} (EMPTY): ${desc.map((d: any) => d.name).join(', ')}`);
      } else {
        console.log(`${table}: ${Object.keys(rows[0]).join(', ')}`);
      }
    } catch (e: any) {
      console.log(`${table}: PROBE ERROR — ${e.message}`);
    }
  }

  console.log('\n=== Service method exercise ===');
  const svc = getSamsaraService();
  const methods: Array<[string, () => Promise<any[]>]> = [
    ['getVehicles()', () => svc.getVehicles()],
    ['getDrivers()', () => svc.getDrivers()],
    ['getAssignments()', () => svc.getAssignments()],
    ['getAssignments(date, vehicleId)', () => svc.getAssignments(undefined, '123456789')],
    ['getAssignments(date, _, driverId)', () => svc.getAssignments(undefined, undefined, '123456789')],
    ['getSafetyScores()', () => svc.getSafetyScores()],
    ['getSafetyScores(driverId)', () => svc.getSafetyScores('123456789')],
    ['getOdometer()', () => svc.getOdometer('99999')],
    ['getTrips()', () => svc.getTrips()],
    ['getTrips(vehicleId, driverId)', () => svc.getTrips('123456789', '123456789')],
    ['getMaintenance()', () => svc.getMaintenance()],
    ['getFuelEnergy()', () => svc.getFuelEnergy()],
    ['getFuelEnergy(vehicleId)', () => svc.getFuelEnergy('123456789')],
    ['getSafetyEvents()', () => svc.getSafetyEvents()],
    ['getSafetyEvents(vehicleId, driverId)', () => svc.getSafetyEvents('123456789', '123456789')],
    ['getSpeedingEvents()', () => svc.getSpeedingEvents()],
    ['getSpeedingEvents(vehicleId)', () => svc.getSpeedingEvents('123456789')],
    ['getIdlingEvents()', () => svc.getIdlingEvents()],
    ['getIdlingEvents(vehicleId)', () => svc.getIdlingEvents('123456789')],
    ['getDevices()', () => svc.getDevices()],
    ['getGateways()', () => svc.getGateways()],
  ];

  for (const [label, fn] of methods) {
    try {
      const rows = await fn();
      const sample = rows[0] ? ` keys=[${Object.keys(rows[0]).join(',')}]` : '';
      console.log(`OK    ${label}: ${rows.length} rows${sample}`);
    } catch (e: any) {
      console.log(`FAIL  ${label}: ${e.message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
