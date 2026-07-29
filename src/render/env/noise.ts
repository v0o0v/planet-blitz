/**
 * 환경 레이어 공용 결정적 난수 (렌더 전용).
 *
 * `Math.random` 을 쓰면 같은 시드의 리플레이가 다른 배경을 그린다. 배경은 해시에 안 들어가니
 * "틀려도 안 터지는" 종류의 결함이라 **더 오래 숨는다** — 그래서 아예 난수원 자체를 여기로
 * 모으고 각 레이어는 이 함수들만 쓴다. autotile.ts 의 `hash2`/`valueNoise` 와 같은 계열이며,
 * 별도 사본을 두지 않고 여기서 재수출한다.
 */

/** 32비트 정수 해시 (seed, x, y) → [0,1). 순수·무상태. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

/** 3입력 해시 (seed, x, y, k) → [0,1). 같은 격자에서 여러 독립 속성을 뽑을 때 쓴다. */
export function hash3(seed: number, x: number, y: number, k: number): number {
  return hash2(seed ^ Math.imul(k | 0, 0x85ebca6b), x, y);
}

/** 부드러운 보간용 smoothstep. */
export function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 정수 격자 2D value noise, 쌍선형 평활 → [0,1). */
export function valueNoise(seed: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fade(fx - x0);
  const v = fade(fy - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 다중 옥타브 fBm → [0,1). 큰 덩어리 + 잔결을 한 번에 얻는다. */
export function fbm(seed: number, fx: number, fy: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed ^ Math.imul(i + 1, 0x9e3779b9), fx * f, fy * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}
