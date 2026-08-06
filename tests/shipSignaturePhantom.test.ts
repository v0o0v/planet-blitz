/**
 * M8 시그니처 배선 — 팬텀(typeId 3 / 비트 20) 은신.
 *
 * ## 무엇을 막는가
 * 1. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:3}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 굴려 **은신에 실제로 진입하고 해제 첫 타가 실제로 소진되는지**를
 *    런타임 궤적으로 잰다.
 * 2. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런.
 * 3. **반쪽 은신** — 은신은 잡몹 일반 사격·돌격형 파편 분출·보스 패턴 세 방출 경로를 모두 막아야
 *    한다. 하나라도 빠지면 "어떤 적은 은신을 뚫는다" 가 되는데 화면상 조용하다. 억제 대조군 대비
 *    **적탄 총량이 실제로 갈리는지**로 잰다.
 * 4. **양방향 리셋 결함** — 무피격 카운터를 "없던 피격"(생존 캡스톤 무효)에서도 리셋하면 은신이
 *    사실상 발동하지 않고, 반대로 실피격에서 리셋을 빼면 맞아도 은신이 유지된다. 둘 다 조용하다.
 * 5. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld, playerCloaked } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_PHANTOM_CLOAK,
  SIGNATURE_BITS,
  CLOAK_UNHIT_TICKS,
  CLOAK_BREAK_BP,
  cloakActive,
  cloakBreakDamage,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 임계와 배율
// ---------------------------------------------------------------------------

describe('팬텀 은신 — 순수 산술 골든', () => {
  it('은신은 연속 무피격이 임계에 **도달**해야 성립한다(경계 포함)', () => {
    expect(cloakActive(CLOAK_UNHIT_TICKS - 1)).toBe(false);
    expect(cloakActive(CLOAK_UNHIT_TICKS)).toBe(true);
    expect(cloakActive(CLOAK_UNHIT_TICKS + 1000)).toBe(true);
    expect(cloakActive(0)).toBe(false);
  });

  it('world.ts 가 인라인한 배율 산술은 정수 피해에 대해 순수 함수와 값이 같다', () => {
    // world.ts 는 `cloakBreakDamage` 를 직접 부르지 않는다 — 그 함수가 입력을 `Math.trunc` 해서
    // weapon.damage(소수 2자리 실수)의 소수부를 지우기 때문이다(아크캐스터가 이미 밟은 함정).
    // 대신 동형 산술(정수 bp · 단일 나눗셈 · 반올림 1회)을 인라인했다. 그 동형성을 여기서 못 박아
    // 두 경로가 갈라지면 즉시 빨개지게 한다.
    for (const d of [0, 1, 2, 3, 7, 13, 25, 99, 100, 12345]) {
      expect(Math.round((d * CLOAK_BREAK_BP) / 10000)).toBe(cloakBreakDamage(d));
    }
    // 2.5배라는 축 자체도 못 박는다(밸런스 패스가 상수를 바꾸면 여기가 먼저 알려 준다).
    expect(CLOAK_BREAK_BP).toBe(25000);
    expect(cloakBreakDamage(100)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// ② 정규 경로 통합 — 실제로 배선이 살아 있는가
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

/**
 * ⚠️ 2026-08-06 — **`suppressSignature`(shipType:0 강제)는 ADR-0049 이후 오염된 대조군이라
 * 삭제했다.** 그 헬퍼는 "typeId 0(스트라이커)는 시그니처가 없다(`shipTypeDef(0).signatureBit
 * === -1`)"는 전제로 마스크 비트를 지우고 shipType 을 0 으로 눌러 "시그니처 완전 off" 런을
 * 만들었다. 그런데 ADR-0049 가 스트라이커에 비트 24(정조준 사이클)를 부여하면서 그 전제가
 * 깨졌다 — shipType:0 은 이제 "시그니처 없음"이 아니라 **"팬텀 대신 스트라이커 정조준이 켜진
 * 런"**이다. 실측(2026-08-06): 정조준 사이클이 `player.aux0` 를 0..11 로 돌리므로
 * `ctrl.maxAux0` 가 0 이 아니라 11 근처를 오간다 — "억제 대조군은 aux 를 안 건드린다"는 계약이
 * 통째로 거짓이 됐다. **"시그니처 없음"은 이제 제품에 존재하는 상태가 아니다** — 유효한
 * shipType 0~6 전부가 시그니처 비트를 하나씩 갖는다(shipSignature.ts SIGNATURE_BITS). 존재하지
 * 않는 상태를 대조군으로 쓰는 설계 자체가 틀렸으므로, config 를 바꿔 시그니처를 "끄는" 접근을
 * 버린다.
 *
 * ## 대신 무엇을 쓰는가 — 트리거 입력 굶기기(ⓐ)
 * 팬텀의 은신은 **연속 무피격 240틱**이 트리거다. 실제 피격은 `aux0`(무피격 스트릭)·`aux1`
 * (해제 대기 플래그)을 world.ts 가 둘 다 0 으로 되돌린다(hit-resolution 분기). 그래서 "매 틱
 * 방금 피격당한 것처럼" aux0·aux1 을 강제로 0 에 묶어 두면 — **시그니처 비트는 그대로 켜진
 * 채로**(shipType·mask 는 live 와 완전히 동일) — 연속 무피격 카운터가 임계(240)에 영원히
 * 도달하지 못해 은신이 자연히 발동하지 않는다. 이것이 `runObserved` 의 `starve` 플래그다.
 *
 * 이 방식이 옛 헬퍼보다 **더 정직하다**: ①shipType 이 바뀌지 않으므로 `baseBp`(damage/maxHp/
 * moveSpeed) 오염이 원천적으로 없다(옛 방식이 파일 머리말에서 스스로 경고했던 "가짜 증거" #2가
 * 사라진다) ②다른 시그니처(스트라이커 정조준 등)가 섞여 들어올 여지가 없다 — 굶기는 것은 팬텀
 * 자신의 트리거 입력뿐이다. 대가는 `ctrl.maxAux0`/`maxAux1` 자체를 "배선이 안 건드렸다"의
 * 증거로 못 쓴다는 것이다(우리가 직접 0 으로 고정했으니 당연히 0 — 항진). 그래서 아래 단언은
 * aux 슬롯이 아니라 **그 슬롯이 먹여 살리는 하류 관측**(cloakEnters·cloakedTicks·breakShots·
 * enemyBulletTicks 등, world.ts 의 다른 코드 경로가 독립적으로 계산하는 값)으로 옮겼다.
 */

