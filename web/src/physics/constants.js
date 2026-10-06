// Physical constants. Units: km, s, kg.
export const MU_EARTH = 398600.4418;   // km³/s²
export const R_EARTH = 6371;           // km
export const MU_MOON = 4902.800066;    // km³/s²
export const R_MOON = 1737.4;          // km
export const MOON_ORBIT = 384400;      // km, circular approximation
export const MOON_SOI = MOON_ORBIT * Math.pow(MU_MOON / MU_EARTH, 2 / 5); // ≈ 66,100 km
export const MOON_RATE = Math.sqrt((MU_EARTH + MU_MOON) / MOON_ORBIT ** 3); // rad/s
export const MOON_PERIOD = (2 * Math.PI) / MOON_RATE;
// The reference plane is Earth's equator. The Moon's orbit is tilted to it by between 18.3° and
// 28.6° over an 18.6-year cycle; 2026 is close to the maximum.
export const MOON_INC_DEFAULT = (28.0 * Math.PI) / 180;
export const DEG = Math.PI / 180;
export const G0 = 9.80665e-3;          // km/s²
export const DAY = 86400;
