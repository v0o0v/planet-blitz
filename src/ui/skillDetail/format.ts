/**
 * 스킬 상세 표가 공유하는 **타입과 수치 표기**.
 *
 * 기체마다 표가 한 파일씩이고(`./striker.ts` …) 그 일곱이 같은 형식으로 수치를 적어야 한다 —
 * 같은 `bp` 를 한 화면에서는 `+12%`, 다른 화면에서는 `×1.12` 로 적으면 플레이어가 두 수를
 * 비교할 수 없다. 그래서 표기 함수를 여기 한 벌만 둔다.
 */

/** 스킬 1종의 상세. 수치는 {@link SkillDetail.values} 가 **계산해서** 낸다. */
export interface SkillDetail {
  /**
   * 본체 — 조건·대상·예외까지 적은 확장 설명. `node.desc` 한 줄보다 길고, **구현이 실제로
   * 하는 것**을 적는다(설계서가 약속했지만 구현되지 않은 축은 적지 않는다 — 스트라이커 M5 의
   * "거리"가 그 예다).
   *
   * ## 문체·용어 규율 (2026-08-09 사용자 지적 · `tests/skillDetail.test.ts` ①-bis 가 잠근다)
   *  - **합니다체**로 쓴다. 게임의 다른 플레이어 대상 설명이 전부 그렇다(액티브 스킬 설명
   *    "180틱 동안 모든 피해를 무시합니다" · 공명 "처치가 연쇄합니다" · 시그니처 설명).
   *  - **코드·설계서 어휘를 쓰지 않는다.** `fanStrike`·`무연산`·`좌표 직접 변위` 같은 말은
   *    화면 어디에도 안 나오므로 플레이어가 해석할 근거가 없다.
   *  - **다른 스킬과의 상충은 설계서 ID 로 지목하지 않고 이유를 푼다.** "F8 과 충돌한다"는
   *    F8 을 아는 사람만 읽을 수 있다 — 무엇이 왜 부딪히는지를 문장으로 적는다.
   *  - **마크다운을 쓰지 않는다.** Pixi `Text` 는 `**강조**` 를 파싱하지 않아 별표가 그대로
   *    화면에 뜬다(스트라이커 초판이 실제로 그랬다).
   */
  readonly body: string;
  /** 레벨 스케일 — 공식 문장. 값이 아니라 **모양**이라 레벨과 무관하다. */
  readonly scale: string;
  /**
   * 주어진 레벨에서의 **실수치** 줄들. 화면이 현재 레벨과 만렙 두 번 부른다.
   * 레벨 0(미투자)에서도 불린다 — "1포인트를 넣으면 얼마인가"는 `values(1)` 이 답한다.
   */
  readonly values: (level: number) => readonly string[];
  /** 첫 1포인트가 주는 것. */
  readonly lv1: string;
  /** 20포인트를 다 넣으면 무엇이 되는가. */
  readonly max: string;
}

/** `+12%` 처럼 **증분** bp 를 퍼센트로. 소수 첫째 자리까지(0.5%p 계단이 있다). */
export function incPct(bp: number): string {
  const pct = bp / 100;
  return `+${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** `×1.31` 처럼 **배율** bp 를(10000 = ×1.00). */
export function multX(bp: number): string {
  return `×${(bp / 10000).toFixed(2)}`;
}

/** `31%` 처럼 **배율** bp 를 "원본의 몇 %"로(10000 = 100%). */
export function ofPct(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** 틱 → "N틱(≈X.X초)". 60틱 = 1초. */
export function ticks(n: number): string {
  return `${n}틱(≈${(n / 60).toFixed(1)}초)`;
}

/**
 * 레벨 손잡이가 **없는** 스킬이 공유하는 두 문장.
 *
 * 설계 문면이 「가득 채운다」·「면역」·「절반」처럼 더 벌릴 축이 없는 말이라 레벨을 올려도
 * 값이 안 변한다. 그 사실을 화면이 말하지 않으면 플레이어는 20포인트를 붓고 나서야 안다.
 */
export const NO_SCALE_LV1 = '1포인트만으로 효과가 온전히 나옵니다. 더 넣어도 달라지지 않습니다.';
export const NO_SCALE_MAX =
  '더 넣어도 얻는 것이 없습니다. 1포인트만 넣고 다른 스킬로 넘어가는 편이 낫습니다.';