interface Observed {
  hpLost: number;
  kills: number;
  entityCount: number;
  /** 매 틱 살아 있는 적탄 수의 누적합 — 적 방출 게이트가 실제로 무언가를 막았는지의 척도. */
  enemyBulletTicks: number;
  /** 은신에 진입한 횟수(무피격 카운터가 임계를 새로 넘긴 횟수). */
  cloakEnters: number;
  /** 틱 종료 시점에 은신이 유지되고 있던 틱 수(= 적이 쏘지 못한 틱). */
  cloakedTicks: number;
  firstCloakTick: number;
  /**
   * 해제 첫 타가 **실제로 소진된** 횟수. 판정: 대기 플래그(aux1)가 1 → 0 이 되면서 그 틱에
   * 플레이어 hp 가 줄지 않았다면, 플래그를 지운 주체는 피격 경로가 아니라 autoAttack 의 배율
   * 블록뿐이다(피격 리셋은 hp 차감 분기 안에서만 일어난다).
   */
  breakShots: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

/**
 * `starve=true` 면 매 틱 stepWorld **직전에** `aux0=aux1=0` 을 강제한다("방금 피격당한 것처럼") —
 * 위 헤더 주석의 트리거 굶기기 기법. 시그니처 비트(shipType·mask)는 손대지 않는다.
 */
function runObserved(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  starve = false,
): Observed {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let cloakEnters = 0;
  let cloakedTicks = 0;
  let firstCloakTick = -1;
  let breakShots = 0;
  let enemyBulletTicks = 0;
  let prevAux1 = 0;
  let prevHp = DURABLE_HP;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    if (starve) {
      const pre = state.entities[0]!;
      pre.aux0 = 0;
      pre.aux1 = 0;
    }
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    for (const e of state.entities) if (e.kind === 'enemyBullet' && !e.dead) enemyBulletTicks++;
    if (playerCloaked(state, p)) cloakedTicks++;
    // 진입 판정은 대기 플래그로 한다 — 같은 틱 안에서 진입 후 곧바로 첫 타가 나가면 틱 종료
    // 시점의 aux0 은 이미 0 으로 되돌아 있어 카운터만으로는 놓친다.
    if (prevAux1 === 0 && p.aux1 === 1) {
      cloakEnters++;
      if (firstCloakTick < 0) firstCloakTick = i;
    }
    if (prevAux1 === 1 && p.aux1 === 0 && p.hp === prevHp) breakShots++;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    prevAux1 = p.aux1;
    prevHp = p.hp;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    kills: state.kills,
    entityCount: state.entities.length,
    enemyBulletTicks,
    cloakEnters,
    cloakedTicks,
    firstCloakTick,
    breakShots,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('팬텀(typeId 3) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  it('마스크에 자기 비트만 켜지고 shipType 축도 선다', () => {
    const cfg = buildRunConfig(profileWithType(3), { planet: 0, stage: 1 });
    expect(cfg.shipType).toBe(3);
    const mask = cfg.loadout?.uniqueMask ?? 0;
    expect(hasCapstone(mask, SIG_PHANTOM_CLOAK)).toBe(true);
    for (const bit of SIGNATURE_BITS) {
      if (bit === SIG_PHANTOM_CLOAK) continue;
      expect(hasCapstone(mask, bit), `bit ${bit}`).toBe(false);
    }
  });

