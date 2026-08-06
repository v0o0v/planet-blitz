/**
 * AC-13 후단(위력)의 **적용 범위** 잠금 — ADR-0041 개정(2026-07-31).
 *
 * ## 왜 이 파일이 따로 있는가
 * `tests/activeSkills.test.ts:84` 의 AC-13 단조성은 `activeCooldownTicks`·`activePowerCenti` 를
 * **직접** 부른다. 순수 함수로서는 옳지만 **그 반환값이 sim 에 도달하는지는 보지 않는다** —
 * 실측(2026-07-31 조사, `.omc/research/existing-defects-active-power-loadout-clamp-2026-07-31.md`)
 * 으로 확증했다: `powerCentiOf` 의 소비를 통째로 끊어도 5,334개 중 `denoFixture` 1건만 실패하고
 * AC-13 은 42종 전원 통과한다. 즉 **위력이 실제로 도달하는지는 어떤 의미 단언도 지키지 않았다.**
 *
 * 그래서 여기서는 **관측량**으로 잰다. 그리고 도달 범위가 42종이 아니므로 양성·음성을 함께 둔다:
 *
 *   · 양성 A — strike 14종: 투자가 늘면 관측량이 **달라진다**(`coeff.damage` 가 centi 를 지난다).
 *   · 양성 B — buff 3종: 만료 훅의 폭발/회복만 투자에 반응한다. **조건을 세워야 드러난다.**
 *   · 음성   — 나머지 25종: 투자를 부어도 관측량이 **바이트 불변**이다(ADR-0041 개정의 명문).
 *
 * ## 쿨다운 축과 섞이지 않게 하는 방법
 * 투자량은 sim 안에서 딱 두 곳에만 도달한다 — `src/sim/actives.ts:182`(쿨다운)와
 * `src/sim/activeTypes.ts:78` `powerCentiOf`(위력). 그래서 **한 번만 발동**시키면(재발동 없음)
 * 쿨다운 차이가 관측에 들어올 길이 없고, 남는 차이는 전부 위력 축이다.
 *
 * ## ⚠️ 투자를 `skillInvest` 로 주입하지 마라 — `activeTune0` 로 주입한다 (ADR-0049)
 * 예전 판은 축 40점을 **그 축의 첫 칸**(`v[start]`)에 몰아넣었다. 구 트리에서는 액티브가
 * 계열 **합**만 읽으므로 "어느 칸이든 같다"가 성립해 무해했지만, ADR-0049 의 flat 재편 후
 * `v[start]` 는 **각 축의 머리 노드**(flat 0·10·20 = SQ1·ME1·CU1 / PO1·DR1·FI1 …)라
 * **실제 스킬이 켜진다.** 그 노드가 관측량(탄수·탄피해·적HP합·플레이어HP·좌표)에 닿는 순간
 * 음성 25종과 양성 strike 14종이 **동시에** 거짓 실패한다.
 *
 * 그래서 `skillInvest` 는 **전 칸 0 으로 고정**하고 투자량을 슬롯 조율 정수로 넣는다.
 * 두 경로가 같은 합(`investedInTree(skillInvest, def) + tuneSlotOf(state, def)`)을 읽는 것이
 * 이 치환의 근거다 — 쿨다운은 `actives.ts:182`, 위력은 `activeTypes.ts:79` 가 **한 줄씩**
 * 그 합을 만든다(`activeSkills.test.ts:307` 이 "투자 + 조율 합산이 유일한 입력"을 못 박았다).
 * `tune` 만 올리면 **스킬은 한 칸도 안 켜지고 액티브 축만 움직인다.**
 *
 * ⚠️ 발동 자체는 게이트를 안 본다 — `stepActives` 는 `config.activeSlots` 에 실린 wire 를
 * 그대로 부르고 `activeGateThreshold` 는 장착 경로(UI)에서만 쓰인다. 그래서 `skillInvest`
 * 가 전부 0 이어도 42종이 정상 발동한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG, SPECIAL_ACTIVE_SLOT1 } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { ALL_ACTIVES, activeGateThreshold, wireIdOf } from '../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../data/ships/actives/types.js';
import { zeroSkillInvest } from '../data/ships/index.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
const FIRE: InputFrame = { ...IDLE, special: SPECIAL_ACTIVE_SLOT1 };

/** 발동 틱. 이 시점 이후로는 다시 누르지 않는다(쿨다운 축 차단). */
const FIRE_TICK = 30;
/** 관측 창. `coeff.ticks` 최댓값 300 보다 넉넉히 길어 만료 훅까지 창 안에 든다. */
const WINDOW_TICKS = 900;
/** 저·고 투자 간격. */
const INVEST_DELTA = 40;

