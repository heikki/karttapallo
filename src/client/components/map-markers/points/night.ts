// Subsolar point calculation (ported from maplibre-gl-nightlayer) + transition helpers

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number) {
  return (rad / Math.PI) * 180;
}

/** Integer division that rounds toward negative infinity */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** Modulo that always returns a non-negative result */
function floorMod(a: bigint, b: bigint): bigint {
  return a - floorDiv(a, b) * b;
}

function isLeapYear(y: bigint) {
  if (y % 4n !== 0n) {
    return false;
  }
  if (y % 100n !== 0n) {
    return true;
  }
  return y % 400n === 0n;
}

const SECS_PER_DAY = 86400n;
const EPOCH_DAYS = 719528n; // days from year 0 to Unix epoch (1970-01-01)
const DAYS_PER_400Y = 146097n;

interface DateParts {
  dayOfYear: bigint;
  secondsOfDay: number;
}

function dateParts(epochSeconds: number): DateParts {
  const totalSecs = BigInt(Math.floor(epochSeconds));
  const frac = epochSeconds - Math.floor(epochSeconds);
  const daysBig = floorDiv(totalSecs, SECS_PER_DAY);
  const secsOfDay = floorMod(totalSecs, SECS_PER_DAY);

  let epochDays = daysBig + EPOCH_DAYS;
  epochDays -= 60n; // adjust for March-based year

  const era = floorDiv(epochDays, DAYS_PER_400Y);
  const dayOfEra = epochDays - era * DAYS_PER_400Y;
  const yearOfEra = floorDiv(
    dayOfEra - dayOfEra / 1460n + dayOfEra / 36524n - dayOfEra / 146096n,
    365n
  );

  let year = yearOfEra + era * 400n;
  const dayOfYear0 =
    dayOfEra - (365n * yearOfEra + yearOfEra / 4n - yearOfEra / 100n);
  const m = (5n * dayOfYear0 + 2n) / 153n;

  let month = m + 3n;
  if (month > 12n) {
    month -= 12n;
    year += 1n;
  }

  const daysInMonth = [
    31n,
    isLeapYear(year) ? 29n : 28n,
    31n,
    30n,
    31n,
    30n,
    31n,
    31n,
    30n,
    31n,
    30n,
    31n
  ];
  const day = dayOfYear0 - (153n * m + 2n) / 5n + 1n;
  let doy = day;
  for (let i = 0; i < Number(month) - 1; i++) {
    doy += daysInMonth[i]!;
  }

  return {
    dayOfYear: doy,
    secondsOfDay: Number(secsOfDay) + frac
  };
}

/**
 * Compute the subsolar point (where the sun is directly overhead) for a given date.
 */
export function getSubsolarPoint(date: Date | null = null): {
  lng: number;
  lat: number;
} {
  const epochSec = (date ?? new Date()).getTime() / 1000;
  const { dayOfYear, secondsOfDay } = dateParts(epochSec);

  const dayFrac = Number(dayOfYear) + secondsOfDay / 86400;
  const angVel = (2 * Math.PI) / 365.24;
  const obliquity = toRad(23.44);
  const eccentricity = 0.0167;

  const meanAnomaly = (dayFrac + 9) * angVel;
  const eclipticLng =
    meanAnomaly + 2 * eccentricity * Math.sin((dayFrac - 3) * angVel);

  const eqTime =
    (meanAnomaly -
      Math.atan2(
        Math.sin(eclipticLng),
        Math.cos(eclipticLng) * Math.cos(obliquity)
      )) /
    Math.PI;
  const correction = 720 * (eqTime - Math.trunc(eqTime + 0.5));

  const lng = -15 * (secondsOfDay / 3600 - 12 + correction / 60);
  const lat = toDeg(Math.asin(Math.sin(-obliquity) * Math.cos(eclipticLng)));

  return { lng, lat };
}

const MS_PER_DAY = 86400000;

/**
 * Compute animation transition parameters for night shadow.
 * Big time jumps (>24h) get shortened animation (keep time-of-day, change date).
 * Small jumps animate smoothly.
 */
export function computeTransition(
  currentDate: Date,
  targetDate: Date
): { startTime: number; endTime: number; duration: number } {
  const endTime = targetDate.getTime();
  const fullDiffMs = Math.abs(endTime - currentDate.getTime());

  const startTime =
    fullDiffMs <= MS_PER_DAY
      ? currentDate.getTime()
      : (() => {
          let t = new Date(targetDate).setHours(
            currentDate.getHours(),
            currentDate.getMinutes(),
            currentDate.getSeconds()
          );
          const realDirection = endTime - currentDate.getTime();
          const shortDirection = endTime - t;
          if (realDirection > 0 && shortDirection <= 0) {
            t -= MS_PER_DAY;
          } else if (realDirection < 0 && shortDirection >= 0) {
            t += MS_PER_DAY;
          }
          return t;
        })();

  const duration = fullDiffMs > MS_PER_DAY ? 2000 : 400;
  return { startTime, endTime, duration };
}
