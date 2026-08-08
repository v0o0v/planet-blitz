/**
 * 추격·탈출(chase) 모드 — Lane6 (ADR-0021 §2.4). 비-스크롤 **자유추적** 모드.
 * 무적 포식자(boss.aux0=0)가 끝없이 추격하고, 맵의 **반격 장치**(파괴가능 오브젝트)를 전부
 * 파괴하면 포식자가 취약화(aux0=1)되어 보스전으로 전환된다. 진행은 **대피소** 도달로 세그먼트를
 * 넘고, 승리는 취약해진 포식자 처치(공통 compact→victory 재사용)다. 무적 포식자 접촉 =
 * 회피 불가 실패(iframes 무시). 서바이벌 코어(웨이브 디렉터·파워업·드랍)는 불변, 진행/승리/실패
 * 게이트만 추격 규칙으로 바꾼다. 전 계수는 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 WorldState 필드 0 (Lane4/5/8 철학 계승)
 * 추격 상태는 전부 **엔티티 + boss/노드 aux**에 싣는다:
 *   - 포식자 = `boss` kind, createWorld 에서 스폰(`aux0=0` 무적), `updateBoss` 가 이미 매 틱 추격.
 *     취약화 = `aux0=1`(정수, hashEntity 조건부 꼬리에 접힘).
 *   - 반격 장치 = `destructible` + `ownerId === COUNTER_DEVICE_MARK`(센티넬, CONTAMINATION_NODE_MARK
 *     선례). 살아있는 장치 수 = 파생(필드 불요). 아군탄 파괴 = destructible 기존 드랍 경로.
 *   - 대피소 = 신규 kind `shelter`(inert, boostPad 선례). `aux0` = 세그먼트 인덱스.
 *   - 시야 = snapshot 필드(`chaseVisionRadius`) — sim 이 값을 정하고 렌더가 암흑/안개로 쓴다(art 후속).
 * → 신규 WorldState 필드 없음 → hashWorld 폴드 없음. boss.aux0(정수)·엔티티가 이미 해시에 접힌다.
 *   추격은 `planetMode === chase` 게이트라 뱀서류·침공·블록격파·레이싱·오염 바이트 불변.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 배치는 고정 좌표(플레이어 시작 0,0 주변 링, 결정론 트리그
 * `cos`/`sin`). aux0 은 **정수 필수**(hashU32 로 접힘 — 소수부 유실). 배치·판정 모두 순수.
 *
 * ## 순환 의존 주의
 * world.ts / waves.ts / snapshot.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서
 * **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈(entities·math·planetMode)과
 * 데이터 레지스트리(planetContent — world 를 import 하지 않는다)로만(contamination/racing 선례).
 */
import type { Entity } from '../entities.js';
import { spawnBoss, spawnShelter } from '../entities.js';
import type { WorldState } from '../world.js';
import { PLANET_MODE, type PlanetMode } from '../planetMode.js';
import { BOSS_HP_MULT, bossStageHpMult } from '../enemyScale.js';
import { planetContent } from '../../../data/planets/index.js';
import { SEGMENTS, stageHpMult, objectiveLowStageRelief } from '../../../data/waves.js';
import { cos, sin, atan2, clamp, TWO_PI } from '../math.js';
import { DT } from '../constants.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 추격 시야 반경(월드 유닛). 렌더가 이 값으로 암흑/안개 오버레이(art 후속). TODO(밸런스). */
export const CHASE_VISION_RADIUS = 1400;
/** 포식자 초기 스폰 위치(플레이어 시작 0,0 대비 위쪽 offset). chasePredatorPursue 가 곧 플레이어 실좌표로 당긴다. TODO(밸런스). */
export const CHASE_PREDATOR_SPAWN_OFFSET = 1200;
/** 무적 포식자 추격 속도(월드 유닛/초). 접근 하한 링까지만 수렴한다({@link CHASE_PREDATOR_STANDOFF}). TODO(밸런스). */
export const CHASE_PREDATOR_SPEED = 540;
/**
 * 무적 포식자의 **접근 하한**(월드 유닛). 포식자는 플레이어를 끝없이 쫓되 이 거리 안쪽으로는
 * 스스로 들어오지 않는다 — 멀면 다가오고, 가까우면 물러난다.
 *
 * ## 왜 하한이 필요한가
 * 원래는 플레이어 실좌표로 그냥 수렴했다(하한 0). 포식자 속도 540 u/s 는 플레이어 기본
 * 720 u/s 보다 느리지만, 적을 쏘거나 반격 장치를 깨느라 **잠깐만 서 있어도** 접촉 판정 안으로
 * 들어와 무적 포식자 접촉 = 회피 불가 즉사가 성립했다. 플레이 결과는 "니플헤임이 손도 못 대게
 * 어렵다"였다(사용자 신고 2026-07-27). 하한을 두면 압박은 **시야·시간·반격 장치**로 남고,
 * 즉사는 플레이어가 스스로 링 안으로 들어갔을 때만 일어난다(회피 가능 = 학습 가능).
 *
 * 값은 화면 반폭보다 크게 잡아, 정상적으로 도망 다니는 동안에는 포식자가 화면 가장자리 밖
 * 그림자로 남게 한다. TODO(밸런스): 출시 전 튜닝.
 */
