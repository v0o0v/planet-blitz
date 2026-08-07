/**
 * 수축지대(shrink) 모드 — Lane7 (ADR-0021 §2.5). 비-스크롤 **자유추적** 모드.
 * 아레나 중심(고정 원점 0,0) 기준 **동적으로 줄어드는 안전 반경** 밖에 있으면 지속 피해를
 * 준다(배틀로얄식 압박존, 하드 클램프 없음 — 밖으로 나갈 수는 있고 피해만 받는다). 안전
 * 반경 안의 적을 전멸시키면 세그먼트가 전진하고(그때 유예 후 반경이 한 단계 더 조여진다),
 * 마지막에 아레나 중심에 보스가 소환되면 처치로 완주한다. 서바이벌 코어(웨이브 디렉터·파워업·
 * 드랍)는 불변, 진행/실패 게이트만 반경 규칙으로 바꾼다. 전 계수는 플레이스홀더 —
 * TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 WorldState 필드 1 (이 재설계의 첫 "신규 해시 필드" 모드)
 * contamination(Lane8)·chase(Lane6)는 상태를 전부 엔티티/aux 에 실어 신규 필드가 0 이었지만,
 * 수축 반경은 게임플레이 이력(유예 종료 후 경과 틱 + 세그먼트 전진 시점의 리셋)에 의존해
 * 누적되는 동적 정수라 tick 의 닫힌 함수로 파생할 수 없다 → `WorldState.shrinkRuntime?`
 * 신규 필드가 필요하다(scrollRuntime.scrollX/accelCp 와 정확히 같은 사유). 배선(필드 선언·
 * createWorld 조건부 세움·조건부 스프레드·hashWorld 조건부 폴드)은 scrollRuntime 4단을,
 * 모듈 순수 헬퍼 구조는 contamination/chase 를 미러한다.
 *   - 안전 반경 = `shrinkRuntime.safeRadius`(정수). 밖 피해·링 전멸·스폰 판정의 정본.
 *   - 유예 = `shrinkRuntime.graceTicks`(정수). >0 이면 이번 틱 수축 보류(세그먼트 전진 직후 숨돌릴 틈).
 * → hashWorld 는 `shrinkRuntime !== undefined` 게이트로 shrink 런에만 정수 2필드를 append-only
 *   꼬리에 접는다 → 뱀서류·침공·블록격파·레이싱·추격·오염 바이트 불변.
 *
 * ## 안전 원의 **중심은 인자다**(기본 `(0,0)` — 종전 하드코딩 원점)
 * `id 33 berdan-collapse`(촉매 특산)가 *"안전 원이 15초마다 다른 곳으로 점프한다"* 라 중심이
 * 런타임에 움직인다. 원점은 이 파일 둘(`shrinkOutOfBounds`·`shrinkRingCleared`)과 `waves.ts`
 * 스폰 링 · `world.ts` 보스 소환 좌표, **넷에 하드코딩**돼 있었다 — 넷을 같이 안 옮기면 원과
 * 게이트가 갈려 *"원점 근처 적이 사라질 때마다 세그먼트가 자동 전진"* 한다.
 * ⚠️ **기본 인자가 `(0,0)` 이라 무촉매 런은 산술이 비트 동일이다**
 * (`scripts/catalystByteInvariance.ts` 가 그것을 잠근다). 촉매를 이 모듈이 import 하지 않는
 * 것도 계약이다 — 간선 방향은 **촉매가 모드를 읽는 쪽**이다(`catalyst/shared.ts` §id 33).
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 반경·유예·감소량 전부 **정수 필수**(hashU32 로 접힘 —
 * 소수부 유실). 감소는 정수 뺄셈뿐(부동소수 금지). 배치 RNG 없음 — 적은 웨이브 디렉터 기존
 * 경로로 스폰되고, shrink 는 스폰 위치만 원점 기준으로 재배치한다. 밖 피해·링 판정은 순수
 * 위치 함수(원점 기준 원 거리)라 사전 배치 gimmick 엔티티가 없다(청크 컬링 무관).
 *
 * ## 순환 의존 주의
 * world.ts / waves.ts / snapshot.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서
 * **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈(entities)로만(contamination/chase 선례).
 */
