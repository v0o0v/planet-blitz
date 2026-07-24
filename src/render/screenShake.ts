/**
 * 화면 흔들림 — 트라우마 모델 (Phase 2 — plan §AC-2.1·2.2; ADR-0031 "규율 있는 하이브리드 글로우").
 *
 * "trauma" 는 0~1 의 스칼라 스트레스 값이다. 트리거(플레이어 피격·보스/엘리트 처치·대형 폭발)가
 * trauma 를 밀어올리고, 매 프레임 선형 감쇠로 0 을 향해 줄어든다. 실제 카메라 오프셋은
 * `shake = trauma²`(또는 trauma^POWER)에 비례해 **비선형**으로 붙어, 약한 이벤트는 거의 안
 * 흔들리고 강한 이벤트만 크게 흔들리게 한다(Squirrel Eiserloh 트라우마 모델).
 *
 * ── 결정론(ADR-0005) ── 이 모듈은 **render-only 파생**이다. 카메라 오프셋은 sim 을 되먹이지
 * 않으며(sim·`hashWorld`/`hashEntity`·리플레이 무관), noise 는 tick 만의 결정론적 의사난수라
 * `(trauma, tick)` 만으로 출력이 정해진다. `src/sim/` 에서 절대 import 되지 않는다.
 *
 * ── 접근성 ── `reducedMotion`(모션 감소) 시 오프셋을 0 으로 만든다. {@link TraumaController.tick}
 * 의 `enabled=false` 가 그 역할을 하되, **trauma 자체는 계속 감쇠**시켜 감소 토글을 되돌렸을 때
 * 과거 스트레스가 잔류해 갑자기 크게 흔들리는 일이 없게 한다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 진폭({@link MAX_OFFSET})·감쇠율({@link TRAUMA_DECAY})·
 * 곡률({@link SHAKE_POWER})·트리거별 세기({@link TRAUMA_PLAYER_HIT} 등)는 전부 placeholder 다.
 * 실제 체감은 출시 직전 하네스 눈검증에서 일괄 튜닝한다(Wave B 가 트리거를 배선한다).
 *
 * ── 테스트 안전 ── 흔들림 계산은 순수함수 {@link shakeOffset} 로 분리해 node 환경에서 검증한다.
 * {@link TraumaController} 는 누적/감쇠 런타임 상태만 얹은 얇은 래퍼다.
 */

/** 화면 오프셋(픽셀). render 카메라 팬에 render-only 로 가산된다(sim 되먹임 없음). */
export interface ShakeOffset {
  dx: number;
  dy: number;
}

/** 오프셋 원점(흔들림 없음). 재사용 상수(불변 취급). */
const ZERO_OFFSET: ShakeOffset = { dx: 0, dy: 0 };

/**
 * 최대 화면 오프셋(픽셀). trauma=1 · noise=±1 일 때의 절대 상한. placeholder, defer-balance-tuning.
 */
export const MAX_OFFSET = 24;

/**
 * 트라우마 감쇠율(초당). 매 프레임 `trauma -= TRAUMA_DECAY · dt`(하한 0)로 선형 감쇠한다.
 * 1.6 이면 trauma=1 이 약 0.63초 만에 0 으로 수렴한다. placeholder, defer-balance-tuning.
 */
export const TRAUMA_DECAY = 1.6;

/**
 * 흔들림 곡률 지수. `shake = trauma^SHAKE_POWER`. 2 이면 약한 trauma 는 거의 안 흔들리고 강한
 * 것만 크게 흔들린다(트라우마 모델 핵심). placeholder, defer-balance-tuning.
 */
export const SHAKE_POWER = 2;

// ── 트리거별 권장 trauma 세기(Wave B 가 배선에서 사용) ──
// 전부 placeholder, defer-balance-tuning. 세기 서열(강>중)만 의미가 있고 절대값은 튜닝 대상이다.

/** 플레이어 피격(중). plan §AC-2.1 트리거. placeholder, defer-balance-tuning. */
export const TRAUMA_PLAYER_HIT = 0.4;
/** 보스 처치(강). plan §AC-2.1 트리거. placeholder, defer-balance-tuning. */
export const TRAUMA_BOSS_KILL = 0.7;
/** 엘리트 처치(강). 보스와 동급 강 트리거. placeholder, defer-balance-tuning. */
export const TRAUMA_ELITE_KILL = 0.6;
/** 대형 폭발(중). plan §AC-2.1 트리거. placeholder, defer-balance-tuning. */
export const TRAUMA_BIG_EXPLOSION = 0.4;

/** 정수 해시 스케일(2^31). int32 → [-1, 1) 정규화 분모. */
const HASH_SCALE = 2147483648;

