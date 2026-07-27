/**
 * 행성 인기 배율 — 전체 유저의 행성 편식을 보상으로 되미는 자동 평형 장치(ADR-0038).
 *
 * 덜 도는 행성의 보상을 올리고 많이 도는 행성의 보상을 내려서, 6행성이 균일하게 소비되도록
 * 유도한다. 입력은 **전체 유저 통계**(per-player 아님)이고, 지표는 행성별 **PvE 런 정산 건수**다.
 *
 * ## 어디에 걸리고 어디에 안 걸리나
 *  - 걸린다: **수량**(엘리트 드랍 게이트) · **XP**(메타 풀) · **자원**(보급 습격 적립).
 *  - 안 걸린다: **품질(rarity)** — ADR-0022 의 "품질 축은 전 행성 동일"이 그대로 계약이다.
 *    조우 보상 · 보스 확정 드랍 1개(ADR-0035 확정성) · 특산 설계도 · 특산 촉매 ·
 *    침공(PvP) · 예비역 소집 · 하네스/오염 런.
 *
 * ## 왜 centi 정수인가
 * 배율을 **0.01 단위 정수**(중립 = {@link NEUTRAL_MULT_CENTI} = 100)로 저장·전송·해시한다.
 * 리포의 `blueprintChanceCp`(centi-percent) 관례와 정합하고, EF(Deno)↔브라우저 IEEE754 재현
 * 논쟁을 없앤다 — 서버 스냅샷·`runConfig` 스탬프·`hashWorld` 폴드가 전부 같은 정수를 본다.
 * 부동소수 배율은 sim 안에서 `centi / 100` 로 **한 번만** 만들어 쓰고, `100 / 100 === 1` 이
 * IEEE754 에서 정확하므로 중립 런은 곱셈이 무연산이다(바이트 불변).
 *
 * ## 산식 정본 (⚠️ SQL 과 이중 구현이다 — 반드시 함께 고쳐라)
 * ```
 * ŵᵢ        = (cᵢ + K) / (R + 6K)                       # 사전표본 축소. cᵢ = 행성 i 런 수, R = 총합
 * mᵢ_raw    = (1/6) / ŵᵢ                                 # 역비례
 * mᵢ_clamp  = clamp(mᵢ_raw, CLAMP_LO, CLAMP_HI)
 * mᵢ_target = mᵢ_clamp / Σ(wᵢ · mᵢ_clamp)                # 런가중 재정규화 → Σwᵢmᵢ = 1
 * mᵢ_new    = mᵢ_prev + ALPHA × (mᵢ_target − mᵢ_prev)    # 지수평활
 * ```
 * 실제 30분 cron 은 SQL(`supabase/migrations/20260727010000_planet_popularity.sql`
 * `refresh_planet_popularity()`)에서 이 산식을 다시 구현한다. 클라는 그 결과를 폴링만 하므로
 * **이 모듈은 런타임 경로가 아니라 산식의 정본·검증 기준**이다. `tests/planetPopularity.test.ts`
 * 가 불변식(런가중 평균 = 1 · 클램프 · 사전표본 축소 · 수렴)을 못 박는다. 두 구현이 갈리면
 * 서버가 이기고 클라 표시가 틀리므로, 산식 수정은 **항상 두 파일을 같은 커밋에서** 한다.
 */

/** 행성 수. `data/planets/index.ts` 의 `PLANETS.length` 와 항상 같아야 한다(ADR-0038). */
export const PLANET_COUNT = 6;

/** 중립 배율(centi). 이 값이면 sim 이 무연산이고 `hashWorld` 가 한 폴드도 실행하지 않는다. */
export const NEUTRAL_MULT_CENTI = 100;

/** 배율 갱신 주기(초) = 30분. epoch = `floor(unixSeconds / EPOCH_SECONDS)`. */
export const EPOCH_SECONDS = 1800;

/** 집계 창(초) = 최근 1시간. cron 이 이 창의 정산 건수를 센다. */
export const WINDOW_SECONDS = 3600;

// ---------------------------------------------------------------------------
// 상수 — 전부 플레이스홀더. 값 결정·스윕·실측 튜닝은 이 레인 범위 밖이다.
// ---------------------------------------------------------------------------

/** 배율 하한. TODO(밸런스): 출시 전 튜닝 */
export const CLAMP_LO = 0.85;
/** 배율 상한. TODO(밸런스): 출시 전 튜닝 */
export const CLAMP_HI = 1.2;
/**
 * 사전표본(pseudo-count). 행성마다 K 런을 미리 관측한 셈 쳐서, 표본이 적을 때 배율이 1.0 에
 * 붙게 만든다(초기 노이즈 증폭 방지). TODO(밸런스): 출시 전 튜닝
 */
export const PRIOR_K = 80;
/** 지수평활 계수. 한 주기에 목표치로 가는 비율. TODO(밸런스): 출시 전 튜닝 */
export const ALPHA = 0.2;

// ---------------------------------------------------------------------------
// epoch
// ---------------------------------------------------------------------------

/** unix ms → epoch(30분 단위 정수). 런 시작에 `runConfig` 로 스탬프되는 값. */
export function epochOfMs(unixMs: number): number {
  return Math.floor(unixMs / 1000 / EPOCH_SECONDS);
}

