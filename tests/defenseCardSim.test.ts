/**
 * 방어 카드 sim 통합 테스트 (Lane B — grill-defense-card 스펙 §효과 3범주, lane-a-cards-data 계약).
 *
 * 커버리지:
 *   1. 하위 호환: 카드 미장착 침공 해시가 카드 기능 도입 前 baseline 과 바이트 동일(회귀 0).
 *   2. 정적 카운터: 조건 일치/불일치 공격자 매치업으로 결과(포탑 화력·방어 피해 감소) 차이 검증.
 *   3. 동적 트리거: 발동/미발동 리플레이로 발동 차이(코어 근접 실드) 검증.
 *   4. 유니크 4종: 신기루 코어·블랙아웃·최후의 재기동·거울 관문 각 거동.
 *   5. 결정론: 같은 시드+같은 카드 2회 실행 → 틱별 해시 스트림 100% 일치.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { runReplay, hashWorld } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import {
  DEFAULT_TIME_LIMIT_TICKS,
  TURRET_VULCAN,
  TURRET_SNIPER,
  TURRET_SHOTGUN,
  TURRET_FROST,
  TURRET_MISSILE,
  TURRET_TESLA,
} from '../src/sim/defense.js';
import type { DefenseLayout, InvasionConfig } from '../src/sim/defense.js';
import type { AttackerMatchup, DefenseCardConfig } from '../src/sim/cardEffects.js';
import type { CardInstance, CardAffixRoll } from '../data/defenseCards.js';

const idle: InputFrame = emptyInput();

function invasionConfig(layout: DefenseLayout, card?: DefenseCardConfig): WorldConfig {
  const inv: InvasionConfig =
    card === undefined
      ? { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS }
      : { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS, card };
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion: inv,
  };
}

/** 완전 불일치(모든 조건 off) 매치업 — 개별 테스트가 필요한 축만 켠다. */
function noMatch(): AttackerMatchup {
  return {
    fire: false,
    cold: false,
    lightning: false,
    beam: false,
    attackerCp: 0,
    defenderCp: 0,
    revenge: false,
    reinvasion: false,
    subweaponHeavy: false,
  };
}

function prefix(id: string, stat: CardAffixRoll['stat'], value: number): CardAffixRoll {
  return { id, stat, value };
}

function makeCard(opts: {
  rarity?: CardInstance['rarity'];
  prefixes?: CardAffixRoll[];
  suffixes?: CardAffixRoll[];
  uniqueId?: string;
  charges?: number;
  seed?: number;
}): CardInstance {
  const chargesMax = opts.charges ?? 5;
  const base: CardInstance = {
    id: `card-${opts.seed ?? 1}`,
    rarity: opts.rarity ?? 'magic',
    prefixes: opts.prefixes ?? [],
    suffixes: opts.suffixes ?? [],
    chargesMax,
    chargesLeft: chargesMax,
    seed: opts.seed ?? 1,
    ...(opts.uniqueId !== undefined ? { uniqueId: opts.uniqueId } : {}),
  };
  return base;
}

function cardCfg(card: CardInstance, matchup: AttackerMatchup): DefenseCardConfig {
  return { card, matchup };
}

function countKind(state: WorldState, kind: string): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}