export const CHASE_PREDATOR_STANDOFF = 900;
/**
 * ⛔ **반격 장치는 2026-08-05 에 제거됐다**(사용자 지시 — "대피소를 다 찾으면 보스 등장").
 *
 * 예전 규칙은 손잡이가 둘이었다: ①반격 장치 5개 전부 파괴 → 포식자 취약화(보스전) ②대피소
 * 6개 도달 → 세그먼트 전진. 두 축이 서로를 몰랐고, 화면에서는 무엇이 보스를 부르는지 읽히지
 * 않았다. 이제 축은 **대피소 하나**다 — 10곳을 전부 확보하면 그것이 곧 세그먼트 완주이자
 * 포식자 취약화다({@link updateChasePredator}).
 *
 * 아래 두 상수는 **더는 배치에 쓰이지 않는다**. 그런데도 남겨 둔 이유는 밸런스 계측
 * (`src/bench/balance/metrics.ts`)과 이 파일 아래 실측표들이 이 값을 전제로 쓰였고, 그 기록이
 * 곧 "이 무대의 난이도를 무엇이 지고 있었는가"의 유일한 근거이기 때문이다. **새 코드에서
 * 참조하지 마라.**
 *
 * ⚠️ **난이도 축이 비었다.** 장치 HP 가 지던 TTK 예산이 사라지고 그 자리를 **이동 거리·시야**
 * 가 대신 진다({@link CHASE_SHELTER_RING_RADIUS} 참조). 클리어율·보스도달은 재측정 대상이다 —
 * TODO(밸런스): 출시 전 니플헤임 프로브 재실행.
 */
export const CHASE_COUNTER_DEVICE_COUNT = 5;
/**
 * 구 반격 장치 **기준 HP**(단계 1 기준). 실 HP 는 `stageHpMult(stage)` 를 곱한 값이었다
 * ({@link chaseCounterDeviceHp}). **현행 배치에는 쓰이지 않는다** — 위 주석 참조.
 *
 * ## 왜 단계 스케일이 필요한가 (2026-08-01)
 * 예전에는 단계·레벨과 무관한 **고정 40** 이었다. 그 값은 어느 레벨에서도 한 틱 사격이면
 * 사라지는 크기라, 추격 모드의 유일한 승리 조건(장치 5개 파괴)이 **난이도 축을 전혀 갖지
 * 못했다**. 조준 결함을 고치고 재측정하자 니플헤임 클리어율이 Lv5~Lv100 **전 구간 100.0%**,
 * 클리어 5.4초로 나왔다 — 소요의 거의 전부가 장치 사이 이동 시간이었고 파괴 자체는 공짜였다.
 * 즉 이 무대에는 조절할 난이도가 아예 없었던 것이지, 어려웠던 것이 아니다.
 *
 * 적 HP 와 같은 앵커(`stageHpMult`)를 쓰는 이유는 ADR-0037("난이도 곡선은 적 축에서만")과
 * 정합하기 위해서다 — 장치는 이 무대에서 적 HP 가 맡는 역할(TTK 예산)을 대신 진다.
 */
export const CHASE_COUNTER_DEVICE_HP_BASE = 64000;

