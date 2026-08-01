/**
 * 밸런스 스윕 시드 정본.
 *
 * 재현성이 계약이므로 **절대 난수로 만들지 않는다**. 이 목록은 `src/bench/rosterBench.ts` 가
 * 쓰던 96개와 **바이트 동일**하다 — 정본을 여기로 옮기고 그쪽이 재수출한다. 두 벌로 두면
 * 한쪽만 확장했을 때 "같은 시드로 쟀다"는 주장이 조용히 거짓이 된다.
 *
 * - **앞 24개는 M8 원본이며 절대 바꾸지 않는다**(m8 인계 §1.2). 그 앞 12개는
 *   `tests/invasionBalance.test.ts` 의 `BALANCE_SEEDS` 와 동일해 침공 밸런스와 시드를 공유한다.
 * - 25~96번째 72개는 **뒤에 append 만** 했다(ADR-0037). 191 다음 연속 소수 72개다.
 *
 * ## 96개를 넘는 라운드
 * 예산제 러너({@link ../../../scripts/balance/run.mjs})는 예산이 남으면 라운드를 계속 돌린다.
 * 96 라운드를 넘어가면 {@link seedAt} 이 규칙으로 확장한다 — 난수가 아니라 **인덱스의 함수**라
 * 같은 라운드 수는 언제나 같은 시드 집합이 된다. 앞 96개 구간은 고정 목록 그대로라 기존
 * 산출물의 재현성이 유지된다.
 */

/** 고정 시드 96개. 이 배열의 **앞 24개는 불변**이고 뒤로만 append 한다. */
export const FIXED_SEEDS: readonly number[] = [
  // --- 1~24: M8 원본(불변) ---
  1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79,
  83, 97, 101, 113, 127, 131, 149, 151, 163, 173, 181, 191,
  // --- 25~96: 191 다음 연속 소수 72개(append) ---
  193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257,
  263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331,
  337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401,
  409, 419, 421, 431, 433, 439, 443, 449, 457, 461, 463, 467,
  479, 487, 491, 499, 503, 509, 521, 523, 541, 547, 557, 563,
  569, 571, 577, 587, 593, 599, 601, 607, 613, 617, 619, 631,
];

/** CI 게이트 · M8 매트릭스가 쓰는 24 시드(= {@link FIXED_SEEDS} 앞 24개). */
export const CI_SEEDS: readonly number[] = FIXED_SEEDS.slice(0, 24);

/**
 * 고정 목록을 넘어선 라운드의 시드 보폭. 목록 최대값(631)보다 훨씬 크게 잡아 확장분이 고정
 * 구간과 겹치지 않게 한다(겹치면 같은 런을 두 번 세어 표본이 부풀려진다).
 */
const SEED_STRIDE = 10_007;

/**
 * 라운드 인덱스 `i`(0-based)의 시드. `i < 96` 이면 고정 목록 그대로, 그 뒤는 규칙 확장이다.
 *
 * 확장분이 서로 다른 값임을 보장한다: `FIXED_SEEDS` 는 전부 631 이하이고 보폭이 10,007 이라
 * 사이클 `k`(= `floor(i/96)`)가 다르면 구간이 절대 겹치지 않는다.
 */
export function seedAt(i: number): number {
  const idx = Math.max(0, Math.floor(i));
  const base = FIXED_SEEDS[idx % FIXED_SEEDS.length];
  if (base === undefined) return 1; // 도달 불가(모듈로) — 타입 좁히기용
  return base + SEED_STRIDE * Math.floor(idx / FIXED_SEEDS.length);
}

/** 앞에서부터 `n` 개의 시드. `n > 96` 이면 {@link seedAt} 규칙으로 이어 붙인다. */
export function seedsUpTo(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) out.push(seedAt(i));
  return out;
}
