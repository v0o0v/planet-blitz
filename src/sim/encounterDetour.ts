/**
 * 보물 격실 detour — 조우 프레임워크(ADR-0033)의 플래그십이자 **이 재설계에서 유일한 신규
 * 제어흐름**이다. 포탈로 진입하면 플레이어가 메인 월드에서 아주 먼 "포켓" 좌표로 워프해
 * 별도 보너스 공간에서 전리품을 줍고, 타이머 만료·조기 이탈·사망 중 하나로 결말이 난다.
 *
 * ## 왜 "단일 분기 + 자체 최소 파이프라인" 인가 (CRIT-1)
 * 산발적으로 `if (!inDetour)` 게이트를 흩뿌리는 원안은 컨센서스에서 REJECT 됐다 —
 * updateWaves·stepEnemies·stepBoss·autoAttack·clampToWindow·shrinkOutOfBounds·
 * advanceScroll/Shrink·applySingularityPull·updateChasePredator 등 **과소열거하기 쉬운
 * 충돌점이 최소 7곳**이고, 하나만 빠뜨려도 detour 중에 메인 시뮬이 계속 돈다. 그래서
 * world.ts `stepWorld` **최상단에 레벨업 프리즈와 동형인 단일 분기**를 두고, 그 안에서
 * 이 파일의 {@link stepDetour} 만 돈다. 열거가 아니라 구조로 차단하는 것이 요점이다.
 *
 * ## 메인 월드 동결 계약 (AC6 — 이 파일의 최우선 불변식)
 * **stepDetour 는 플레이어를 제외한 메인 월드 엔티티(= `ownerId !== DETOUR_MARK`)의 단 한
 * 필드도 건드리지 않는다.** 적·보스·적탄·웨이브 런타임은 배열에 그대로 프리즈된 채 남고
 * hashWorld 가 계속 접으므로, detour 중 메인 월드 상태는 `tick` 외 바이트 불변이다. 메인
 * 충돌 격자(`resolveCollisions`)를 절대 부르지 않는 것도 같은 이유다 — 격자는 전 엔티티를
 * 훑으므로 그 한 번으로 동결이 깨진다.
 *
 * ## 전투력 무개입 계약 (AC7)
 * 방내 처치는 런 전투력 경로에 **한 톨도** 들어가지 않는다: `state.kills++` 금지 · 젬 스폰
 * 금지(젬은 xp 를 낳고 xp 는 레벨업·파워업을 낳는다) · combo/level/`player.aux0`(기체
 * 시그니처 카운터) 불변. 방내 보상은 **정산 경제로만** 나간다 — rarity 를 강제한
 * `spawnLoot` 와 `state.resources`(크레딧). 이 규율이 "방 안에서 파밍해 런을 강화한다"는
 * 치즈를 원천 차단한다.
 *
 * ## 결정론 규율
 *  - **RNG 를 한 번도 소비하지 않는다.** 세트피스 배치는 고정 좌표, 사격은 고정 각도 분산,
 *    전리품 시드는 `state.tick`·엔티티 id 파생 정수 해시(`Math.imul` 만 — 정확한 정수 연산)
 *    로 만든다. 방내 사건이 어떤 RNG 스트림도 밀지 않으므로 복귀 후 메인 런의 웨이브·드랍
 *    시퀀스가 워프 전과 완전히 같다.
 *  - 삼각함수는 `./math.js` 결정론 구현만 쓴다(`Math.sin/cos/atan2` 금지 — ADR-0005).
 *
 * ## 순환 의존 주의
 * world.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서 **타입만** 가져온다.
 * 메인 `stepPlayer` 는 world.ts 의 모듈 내부 함수라 import 할 수 없고 **의존성 주입**으로
 * 받는다({@link stepDetour} 의 `stepPlayerFn`) — world.ts → encounterDetour.ts 단방향만
 * 유지된다. 플레이어 이동만은 방 안에서도 메인과 완전히 같은 감각이어야 하므로(대시 쿨다운·
 * 무적 프레임·감속까지) 복제하지 않고 진짜 그 함수를 받는다.
 */