/**
 * tick(정수) → [-1, 1) 결정론적 의사난수(순수). Math.imul 기반 정수 해시(fmix 계열)로 잘
 * 흩어진 값을 만든다. 같은 seed → 같은 값이라 리플레이/테스트에서 재현 가능하다.
 * dx/dy 두 축은 서로 다른 seed(2·tick, 2·tick+1)로 독립화한다.
 */
function hashUnit(seed: number): number {
  let x = (Math.trunc(seed) | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) | 0; // 부호 있는 int32 로 확정.
  return x / HASH_SCALE; // [-1, 1).
}

/**
 * 화면 흔들림 오프셋(순수함수). plan §AC-2.1 의 핵심 계약.
 *
 * `trauma` 를 [0,1] 로 클램프하고, `trauma ≤ 0` 이면 {@link ZERO_OFFSET}. 그 외에는
 * `shake = trauma^SHAKE_POWER`, `offset = shake · MAX_OFFSET · noise(tick)` 로 계산한다.
 * noise 는 tick 의 결정론적 의사난수([-1,1))라 `(trauma, tick)` 만으로 출력이 정해진다.
 * 따라서 |dx|,|dy| ≤ MAX_OFFSET 가 항상 보장된다(shake≤1, |noise|<1).
 *
 * @param trauma 스트레스 스칼라([0,1] 로 클램프; 음수/0 → 흔들림 없음).
 * @param tick   프레임 카운터(결정론적 noise 위상; 내부에서 정수로 절단).
 */
export function shakeOffset(trauma: number, tick: number): ShakeOffset {
  // 음수/NaN 방어 + 상한 1 클램프.
  const t = trauma > 1 ? 1 : trauma; // NaN 은 아래 t > 0 비교에서 false 로 걸러진다.
  if (!(t > 0)) return { ...ZERO_OFFSET };

  const shake = Math.pow(t, SHAKE_POWER);
  const amp = shake * MAX_OFFSET;
  const n = Math.trunc(tick);
  return {
    dx: amp * hashUnit(2 * n),
    dy: amp * hashUnit(2 * n + 1),
  };
}

/**
 * 트라우마 누적/감쇠 런타임 상태(render-only). 트리거가 {@link addTrauma} 로 스트레스를 밀어넣고,
 * 매 프레임 {@link tick} 이 감쇠 + 카메라 오프셋 산출을 한 번에 한다. 내부 tick 카운터는
 * {@link shakeOffset} 의 noise 위상으로 쓰여, 흔들리는 동안 매 프레임 다른 방향으로 진동한다.
 *
 * sim 무관(순수 render 파생)이라 브라우저 밖(테스트)에서도 안전하게 생성·구동된다.
 */
export class TraumaController {
  /** 현재 트라우마([0,1]). */
  private trauma = 0;
  /** 내부 프레임 카운터(noise 위상). 단조 증가, reset 에서만 0 복귀. */
  private tickCount = 0;

  /**
   * 트라우마 누적(상한 1 클램프). 음수는 0 하한으로 무시된다(감쇠는 {@link tick} 몫).
   * @param amount 더할 스트레스(권장값은 TRAUMA_* 상수).
   */
  addTrauma(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const next = this.trauma + amount;
    this.trauma = next > 1 ? 1 : next;
  }

  /**
   * 한 프레임 진행: 트라우마를 `TRAUMA_DECAY · deltaSeconds` 만큼 감쇠(하한 0)하고, 내부 tick 을
   * 진행한 뒤 {@link shakeOffset} 를 반환한다.
   *
   * `enabled === false`(모션 감소)면 {@link ZERO_OFFSET} 를 반환하되 **감쇠는 그대로 진행**해,
   * 감소 토글을 되돌렸을 때 과거 스트레스가 잔류하지 않게 한다.
   *
   * @param deltaSeconds 직전 프레임과의 시간 간격(초). 음수/NaN 은 감쇠 0 으로 방어.
   * @param enabled      흔들림 활성(기본 true). false 면 오프셋 0(단 감쇠는 계속).
   */
  tick(deltaSeconds: number, enabled = true): ShakeOffset {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const decayed = this.trauma - TRAUMA_DECAY * dt;
    this.trauma = decayed > 0 ? decayed : 0;
    this.tickCount += 1;
    if (enabled === false) return { ...ZERO_OFFSET };
    return shakeOffset(this.trauma, this.tickCount);
  }

  /** 현재 트라우마 값([0,1]). */
  getTrauma(): number {
    return this.trauma;
  }

  /** 트라우마·tick 카운터를 초기화(씬 전환·런 재시작 시). */
  reset(): void {
    this.trauma = 0;
    this.tickCount = 0;
  }
}