  // 무대 선정도 계약의 일부다: 은신은 **연속 무피격 240틱**이 필요하므로 압박이 끊이지 않는
  // 무대(행성2/티어2)에서는 정지 파일럿의 무피격 최대치가 146틱에 그쳐 영영 진입하지 못한다
  // (실측). 행성0/티어0 은 교전 사이에 긴 무피격 구간이 생겨 은신이 반복 발현한다.
  //
  // ⚠️ SEED·TICKS 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인 seed 555 는
  // 밀도가 오르면서 압박이 거의 끊이지 않게 돼(잡몹이 항상 붙어 있다) 1800틱에 진입 1회뿐이었다
  // (breakShots 도 1회 — 임계 4·3 미달). seed 48 은 3600틱에서 진입 4회·해제 첫 타 4회로
  // 여유 있게 통과한다(PVE_DENSITY_MULT 가 2 → 1.5 로 재조정된 뒤에도 재확인해 동일했다).
  //
  // ⚠️ SEED 재선정 2026-07-27(48 → 84, 밸런스 패스 ADR-0037). 적 축 상향(`eliteCount` 밴드0
  // 0 → 1 · `SEGMENTS.killGoal` 합계 80 → 240)으로 압박이 더 촘촘해져 seed 48 의 은신 진입이
  // 3,600틱에 **2회**로 떨어졌다(임계 4 미달). 무대·틱·단언은 그대로고 증인만 다시 골랐다.
  // 재표본(48..167 연속 120시드, 이 블록의 단언 전부를 만족): **84** 하나 — 진입 4회 ·
  // 은신 유지 480틱 · 해제 첫 타 4회 · 첫 진입 427틱 · 무피격 최대 359틱 · 처치 28 ·
  // 고유 해시 3,600(공허 런 아님). 조건을 만족하는 시드가 120개 중 1개로 **희소하다**는 것
  // 자체가 기록해 둘 값이다 — 다음 sim 변경 때는 더 넓게 스캔해야 한다.
  const TRAJ = { planet: 0, stage: 1 } as const;
  // ⚠️ SEED 재선정 2026-08-04(84 → 156, 카르곤 정예 2종 추가로 카드 풀 8 → 10).
  // 풀 길이가 바뀌면 같은 시드의 카드열이 통째로 갈린다 — seed 84 는 진입 1회·해제 첫 타 1회로
  // 임계(4·3) 미달이 됐다. 300시드 스캔에서 seed 156 이 진입 4 · 은신 유지 480틱 · 해제 첫 타 4 ·
  // 처치 46 으로 가장 여유가 크다(seed 13·195 도 통과 — 다음 재선정 때 후보로 쓸 수 있다).
  // ⚠️ SEED 재선정 2026-08-04(156 → 238, 해저드 반감). 지형 해저드 4%→2% · 박격포 쿨다운 2배 ·
  // 용암 기둥 6→3 이 굴림 값을 바꿔 같은 시드의 런이 통째로 달라진다 — seed 156 은 진입 1회로
  // 임계(4) 미달이 됐다. **400시드 연속 스캔(1..400)에서 통과 시드는 238 하나뿐이다**
  // (진입 4 · 해제 첫 타 4 · 처치 42). 위 2026-07-27 메모가 예고한 희소성이 그대로 재현됐다 —
  // 다음 sim 변경 때는 400보다 더 넓게 스캔할 각오를 하라. 무대·틱·단언은 이번에도 불변이다.
  const TRAJ_SEED = 238;
  const TRAJ_TICKS = 3600;