/*
 * ## 76,000 → 52,000 의 근거 (2026-08-02 난이도 복구 2차)
 *
 * 오염 노드와 **같은 모양**이었다 — 패배 런의 **장치잔존이 4.14/5** 였다(5개 중 0.86개를 깨고
 * 죽는다). 목표 총 HP 가 생존 창을 넘는다는 뜻이라, 웨이브 축(유입 1.6배 → 30.6% → 31.7%,
 * 무반응)이 아니라 이 상수가 레버다.
 *
 * | 지표 | 76,000 | 52,000 |
 * |---|---|---|
 * | 클리어율 | 31.6% | **40.8%** |
 * | 보스도달 | 82.6s | **64.8s** |
 *
 * ⚠️ 오염과 같은 페이싱·난이도 결합이 여기에도 있다(이 값을 낮추면 취약화가 빨라져 보스 도달이
 * 함께 당겨진다). 그래서 생존 축을 따로 만들었다 — `CHASE_DAMAGE_SCALE`
 * (`src/sim/modes/objective.ts`). 이 무대의 최종 조합은 **HP 64,000 + 기울기 0.06 + 피격 배율
 * 0.32** 이고 그 결과가 42.0% → **65.1%**(밴드 안) · 보스도달 65.7 → 78.1s 다. 세 값은 **함께**
 * 정해진 것이라 하나만 되돌리면 안 된다.
 *
 * ⚠️ **미해소**: 그 대신 Lv100 타임아웃이 2.6% → 6.9% 로 **악화**됐다(전량 이 무대다). 만렙
 * 추격 런은 승률 72.9% · 사망 거의 0 · 나머지가 시간 초과다 — 즉 플레이어가 죽는 게 아니라
 * **장치 5개 + 포식자를 300초 안에 못 깎는다.**
 *
 * ## 2026-08-03 — 그 "다음 축은 포식자 HP" 라는 추정은 **틀렸다**
 * 실측이 뒤집었다. 승리 런은 보스 도달 83.3초 → 클리어 84.8초로 **취약화 후 1.5초에 포식자가
 * 죽는다**(보스 DPS 3,776). 포식자는 병목이 아니었다. 타임아웃 런의 64%가 장치 5/5 잔존이고,
 * 신설 계측(`chaseDeviceHpFrac`)으로 보니 그 런들의 **평균 잔여 HP 가 0.766** — 화력이 0 인
 * 것도 아니고 300초에 23%만 깎았다. 같은 셀 승리 런은 83초에 5개를 전부 깼다.
 *
 * 가른 것은 **처치/초**였다(타임아웃 6.12 vs 승리 3.11). 화력이 약한 게 아니라 전부 잡몹에
 * 쓰고 있었다 — 축은 이 상수가 아니라 **조준 순번**이다(`objectiveAimBias`). 이 상수의 기울기는
 * 0.06 → **0.02** 로 낮춰 만렙 총 HP 를 함께 덜었다(단계 1 에서는 정의상 불변이라 저레벨
 * 대조군이 런 단위로 성립한다 — 니플헤임 Lv5 38% · 톡사르 전 구간 **완전 불변**).
 *
 * | 니플헤임(3분 프로브 · 레벨 축 고정) | 전체 승률 | 전체 타임아웃 | Lv100 승률 | Lv100 타임아웃 |
 * |---|---|---|---|---|
 * | 기준선(기울기 0.06) | 64.6% | 5.0% | 70% | 29% |
 * | 기울기 0.02 단독 | 67.7% | 4.4% | 76% | 24% |
 * | **기울기 0.02 + 단계 함수 조준 가중치** | **69.0%** | **3.2%** | **83%** | **17%** |
 *
 * ⚠️ HP 축은 **수확체감**이다: 18% 깎으나 36% 깎으나 같은 자리였다. 이 상수를 더 낮춰 B7 을
 * 닫으려 하지 마라 — 남은 17%의 축은 조준·잡몹 밀도 쪽이다. 밸런스 큐 §B7·§R12·§R13 참조.
 */