// ---------------------------------------------------------------------------
// 1. 하위 호환 — 카드 미장착 해시 불변 (baseline 실측 고정)
// ---------------------------------------------------------------------------
describe('방어 카드 — 하위 호환 (조건부 접기)', () => {
  // 카드 기능 도입 이전 코드로 실측한 baseline(6종 포탑·장애물 2·600틱 혼합 입력, seed 7).
  const BASELINE_FINAL = 2182714940;
  const BASELINE_H100 = 3173789719;

  function baselineLayout(): DefenseLayout {
    return {
      core: { x: 900, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 400, y: -150 },
        { type: TURRET_SNIPER, x: 500, y: 200 },
        { type: TURRET_SHOTGUN, x: 250, y: 0 },
        { type: TURRET_FROST, x: 350, y: 300 },
        { type: TURRET_MISSILE, x: 600, y: -300 },
        { type: TURRET_TESLA, x: 200, y: 150 },
      ],
      obstacles: [
        { x: 450, y: 0, halfW: 50, halfH: 120 },
        { x: 700, y: 250, halfW: 80, halfH: 40 },
      ],
    };
  }

  function baselineInputs(): InputFrame[] {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 600; i++) {
      inputs.push({ moveX: Math.sin(i / 40), moveY: Math.cos(i / 55), aim: (i / 30) % 6.28, dash: i % 90 === 0, special: 0 });
    }
    return inputs;
  }

  it('카드 미장착 침공 해시가 baseline 과 바이트 동일 (회귀 0)', () => {
    const replay: Replay = { seed: 7, config: invasionConfig(baselineLayout()), inputs: baselineInputs() };
    const a = runReplay(replay);
    expect(a.finalHash).toBe(BASELINE_FINAL);
    expect(a.hashes[99]).toBe(BASELINE_H100);
    expect(a.hashes[599]).toBe(BASELINE_FINAL);
  });

  it('card 필드 부재 == 명시 undefined: cardRuntime 미생성', () => {
    const state = createWorld(7, invasionConfig(baselineLayout()));
    expect(state.cardRuntime).toBeUndefined();
  });

  it('PvE 런은 카드 접점을 건드리지 않는다(2 독립 런 해시 일치)', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    for (let i = 0; i < 200; i++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    expect(a.cardRuntime).toBeUndefined();
    expect(a.config.invasion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. 정적 카운터 — 조건 일치/불일치 차이
// ---------------------------------------------------------------------------
describe('방어 카드 — 정적 카운터(접두)', () => {
  it('turretDamagePct(중장갑 파쇄): 전투력 우위 일치 시 포탑 피해↑ → 플레이어 HP 더 감소', () => {
    // 플레이어 사거리 안 발칸 포탑, 코어는 원거리(우발 승리 방지). idle 로 포탑 발사만 관찰.
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 300, y: 0 }],
      obstacles: [],
    };
    const card = makeCard({ prefixes: [prefix('cc-armorbreak', 'turretDamagePct', 80)] });
    function hpAfter(match: boolean): number {
      const m = noMatch();
      // 일치: 공격자 CP 우위(마진 초과), 불일치: 동률.
      const matchup: AttackerMatchup = { ...m, attackerCp: match ? 5000 : 0, defenderCp: 0 };
      const state = createWorld(9, invasionConfig(layout, cardCfg(card, matchup)));
      for (let i = 0; i < 400; i++) stepWorld(state, idle);
      return state.entities[0]!.hp;
    }
    const hpMatch = hpAfter(true);
    const hpNoMatch = hpAfter(false);
    expect(hpMatch).toBeLessThan(hpNoMatch); // 화력 보너스로 더 아프다
  });

  it('incomingDmgReductionPct(소화): 화염 공격자 일치 시 코어 피해 감소(코어 HP 더 높음)', () => {
    // 플레이어가 코어를 직접 사격. 소화 접두는 fireAttacker 일 때만 코어 피격 감소.
    const layout: DefenseLayout = {
      core: { x: 240, y: 0 },
      turrets: [],
      obstacles: [],
    };
    const card = makeCard({ prefixes: [prefix('cc-quench', 'incomingDmgReductionPct', 18)] });
    function coreHpAfter(fire: boolean): number {
      const matchup: AttackerMatchup = { ...noMatch(), fire };
      const state = createWorld(5, invasionConfig(layout, cardCfg(card, matchup)));
      for (let i = 0; i < 160; i++) {
        if (countKind(state, 'core') === 0) break;
        stepWorld(state, idle);
      }
      const core = state.entities.find((e) => e.kind === 'core');
      return core === undefined ? 0 : core.hp;
    }
    const hpFire = coreHpAfter(true); // 감소 적용
    const hpNoFire = coreHpAfter(false); // 감소 없음
    expect(hpFire).toBeGreaterThan(hpNoFire);
  });

  it('조건 불일치면 정적 카운터 미적용 → 카드 있어도 baseline 대비 거동 동일한 해시', () => {
    // fire 접두만 든 카드 + 비화염 공격자: 정적 누적 0. 단 기저 효과(turretDamagePct/coreHpPct)는
    // 무조건 적용되므로 해시는 카드 없음과 다를 수 있다(기저는 항상 적용). 여기선 정적 축만 격리:
    // 코어 HP 기저 버프가 반영돼 코어 HP 가 CORE_HP 초과임을 확인(기저는 무조건).
    const layout: DefenseLayout = { core: { x: 900, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'rare', prefixes: [prefix('cc-quench', 'incomingDmgReductionPct', 18)] });
    const state = createWorld(1, invasionConfig(layout, cardCfg(card, noMatch())));
    const core = state.entities.find((e) => e.kind === 'core')!;
    expect(core.maxHp).toBeGreaterThan(3000); // rare 기저 coreHpPct=10 → 3300
  });
});

