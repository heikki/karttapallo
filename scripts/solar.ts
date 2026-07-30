/**
 * Sun position and scene brightness — used to sanity-check capture times.
 *
 * Script-only helper. Nothing in the app reads this; it exists because a stored
 * capture time can be checked against physics. The sun's altitude at a given
 * instant and place is fixed, and the exposure the camera chose records how much
 * light was actually there. A frame shot at EV 14 cannot have been taken with
 * the sun a degree above the horizon.
 *
 * The test is one-sided. A scene can always be darker than the sun allows
 * (indoors, shade, a subject in shadow) but never brighter, so "too bright for
 * this sun" is evidence and "darker than expected" is not. Treat the pair as an
 * advisory signal for a human to read, not a gate — see the header of
 * fix-offset-derived-dates.ts for how that plays out in practice.
 */

const DEG = Math.PI / 180;
const UNIX_EPOCH_JD = 2440587.5;
const J2000 = 2451545.0;

/**
 * Sun altitude in degrees above the horizon, from NOAA's solar position
 * equations. Geometric — no atmospheric refraction, which matters only within
 * about half a degree of the horizon.
 */
export function sunAltitude(
  instantUnix: number,
  lat: number,
  lon: number
): number {
  const d = new Date(instantUnix * 1000);
  const t = (instantUnix / 86400 + UNIX_EPOCH_JD - J2000) / 36525.0;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const ma = meanAnom * DEG;

  const centre =
    Math.sin(ma) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * ma) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * ma) * 0.000289;

  const omega = 125.04 - 1934.136 * t;
  const apparentLong =
    meanLong + centre - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const meanObliq =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);

  const decl =
    Math.asin(Math.sin(obliq * DEG) * Math.sin(apparentLong * DEG)) / DEG;

  // Equation of time, in minutes.
  const y = Math.tan((obliq / 2) * DEG) ** 2;
  const eot =
    (4 *
      (y * Math.sin(2 * meanLong * DEG) -
        2 * ecc * Math.sin(ma) +
        4 * ecc * y * Math.sin(ma) * Math.cos(2 * meanLong * DEG) -
        0.5 * y * y * Math.sin(4 * meanLong * DEG) -
        1.25 * ecc * ecc * Math.sin(2 * ma))) /
    DEG;

  const utcMinutes =
    d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const hourAngle = (utcMinutes + eot + 4 * lon) / 4 - 180;

  const cosZenith =
    Math.sin(lat * DEG) * Math.sin(decl * DEG) +
    Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(hourAngle * DEG);

  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / DEG;
}

/**
 * Exposure value normalised to ISO 100, from the exposure triangle. Roughly:
 * 15 full sun with hard shadows, 13 cloudy bright, 11 golden hour, 9 sun on the
 * horizon, 3 night. Each whole step is a doubling of light.
 *
 * Returns null when any leg is missing or nonsensical, which is common — plenty
 * of assets carry no exposure metadata at all.
 */
export function exposureValue(
  aperture: number | null,
  shutterSeconds: number | null,
  iso: number | null
): number | null {
  if (aperture === null || shutterSeconds === null || iso === null) return null;
  if (aperture <= 0 || shutterSeconds <= 0 || iso <= 0) return null;
  return (
    Math.log2((aperture * aperture) / shutterSeconds) - Math.log2(iso / 100)
  );
}
