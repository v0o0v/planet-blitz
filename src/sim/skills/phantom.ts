/**
 * **팬텀 30스킬의 효과 본체**(ADR-0049 배치 4 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/phantom.md` 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 은신 사이클 조작은 **`cloak.ts` 헬퍼 3종만** 쓴다
 * `advanceCloak`·`fireCloakEntry`·`setBreakToken`(+ 통과 판정 `crossed` 계열)이 이미 정본으로
 * 서 있다. `player.aux0` 을 직접 밀거나 `=== 임계` 로 에지를 다시 판정하지 마라 — 그 형태는
 * 임계를 건너뛰어 진입 훅과 배율 토큰을 **조용히** 죽인다(`cloak.ts` 의 각 함수 주석이 근거).
 *
 * ## ⚠️ 진입 에지 훅(PH7·DI7·DI8)은 이 파일이 아니라 `skills/phantomEntry.ts` 에 있다
 * 이 파일이 `cloak.ts` 를 런타임 import 하므로, `cloak.ts` 의 `fireCloakEntry` 가 이 파일을
 * 부르면 곧바로 순환이다. 사유와 그래프는 그 파일 헤더에 있다.
 *
 * ## ⚠️ `player.aux0`/`aux1` 은 시그니처가 점유한다
 * `aux0` = 연속 무피격 틱(0..359) · `aux1` = 해제 첫 타 배율 토큰(0/1). 스킬이 쓸 칸이 아니다 —
 * 상태가 필요하면 `PhantomCarry`/`PhantomStage` 슬롯을 잡는다.
 *
 * ---
 *
 * ## ⚠️ 이 배치가 배선한 것은 30종 중 **12종**이다
 * 나머지 18종은 앵커 14개로 닿지 않는 지점을 요구한다 — 사유는 각 앵커의 `case` 주석과 레인
 * 보고서에 있다. 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다.**
 * 가장 큰 덩어리는 **해제 첫 타 배율의 소진 지점**(`world.ts` autoAttack)이다 — AS1·AS3·AS8·
 * AS9·DI10 다섯이 전부 거기에 달려 있고, 그 자리에는 앵커가 없다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { advanceCloak } from '../cloak.js';
import { slideCircleWalls } from '../los.js';
import { length } from '../math.js';
import { readSlot, writeSlot, PhantomCarry } from '../skillSlots.js';
import { CLOAK_UNHIT_TICKS } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/phantom.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [assassin(offense), phase(utility), disrupt(defense)]` 이므로
// AS1..AS10 = 0..9 · PH1..PH10 = 10..19 · DI1..DI10 = 20..29 다.
//
// ⚠️ **세 기체가 전부 다른 축 순서를 쓴다** — 스트라이커 [offense, defense, utility] ·
// 아크캐스터 [offense, utility, defense] · 팬텀 [offense, utility, defense]. 설계서의 서술
// 순서와 우연히 맞아도 정본은 언제나 `trees` 배열이다.

const enum Sk {
  /** AS4 급소 해부 */ vitalDissection = 3,
  /** AS5 배후 격살 */ backstab = 4,
  /** PH1 잔상 이탈 */ afterimageExit = 10,
  /** PH8 흔적 흡수 */ traceSiphon = 17,
  /** DI2 은둔 재생 */ cloakedMending = 21,
  /** DI3 초탄 감쇄 */ firstHitAttenuation = 22,
  /** DI4 반발 위상 */ repulsePhase = 23,
  /** DI5 최후 위상 */ lastPhase = 24,
  /** DI6 차폐 잠행 */ coverStalk = 25,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_PHANTOM_CLOAK`)가 이미 걸었다.
 */
function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}

// ---------------------------------------------------------------------------
// 상수 · 레벨 스케일
// ---------------------------------------------------------------------------

/**
 * DI2 회복 주기. 설계서 고정값(창 안 60틱마다) — 진입 틱 공짜 회복을 없애려고 `aux0 > 240` 을
 * 함께 본다(설계서 DI2 의 MINOR 정정).
 */
const MENDING_PERIOD = 60;

/**
 * DI4 밀어내기 반경. **밸런스 각주**다 — 설계서 DI4 는 변위량(60 + 8×Lv)만 정하고 반경을
 * 비워 뒀다(헌장 두 게이트 기준 어느 쪽도 아님 → 출시 전 일괄 패스 대상). 여기 상수 하나로
 * 모아 둔 것은 그때 고칠 자리를 하나로 만들기 위해서다.
 */
const REPULSE_RADIUS = 220;

/** DI5 내부 쿨다운 = 3600 − 3600×Lv/(Lv+30) 틱 (Lv1 ≈ 3484, Lv20 = 2160, 점근 0·도달 없음). */
function lastPhaseCooldownTicks(level: number): number {
  return 3600 - Math.floor((3600 * level) / (level + 30));
}

/**
 * DI3 감소 bp = 6000×s/(s+2000), s = aux0×(4+Lv).
 *
 * ⚠️ 나눗셈이 `skillDerived` 가 아니라 여기 있는 사유는 `skills/striker.ts` 의 같은 주석이
 * 정본이다(`world.ts` 런타임 import 또는 이중 정본 둘 중 하나가 되기 때문). 이 함수는 **선체
 * hp 가 실제로 깎이는 피격 틱**에만 불린다 — sim 루프의 상시 나눗셈이 아니다.
 */
function attenuationBp(streak: number, level: number): number {
  const s = streak * (4 + level);
  if (s <= 0) return 0;
  return Math.floor((6000 * s) / (s + 2000));
}

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_PHANTOM_CLOAK:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ② **대시 발동** — PH1 잔상 이탈.
 *
 * 전진은 반드시 {@link advanceCloak} 경유다: 240 에서 멈추고 진입 에지를 정상 발화하며,
 * **창 안 대시는 무효**(창 조작은 PH6 의 전유 축 — 설계서 ①-3 의 택일 확정). 침공 no-op 도
 * 헬퍼에 내장돼 있어 여기서 다시 보지 않는다.
 */
export function phantomDashFired(state: WorldState, player: Entity): void {
  const ph1 = lv(state, Sk.afterimageExit);
  if (ph1 < 1) return;
  advanceCloak(state, player, 20 + 4 * ph1);
}

/**
 * 앵커 ③ **젬 수거** — PH8 흔적 흡수. 젬 1개당 +1 + ceil(Lv/5) 틱 (Lv20 = +5, 5레벨 폭 계단).
 *
 * ⚠️ 이 앵커는 침공에서도 불린다(침공 편대원·스포너 드론이 젬을 뿌린다 — 앵커 ③ 주석).
 * 그래도 안전한 것은 `advanceCloak` 이 침공에서 no-op 이기 때문이다 — "침공엔 젬이 없다"에
 * 기대지 않는다.
 */
export function phantomGemCollected(state: WorldState, player: Entity): void {
  const ph8 = lv(state, Sk.traceSiphon);
  if (ph8 < 1) return;
  advanceCloak(state, player, 1 + Math.ceil(ph8 / 5));
}

/**
 * 앵커 ⑦ **벽 접촉 틱** — DI6 차폐 잠행. 접촉 틱당 +1 + floor(Lv/10) 틱 (Lv20 = +3).
 *
 * ## 설계서의 "직전 틱"과 이 앵커의 "이번 틱"
 * 설계서는 "직전 틱에 벽 슬라이드가 일어났으면 **그 틱의** 적립이 가속" 이라고 적었다. 이
 * 앵커는 `wallContactTicks` 갱신 **직후**·접촉이 참인 틱에만 불리므로 여기서 가속하면 대상이
 * "이번 틱"이 된다 — 한 틱 차이이고, 연속 접촉 구간에서는 총 적립량이 같다(첫 틱이 앞당겨지고
 * 마지막 틱이 빠질 뿐). 설계서가 요구한 신규 플래그(구현 태그 B)를 세우지 않은 것도 같은
 * 이유다: S0 의 E5 가 `state.wallContactTicks` 로 같은 술어를 이미 엔진 상태로 세웠고,
 * 같은 술어를 슬롯에 복제하면 갱신 시점이 갈려 조용히 어긋난다(스트라이커 M5·S4 선례).
 */
export function phantomWallContact(state: WorldState, player: Entity): void {
  const di6 = lv(state, Sk.coverStalk);
  if (di6 < 1) return;
  advanceCloak(state, player, 1 + Math.floor(di6 / 10));
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯** — DI3 초탄 감쇄(**감소** 칸). 흡수 칸을 쓰는 팬텀 스킬은 없다.
 *
 * ## 이 지점의 `aux0` 은 아직 **피격 리셋 전**이다
 * 팬텀 피격 리셋(`world.ts` 의 `player.aux0 = 0`)은 사슬 **뒤**, hp 차감 뒤에 온다. 그래서
 * 여기서 읽는 스트릭이 정확히 설계서가 요구한 "이 피격 직전까지 쌓인 무피격 틱" 이다 —
 * 이 순서가 뒤집히면 이 스킬은 상시 0 감소가 되어 조용히 죽는다.
 *
 * 침공에서는 `aux0` 이 끝까지 0 이라 `s = 0` → 감소 0 으로 자연 no-op 이다(상수항 없음).
 */
export function phantomDamageChain(state: WorldState, player: Entity, dmg: number): number {
  const di3 = lv(state, Sk.firstHitAttenuation);
  if (di3 < 1) return dmg;
  const bp = attenuationBp(Math.trunc(player.aux0), di3);
  if (bp <= 0) return dmg;
  // 반올림은 이 게이트 **안**이다(규율 ③) — 접촉 피해에 엘리트 배율이 섞여 소수로 들어올 수
  // 있고, 반올림이 게이트 밖으로 나가면 스킬 없는 런의 소수 피해까지 바뀐다.
  const out = dmg - Math.round((dmg * bp) / 10000);
  return out > 0 ? out : 0;
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — DI4 반발 위상 · DI5 최후 위상.
 *
 * ## ⚠️ DI1·PH10 은 여기 없다 — **앵커가 리셋보다 뒤이기 때문이다**
 * 설계서 공통 구현 고지 ④ 는 순서를 **DI1(리셋 전 aux0 읽기) → PH10(창 술어) → 리셋 →
 * DI5(진입)** 로 못 박았는데, 이 앵커는 팬텀 피격 리셋(`world.ts` 의 `aux0 = 0` +
 * `setBreakToken(…, 0)`) **뒤**에 있다. 즉 여기 도달한 시점의 `aux0` 은 **항상 0** 이라
 * DI1 의 반경 보정(aux0/2)은 영영 0 이 되고 PH10 의 "창 중 피격" 술어는 영영 거짓이다.
 * 그 둘은 리셋 분기 자체에 손잡이가 필요하다 — 흉내 내면 화면과 규칙이 갈린다.
 * (DI5 만 "리셋 **이후**"가 설계 순서라 여기서 정확히 성립한다.)
 *
 * @param dmg 실제로 hp 에서 차감된 피해 — DI5 의 임계 통과 판정이 피격 **전** hp 를 복원하는 데 쓴다
 */
export function phantomPlayerDamaged(state: WorldState, player: Entity, dmg: number): void {
  // ① DI4 반발 위상 — 주변 적을 좌표 직접 변위로 밀어낸다(`resolveFilmBurst` 동형).
  const di4 = lv(state, Sk.repulsePhase);
  if (di4 >= 1) {
    const push = 60 + 8 * di4;
    const r2 = REPULSE_RADIUS * REPULSE_RADIUS;
    for (const e of state.entities) {
      if (e.dead) continue;
      // 잡몹·보스만 민다. 구조물·기물·탄은 좌표가 배치 계약이라 밀면 무대가 무너진다.
      const isBoss = e.kind === 'boss';
      if (e.kind !== 'enemy' && !isBoss) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = length(dx, dy);
      // 중심과 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다
      // (`resolveFilmBurst` 와 같은 판단).
      if (d <= 1) continue;
      // 보스·엘리트는 반감. 엘리트 술어는 `isElite` 의 정의(`kind === 'enemy' && pierce > 0`)를
      // 그대로 적는다 — `elite.ts` 를 import 하면 그쪽이 `world.ts` 를 런타임으로 당긴다.
      const heavy = isBoss || e.pierce > 0;
      const amount = heavy ? Math.round(push / 2) : push;
      if (amount <= 0) continue;
      e.x += (dx / d) * amount;
      e.y += (dy / d) * amount;
      // ⚠️ 밀어낸 직후 벽 충돌을 **즉시** 재해결한다(`resolveFilmBurst` 의 MED-4 와 같은 사유):
      // 변위가 벽 두께보다 크면 적이 벽 안쪽에 박히고, 다음 틱 `slideCircleWalls` 가 최근접
      // 면으로 밀어내며 반대편으로 튀어나온다(터널링). 결정론은 유지되므로 해시 검증으로는
      // 절대 안 잡히는 조용한 배치 계약 위반이다.
      if (state.activeWalls.length > 0) {
        const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
        e.x = slid.x;
        e.y = slid.y;
      }
    }
  }

  // ② DI5 최후 위상 — HP 가 30% 아래로 **떨어지는 그 틱**에 즉시 은신 진입(내부 쿨다운 있음).
  //
  // ⚠️ 침공 게이트를 **트리거 자체에** 병기한다(설계서 ④ 표 DI5). `advanceCloak` 이 침공에서
  //    no-op 이라 이득은 이미 막혀 있지만, 게이트가 없으면 쿨다운 카운터만 런 내내 돌며
  //    `skillCarry` 폴드에 실려 침공 해시를 바꾼다 — 아무것도 안 하는 상태가 해시에 접히는
  //    것이 "구현했는데 안 불린다"의 해시판이다.
  if (state.config.invasion3 !== undefined) return;
  const di5 = lv(state, Sk.lastPhase);
  if (di5 < 1) return;
  if (readSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown) > 0) return;
  // 임계 통과 판정 — 정수 비교로 한다(`hp × 10000` vs `maxHp × 3000`). 부동소수 임계값을
  // 만들면 hp 가 정수인데 판정만 소수가 되어 경계 틱이 기체마다 갈린다.
  const thr = player.maxHp * 3000;
  const before = player.hp + dmg;
  if (!(player.hp * 10000 < thr && before * 10000 >= thr)) return;
  if (player.hp <= 0) return;
  advanceCloak(state, player, CLOAK_UNHIT_TICKS);
  writeSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown, lastPhaseCooldownTicks(di5));
}

/**
 * 앵커 ⑨ **시그니처 틱 진행**(매 틱 정확히 한 번) — DI2 은둔 재생 · DI5 쿨다운 진행.
 *
 * ## 이 앵커는 팬텀 `aux0++` **보다 앞**이다
 * `stepShipSignature` 진입점이라, 여기서 읽는 `aux0` 은 **직전 틱 말의 값**이다. DI2 의
 * 주기 판정이 그 전제 위에 선다: 진입 틱(aux0 = 240)에는 `> 240` 이 거짓이라 공짜 회복이
 * 없고, 60틱 뒤 `aux0 = 300` 인 틱에 첫 회복이 온다 — 설계서 DI2 의 "첫 회복은 진입 60틱 후"
 * 그대로다. 기본 창(HOLD 120)에서는 창당 정확히 1회다.
 *
 * 침공에서는 `aux0` 이 끝까지 0 이라 DI2 가 자연 no-op 이다.
 */
export function phantomSignatureStep(state: WorldState, player: Entity): void {
  // ① DI2 은둔 재생 — 창 안 60틱마다 2 + 1×Lv HP.
  const di2 = lv(state, Sk.cloakedMending);
  if (di2 >= 1) {
    const a = Math.trunc(player.aux0);
    if (a > CLOAK_UNHIT_TICKS && (a - CLOAK_UNHIT_TICKS) % MENDING_PERIOD === 0) {
      const heal = 2 + di2;
      const next = player.hp + heal;
      player.hp = next > player.maxHp ? player.maxHp : next;
    }
  }

  // ② DI5 내부 쿨다운 진행. 게이트 안에서만 만진다 — 미투자 런은 슬롯이 0 인 채로 남아야
  //    "전 슬롯 0 이면 무폴드" 가 성립한다(`skillSlots.ts` 값 규약 3).
  const di5 = lv(state, Sk.lastPhase);
  if (di5 >= 1) {
    const cd = readSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown);
    if (cd > 0) writeSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown, cd - 1);
  }
}

/**
 * 앵커 ⑩ **적성 표적이 아군탄에 맞아 피해가 확정된 직후** — AS4 급소 해부 · AS5 배후 격살.
 *
 * ## 두 스킬 다 "증폭"이 아니라 **추가 피해**로 구현된다
 * 설계서는 둘을 "명중 피해 증폭"으로 적었지만 이 앵커는 차감·격추 판정이 **이미 끝난** 자리다.
 * 그래서 증폭분을 추가 피해로 얹는다 — 총 피해량은 같고, 다른 것은 **격추 시점**뿐이다:
 * 추가분이 마지막 일격이면 그 적은 이번 틱이 아니라 다음 틱에 죽는다. 브루저 BL9(중압 리듬)의
 * 강타가 같은 자리에서 같은 형태(`target.hp -= bonus`)를 이미 쓰고 있어 선례를 따랐다.
 * ⚠️ `target.hp`/`target.dead` 를 **되돌리지는 않는다**(앵커 ⑩ 의 금지 사항).
 *
 * ## 덮는 범위는 아군탄 명중 하나뿐이다
 * 화염 DoT·전격 연쇄·폭탄 기물·액티브 폭발·격실 탄은 leaf 라 이 앵커에 오지 않는다(앵커 주석).
 * 두 스킬 다 설계상 "명중"이 트리거라 그 한계와 정확히 겹친다 — 넓혀 약속하지 않았다.
 */
export function phantomEnemyDamaged(
  state: WorldState,
  player: Entity,
  target: Entity,
  dmg: number,
): void {
  // 코어 실드가 전량 흡수한 명중은 `dmg === 0` 으로도 온다 — "맞았다"가 아니라 "깎였다"를 센다.
  if (dmg <= 0) return;

  // ① AS4 급소 해부 — 만피 적에게 명중하는 첫 타에 +12% + 1.8%p/Lv.
  //
  // ## 침공 실드 경로의 상시 참 위험(설계서 AS4 의 MINOR 검증 항목)
  // 실드가 피해를 대신 받으면 `hp === maxHp` 가 매 타 참이 되어 선타 보너스가 상시화된다.
  // **위의 `dmg > 0` 게이트가 그것을 닫는다**: 실드가 전량 흡수하면 `dmg === 0` 으로 와서
  // 제외되고, 실드를 뚫고 hp 가 깎였다면 그 다음 타의 `hpBefore` 는 더 이상 만피가 아니다.
  // 그래서 판정을 `hp + 실드` 로 확장하거나 대상을 제외할 필요가 없다.
  const as4 = lv(state, Sk.vitalDissection);
  if (as4 >= 1 && target.hp + dmg === target.maxHp) {
    const extra = Math.round((dmg * (1200 + 180 * as4)) / 10000);
    if (extra > 0) target.hp -= extra;
  }

  // ② AS5 배후 격살 — 적의 후방 반구(적→플레이어 벡터와 적 이동 방향의 내적 음수)에서 +10% + 1.5%p/Lv.
  //    정지 적(vx = vy = 0)은 내적이 0 이라 구조적으로 증폭 없음 — 침공 구조물 무영향이
  //    공식에 내장돼 있다(설계서 ④ 표 AS5).
  const as5 = lv(state, Sk.backstab);
  if (as5 >= 1) {
    const dot = (player.x - target.x) * target.vx + (player.y - target.y) * target.vy;
    if (dot < 0) {
      const extra = Math.round((dmg * (1000 + 150 * as5)) / 10000);
      if (extra > 0) target.hp -= extra;
    }
  }
}