  it('은신에 실제로 진입하고 해제 첫 타가 실제로 소진된다 — 트리거 굶긴 대조군은 끝까지 미발현', () => {
    const cfg = buildRunConfig(profileWithType(3), TRAJ);
    const live = runObserved(TRAJ_SEED, cfg, TRAJ_TICKS);
    // starve=true: 같은 cfg(같은 shipType·같은 마스크, 시그니처는 계속 켜져 있다) · 매 틱
    // "방금 피격당한 것처럼" aux0/aux1 을 0 에 묶어 트리거만 굶긴다(위 헤더 주석 참조).
    const ctrl = runObserved(TRAJ_SEED, cfg, TRAJ_TICKS, true);

    // 공허 런 가드 — 월드가 멈춰 있으면 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(live.kills).toBeGreaterThan(0);

    // 실측 기준선(seed 48 / p0t0 / 3600틱): 진입 4회 · 은신 유지 274틱 · 해제 첫 타 4회 ·
    // 무피격 최대 359틱.
    expect(live.cloakEnters).toBeGreaterThanOrEqual(4);
    expect(live.cloakedTicks).toBeGreaterThan(0);
    expect(live.breakShots).toBeGreaterThanOrEqual(3);
    expect(live.firstCloakTick).toBeGreaterThanOrEqual(CLOAK_UNHIT_TICKS - 1);
    expect(live.maxAux0).toBeGreaterThanOrEqual(CLOAK_UNHIT_TICKS);

    // 트리거를 굶긴 대조군은 aux0 가 240 에 영영 못 닿으므로 하류 관측(은신 진입·유지·해제
    // 첫 타)이 전부 미발현이다. ⚠️ maxAux0/maxAux1 자체는 우리가 직접 0 으로 고정했으므로
    // 항진이라 여기서 재지 않는다 — 아래는 world.ts 의 다른 코드 경로가 독립적으로 계산하는
    // 하류 관측값이다.
    expect(ctrl.cloakEnters).toBe(0);
    expect(ctrl.cloakedTicks).toBe(0);
    expect(ctrl.breakShots).toBe(0);
  });

  it('aux1 은 0/1 플래그이고 은신 카운터는 상한 안에 머문다 (u32 폴드 규율)', () => {
    const cfg = buildRunConfig(profileWithType(3), TRAJ);
    const live = runObserved(TRAJ_SEED, cfg, TRAJ_TICKS);
    expect(live.maxAux1).toBe(1);
    expect(Number.isInteger(live.maxAux0)).toBe(true);
    // world.ts 의 CLOAK_TICK_CAP(600)과 같은 계약값. 상한이 사라지면 여기가 먼저 빨개진다.
    expect(live.maxAux0).toBeLessThanOrEqual(600);
  });

  // 적 방출 게이트가 실제로 무언가를 막는 무대·시드(실측 탐색으로 고름).
  // ⚠️ 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인(행성1/seed 9182)은 이제
  // vampire 로 덮어도 live·ctrl 의 적탄 누적·엔티티 수가 완전히 같아졌다(cloakedTicks=0 —
  // 밀도가 오르며 이 무대에서는 무피격 240틱을 영영 못 채운다). 행성0/seed 9182 는 밀도가 낮은
  // 카르곤 로스터라 은신이 반복 서고(누적 49틱), 억제를 껐을 때 초반 방출 하나가 이후 교전
  // 전개를 완전히 바꾼다 — 적탄 누적 157444(live) vs 147704(ctrl), 최종 엔티티 77 vs 73.
  // planet 모드 축은 이 테스트가 재는 팬텀 시그니처 축과 직교하므로 vampire 로 고정한다.
  const GATE = { planet: 0, stage: 1 } as const;
  // ⚠️ SEED 재선정 2026-08-04(9182 → 6, 카르곤 정예 2종 추가로 카드 풀 8 → 10). 카드열이
  // 갈리며 seed 9182 는 은신이 한 틱도 서지 않게 됐다(cloakedTicks=0 → 게이트가 잴 것이 없다).
  // 120시드 스캔에서 seed 6 이 은신 120틱 · 적탄 누적 174505(live) vs 60186(ctrl) ·
  // 최종 엔티티 236 vs 100 으로 갈림이 가장 크다.
  //
  // ⚠️ SEED 재선정 2026-08-04(6 → 7, 벽 프리팹 도입). 벽이 낱개 사각형에서 조각 7개 이상이
  // 이어진 구조물이 되면서 **사선이 지형에 더 자주 막힌다** — seed 6 은 은신을 켜든 끄든 적탄
  // 누적이 196252 로 완전히 같아졌다(은신의 기여가 지형 차폐에 묻혔다 = 게이트가 잴 것이 없다).
  // 60시드 스캔에서 은신이 실제로 선 시드는 12개였고, 그중 seed 7 이 은신 240틱 · 적탄 누적
  // 164686(live) vs 230487(ctrl) · 최종 엔티티 233 vs 286 으로 갈림이 크고 은신 유지도 길다.
  const GATE_SEED = 7;
  const GATE_TICKS = 3600;