/**
 * 단계 기울기 **감쇠 계수**. 장치 HP 는 `stageHpMult` 를 그대로 타지 않고 이 비율만큼만 탄다.
 *
 * ## 왜 그대로 타면 안 되는가 (실측)
 * 감쇠 없이(계수 1.0) 재보니 니플헤임 클리어율이 **Lv5 95.4% → Lv90 65.9%** 로 30pp 기울었다.
 * 적 HP 앵커는 **수와 밀도가 함께 늘어나는 잡몹 무리**를 상대로 보정된 값인데, 반격 장치는
 * 플레이어의 집중 화력을 혼자 받는 **단일 표적**이라 같은 기울기를 주면 고레벨에서 과하게
 * 무거워진다. 감쇠는 그 차이를 흡수한다 — 무대의 절대 난이도는 `_HP_BASE` 가, 단계 축
 * 기울기는 이 계수가 진다.
 *
 * 0.15 → 0.06 → **0.02**(2026-08-03). 근거와 실측표는 위 `_HP_BASE` 주석의 2026-08-03 절이다.
 */
export const CHASE_COUNTER_DEVICE_HP_SLOPE = 0.02;

/**
 * 이 단계의 반격 장치 HP. 적 HP 와 같은 단계 앵커를 타되 기울기는
 * {@link CHASE_COUNTER_DEVICE_HP_SLOPE} 만큼 감쇠한다. 단계 1 에서는 정확히 `_HP_BASE` 다
 * (`stageHpMult(1) === 1` → 감쇠항이 0).
 *
 * ## 기울기 0.15 → 0.06 (2026-08-02 난이도 복구 2차)
 * 생존 축을 넣어 플레이어가 오래 버티게 되자 **고단계에서 런이 끝나지 않는 문제**가 드러났다.
 * 목표 총 HP 가 단계로 오르는 속도가 플레이어 화력 성장을 앞지르면, 안 죽는 런이 승리가 아니라
 * **시간 초과**로 간다. 기울기를 낮춰 그 격차를 좁혔다(그래도 Lv100 은 미해소 — 위 주석 참조).
 *
 * 정수로 내린다 — 엔티티 hp 가 해시에 접히므로 소수부가 유실되면 클라·서버 재실행이 갈린다.
 */
export function chaseCounterDeviceHp(stage: number): number {
  const scale = 1 + (stageHpMult(stage) - 1) * CHASE_COUNTER_DEVICE_HP_SLOPE;
  // 저단계 완화(`objectiveLowStageRelief`) — 단계 4 이상은 정확히 1 이라 산술 불변이다.
  return Math.round(CHASE_COUNTER_DEVICE_HP_BASE * scale * objectiveLowStageRelief(stage));
}
/** 반격 장치 반경(조준·피격 판정). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_RADIUS = 70;
/** 반격 장치 파괴 시 드랍 젬 XP(destructible 기존 드랍 경로). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_GEM_XP = 6;
/** 반격 장치 배치 링 반경(플레이어 시작 0,0 주변). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_RING_RADIUS = 1100;
/**
 * 대피소 수(= 보스를 뺀 세그먼트 수 6, 각 aux0=세그먼트 인덱스). TODO(밸런스).
 *
 * ⚠️ `SEGMENTS.length - 1` 에서 **파생한다**(하드코딩 금지) — 대피소 aux0 가 세그먼트 인덱스와
 * 1:1 이라, 모자라면 초과 세그먼트에서 영영 전진하지 못한다. 중반 격전(ADR-0032)이 세그먼트를
 * 하나 늘렸을 때 이 값이 5 로 고정돼 있어 실제로 desync 가 났고, 같은 사고가 racing·blockBreak
 * 구간 수에서도 동시에 났다. 세 곳 전부 파생으로 바꿔 이 결함 부류를 구조적으로 없앤다.
 * 격전 세그먼트(index 3)에 대응하는 대피소는 전진 게이트가 리더 처치로 대체돼 쓰이지 않지만,
 * 인덱스 정합을 위해 자리를 비우지 않고 그대로 배치한다(배치가 인덱스만의 함수라 특례를 두면
 * 결정론 배치가 복잡해진다).
 *
 * ## ⛔ 위 규율은 2026-08-05 에 **폐기됐다** — 이제 세그먼트에서 파생하지 않는다
 * 대피소 `aux0` 가 세그먼트 인덱스와 1:1 이던 것이 그 파생의 전제였다. 지금 대피소는
 * **세그먼트에 매인 표식이 아니라 모으는 대상**이고, 세그먼트 전진은 누적 확보 수의
 * 마일스톤({@link chaseShelterMilestone})으로 파생한다. 두 수가 독립이라 어떤 조합에서도
 * 마지막 마일스톤이 정확히 전량이고, 위 desync 부류는 구조적으로 재발하지 않는다.
 * TODO(밸런스): 출시 전 튜닝.
 */