/**
 * 위력이 **만료 훅에만** 도달하는 3종(ADR-0041 개정 §"위력의 적용 범위").
 * 지속·무적·충전·흡수량은 이 3종에서도 투자 불변이다.
 */
const EXPIRE_ONLY_IDS: readonly string[] = [
  'as_striker_survival_hi', // coeff.heal
  'as_bruiser_fortify_hi', // coeff.blastDamage
  'as_bubble_film_hi', // coeff.blastDamage
];

/**
 * 액티브 축에만 `invested` 점을 넣은 월드.
 *
 * `skillInvest` 는 **전 칸 0** 이고(스킬 노드는 한 개도 안 켜진다) 투자량은 슬롯 0 의 조율
 * 정수로 들어간다. 파일 헤더 §"투자를 `skillInvest` 로 주입하지 마라" 참조.
 */
function worldFor(def: ActiveSkillDef, invested: number): WorldState {
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    shipType: def.shipTypeId,
    skillInvest: zeroSkillInvest(def.shipTypeId),
    activeSlots: [wireIdOf(def.id), -1],
  };
  const s = createWorld(0xc001d, cfg);
  // 슬롯 0 에만 장착했으므로 `tuneSlotOf` 가 읽는 칸은 `activeTune0` 다.
  s.activeTune0 = invested;
  return s;
}

/** 한 틱의 관측량 — 투사체 수·피해 합 · 적 HP 합 · 플레이어 HP·좌표 · 버프 잔여 틱. */
function observe(s: WorldState): string {
  let bulletCount = 0;
  let bulletDamage = 0;
  let enemyHp = 0;
  let playerHp = 0;
  let px = 0;
  let py = 0;
  for (const e of s.entities) {
    if (e.dead) continue;
    if (e.kind === 'bullet') {
      bulletCount++;
      bulletDamage += e.damage;
    } else if (e.kind === 'enemy' || e.kind === 'boss') {
      enemyHp += e.hp;
    } else if (e.kind === 'player') {
      playerHp = e.hp;
      px = e.x;
      py = e.y;
    }
  }
  return `${bulletCount}|${bulletDamage}|${enemyHp}|${playerHp}|${px}|${py}|${s.activeBuff0}`;
}

/** 1회 발동 후 관측량 시계열. */
function trace(def: ActiveSkillDef, invested: number): string[] {
  const s = worldFor(def, invested);
  const out: string[] = [];
  for (let t = 0; t < WINDOW_TICKS; t++) {
    stepWorld(s, t === FIRE_TICK ? FIRE : IDLE);
    out.push(observe(s));
  }
  return out;
}

/** 두 투자 수준의 시계열이 처음 갈리는 틱. 끝까지 같으면 -1. */
function firstDivergence(def: ActiveSkillDef): number {
  const gate = activeGateThreshold(def);
  const lo = trace(def, gate);
  const hi = trace(def, gate + INVEST_DELTA);
  for (let i = 0; i < lo.length; i++) if (lo[i] !== hi[i]) return i;
  return -1;
}

const STRIKES = ALL_ACTIVES.filter((d) => d.kind === 'strike');
const EXPIRE_ONLY = ALL_ACTIVES.filter((d) => EXPIRE_ONLY_IDS.includes(d.id));
const UNSCALED = ALL_ACTIVES.filter((d) => d.kind !== 'strike' && !EXPIRE_ONLY_IDS.includes(d.id));

describe('AC-13 위력 적용 범위 — 전제 (분류가 카탈로그와 어긋나면 나머지 단언이 무의미하다)', () => {
  it('42종이 strike 14 · 만료 한정 3 · 불변 25 로 정확히 갈린다', () => {
    expect(ALL_ACTIVES.length).toBe(42);
    expect(STRIKES.length).toBe(14);
    expect(EXPIRE_ONLY.length).toBe(EXPIRE_ONLY_IDS.length);
    expect(UNSCALED.length).toBe(25);
    // 만료 한정 3종은 전부 buff 다(strike 로 새면 양성 A 와 이중 계산이 된다).
    for (const d of EXPIRE_ONLY) expect(d.kind, d.id).toBe('buff');
  });

  /**
   * 하네스 자체의 전제. ADR-0049 의 flat 재편 후 `skillInvest` 에 한 점이라도 넣으면 그것은
   * **실제 스킬 노드**라, 이 파일의 음성 25종이 "스킬이 관측량을 움직였다"는 이유로 거짓
   * 실패한다. 투자 주입이 다시 `skillInvest` 로 돌아가면 여기서 먼저 빨개진다.
   */
  it('하네스는 스킬 노드를 한 칸도 켜지 않는다 — 투자는 조율 정수로만 들어간다', () => {
    const def = ALL_ACTIVES[0];
    expect(def).toBeDefined();
    if (def === undefined) return;
    const s = worldFor(def, activeGateThreshold(def) + INVEST_DELTA);
    const invest = s.config.skillInvest ?? [];
    expect(invest.length, 'skillInvest 가 비어 있으면 이 단언이 항진이다').toBeGreaterThan(0);
    expect(
      invest.every((n) => n === 0),
      `skillInvest 에 투자가 실렸다 — 음성 25종이 거짓 실패한다: [${invest.join(',')}]`,
    ).toBe(true);
    // 그리고 투자량은 실제로 액티브 축에 도착해 있어야 한다(죽은 계측기 방지).
    expect(s.activeTune0).toBe(activeGateThreshold(def) + INVEST_DELTA);
  });
});