import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 안전 반경 시작값(월드 유닛, 정수). 원점 0,0 기준. TODO(밸런스). */
export const SHRINK_INITIAL_RADIUS = 5500;
/** 안전 반경 하한(정수). 수축이 이 값에서 멈춘다(0 으로 조이면 코어가 붕괴). TODO(밸런스). */
export const SHRINK_MIN_RADIUS = 600;
/** 유예 소진 후 매 틱 반경 감소량(정수). 정수 뺄셈뿐 — 부동소수 금지. TODO(밸런스). */
export const SHRINK_RATE_PER_TICK = 1;
/** 세그먼트 전진 직후 부여되는 유예 틱(정수). 이 동안 반경이 홀드된다(숨돌릴 틈). TODO(밸런스). */
export const SHRINK_GRACE_TICKS = 240;
/**
 * 안전 반경 밖 지속 피해(iframes 간격 적용, 즉사 아님).
 *
 * ## 8 → 2 (2026-08-04) — 베르단의 사인은 **압박도 굶는 것도 아니라 이 상수였다**
 * 이 무대는 밴드 아래(54.4%)에 3회차 남아 있었고, 직전 회차(§R15)의 진단은 "굶는 것"이라
 * `SHRINK_INTERVAL_SCALE` 을 2.4 까지 밀었다. 그런데 그 축은 **소진**이었다 — 더 올리면 런내
 * 레벨업이 밴드 하한 5 아래로 떨어진다(2.7 에서 4.60). 실제로 4.7 로 이미 하한 밑이었다.
 *
 * ⚠️ **피해 귀속 지표가 이 상수를 가리키지 않았다.** 베르단 패배 런의 `지형피해분` 은 0.794 로
 * 해저드(산성 기둥)가 압도적으로 보였고 잔차는 0.185 뿐이었다. 그런데 이 상수는 해저드
 * 엔티티를 거치지 않고 `player.hp` 를 직접 깎으므로 **귀속 표에서 잔차에 숨는다.** 극단값
 * 연결 확인(8 → 0)이 그것을 드러냈다:
 *
 * | 밖 피해 | 클리어율 | 보스도달 | 런내 레벨업 | 처치 | 타임아웃 |
 * |---|---|---|---|---|---|
 * | 8(전) | 54.4% | 86.5s | 4.7 | 124 | 0.0% |
 * | 4 | 58.9% | 87.6s | 4.9 | 134 | 0.1% |
 * | **2** | **66.8%** | **89.9s** | **5.3** | **158** | 0.9% |
 * | 0 | 71.3% | 94.7s | 5.5 | 180 | **3.9%** ← 기각 |
 *
 * 0 은 밴드 안이지만 **타임아웃 3.9%** 로 구조 건전성(0~2%)이 깨진다 — 밖으로 나가도 아프지
 * 않으니 링 전멸 게이트가 끝나지 않는 런이 생긴다. 2 가 밴드·페이싱·레벨업·타임아웃을 동시에
 * 지키는 자리다.
 *
 * **왜 이 축이 `SHRINK_INTERVAL_SCALE` 보다 나은가**: 유입 축은 압박과 성장 자원을 같이
 * 줄이지만(그래서 레벨업이 무너진다) 이쪽은 **순수 피해원**이라 성장에 손대지 않는다. 실제로
 * 처치 124 → 158 · 레벨업 4.7 → 5.3 으로 "굶는" 증상까지 함께 풀렸다 — 굶은 원인이 유입이
 * 아니라 **일찍 죽는 것**이었다. 크라스의 `BLOCKBREAK_CRUSH_DAMAGE`(§R11)와 같은 부류다.
 *
 * ⚠️ 보스 도달 86.5 → 89.9s 의 대부분은 선택 편향이다 — 이 지표는 **승리 런만** 보므로 약한
 * 런이 새로 이기면 값이 올라간다. 페이싱 상수는 하나도 건드리지 않았다.
 * TODO(밸런스): 출시 전 튜닝.
 */