import type { WorldState, InputFrame } from './world.js';
import type { EncounterRuntime } from './encounter.js';
import type { Entity } from './entities.js';
import { blankEntity, addEntity, spawnBullet, spawnLoot } from './entities.js';
import { DT, FIRE_CD_Q } from './constants.js';
import { atan2, cos, sin, length } from './math.js';
import {
  SPECIAL_ENCOUNTER_EXIT,
  VAULT_TIMER_TICKS,
  VAULT_WARP_OFFSET_X,
  VAULT_WARP_OFFSET_Y,
  VAULT_SAFE_LOOT_COUNT,
  VAULT_SAFE_LOOT_RARITY,
  VAULT_SAFE_LOOT_SPACING,
  VAULT_SAFE_LOOT_Y,
  VAULT_PRIZE_LOOT_COUNT,
  VAULT_PRIZE_LOOT_RARITY,
  VAULT_PRIZE_LOOT_Y,
  VAULT_GUARD_COUNT,
  VAULT_GUARD_HP,
  VAULT_GUARD_DAMAGE,
  VAULT_GUARD_RADIUS,
  VAULT_GUARD_SPEED,
  VAULT_GUARD_Y,
  VAULT_GUARD_SPACING,
  VAULT_GUARD_CREDITS,
  VAULT_GUARD_LOOT_RARITY,
  VAULT_LOOT_PICKUP_RADIUS,
} from '../../data/encounters.js';

/**
 * detour 가 스폰한 **모든** 엔티티의 `ownerId` 마커(MISSILE_MARK·DRONE_MARK 선례).
 * 이 값 하나가 "방 안 소유물"과 "메인 월드"를 가르는 유일한 기준이다 — 이동·사격·충돌·
 * 수거·정리가 전부 이 비교로만 대상을 고른다. 값은 임의의 큰 상수이며 엔티티 id 와 절대
 * 겹치지 않는다(id 는 1 부터 순차 증가한다).
 */
export const DETOUR_MARK = 0xde7011;

/** 방 안 소유물인가(플레이어는 마커가 없으므로 항상 false). */
function isDetourOwned(e: Entity): boolean {
  return e.ownerId === DETOUR_MARK;
}

/**
 * 전리품 드랍 시드를 **RNG 없이** 파생한다. `state.tick` 과 엔티티 id 만으로 정해지므로
 * 같은 시드·입력의 재실행이 같은 아이템을 낳고(서버 재검증 성립), 어떤 RNG 스트림도
 * 전진시키지 않는다(복귀 후 메인 웨이브·드랍 시퀀스 불변). SplitMix32 계열 믹싱을
 * `Math.imul`(정확한 32비트 정수 곱)로만 구성해 전 플랫폼 바이트 동일하다.
 */