export const CHASE_SHELTER_COUNT = 10;
/** 대피소 반경(도달 판정, 관대). TODO(밸런스). */
export const CHASE_SHELTER_RADIUS = 140;
/**
 * 대피소 배치 **안쪽 링** 반경(플레이어 시작 0,0 주변). 짝수 인덱스가 여기 선다.
 *
 * ## 왜 링이 둘인가
 * 10곳을 한 링에 세우면 원을 한 바퀴 도는 단조로운 코스가 되고, 무엇보다 **찾을 것이 없다** —
 * 시야 반경({@link CHASE_VISION_RADIUS} 1400)이 링 반경보다 크면 시작 지점에서 사실상 전부
 * 보인다. 안/밖 두 링으로 갈라 바깥 링을 시야 밖에 두면 "다 찾는다"가 실제 탐색이 된다.
 *
 * ⚠️ 반격 장치가 지던 난이도 축(TTK 예산)이 사라진 자리를 **이 반경 = 이동 거리**가 진다.
 * 니플헤임 클리어율·보스도달의 주 레버가 이 두 값으로 옮겨졌다. TODO(밸런스): 출시 전 재측정.
 */
export const CHASE_SHELTER_RING_RADIUS = 1300;
/** 대피소 배치 **바깥 링** 반경(홀수 인덱스). 시야 반경 밖이라 탐색이 필요하다. 근거는 위 주석. */
export const CHASE_SHELTER_RING_RADIUS_OUTER = 2300;

/**
 * 반격 장치 마커(ownerId 센티넬). 절차 청크 destructible(ownerId=0)·오염 노드와 구분해
 * ① 살아있는 장치 카운트(취약화 게이트)와 ② isGimmick 청크 컬링 제외에 쓴다. 기존 7개 마커
 * (DRONE 0xd4090e·BROOD 0xb400d5·MISSILE 0x3155110·HIVE 0x81ce77·SPLIT 0xf12a6·
 * RACING_WALL 0x4ac1a6·CONTAMINATION_NODE 0xc0f7a1)와 전부 다르다. 이 값은 추격 런에만
 * 등장한다(그 외 destructible 은 ownerId=0/오염 마커라 조건 그대로 성립 → 거동·해시 불변).
 */
export const COUNTER_DEVICE_MARK = 0xc07e5d;

/** 반격 장치인가(파괴가능 오브젝트 + 반격 마커). 절차 청크 destructible(ownerId=0)·오염 노드는 false. */
export function isCounterDevice(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === COUNTER_DEVICE_MARK;
}

/** 대피소인가(신규 inert kind). */
export function isShelter(e: Entity): boolean {
  return e.kind === 'shelter';
}

/**
 * 이 대피소를 이미 **확보**했는가(`aux1 === 1`). 미확보는 0 이다.
 *
 * ## 왜 `dead` 가 아니라 aux1 인가
 * 확보된 대피소도 화면에 남아야 한다 — 남지 않으면 "몇 개를 어디서 찾았는지"가 지도에서
 * 사라져 남은 곳을 추리할 단서가 없어진다(렌더는 `spent` 로 흐리게 그린다, `snapshot.ts`).
 * 그리고 `dead` 는 `compact` 가 배열에서 제거하므로 확보 수를 셀 근거 자체가 없어진다.
 *
 * aux1 은 **정수**여야 한다 — `hashEntity` 가 u32 로 접으므로 소수부가 유실되면 클라·EF
 * 재실행이 갈린다(이 파일 머리 §결정론).
 */
export function isShelterSecured(e: Entity): boolean {
  return e.aux1 === 1;
}

/** 포식자(boss)가 무적인가 = 취약화 전(aux0===0). 취약(aux0===1) 후엔 아군탄이 처치할 수 있다. */
export function isPredatorInvincible(boss: Entity): boolean {
  return boss.aux0 === 0;
}