export const SHRINK_OUT_OF_BOUNDS_DAMAGE = 2;
/**
 * 적 스폰 링 반경(아레나 중심 0,0 기준). shrinkSpawnRadius 가 현재 safeRadius 이하로 조여
 * 스폰이 항상 안전 반경 안에 들도록 보장한다 — 그래야 링 전멸 게이트가 성립한다(밖에 스폰되면
 * shrinkRingCleared 가 즉시 true 가 되어 세그먼트가 헛돈다). 시작값 < SHRINK_INITIAL_RADIUS.
 * TODO(밸런스).
 */
export const SHRINK_SPAWN_RING_RADIUS = 3000;
/**
 * 스폰 링 인셋(safeRadius 경계에서 안쪽으로 당기는 정수 여유). ⚠️ 결정론용 Taylor sin/cos
 * (`math.ts`)는 **모든 각도에서 cos²+sin²>1**(20M 각도 전수 실측 최대 1.0000071)이라, 경계
 * (=safeRadius)에 스폰하면 `x²+y² = r²·(cos²+sin²) > safeRadius²` 가 되어 `shrinkRingCleared` 가
 * 그 적을 **"밖"으로 오분류**한다 → 스폰 틱에 링이 "전멸"로 보여 세그먼트가 조기 전진(코어
 * 진행 규칙 무력화, 리뷰 MED). 스폰을 이 인셋만큼 **엄격히 안쪽**에 둬 링 전멸 게이트 불변식
 * ("스폰은 항상 안전 반경 안")을 실제로 성립시킨다. 상대오차 ~7e-6 라 1 유닛이면 충분하나
 * 여유를 준다(정수). TODO(밸런스).
 */
export const SHRINK_SPAWN_INSET = 16;
/**
 * 스폰을 링 경계에서 안쪽으로 떼어 놓는 **거리(= 적이 게이트를 풀려면 나가야 하는 거리)**.
 *
 * ## 왜 인셋(16)만으로는 안 됐는가 — 사용자 신고 2026-08-04
 * "보스 게이지가 초반에는 잘 안 늘다가 후반에 갑자기 늘어남." 게이지 산식은 무죄다(6칸
 * 불리언 계단, `bossProgress.ts`). 무너진 것은 **게이트 난이도**였다.
 *
 * 구 산식은 `spawnR = min(safeRadius, 3000) − 16` 이라, 적이 링 밖으로 나가야 하는 거리가
 *
 * | safeRadius | 탈출 여유 | 돌격체(380u/s) 탈출 |
 * |---|---|---|
 * | 5500(시작) | 2516 | 6.6초 |
 * | 3500 | 516 | 1.4초 |
 * | **3000 이하** | **16 (고정)** | **0.04초** |
 *
 * 즉 `safeRadius` 가 스폰 링(3000) 밑으로 내려가는 **약 46~54초 지점부터** 돌격체가 플레이어를
 * 관통해 오버슛하기만 해도 "링 전멸"이 되어 칸이 즉시 넘어갔다. 런의 앞 절반은 "다 죽여야
 * 하는" 게이트, 뒤 절반은 사실상 공짜 게이트 — 사용자 체감과 정확히 일치한다.
 *
 * 이 상수는 그 여유를 **런 내내 일정하게** 만든다. `safeRadius ≥ 3000` 구간(= 초반)은
 * 상한 3000 이 여전히 지배하므로 **거동이 사실상 그대로**고(2516 → 2500), 무너지던 후반만
 * 700 으로 복원된다. 즉 초반 난이도(실측 클리어율 66.8% 가 맞춰진 자리)를 건드리지 않는다.
 *
 * ⚠️ {@link SHRINK_SPAWN_INSET}(16)의 원래 목적인 Taylor sin/cos 경계 오분류 방어는 이 값이
 * 그것보다 훨씬 크므로 자연히 포함된다. 다만 링이 최소 반경 근처로 조여져 마진을 다 뺄 수
 * 없을 때를 위해 아래 `shrinkSpawnRadius` 가 **비율 하한**을 함께 건다. TODO(밸런스).
 */