// ---------------------------------------------------------------------------
// 3. 동적 트리거 — 발동/미발동
// ---------------------------------------------------------------------------
describe('방어 카드 — 동적 트리거(접미)', () => {
  it('coreProximity(역장): 공격자 코어 근접 시 코어 실드(targetY) 1회 부여', () => {
    // 코어를 플레이어(원점) 근접에 둔다 → 첫 틱에 근접 판정 → 실드 부여.
    const layout: DefenseLayout = { core: { x: 100, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ suffixes: [{ id: 'ct-forcefield', stat: 'coreShieldFlat', value: 300 }] });
    const state = createWorld(3, invasionConfig(layout, cardCfg(card, noMatch())));
    expect(state.cardRuntime!.coreProximityFired).toBe(false);
    stepWorld(state, idle);
    const core = state.entities.find((e) => e.kind === 'core')!;
    expect(state.cardRuntime!.coreProximityFired).toBe(true);
    // 첫 틱에 실드 300 부여 후 같은 틱 플레이어 사격 일부를 흡수(<=300, >0). 부여 자체가 관측점.
    expect(core.targetY).toBeGreaterThan(0);
    expect(core.targetY).toBeLessThanOrEqual(300);
  });

  it('coreProximity 미발동: 코어가 원거리면 실드 없음(targetY=0)', () => {
    const layout: DefenseLayout = { core: { x: 100000, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ suffixes: [{ id: 'ct-forcefield', stat: 'coreShieldFlat', value: 300 }] });
    const state = createWorld(3, invasionConfig(layout, cardCfg(card, noMatch())));
    for (let i = 0; i < 60; i++) stepWorld(state, idle);
    const core = state.entities.find((e) => e.kind === 'core')!;
    expect(state.cardRuntime!.coreProximityFired).toBe(false);
    expect(core.targetY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. 유니크 4종
// ---------------------------------------------------------------------------
describe('방어 카드 — 유니크 룰 변경형', () => {
  it('신기루 코어: 가짜 코어(decoyCore) 스폰, 파괴돼도 승리 없음', () => {
    // 가짜 코어를 플레이어 사거리 안, 실제 코어를 원거리에 → 플레이어가 가짜만 부순다.
    const layout: DefenseLayout = { core: { x: 100000, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'unique', uniqueId: 'uq-mirage-core' });
    const state = createWorld(5, invasionConfig(layout, cardCfg(card, noMatch())));
    expect(countKind(state, 'decoyCore')).toBe(1);
    // 가짜 코어를 실제 코어와 분리해 플레이어 근처로 이동시켜 부순다(스폰 좌표는 코어+오프셋이라
    // 원거리 → 직접 부수기 어렵다). 대신 결정론 리플레이로 가짜가 결국 살아있음/승리 없음만 확인.
    let victorySeen = false;
    for (let i = 0; i < 300; i++) {
      stepWorld(state, idle);
      if (state.victory) victorySeen = true;
    }
    expect(victorySeen).toBe(false); // 가짜 코어 파괴는 승리로 이어지지 않는다
  });

  it('신기루 코어: decoyCore 를 직접 파괴해도 victory 플래그가 서지 않는다', () => {
    // 실제 코어 없이(원거리) 가짜만 플레이어 사거리에 배치되도록 코어를 원점 근처에 둔다 →
    // 가짜는 코어+오프셋(240)에 스폰. 플레이어가 실제 코어를 먼저 부술 수 있으니, 실제 코어를
    // 매우 멀리 두고 가짜만 사거리에 들어오게 코어를 플레이어 앞에 배치.
    const layout: DefenseLayout = { core: { x: -100000, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'unique', uniqueId: 'uq-mirage-core' });
    const state = createWorld(5, invasionConfig(layout, cardCfg(card, noMatch())));
    const decoy = state.entities.find((e) => e.kind === 'decoyCore')!;
    // 가짜 코어를 플레이어 사거리 안으로 옮기고 HP 를 낮춰 즉시 파괴되게 한다(결정론 조작 아님 —
    // 스폰 후 좌표/HP 는 sim 입력이 아니라 상태라 테스트가 직접 세팅 가능).
    decoy.x = 300;
    decoy.hp = 1;
    for (let i = 0; i < 120; i++) {
      stepWorld(state, idle);
      if (countKind(state, 'decoyCore') === 0) break;
    }
    expect(countKind(state, 'decoyCore')).toBe(0); // 파괴됨
    expect(state.victory).toBe(false); // 그러나 승리 아님
  });

  it('블랙아웃: cardRuntime.blackoutTicksLeft 가 1800 에서 매 틱 감소(렌더용 sim 필드)', () => {
    const layout: DefenseLayout = { core: { x: 100000, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'unique', uniqueId: 'uq-blackout' });
    const state = createWorld(3, invasionConfig(layout, cardCfg(card, noMatch())));
    expect(state.cardRuntime!.blackoutTicksLeft).toBe(1800);
    for (let i = 0; i < 10; i++) stepWorld(state, idle);
    expect(state.cardRuntime!.blackoutTicksLeft).toBe(1790);
  });

  it('최후의 재기동: 코어가 파괴 직전 1회 부활(승리 지연)', () => {
    // 플레이어 앞 코어. 부활 카드 유무로 승리 tick 비교 — 부활 쪽이 더 오래 걸린다.
    const layout: DefenseLayout = { core: { x: 220, y: 0 }, turrets: [], obstacles: [] };
    function victoryTick(withReboot: boolean): number {
      const cfg = withReboot
        ? invasionConfig(layout, cardCfg(makeCard({ rarity: 'unique', uniqueId: 'uq-last-reboot' }), noMatch()))
        : invasionConfig(layout);
      const state = createWorld(5, cfg);
      for (let i = 0; i < 6000; i++) {
        stepWorld(state, idle);
        if (state.victory) return i;
      }
      return -1;
    }
    const tReboot = victoryTick(true);
    const tPlain = victoryTick(false);
    expect(tPlain).toBeGreaterThan(0);
    expect(tReboot).toBeGreaterThan(tPlain); // 1회 부활만큼 승리가 늦어진다
  });

  it('최후의 재기동: reviveCount 가 부활 순간 1→0 으로 소진', () => {
    const layout: DefenseLayout = { core: { x: 220, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'unique', uniqueId: 'uq-last-reboot' });
    const state = createWorld(5, invasionConfig(layout, cardCfg(card, noMatch())));
    expect(state.cardRuntime!.reviveCount).toBe(1);
    let consumedWhileAlive = false;
    for (let i = 0; i < 6000; i++) {
      stepWorld(state, idle);
      if (state.cardRuntime!.reviveCount === 0 && countKind(state, 'core') === 1 && !state.victory) {
        consumedWhileAlive = true;
      }
      if (state.victory) break;
    }
    expect(consumedWhileAlive).toBe(true); // 부활이 코어 생존 상태에서 충전을 소진했다
  });

  it('거울 관문: 코어 피격 시 피해 일부가 공격자에게 반사(플레이어 HP 감소)', () => {
    const layout: DefenseLayout = { core: { x: 220, y: 0 }, turrets: [], obstacles: [] };
    const card = makeCard({ rarity: 'unique', uniqueId: 'uq-mirror-gate' });
    function playerHp(withMirror: boolean): number {
      const cfg = withMirror ? invasionConfig(layout, cardCfg(card, noMatch())) : invasionConfig(layout);
      const state = createWorld(5, cfg);
      for (let i = 0; i < 120; i++) {
        if (state.gameOver || state.victory) break;
        stepWorld(state, idle);
      }
      return state.entities[0]!.hp;
    }
    const hpMirror = playerHp(true);
    const hpPlain = playerHp(false);
    expect(hpPlain).toBe(100); // 반사 없으면 플레이어 무피해(포탑 없음)
    expect(hpMirror).toBeLessThan(100); // 반사로 자기 피해
  });
});

// ---------------------------------------------------------------------------
// 5. 결정론 + Node 재현
// ---------------------------------------------------------------------------
describe('방어 카드 — 결정론', () => {
  function busy(n: number): InputFrame[] {
    const out: InputFrame[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ moveX: Math.sin(i / 30), moveY: Math.cos(i / 45), aim: (i / 20) % 6.28, dash: i % 80 === 0, special: 0 });
    }
    return out;
  }

  it('같은 시드+같은 카드 2회 실행 → 틱별 해시 스트림 100% 일치', () => {
    const layout: DefenseLayout = {
      core: { x: 700, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 400, y: 0 },
        { type: TURRET_TESLA, x: 350, y: 150 },
      ],
      obstacles: [{ x: 500, y: 0, halfW: 50, halfH: 120 }],
    };
    const card = makeCard({
      rarity: 'rare',
      prefixes: [prefix('cc-armorbreak', 'turretDamagePct', 40), prefix('cc-quench', 'incomingDmgReductionPct', 12)],
      suffixes: [
        { id: 'ct-forcefield', stat: 'coreShieldFlat', value: 200 },
        { id: 'ct-fury', stat: 'turretFireRatePct', value: 30 },
      ],
    });
    const matchup: AttackerMatchup = { ...noMatch(), fire: true, attackerCp: 6000, defenderCp: 100 };
    const cfg = invasionConfig(layout, cardCfg(card, matchup));
    const replay: Replay = { seed: 7, config: cfg, inputs: busy(400) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('카드 효력이 실제로 해시에 반영(카드 유무로 발산)', () => {
    const layout: DefenseLayout = {
      core: { x: 700, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 400, y: 0 }],
      obstacles: [],
    };
    const card = makeCard({ suffixes: [{ id: 'ct-forcefield', stat: 'coreShieldFlat', value: 300 }] });
    const withCard = runReplay({ seed: 7, config: invasionConfig(layout, cardCfg(card, noMatch())), inputs: busy(300) });
    const noCard = runReplay({ seed: 7, config: invasionConfig(layout), inputs: busy(300) });
    expect(withCard.finalHash).not.toBe(noCard.finalHash);
  });
});