/** 살아있는 반격 장치 수. **현행 배치에는 장치가 없어 항상 0 이다**(계측 호환용으로 남긴다). */
export function chaseAliveCounterDevices(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && isCounterDevice(e)) n++;
  }
  return n;
}

/** 지금까지 **확보한** 대피소 수. 전량이면 포식자 취약화({@link updateChasePredator}). 순수 판정. */
export function chaseSheltersSecured(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && isShelter(e) && isShelterSecured(e)) n++;
  }
  return n;
}

/** 이 무대에 배치된 대피소 총수(확보 여부 무관). 추격 런이 아니면 0. */
export function chaseShelterTotal(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && isShelter(e)) n++;
  }
  return n;
}

/** 대피소를 **전부** 확보했는가. 배치가 0개면 false(추격 런이 아니거나 아직 미배치). */
export function chaseAllSheltersSecured(state: WorldState): boolean {
  const total = chaseShelterTotal(state);
  return total > 0 && chaseSheltersSecured(state) >= total;
}

/**
 * 세그먼트 `segmentIndex` 를 넘기는 데 필요한 **누적 확보 수**(1-based 마일스톤).
 *
 * 마지막 일반 세그먼트의 마일스톤은 정확히 {@link CHASE_SHELTER_COUNT} 다 — 즉 **전부 찾으면
 * 곧 보스 세그먼트**이고, 같은 순간 {@link updateChasePredator} 가 포식자를 취약화한다.
 * 두 사건이 같은 조건에서 나오므로 "다 찾으면 보스"가 화면과 규칙 양쪽에서 한 문장이다.
 *
 * ⚠️ 술어를 여기 한 곳에만 둔다. 예전 구조는 같은 "여기까지" 를 sim·HUD·렌더 세 곳에 따로
 * 적어 두어 화면과 규칙이 갈렸다(2026-08-04 대피소 신고). 호출부는 전부 이 함수를 부른다.
 *
 * 순수·정수 연산(`Math.ceil`). 인덱스는 [0, normalSegments-1] 로 클램프한다.
 */
export function chaseShelterMilestone(segmentIndex: number, normalSegments: number): number {
  const n = Math.max(1, Math.floor(normalSegments));
  const i = Math.max(0, Math.min(n - 1, Math.floor(segmentIndex)));
  return Math.ceil((CHASE_SHELTER_COUNT * (i + 1)) / n);
}

/** 이 무대의 일반(보스 제외) 세그먼트 수. 마일스톤 분모의 정본. */
export function chaseNormalSegments(): number {
  return Math.max(1, SEGMENTS.length - 1);
}

/**
 * 세그먼트 전진 게이트(`waves.ts` 배선). 누적 확보 수가 이 세그먼트의 마일스톤에 닿았는가.
 * 순수 판정 — 상태를 바꾸지 않는다(확보 자체는 {@link updateChaseShelters} 가 한다).
 */
export function chaseSegmentCleared(state: WorldState, segmentIndex: number): boolean {
  return chaseSheltersSecured(state) >= chaseShelterMilestone(segmentIndex, chaseNormalSegments());
}

/**
 * 대피소 확보 한 틱(`stepWorld` 배선). 플레이어(entities[0])와 overlap 한 **미확보** 대피소를
 * `aux1 = 1` 로 넘긴다. 한 틱에 여러 곳이 겹치면 전부 확보한다(반경 140 이라 실제로는 드물다).
 *
 * ⚠️ 이 함수만이 확보 상태를 쓴다. 판정(`chaseSegmentCleared`·`chaseAllSheltersSecured`)은
 * 전부 읽기 전용이라, "언제 확보되는가"가 한 자리에만 있다.
 */