// ---------------------------------------------------------------------------
// 산식
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * 배율표 1주기 갱신(순수). `counts` = 최근 창의 행성별 정산 건수, `prevCenti` = 직전 스냅샷
 * 배율(centi). 반환은 새 배율(centi, 정수 반올림).
 *
 * ## 오프라인·미설정 계약
 * `counts` 가 전부 0 이면 ŵᵢ 가 전 행성 동일 → mᵢ_raw = 1 → 재정규화도 1 → 평활 결과는
 * `prevCenti` 와 1.0 사이 어딘가다. 즉 **표본이 없으면 배율이 1.0 으로 되돌아온다**(발산 없음).
 * 클라 쪽 "게이트웨이 미설정 = 전 행성 1.0" 은 이 함수가 아니라 폴링 실패 폴백이 담당한다
 * (`src/net/planetMultipliers.ts`).
 *
 * ## 재정규화가 하는 일
 * `Σ(wᵢ · mᵢ) = 1` 로 맞춘다 — 즉 **현재 플레이 분포로 가중한 평균 배율이 정확히 1**이라,
 * 배율 도입이 게임 전체 보상 총량을 늘리거나 줄이지 않는다(경제 총량 불변). 개별 행성은
 * 1 보다 크거나 작을 수 있어도 합계는 그대로다.
 */
export function refreshMultipliersCenti(
  counts: readonly number[],
  prevCenti: readonly number[],
): number[] {
  const n = PLANET_COUNT;
  // 입력 정규화: 음수·비유한은 0 으로, 길이는 n 으로 맞춘다(손상 입력이 배율을 폭주시키지 않게).
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = counts[i];
    c.push(typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  }
  const total = c.reduce((a, b) => a + b, 0);

  // ŵ: 사전표본 K 축소. 분모가 항상 > 0 이라(K > 0) 0 나눗셈이 없다.
  const denom = total + n * PRIOR_K;
  const wHat = c.map((x) => (x + PRIOR_K) / denom);

  // 역비례 → 클램프.
  const mClamp = wHat.map((w) => clamp(1 / n / w, CLAMP_LO, CLAMP_HI));

  // 런가중 재정규화. 가중치는 **실측 점유율**(wᵢ = cᵢ / R)이다 — 사전표본이 섞인 ŵ 가 아니라.
  // 표본이 하나도 없으면(R = 0) 가중치가 정의되지 않으므로 균등 가중으로 떨어뜨린다.
  const w = total > 0 ? c.map((x) => x / total) : c.map(() => 1 / n);
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += w[i]! * mClamp[i]!;
  const mTarget = weighted > 0 ? mClamp.map((m) => m / weighted) : mClamp.slice();

  // 지수평활 → centi 정수. prev 미지정/손상은 중립(1.0)에서 출발한다.
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pv = prevCenti[i];
    const prevCentiInt =
      typeof pv === 'number' && Number.isFinite(pv) && pv > 0 ? Math.round(pv) : NEUTRAL_MULT_CENTI;
    const prev = prevCentiInt / 100;
    const targetCentiInt = Math.round(mTarget[i]! * 100);
    let next = Math.round((prev + ALPHA * (mTarget[i]! - prev)) * 100);
    // ⚠️ **정수 격자 평활의 정지 지점(stall)** — 반드시 필요한 보정이다.
    // `prev` 가 목표에 가까워지면 한 주기 스텝 `ALPHA × |target − prev|` 이 0.5 centi 밑으로
    // 내려가고, 그 순간 `Math.round` 가 결과를 `prev` 로 되돌려 **영원히 그 자리에 멈춘다**.
    // 예: target 0.95625 · prev 0.98 · ALPHA 0.2 → 스텝 0.475 centi → 98 로 반올림 → 다음
    // 주기도 똑같이 98. 목표(96)에 2 centi 못 미친 채 수렴한 척한다(§1 런가중 평균 불변식이
    // 1.019 로 깨져 이 결함이 드러났다).
    // 보정: 목표가 아직 1 centi 이상 떨어져 있는데 반올림이 제자리면 **최소 1 centi 전진**시킨다.
    // 이러면 유한 주기 안에 정확히 `targetCentiInt` 에 도달하고 거기서 멈춘다(진동 없음).
    if (next === prevCentiInt && targetCentiInt !== prevCentiInt) {
      next = prevCentiInt + (targetCentiInt > prevCentiInt ? 1 : -1);
    }
    out.push(next);
  }
  return out;
}

/**
 * centi 정수 → sim 이 곱할 배율. **정수 100 은 정확히 1.0** 이라 중립 런의 곱셈이 무연산이다.
 * 비정상 입력(비유한·0 이하)은 중립으로 접는다.
 */
export function multFromCenti(centi: number | undefined): number {
  if (typeof centi !== 'number' || !Number.isFinite(centi) || centi <= 0) return 1;
  return (centi | 0) / 100;
}

/** 전 행성 중립 배율표(centi). 오프라인·미로그인·게이트웨이 미설정의 폴백값. */
export function neutralMultipliersCenti(): number[] {
  return new Array<number>(PLANET_COUNT).fill(NEUTRAL_MULT_CENTI);
}