function detourDropSeed(tick: number, id: number): number {
  let h = (tick ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = (h ^ Math.imul(id >>> 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 방 안 전리품 1개를 놓는다(마커·픽업 반경까지 세팅). 시드는 RNG 없이 파생. */
function placeDetourLoot(state: WorldState, x: number, y: number, rarity: number): Entity {
  const seed = detourDropSeed(state.tick, state.nextEntityId);
  const l = spawnLoot(state, x, y, seed, rarity);
  l.ownerId = DETOUR_MARK;
  l.radius = VAULT_LOOT_PICKUP_RADIUS;
  return l;
}

/**
 * 보물 격실 진입 선언 — **좌표만 저장하고 워프·세트피스는 다음 틱으로 미룬다.**
 *
 * ## 왜 여기서 즉시 워프하지 않는가 (진입 틱 오염 차단)
 * 이 함수는 `stepEncounter` 안에서 불리는데, 그 호출 지점은 stepWorld 메인 루프의 **중간**
 * 이다(stepEcho 직후). 그래서 진입 틱에는 뒤이어 `updateWaves`·`stepEnemies`·`stepSupply`
 * 가 **그 틱 안에서 계속 실행된다** — 여기서 곧바로 플레이어를 12만 유닛 밖으로 옮기면
 * 웨이브 카드와 보급 습격이 **포켓 좌표 주위에 메인 적을 스폰**해 버린다. 그 적들은
 * `ownerId` 마커가 없어 exitDetour 가 회수하지 않고, 복귀 후에도 12만 유닛 밖에서 플레이어를
 * 향해 영원히 날아오는 유령으로 남는다(뱀서류는 적 컬링이 없다).
 *
 * 그래서 진입 틱은 **완전히 평범한 틱으로 끝내고**(포탈만 사라진다), 실제 워프·세트피스는
 * 다음 틱 stepDetour 최상단의 {@link materializeVault} 가 한다. 그 시점은 이미 단일 분기
 * 안이라 메인 파이프라인이 한 줄도 돌지 않는다.
 *
 * ## 미materialize 센티널
 * 신규 해시 필드를 만들지 않으려고 `detourTimer === 0` 을 "아직 방이 생기지 않았다"는
 * 센티널로 쓴다. 만료 경로와 헷갈리지 않는 이유: 타이머가 0 으로 떨어지는 틱에 곧바로
 * exitDetour 가 `inDetour = 0` 으로 내리므로, `inDetour === 1 && detourTimer === 0` 인
 * 상태는 **진입 직후 한 순간에만** 성립한다.
 *
 * 저장 좌표를 `Math.round` 로 정수화하는 것은 {@link EncounterRuntime} 의 "해시 필드는 전부
 * 정수" 규율 때문이다. 복귀 좌표가 원래 f64 좌표에서 최대 0.5 유닛 어긋나지만, 플레이어
 * 반경이 32 라 게임플레이상 무의미하고 결정론이 훨씬 중요하다.
 */
export function enterDetour(_state: WorldState, player: Entity, rt: EncounterRuntime): void {
  rt.savedX = Math.round(player.x);
  rt.savedY = Math.round(player.y);
  rt.inDetour = 1;
  rt.state = 2;
  rt.detourTimer = 0; // 미materialize 센티널(위 주석).
}

/**
 * 방 실체화 — 워프 + 세트피스 스폰 + 타이머 기동. detour 단일 분기 **안에서만** 불리므로
 * 이 시점엔 메인 파이프라인이 한 줄도 돌지 않는다(진입 틱 오염 차단, 위 주석 참조).
 *
 * 워프 오프셋은 메인 탄 컬 반경보다 훨씬 크다(data/encounters.ts 주석) — 워프 순간 떠 있던
 * 메인 적탄이 복귀 시 눈앞에 남지 않게 하는 장치다. 메인 **적**은 거리로 처리하지 않는다
 * (적은 컬링되지 않고 플레이어를 재추적하므로) — 단일 분기가 stepEnemies 를 아예 돌리지
 * 않아 프리즈되는 것이 그쪽 해법이다(MAJ-1).
 */
function materializeVault(state: WorldState, player: Entity, rt: EncounterRuntime): void {
  const cx = rt.savedX + VAULT_WARP_OFFSET_X;
  const cy = rt.savedY + VAULT_WARP_OFFSET_Y;
  player.x = cx;
  player.y = cy;
  player.vx = 0;
  player.vy = 0;
  rt.detourTimer = VAULT_TIMER_TICKS;

  // --- 세트피스(위험 구배, ADR-0033): 입구 안전지대 자유 수집 → 안쪽 위험지대에 경비가
  //     지키는 확정 고희귀 전리품. 전부 고정 좌표·RNG 미소비다.
  // 안전지대: 포켓 중심 앞(−Y)에 가로로 늘어놓는다. 중앙 정렬 오프셋은 정수 산술이라 정확.
  const safeSpan = ((VAULT_SAFE_LOOT_COUNT - 1) * VAULT_SAFE_LOOT_SPACING) / 2;
  for (let i = 0; i < VAULT_SAFE_LOOT_COUNT; i++) {
    placeDetourLoot(
      state,
      cx - safeSpan + i * VAULT_SAFE_LOOT_SPACING,
      cy + VAULT_SAFE_LOOT_Y,
      VAULT_SAFE_LOOT_RARITY,
    );
  }
  // 위험지대: 확정 고희귀 전리품(ADR-0033 "확정 고희귀 장비 1개").
  const prizeSpan = ((VAULT_PRIZE_LOOT_COUNT - 1) * VAULT_SAFE_LOOT_SPACING) / 2;
  for (let i = 0; i < VAULT_PRIZE_LOOT_COUNT; i++) {
    placeDetourLoot(
      state,
      cx - prizeSpan + i * VAULT_SAFE_LOOT_SPACING,
      cy + VAULT_PRIZE_LOOT_Y,
      VAULT_PRIZE_LOOT_RARITY,
    );
  }
  // 경비 적: 고희귀 전리품 앞을 막는 줄. **로컬 스폰**이라 웨이브 디렉터·엘리트 롤·패턴
  // 엔진 어디도 타지 않는다(RNG 미소비). enemyType 은 blankEntity 기본값 -1 을 유지해
  // 메인 적 카탈로그(enemyDefFor)와 절대 엮이지 않게 한다 — 방내 적은 xp 값도 없다.
  const guardSpan = ((VAULT_GUARD_COUNT - 1) * VAULT_GUARD_SPACING) / 2;
  for (let i = 0; i < VAULT_GUARD_COUNT; i++) {
    const g = blankEntity('enemy');
    g.x = cx - guardSpan + i * VAULT_GUARD_SPACING;
    g.y = cy + VAULT_GUARD_Y;
    g.radius = VAULT_GUARD_RADIUS;
    g.hp = VAULT_GUARD_HP;
    g.maxHp = VAULT_GUARD_HP;
    g.damage = VAULT_GUARD_DAMAGE;
    g.ownerId = DETOUR_MARK;
    addEntity(state, g);
  }
}

/**
 * detour 종료 — 방 안 소유물을 **전부**(dead 여부 무관) 제거하고 플레이어를 원좌표로
 * 되돌린다. "전부"가 중요하다: 살아남은 경비 적이나 안 주운 전리품이 하나라도 메인 월드에
 * 남으면, 그 순간부터 메인 `compact`·`resolveCollisions` 가 그것을 정상 엔티티로 취급해
 * 방내 격리(AC7)가 무너지고 12만 유닛 밖의 유령 엔티티가 해시에 영원히 남는다.
 *
 * 이 함수가 끝난 뒤 메인 파이프라인이 다시 도는 것이 불변식이므로, "메인 스텝이 도는 동안
 * DETOUR_MARK 엔티티가 존재하는 틱은 없다".
 */
function exitDetour(state: WorldState, player: Entity, rt: EncounterRuntime): void {
  const survivors: Entity[] = [];
  for (const e of state.entities) {
    if (isDetourOwned(e)) continue;
    survivors.push(e);
  }
  state.entities = survivors;
  player.x = rt.savedX;
  player.y = rt.savedY;
  player.vx = 0;
  player.vy = 0;
  rt.inDetour = 0;
  rt.state = 3;
}

/** 방 안 적 이동 — 플레이어 직선 추적(고정 속도). 메인 stepEnemies 는 전혀 돌지 않는다. */
function stepDetourEnemies(state: WorldState, player: Entity): void {
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy' || !isDetourOwned(e)) continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = length(dx, dy);
    if (d > 0.001) {
      e.vx = (dx / d) * VAULT_GUARD_SPEED;
      e.vy = (dy / d) * VAULT_GUARD_SPEED;
    } else {
      e.vx = 0;
      e.vy = 0;
    }
    e.x += e.vx * DT;
    e.y += e.vy * DT;
    e.angle = atan2(dy, dx);
  }
}

/**
 * 방 안 자동 사격 — 메인 `autoAttack` 의 최소 재현. `state.weapon` 스탯을 읽고
 * `player.cooldown` 을 그대로 쿨다운 카운터로 재사용하므로 방 안팎의 연사 리듬이 이어진다.
 *
 * ⚠️ 유니크·시그니처 증폭(과열 드럼·과충전·은신 해제)은 **일부러 재현하지 않는다** — 그
 * 경로들은 `player.phase`/`aux0`/`aux1` 같은 전투력 카운터를 읽고 쓰는데, 방 안에서 그것을
 * 건드리면 AC7(전투력 무개입)이 깨진다. 방 안 전투는 순수 기본 화력으로만 한다.
 *
 * RNG 를 한 번도 쓰지 않는다 — 분산은 `spread` 를 균등 분할한 고정 각도다.
 */
function detourAutoAttack(state: WorldState, player: Entity): void {
  const w = state.weapon;
  // 쿨다운 단위는 메인 `autoAttack` 과 **같은 Q(1/FIRE_CD_Q 틱)** 다 — 방 안팎의 연사 리듬이
  // 이어진다는 이 함수의 계약이 단위까지 포함한다. 잔여분 carry 도 같은 형태로 유지한다.
  if (player.cooldown > 0) player.cooldown -= FIRE_CD_Q;
  if (player.cooldown > 0) return;
  const reach = w.range > 0 ? w.range : 0;
  if (reach <= 0) return;
  // 사거리 안 가장 가까운 방 안 적. 메인 `nearestTarget` 을 부르지 않는 이유는 그것이 전
  // 엔티티(메인 적 포함)를 후보로 훑기 때문이다 — 방 안에서 메인 적을 조준하면 안 된다.
  let target: Entity | undefined;
  let bestD2 = reach * reach;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy' || !isDetourOwned(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      target = e;
    }
  }
  if (target === undefined) return;
  // 사거리 끝까지 탄이 살아 있게 수명을 보정한다(메인 `reachLife` 와 같은 계약 —
  // "조준은 되는데 탄이 안 닿는" 부호 반전을 방 안에서도 만들지 않는다).
  const perTick = w.bulletSpeed * DT;
  const need = perTick > 0 ? Math.ceil(reach / perTick) : w.bulletLife;
  const bulletLife = need > w.bulletLife ? need : w.bulletLife;
  const baseAngle = atan2(target.y - player.y, target.x - player.x);
  const n = w.bulletCount < 1 ? 1 : w.bulletCount;
  const start = n > 1 ? baseAngle - w.spread / 2 : baseAngle;
  const stepA = n > 1 ? w.spread / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const ang = start + stepA * i;
    const b = spawnBullet(
      state,
      player.x,
      player.y,
      ang,
      w.bulletSpeed,
      w.damage,
      w.pierce,
      w.bulletRadius,
      bulletLife,
      cos(ang),
      sin(ang),
    );
    // 방 안 탄도 마커를 단다 — exitDetour 가 잔탄까지 회수해 메인 월드로 새지 않게 한다.
    b.ownerId = DETOUR_MARK;
  }
  player.cooldown += w.fireCooldownQ;
}

