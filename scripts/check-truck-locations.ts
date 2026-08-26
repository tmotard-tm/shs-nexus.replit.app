import { classifyBranch } from "../server/vrm/etd/truck-locations";

// The 16 branches ETD returns around the Pep Boys on request #148 (3702 Atlanta Hwy,
// Athens GA), plus a handful of historical bookings that should and should not trip.
const ATHENS: [string, string, string][] = [
  ["03J3", "Athens Atlanta Hwy.", "3100 ATLANTA HWY,ATHENS,30606-6977"],
  ["0317", "Bogart", "4750 ATLANTA HWY,BOGART,30622"],
  ["0374", "Athens City Centre", "368 OAK STREET,ATHENS,30601-3619"],
  ["03J1", "Winder", "189 W ATHENS ST,WINDER,30680"],
  ["03J4", "Monroe", "222 MARTIN LUTHER KING JR BLVD,MONROE,30655-5622"],
  ["03J5", "Commerce", "420 BANKS CROSSING DR,COMMERCE,30529"],
  ["03J2", "Loganville", "2200 COMMERCE DR,LOGANVILLE,30052-3764"],
  ["03G1", "Madison", "1462 EATONTON RD,STE A,MADISON,30650-4641"],
  ["03K4", "Hurricane Shoals", "489 HURRICANE SHOALS RD NE,LAWRENCEVILLE,30046-4405"],
  ["0316", "Lawrenceville Riverside Pkwy.", "2095 RIVERSIDE PKWY,LAWRENCEVILLE,30043-5911"],
  ["03H2", "Lawrenceville Scenic Hwy. N.", "176 SCENIC HIGHWAY,LAWRENCEVILLE,30045-5739"],
  ["03L3", "Oakwood", "3715 MUNDY MILL RD,STE B,OAKWOOD,30566"],
  ["036A", "Buford", "3550 S BOGAN RD,BUFORD,30519-4540"],
  ["03RG", "Greensboro", "2250 UNION POINT HWY,GREENSBORO,30642-2348"],
  ["036N", "North Buford", "4083 S LEE ST,BUFORD,30518"],
  ["0353", "Covington", "4132 U.S. HWY 278 NW,COVINGTON,30014-2112"],
];

const EXTRA: [string, string, string][] = [
  ["4450", "Eau Claire (request #95 SWICKLA)", "2103 S HASTINGS WAY,ALTOONA,54720-2208"],
  ["1735", "Dover", "DOVER, 635 S BAY RD,DOVER,19901-4601"],
  ["2672", "Brunswick", "4445 ALTAMA AVE,BRUNSWICK,31520-3006"],
  ["4330", "Jacksonville The Avenues", "10733 PHILIPS HWY,JACKSONVILLE,32256-1554"],
  ["1502", "Chicago Irving Park", "5358 W IRVING PARK RD,CHICAGO,60641-2529"],
];

const EXPECT_TRUCK = new Set(["0317", "03K4", "036N", "4450", "1735", "2672"]);

let fails = 0;
for (const [code, name, addr] of [...ATHENS, ...EXTRA]) {
  const v = classifyBranch(code, addr);
  const want = EXPECT_TRUCK.has(code);
  const ok = v.isTruck === want;
  if (!ok) fails++;
  const tag = v.isTruck ? "TRUCK" : "car  ";
  const why = v.match ? `${v.match.city}, ${v.match.address} (${v.reason})` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${tag} ${code.padEnd(6)}${name.padEnd(34)}${why}`);
}
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