export function updateChaseShelters(state: WorldState): void {
  const player = state.entities[0];
  if (player === undefined || player.dead) return;
  for (const e of state.entities) {
    if (e.dead || !isShelter(e) || isShelterSecured(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const rr = e.radius + player.radius;
    if (dx * dx + dy * dy <= rr * rr) e.aux1 = 1;
  }
}

/**
 * 추격 코스를 고정(RNG 없는) 결정론 좌표에 배치한다(createWorld 1회). ① 무적 포식자(boss,
 * aux0=0)를 플레이어 시작(0,0) 위쪽 offset 에 스폰하고 `state.bossSpawned=true` 를 세워 stepBoss
 * 가 두 번째 보스를 세우지 않게 한다. ② 반격 장치 N개(destructible + 마커)를 원점 링에 배치한다.
 * ③ 대피소 N개(shelter kind, aux0=세그먼트 인덱스)를 원점 링에 배치한다. 배치는 인덱스만의
 * 함수(결정론 트리그)라 같은 필드가 항상 동일 배치다 — 시드·해시 스트림에 영향이 없다.
 *
 * `state.entities` 에 append 하는데, 플레이어는 이미 index 0 에 있으므로 hashWorld 불변식이
 * 유지된다(createWorld 가 state 완성 후 호출).
 */
export function placeChaseCourse(state: WorldState): void {
  const planet = state.config.planet ?? 0;
  const bossDef = planetContent(planet).boss;
  // ① 포식자 = boss kind. 행성 보스 정의로 hp/radius, enemyType=planet(렌더 스프라이트 분화),
  //    aux0=0(무적). moveBoss(boss.ts)가 매 틱 플레이어를 향해 추격한다.
  // BOSS_HP_MULT: 포식자는 **이 무대의 보스 그 자체**다(취약화 뒤가 곧 보스전이라 `stepBoss` 가
  // 두 번째 보스를 안 세운다). `world.ts` 의 보스 스폰과 **같은 배수**를 쓴다 — 한쪽만 걸면
  // 같은 보스가 무대에 따라 HP 가 달라진다.
  const predator = spawnBoss(
    state,
    0,
    -CHASE_PREDATOR_SPAWN_OFFSET,
    // bossStageHpMult: `world.ts` 의 보스 스폰과 **같은 배수 조합**이어야 한다(아래 §BOSS_HP_MULT
    // 주석의 "한쪽만 걸면 무대에 따라 HP 가 달라진다" 가 단계 곡선에도 그대로 적용된다).
    Math.round(bossDef.hp * BOSS_HP_MULT * bossStageHpMult(state.config.stage ?? 1)),
    bossDef.radius,
  );
  predator.damage = bossDef.contactDamage;
  predator.enemyType = planet;
  predator.aux0 = 0; // 무적(취약화 전) — blankEntity 기본 0 이지만 계약을 명시.
  state.bossSpawned = true; // stepBoss 가 두 번째 보스를 세우지 않는다(포식자가 곧 보스다).

  // ② 대피소 N곳(shelter kind, aux0=대피소 인덱스, aux1=확보 플래그). 확보 = updateChaseShelters,
  //    전량 확보 = 세그먼트 완주 + 포식자 취약화. 반격 장치는 제거됐다(상수 주석 참조).
  //    안/밖 두 링에 번갈아 세운다 — 바깥 링은 시야 밖이라 실제 탐색이 필요하다.
  for (let i = 0; i < CHASE_SHELTER_COUNT; i++) {
    const angle = (i * TWO_PI) / CHASE_SHELTER_COUNT;
    const r = i % 2 === 0 ? CHASE_SHELTER_RING_RADIUS : CHASE_SHELTER_RING_RADIUS_OUTER;
    const shelter = spawnShelter(state, cos(angle) * r, sin(angle) * r, CHASE_SHELTER_RADIUS);
    shelter.aux0 = i; // 대피소 인덱스(정수). 세그먼트와의 1:1 은 더는 없다.
    shelter.aux1 = 0; // 미확보(blankEntity 기본 0 이지만 계약을 명시).
  }
}

/**
 * 추격 포식자 취약화 한 틱(stepWorld 배선, compact 이후 호출).
 *
 * **대피소를 전부 확보하면** 포식자(boss) `aux0=1`(취약)로 전환한다 → 이제 아군탄이 hp 를
 * 깎아 처치할 수 있고, compact 가 보스 처치를 victory 로 잡는다(공통 경로 재사용). 한 곳이라도
 * 남아 있으면 무적을 유지한다. 순수(엔티티 aux 만 변경).
 *
 * ⚠️ 구 규칙은 "반격 장치 5개 전부 파괴"였다(2026-08-05 사용자 지시로 교체). 조건이 대피소
 * 마일스톤의 마지막 값과 **같은 술어**라, 보스 세그먼트 진입과 취약화가 같은 틱에 일어난다.
 */
export function updateChasePredator(state: WorldState): void {
  if (!chaseAllSheltersSecured(state)) return;
  for (const e of state.entities) {
    if (e.kind === 'boss') e.aux0 = 1; // 취약(아군탄 피해 가능).
  }
}

/**
 * 취약화 전(aux0===0) 무적 포식자의 추격 이동 한 틱(boss.ts `updateBoss` 배선). 공용 `moveBoss` 의
 * 머리 위 hover 오프셋(`player.y − VIEW_HEIGHT*0.28`)을 쓰지 않고 **플레이어를 중심으로 한 접근 하한
 * 링**({@link CHASE_PREDATOR_STANDOFF})으로 수렴한다 — 플레이어가 어디로 도망가든 따라붙지만 링
 * 안쪽으로는 스스로 들어오지 않는다(멀면 접근, 가까우면 후퇴).
 *
 * ## 왜 실좌표 수렴이 아닌가
 * 예전에는 플레이어 실좌표로 직접 수렴해, 반격 장치를 깨느라 잠깐 서 있기만 해도 무적 포식자가
 * 겹쳐 즉사했다(사용자 신고 2026-07-27 "덥쳐서 게임이 너무 어려움"). 링 수렴은 위협의 **지속**은
 * 그대로 두고 즉사를 **플레이어가 링 안으로 들어간 경우**로 한정한다.
 *
 * 취약화(aux0===1) 후엔 boss.ts 가 일반 `moveBoss`(hover + 패턴 보스전)로 되돌린다. 순수·결정론
 * (RNG·wall-clock 없음, `clamp`/`atan2`/`cos`/`sin` 은 moveBoss 와 동일 정수-안전 프리미티브).
 */
export function chasePredatorPursue(boss: Entity, player: Entity): void {
  const stepMax = CHASE_PREDATOR_SPEED * DT;
  // 플레이어 → 포식자 방향의 링 위 지점이 목표다. 포식자가 플레이어와 정확히 겹쳐 있으면
  // atan2(0,0)=0 이라 +X 쪽으로 밀려나 링을 회복한다(0 나눗셈·NaN 없음).
  const outX = boss.x - player.x;
  const outY = boss.y - player.y;
  const outAngle = atan2(outY, outX);
  const targetX = player.x + cos(outAngle) * CHASE_PREDATOR_STANDOFF;
  const targetY = player.y + sin(outAngle) * CHASE_PREDATOR_STANDOFF;
  boss.x += clamp(targetX - boss.x, -stepMax, stepMax);
  boss.y += clamp(targetY - boss.y, -stepMax, stepMax);
  // 바라보는 방향은 여전히 플레이어다(위협 표현 · 렌더 각도).
  boss.angle = atan2(player.y - boss.y, player.x - boss.x);
}

/**
 * 지금 플레이어가 **미확보 대피소 위에 서 있는가**(렌더 연출용 순간 판정).
 *
 * ⚠️ 이것은 더 이상 세그먼트 전진 게이트가 아니다 — 그 자리는 {@link chaseSegmentCleared}
 * (누적 확보 수 마일스톤)가 가져갔다. 구 이름(`chaseShelterReached`)이 쓰이던 자리를 전부
 * 옮겼으니, 새 코드에서 "전진하는가"를 물으려면 반드시 마일스톤 쪽을 불러라.
 */
export function chaseOnUnsecuredShelter(state: WorldState): boolean {
  const player = state.entities[0];
  if (player === undefined) return false;
  for (const e of state.entities) {
    if (e.dead || !isShelter(e) || isShelterSecured(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const rr = e.radius + player.radius;
    if (dx * dx + dy * dy <= rr * rr) return true;
  }
  return false;
}

/**
 * 시야 반경(snapshot 용, 렌더 전용 — 해시 무관). chase 면 `CHASE_VISION_RADIUS`, 그 외 0(무제한).
 * sim 이 정수 상태로 값을 정하고, 렌더가 이 값으로 암흑/안개 오버레이를 그린다(렌더 세부는 art 후속).
 */
export function chaseVisionRadius(mode: PlanetMode | undefined): number {
  return mode === PLANET_MODE.chase ? CHASE_VISION_RADIUS : 0;
}