export const SHRINK_SPAWN_MARGIN = 700;
/**
 * 마진의 **반경 비례 상한**(백분율, 정수) — 실제 마진은 `min(MARGIN, floor(r × PERCENT/100))`.
 *
 * ⚠️ 이 상한이 없으면 링이 최소 반경(600)까지 조여졌을 때 마진 700 이 반경보다 커서 **적이
 * 전부 원점 근처에 겹쳐 스폰**된다. 실측으로 그 상태의 런은 격전 세그먼트에서 **36,000틱을
 * 돌려도 못 빠져나왔다**(증인 `0xd00d`) — 링 게이트를 고치려다 무대를 통째로 막은 것이다.
 * 비율 상한을 두면 마진이 링과 함께 줄어 배치가 항상 퍼진 채로 유지된다.
 *
 * | safeRadius | 마진 | 스폰 반경 | 탈출 여유 |
 * |---|---|---|---|
 * | 5500 | 700 | 2300(상한 지배) | 3200 |
 * | 3000 | 700 | 2300 | 700 |
 * | 2000 | 700 | 1300 | 700 |
 * | 1000 | 350 | 650 | 350 |
 * | 600(하한) | 210 | 390 | 210 |
 *
 * 구값(인셋 16 고정)과 비교하면 후반 여유가 **13~44배**로 복원된다. TODO(밸런스).
 */
export const SHRINK_SPAWN_MARGIN_PERCENT = 35;

/** 수축지대 런타임(정수 2필드). 원점 0,0 이 안전 반경의 중심이다. */
export interface ShrinkRuntime {
  /** 현재 안전 반경(월드 유닛, 정수). 원점 0,0 기준. 유예 후 매 틱 SHRINK_RATE_PER_TICK 만큼 최소 반경까지 조여진다. */
  safeRadius: number;
  /** 남은 유예 틱(정수). >0 이면 이번 틱 수축 보류(세그먼트 전진 직후 숨돌릴 틈). */
  graceTicks: number;
}

/** 수축 런 시작 런타임(전 필드 정수). 초기 반경 + 시작 유예. */
export function createShrinkRuntime(): ShrinkRuntime {
  return { safeRadius: SHRINK_INITIAL_RADIUS, graceTicks: SHRINK_GRACE_TICKS };
}

/**
 * 반경 전진 한 틱(순수, stepWorld 배선). 유예가 남아 있으면 이번 틱은 유예만 1 소진하고 반경을
 * 홀드한다. 유예가 0 이면 최소 반경까지 정수 감소한다(하한 클램프). 세그먼트 전진 시 graceTicks
 * 리셋은 waves.ts 가 별도로 한다(이 함수는 감소·유예 소진만). 정수 뺄셈뿐 — 부동소수 없음.
 */
export function advanceShrinkRuntime(rt: ShrinkRuntime): void {
  if (rt.graceTicks > 0) {
    rt.graceTicks--;
    return;
  }
  if (rt.safeRadius > SHRINK_MIN_RADIUS) {
    rt.safeRadius -= SHRINK_RATE_PER_TICK;
    if (rt.safeRadius < SHRINK_MIN_RADIUS) rt.safeRadius = SHRINK_MIN_RADIUS;
  }
}

/**
 * 현재 안전 반경(스폰·판정·snapshot 공용). shrinkRuntime 미존재면 0(수축 아님 — 밖 판정·스폰
 * 제약을 걸지 않는다). 순수 판정 — 상태를 바꾸지 않는다.
 */
export function shrinkSafeRadius(state: WorldState): number {
  return state.shrinkRuntime?.safeRadius ?? 0;
}

/**
 * 적 스폰 링 반경(아레나 중심 0,0 기준, waves.ts formationPositions 배선). 항상 현재 safeRadius
 * **이하**로 조여(min) 스폰이 안전 반경 안에 들도록 보장한다 — 이게 링 전멸 게이트의 구조적
 * 전제(밖에 스폰하면 gate 가 헛돈다)다. shrinkRuntime 미존재면 0(shrink 아님).
 */
