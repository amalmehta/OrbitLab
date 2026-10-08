// Physical constants. Units: km, s, kg.
export const MU_EARTH = 398600.4418;   // km³/s²
export const R_EARTH = 6371;           // km
export const MU_MOON = 4902.800066;    // km³/s²
export const R_MOON = 1737.4;          // km
export const MOON_ORBIT = 384400;      // km, mean distance (semi-major axis)
export const MOON_SOI = MOON_ORBIT * Math.pow(MU_MOON / MU_EARTH, 2 / 5); // ≈ 66,100 km
export const MOON_RATE = Math.sqrt((MU_EARTH + MU_MOON) / MOON_ORBIT ** 3); // rad/s
export const MOON_PERIOD = (2 * Math.PI) / MOON_RATE;
export const DEG = Math.PI / 180;
// Time: "epoch" is days since J2000.0 (2000-01-01 12:00 UTC); simulation time t is seconds after it.
export const J2000_MS = Date.UTC(2000, 0, 1, 12);
export const epochFromDate = (date) => (date.getTime() - J2000_MS) / 86400000;
export const dateFromEpoch = (epoch) => new Date(J2000_MS + epoch * 86400000);
export const DEFAULT_EPOCH = epochFromDate(new Date(Date.UTC(2026, 9, 8))); // 2026-10-08 00:00 UTC
export const OBLIQUITY = 23.4393 * DEG; // tilt of the ecliptic to the equator
export const G0 = 9.80665e-3;          // km/s²
export const DAY = 86400;