describe('AC-13 양성 A — strike 14종은 투자가 관측량에 도달한다', () => {
  it.each(STRIKES.map((d) => [d.id, d] as const))('%s — 발동 틱에 갈린다', (_id, def) => {
    // 피해가 `scaleCenti` 를 지나므로 발동 그 틱에 즉시 갈려야 한다.
    expect(firstDivergence(def), `${def.id} 투자 증가가 관측량을 못 움직였다`).toBe(FIRE_TICK);
  });
});

describe('AC-13 음성 — 나머지 25종은 투자에 불변이다 (ADR-0041 개정의 명문)', () => {
  it.each(UNSCALED.map((d) => [d.id, d] as const))('%s — 900틱 전 구간 동일', (_id, def) => {
    // ⚠️ 이 단언이 깨지면 "결함이 고쳐졌다"는 뜻일 수도 있다. 그때는 ADR-0041 개정문과
    // 이 파일을 함께 고쳐야지, 이 테스트만 완화하면 안 된다.
    expect(firstDivergence(def), `${def.id} 이동/지속 축이 투자에 반응했다`).toBe(-1);
  });
});

/**
 * 만료 한정 3종을 **조건을 세워** 잰다.
 *
 * ⚠️ 조건을 안 세우면 셋 다 "불변"으로 관측된다 — 회복은 만피라 `Math.min(maxHp, …)` 에 먹히고,
 * 폭발은 반경 안에 적이 없다. 그래서 만료 직전 틱에 플레이어 HP 를 깎고 표적을 옆에 세운다.
 * (이 사실을 모르고 음성 케이스에 넣으면 거짓 음성이 된다 — 조사 기록 §1.2.)
 */
function expireOutcome(def: ActiveSkillDef, invested: number): { playerHp: number; targetHp: number } {
  const s = worldFor(def, invested);
  for (let t = 0; t < FIRE_TICK; t++) stepWorld(s, IDLE);
  stepWorld(s, FIRE);
  for (let t = 0; t < WINDOW_TICKS; t++) {
    if (s.activeBuff0 === 1) break; // 다음 틱이 만료 틱.
    stepWorld(s, IDLE);
  }
  const player = s.entities.find((e) => e.kind === 'player');
  const target = s.entities.find((e) => e.kind === 'enemy' && !e.dead);
  expect(player, `${def.id} 플레이어 부재`).toBeDefined();
  expect(target, `${def.id} 만료 시점에 표적이 없다 — 관측 조건 미성립`).toBeDefined();
  if (player === undefined || target === undefined) return { playerHp: 0, targetHp: 0 };
  player.hp = 10; // 회복이 상한에 먹히지 않게.
  target.x = player.x + 40; // 폭발 반경 안으로.
  target.y = player.y;
  target.hp = 100_000; // 한 방에 죽지 않게(피해량을 잔여 HP 로 읽는다).
  stepWorld(s, IDLE); // 만료 틱.
  return { playerHp: player.hp, targetHp: target.hp };
}

describe('AC-13 양성 B — 만료 한정 3종은 만료 훅의 피해·회복만 투자에 반응한다', () => {
  it.each(EXPIRE_ONLY.map((d) => [d.id, d] as const))('%s — 고투자가 엄격히 강하다', (_id, def) => {
    const gate = activeGateThreshold(def);
    const lo = expireOutcome(def, gate);
    const hi = expireOutcome(def, gate + INVEST_DELTA);
    // 회복은 더 많이 차고(플레이어 HP ↑), 폭발은 더 아프다(표적 HP ↓). 스킬마다 축이 하나뿐이라
    // 두 델타의 합으로 "엄격히 강함"을 한 줄로 단언한다.
    const gain = hi.playerHp - lo.playerHp + (lo.targetHp - hi.targetHp);
    expect(gain, `${def.id} 만료 훅이 투자에 반응하지 않았다`).toBeGreaterThan(0);
  });
});