/** 방 안 탄 전진(수명 감소·만료 처리). 메인 stepProjectiles 는 전혀 돌지 않는다. */
function stepDetourProjectiles(state: WorldState): void {
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'bullet' || !isDetourOwned(b)) continue;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.life > 0) {
      b.life--;
      if (b.life === 0) b.dead = true;
    }
  }
}

/**
 * 방 안 충돌 — 탄×적, 적×플레이어의 O(n·m) 완전탐색이다. 메인 충돌 격자
 * (`resolveCollisions`)를 절대 부르지 않는다: 격자는 전 엔티티를 훑어 rebuild 하므로 그
 * 한 번으로 메인 월드 동결(AC6)이 깨진다. 방 안 엔티티 수는 한 자릿수라 완전탐색이 더 싸다.
 */
function resolveDetourCollisions(state: WorldState, player: Entity): void {
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'bullet' || !isDetourOwned(b)) continue;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy' || !isDetourOwned(e)) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.radius + b.radius;
      if (dx * dx + dy * dy > rr * rr) continue;
      e.hp -= b.damage;
      if (e.hp <= 0) e.dead = true;
      if (b.pierce > 0) {
        b.pierce--;
      } else {
        b.dead = true;
        break;
      }
    }
  }
  // 적 접촉 피해 — 메인과 같은 무적 프레임 규약을 쓴다(방 안에서만 억울하게 맞지 않게).
  // ⚠️ `state.hitsTaken`(사연 관측 카운터)은 **일부러 올리지 않는다**: 비-해시라 결정론엔
  // 무영향이지만, 방내 사건이 메타 지표로 새면 "detour 는 런 상태에 무개입" 계약이 관측
  // 층에서 흐려진다. 방내 결과는 전리품·크레딧·사망뿐이다.
  if (player.iframes > 0) return;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy' || !isDetourOwned(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const rr = e.radius + player.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    player.hp -= e.damage;
    player.iframes = state.config.hitIframes;
    return;
  }
}

