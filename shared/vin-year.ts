// Decode a vehicle's model year from its 17-character VIN.
//
// The model-year is encoded in VIN position 10 (index 9). The same set of
// codes repeats on a 30-year cycle (1980-2009, then 2010-2039, ...). VIN
// position 7 (index 6) disambiguates the cycle: it is numeric for model years
// 1980-2009 and alphabetic for 2010-2039.

const VIN_YEAR_CODE_MAP: Record<string, number> = {
  A: 1980, B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987,
  J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994, S: 1995,
  T: 1996, V: 1997, W: 1998, X: 1999, Y: 2000,
  "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005,
  "6": 2006, "7": 2007, "8": 2008, "9": 2009,
};

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Returns the VIN-derived model year, or null when the VIN is missing/invalid
 * or the year position cannot be decoded.
 */
export function decodeModelYearFromVin(vin: string | null | undefined): number | null {
  if (!vin) return null;
  const v = String(vin).trim().toUpperCase();
  if (!VIN_PATTERN.test(v)) return null;

  const base = VIN_YEAR_CODE_MAP[v[9]];
  if (base == null) return null;

  // Position 7 alphabetic => the 2010-2039 (or later) cycle.
  let year = /[A-Z]/.test(v[6]) ? base + 30 : base;

  // Guard against over-shooting into implausible future years for old vehicles.
  const maxPlausible = new Date().getFullYear() + 2;
  if (year > maxPlausible && year - 30 >= 1980) {
    year -= 30;
  }

  return year;
}
