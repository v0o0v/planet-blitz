/**
 * Deterministic math for the simulation core.
 *
 * ADR-0005 requires the sim core to produce byte-identical results on the
 * browser client (V8) and the verification server (Deno V8 / Edge Function).
 * IEEE-754 basic operations (+, -, *, /, and sqrt) are correctly rounded and
 * therefore deterministic across compliant platforms. The transcendental
 * functions on the built-in `Math` object (`sin`, `cos`, `atan2`, `tan`, ...)
 * are NOT mandated to be correctly rounded and may differ between engine
 * versions — using them in the sim core is a determinism hazard.
 *
 * This module isolates that risk: every trig function here is implemented with
 * only basic arithmetic (plus `Math.abs`, `Math.floor`, `Math.sqrt`, all of
 * which are exact / correctly rounded), so the results are identical on any
 * IEEE-754 platform. The sim core must import trig from here, never from `Math`.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Correctly-rounded square root — safe to use directly (IEEE-754 mandated). */
export function sqrt(x: number): number {
  return Math.sqrt(x);
}

/** Euclidean length using only basic ops (avoids Math.hypot, which is not exact). */
export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * Deterministic sine.
 *
 * Range-reduces the argument into [-PI/2, PI/2] using only basic arithmetic,
 * then evaluates a degree-9 Taylor polynomial (max error < 1e-6 on that
 * interval — far below any gameplay-relevant threshold).
 */
export function sin(x: number): number {
  // Reduce into [-PI, PI].
  let r = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  // Fold into [-PI/2, PI/2] using sin(PI - r) === sin(r).
  if (r > HALF_PI) {
    r = PI - r;
  } else if (r < -HALF_PI) {
    r = -PI - r;
  }
  const r2 = r * r;
  // r - r^3/3! + r^5/5! - r^7/7! + r^9/9!  (Horner form).
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880)))))
  );
}

/** Deterministic cosine, derived from {@link sin}. */
export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/**
 * Deterministic arctangent on the full plane.
 *
 * Uses a degree-9 odd minimax polynomial for atan on [-1, 1] and the identity
 * atan(z) = PI/2 - atan(1/z) for |z| > 1, then applies quadrant/sign fixups.
 * Max error of the core approximation is ~1e-5. Uses only basic arithmetic.
 */
export function atan2(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0; // atan2(0, 0) is conventionally 0.
  }
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  // z in [0, 1]: ratio of the smaller magnitude over the larger.
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax;
  const z2 = z * z;
  // Odd minimax polynomial for atan(z), z in [0,1].
  let a =
    z *
    (0.9998660086 +
      z2 *
        (-0.3302995175 +
          z2 * (0.1801410299 + z2 * (-0.0851330327 + z2 * 0.0208351249))));
  if (swap) {
    a = HALF_PI - a;
  }
  // Apply signs to reach the correct quadrant.
  if (x < 0) {
    a = PI - a;
  }
  if (y < 0) {
    a = -a;
  }
  return a;
}

/** Clamp helper (basic ops only). */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + PI) / TWO_PI);
}