export function shrinkSpawnRadius(state: WorldState): number {
  const r = shrinkSafeRadius(state);
  if (r <= 0) return 0;
  // 스폰은 항상 안전 반경 **미만**이어야 링 전멸 게이트가 성립한다(SHRINK_SPAWN_INSET 근거 참조).
  // safeRadius 를 스폰 링 반경 상한으로 min 한 뒤, **마진**만큼 경계에서 떼어 낸다 — 인셋(16)
  // 하나로는 링이 상한 밑으로 조여진 순간 여유가 16 으로 고정돼 게이트가 공짜가 됐다
  // (SHRINK_SPAWN_MARGIN 주석의 실측표). 정수 산술뿐 — 부동소수 금지.
  const capped = r < SHRINK_SPAWN_RING_RADIUS ? r : SHRINK_SPAWN_RING_RADIUS;
  // 마진은 **반경에 비례해 상한**이 걸린다 — 조여진 링에서 원점 겹침 스폰을 막는다
  // (SHRINK_SPAWN_MARGIN_PERCENT 주석의 36,000틱 정체 실측). `Math.floor` 로 접어 정수 유지.
  const scaled = Math.floor((r * SHRINK_SPAWN_MARGIN_PERCENT) / 100);
  const margin = SHRINK_SPAWN_MARGIN < scaled ? SHRINK_SPAWN_MARGIN : scaled;
  const out = capped - margin;
  // 마지막 안전망 — 어떤 경우에도 경계보다 최소 인셋만큼은 안쪽이어야 한다(Taylor 오분류 방어).
  const hardCap = r - SHRINK_SPAWN_INSET;
  const clamped = out > hardCap ? hardCap : out;
  return clamped < 0 ? 0 : clamped;
}

/**
 * 안전 반경 밖(원점 0,0 기준 거리 > safeRadius)에 있는 플레이어에게 지속 피해(racingRearPressure
 * 이식 — 직사각 뒤 경계 판정을 원형 거리 판정으로 바꿈). 무적 프레임을 존중하고(피격과 같은
 * 규율) 피해 후 피격 무적을 부여해 매 틱 갈리는 것을 막는다. 즉사 아님(누적) — 정수 산술로 f64
 * 누적이 없다. shrinkRuntime 미존재면 즉시 return(수축 아님 → 무피해). 하드 클램프는 걸지
 * 않는다(밖으로 나갈 수는 있고 피해만 받는 배틀로얄식 압박).
 */
export function shrinkOutOfBounds(state: WorldState, player: Entity, cx = 0, cy = 0): void {
  const rt = state.shrinkRuntime;
  if (rt === undefined) return;
  const safeR = rt.safeRadius;
  const px = player.x - cx;
  const py = player.y - cy;
  if (px * px + py * py <= safeR * safeR) return; // 안 = 무피해
  if (player.iframes > 0) return;
  player.hp -= SHRINK_OUT_OF_BOUNDS_DAMAGE;
  if (player.hp < 0) player.hp = 0;
  player.iframes = state.config.hitIframes;
}

/**
 * 링 전멸 여부(세그먼트 전진 게이트, waves.ts 배선 · blockBreakCleared 원형 이식). 살아있는
 * **enemy** 가 안전 반경(원점 0,0 기준 원) 안에 하나도 없으면 true. 순수 판정 — 상태를 바꾸지
 * 않는다. shrinkRuntime 미존재면 false.
 *
 * ⚠️ **보스는 세지 않는다**(`e.kind === 'enemy'` 만). 보스는 항상 아레나 중심(0,0)에 소환되어
 * 늘 안전 반경 안이라, 보스를 포함하면 ring-cleared 가 영원히 false 가 된다. blockBreakCleared 는
 * enemy/boss 를 함께 세지만 shrink 는 enemy 만 — 보스 세그먼트 도달·처치는 stepBoss/compact
 * 공통 경로가 관리한다(세그먼트 전진 게이트는 `!seg.boss` 라 보스 세그먼트에는 애초 안 걸린다).
 */
export function shrinkRingCleared(state: WorldState, cx = 0, cy = 0): boolean {
  const rt = state.shrinkRuntime;
  if (rt === undefined) return false;
  const safeR = rt.safeRadius;
  const r2 = safeR * safeR;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy <= r2) return false;
  }
  return true;
}