/**
 * 방 안 정리·보상 — dead 인 방 안 엔티티만 걷어내고, 그중 실제로 격추된 적(`hp<=0`)에 대해
 * **정산 경제 보상만** 지급한다.
 *
 * AC7 의 코드적 실체가 여기다: `state.kills++` 없음 · `spawnGem` 없음 · xp/combo/level 경로
 * 없음. 보상은 rarity 를 강제한 `spawnLoot`(줍는 것은 플레이어 몫)와 `state.resources`
 * (크레딧)뿐이다. 메인 `compact` 는 이 틱에 아예 돌지 않으므로 메인 엔티티는 dead 여도
 * 그대로 남는다(동결).
 */
function compactDetour(state: WorldState): void {
  const survivors: Entity[] = [];
  const drops: { x: number; y: number }[] = [];
  for (const e of state.entities) {
    // 제거 대상은 **dead 이면서 방 안 소유물**인 것뿐이다. 메인 월드의 dead 엔티티는 여기서
    // 수거하지 않고 그대로 남긴다 — 그건 메인 compact 의 몫이고, 이 틱에 대신 처리하면
    // 복귀 후 메인 엔티티 배열이 워프 전과 달라진다(AC6 위반).
    if (!e.dead || !isDetourOwned(e)) {
      survivors.push(e);
      continue;
    }
    // 실제 격추(hp<=0)만 보상한다 — 수명 만료로 사라지는 방 안 탄은 보상 대상이 아니다.
    if (e.kind === 'enemy' && e.hp <= 0) {
      state.resources += VAULT_GUARD_CREDITS;
      drops.push({ x: e.x, y: e.y });
    }
  }
  state.entities = survivors;
  for (const d of drops) placeDetourLoot(state, d.x, d.y, VAULT_GUARD_LOOT_RARITY);
}