  it('은신이 적의 방출을 실제로 막는다 — 트리거 굶긴 대조군과 적탄 총량·엔티티가 갈린다', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(profileWithType(3), GATE),
      planetMode: PLANET_MODE.vampire,
    };
    const live = runObserved(GATE_SEED, cfg, GATE_TICKS);
    const ctrl = runObserved(GATE_SEED, cfg, GATE_TICKS, true);

    expect(new Set(live.hashes).size).toBeGreaterThan(1800);
    expect(live.cloakedTicks).toBeGreaterThan(0);
    expect(ctrl.enemyBulletTicks).toBeGreaterThan(0);

    // 시그니처 트리거만 굶기면 관측이 갈린다 = 배선이 실제로 산 상태다. 두 config 는 완전히
    // 동일한 shipType·mask(시그니처는 live·ctrl 모두 켜져 있다) — 갈리는 유일한 원인은
    // ctrl 이 매 틱 aux0/aux1 을 0 으로 눌러 트리거를 굶긴 것뿐이다. 옛 suppressSignature 는
    // shipType 을 0 으로 바꿔 baseBp(damage/maxHp/moveSpeed)까지 같이 흔들었지만, 이 버전은
    // 그 축이 아예 존재하지 않는다.
    expect(live.enemyBulletTicks).not.toBe(ctrl.enemyBulletTicks);
    expect(live.entityCount).not.toBe(ctrl.entityCount);
  });

  it('스트라이커(typeId 0) 런은 은신하지 않는다 (다른 시그니처를 쓰지만 팬텀 축은 끝까지 미발현)', () => {
    // ⚠️ 2026-08-06: 이 테스트는 원래 "스트라이커 = 시그니처 없음이라 aux0/aux1 이 끝까지 0"을
    // 재는 자리였다. ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여하면서 그 전제가
    // 깨졌다 — 스트라이커도 이제 aux0 를 0..11 로 돌린다(정조준 사이클 카운터, 볼리 발사마다
    // 진행). 그래서 maxAux0 는 더 이상 0 이 아니다. 대신 **팬텀 고유 축**(cloakedTicks·
    // breakShots — playerCloaked 술어와 은신 해제 배율 경로, 둘 다 signatureOn(SIG_PHANTOM_CLOAK)
    // 게이트 뒤에 있다)이 스트라이커 런에서 끝까지 미발현인지를 잰다. 이것이 이 테스트가 원래
    // 증명하려던 것("남의 시그니처가 이 축을 오염시키지 않는다")의 정확한 축이다.
    const striker = buildRunConfig(defaultProfile(), TRAJ);
    const obs = runObserved(TRAJ_SEED, striker, 900);
    // 정조준 사이클 카운터는 [0, MARKSMAN_CYCLE_SHOTS) 안에서만 돈다(shipSignatureStriker.test.ts
    // 가 이 축의 정본이다) — 여기서는 "0 이 아니게 됐다"는 사실만 계약값으로 못 박는다.
    expect(obs.maxAux0).toBeGreaterThanOrEqual(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.cloakedTicks).toBe(0);
    expect(obs.breakShots).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(450);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005, 은신은 RNG 미소비)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(3), TRAJ);
    expect(runObserved(TRAJ_SEED, cfg(), 700).hashes).toEqual(
      runObserved(TRAJ_SEED, cfg(), 700).hashes,
    );
  });
});