/**
 * 방 안 전리품 수거 — 접촉 즉시 `state.loot`(정산 경제)로 직행한다. 메인 `collectLoot` 와
 * 같은 LootRecord 형태·같은 provenance(planet/stage)를 쓰므로 정산·서버 재검증이 방 안팎을
 * 구분할 필요가 없다. 콤보·xp 는 젬의 몫이지 loot 의 몫이 아니라 여기서도 전투력 무개입이
 * 자연히 성립한다.
 */
function collectDetourLoot(state: WorldState, player: Entity): void {
  const cfg = state.config;
  for (const l of state.entities) {
    if (l.dead || l.kind !== 'loot' || !isDetourOwned(l)) continue;
    const dx = l.x - player.x;
    const dy = l.y - player.y;
    const rr = l.radius + player.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    l.dead = true;
    state.loot.push({
      seed: l.damage >>> 0,
      rarity: l.enemyType,
      planet: cfg.planet ?? 0,
      stage: cfg.stage ?? 1,
    });
  }
}

/**
 * detour 한 틱 — **메인 파이프라인을 완전히 대체하는 자체 최소 파이프라인**이다.
 * world.ts `stepWorld` 최상단 단일 분기에서만 호출되고, 호출한 쪽이 `state.tick++` 후
 * 즉시 return 하므로 이 함수가 도는 틱에는 메인 스텝이 단 하나도 실행되지 않는다.
 *
 * 순서: (첫 틱 방 실체화) → 플레이어 → 적 이동 → 사격 → 탄 전진 → 충돌 → 정리/보상 →
 *       전리품 수거 → 사망 판정 → 타이머/조기 이탈.
 * 사망을 타이머보다 먼저 보는 것은 같은 틱에 둘 다 성립할 때 **런 실패가 권위**이기
 * 때문이다(ADR-0033 실사망 규칙).
 *
 * `stepPlayerFn` 은 world.ts 의 내부 `stepPlayer` 를 주입받은 것이다(순환 import 회피).
 * 메인 벽 목록(`state.activeWalls`)은 12만 유닛 밖이라 방 안 이동에 영향이 없고, 워프
 * detour 는 뱀서류 모드로 게이트돼 있어 창 클램프·수축 판정도 애초에 존재하지 않는다.
 */
export function stepDetour(
  state: WorldState,
  player: Entity,
  input: InputFrame,
  stepPlayerFn: (s: WorldState, p: Entity, i: InputFrame) => void,
): void {
  const rt = state.encounterRuntime;
  if (rt === undefined || rt.inDetour !== 1) return; // 단일 분기 밖에서 불릴 일은 없다(방어).

  // 진입 직후 첫 detour 틱에만 방을 실체화한다(미materialize 센티널 = detourTimer 0,
  // enterDetour 주석 참조). 이 시점은 이미 단일 분기 안이라 메인 파이프라인이 돌지 않는다.
  if (rt.detourTimer === 0) materializeVault(state, player, rt);

  stepPlayerFn(state, player, input);
  stepDetourEnemies(state, player);
  detourAutoAttack(state, player);
  stepDetourProjectiles(state);
  resolveDetourCollisions(state, player);
  compactDetour(state);
  collectDetourLoot(state, player);

  // 방 안 사망 = 런 실패(전역 실사망 규칙). 이미 `state.loot` 에 담긴 전리품은 그대로
  // 보존된다 — 정산이 그 배열을 읽기 때문이다(AC8). 방을 정리하지 않고 그대로 두는 것은
  // 다음 stepWorld 첫 줄 가드(gameOver)가 월드를 inert 로 만들기 때문이며, 그 상태 그대로
  // 결정론적으로 해시된다.
  if (player.hp <= 0) {
    state.gameOver = true;
    return;
  }

  // 조기 이탈(가진 것 보존) — 플레이어가 명시적으로 누른 경우.
  if ((input.special & SPECIAL_ENCOUNTER_EXIT) !== 0) {
    exitDetour(state, player, rt);
    return;
  }
  // 타이머 만료 → 자동 이젝트.
  if (rt.detourTimer > 0) rt.detourTimer--;
  if (rt.detourTimer === 0) exitDetour(state, player, rt);
}
