/**
 * 의뢰 **주문 4종의 sim 축** 테스트 (계획 §Phase D).
 *
 * 이 파일이 지는 축:
 *  - **무의뢰 런 무연산** — 신규 경로가 하나도 진입하지 않는다(최상위 하드 게이트의 기제).
 *  - **정예 소집령**(ADR-0043) — 잡몹 0 · 젬 0 · 겹침이 *직전 정예 생존 시에만* 추가된다.
 *  - **제약 계약** — 금지 계열이 3택 풀 **진입 자체**를 못 한다(가중 총합 불변).
 *  - **현상금 표적** — 도주가 `endCommissionSegment('escaped')` 로 떨어지고, **표적은 살아 있다.**
 *  - **의뢰 보스 배치** — 주문이 보스를 고르고 `enemyType` 이 의뢰 공간으로 태깅된다.
 *
 * ## ⚠️ per-tick 해시 **바이트** 불변의 정본은 여기가 아니다
 * 무의뢰 런의 바이트 불변은 이 변경 **이전**에 녹화된 두 골든이 진다 —
 * `tests/shipHashBaseline.test.ts`(12런 × 6,000틱, `tests/fixtures/striker-prem8.json`)와
 * `tests/encounterHashInvariance.test.ts`(PvE 12런 × 1,800틱 + 침공 3런 × 900틱,
 * `tests/fixtures/encounter-baseline.json`). 둘 다 같은 스위트에서 돌고 `tests/fixtures/` 는
 * diff 0 이다. **이 파일이 지는 것은 그 불변이 성립하는 *기제*** — 신규 술어가 전부 거짓이고
 * 신규 상태가 끝까지 0 이라는 것 — 이다. 골든을 여기서 복제하면 실행 시간만 늘고 커버리지는
 * 0 이 늘어난다.
 *
 * ## 이 파일의 단언 규율
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 주석으로 적는다. 이 저장소는
 * AC 전부 초록인 채 결함이 통과한 전례가 많다. 그리고 **목록을 순회하는 검증은 목록 변경에
 * 원리적으로 눈이 먼다** — 카탈로그를 돌며 단언하지 않고 독립 전사본을 여기 둔다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  endCommissionSegment,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import { advanceCommissionSegment } from '../src/sim/commissionSegment.js';
import { bossDefFor } from '../src/sim/boss.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { drawPowerupChoices, POWERUPS } from '../src/sim/powerups.js';
import { isElite } from '../src/sim/elite.js';
import {
  bountyEscaped,
  bountyIgnites,
  decideEliteDeploy,
  decodeBountyIgnition,
  encodeBountyIgnition,
} from '../src/sim/commissionOrders.js';
import type { CommissionOrder, CommissionRunConfig } from '../src/run/commission.js';
import {
  COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS,
  COMMISSION_ELITE_OVERLAP_DELAY_TICKS,
  COMMISSION_ELITE_OVERLAP_MIN,
  COMMISSION_ELITE_OVERLAP_MAX,
  COMMISSION_ELITE_REGROUP_TICKS,
  COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
} from '../src/run/commissionConstants.js';
import { COMMISSION_BOSS_ENEMY_TYPE_BASE, commissionBossDef } from '../data/commissionBosses.js';
import { planetContent } from '../data/planets/index.js';
import { SEGMENTS } from '../data/waves.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { RARITY_CODE } from '../src/items/types.js';
import type { Item } from '../src/items/types.js';
import { M2_UNIQUES } from '../data/uniques.js';

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------

const TWO = [
  { planet: 0, stage: 1 },
  { planet: 0, stage: 1 },
];

function cfg(
  order: CommissionOrder,
  segmentIndex = 0,
  extra: Partial<CommissionRunConfig> = {},
  worldExtra: Partial<WorldConfig> = {},
): WorldConfig {
  const seg = TWO[segmentIndex] ?? TWO[0];
  const commission: CommissionRunConfig = {
    commissionId: '00000000-0000-4000-8000-0000000000d0',
    order,
    grade: 2,
    segments: [...TWO],
    replayBudgetTicks: 27000,
    segmentIndex,
    ...extra,
  };
  return {
    ...DEFAULT_CONFIG,
    planet: seg?.planet ?? 0,
    stage: seg?.stage ?? 1,
    planetMode: planetContent(seg?.planet ?? 0).mode,
    commission,
    ...worldExtra,
  };
}

const plainCfg = (): WorldConfig => ({ ...DEFAULT_CONFIG });

function run(w: WorldState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(w, emptyInput());
}

const countKind = (w: WorldState, kind: Entity['kind']): number =>
  w.entities.filter((e) => e.kind === kind).length;

const countAliveElites = (w: WorldState): number =>
  w.entities.filter((e) => e.kind === 'enemy' && !e.dead && isElite(e)).length;

const countTrash = (w: WorldState): number =>
  w.entities.filter((e) => e.kind === 'enemy' && !isElite(e)).length;

/** 보스 세그먼트로 점프시켜 이번 틱에 보스를 세운다(스폰 경로를 실제로 태운다). */
function spawnBoss(w: WorldState): Entity {
  w.wave.segmentIndex = SEGMENTS.length - 1;
  w.wave.segmentElapsed = 0;
  stepWorld(w, emptyInput());
  const b = w.entities.find((e) => e.kind === 'boss');
  if (b === undefined) throw new Error('보스가 스폰되지 않았다 — 이 헬퍼가 무의미하다');
  return b;
}

// ---------------------------------------------------------------------------
// (a) 무의뢰 런 — 신규 경로가 하나도 진입하지 않는다
// ---------------------------------------------------------------------------

describe('(a) 무의뢰 런 무연산 — 바이트 불변이 성립하는 기제', () => {
  it('정예 스포너가 한 번도 돌지 않는다 (겹침 시계 두 정수가 끝까지 0)', () => {
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: **스포너가 돌긴 하는데 아무것도 안 뱉는 것.**
    // 그래서 "정예가 없다"가 아니라 **시계 상태가 안 움직였다**를 단언한다 — 시계는 투입
    // 여부와 무관하게 `stepEliteSummons` 진입 즉시 갱신되므로 진입 자체를 잡는다.
    const w = createWorld(0x51ee, plainCfg());
    run(w, 400);
    expect(w.wave.eliteAlivePrev).toBe(0);
    expect(w.wave.eliteNextTick).toBe(0);
  });

  it('대조군: 정예 소집령에서는 그 시계가 실제로 움직인다 (위 단언이 항진이 아니다)', () => {
    const w = createWorld(0x51ee, cfg('elite'));
    run(w, 400);
    expect(w.wave.eliteNextTick).toBeGreaterThan(0);
  });

  it('젬이 정상적으로 떨어진다 (젬 억제가 무의뢰 런으로 새지 않는다)', () => {
    const w = createWorld(0x51ee, plainCfg());
    run(w, 900);
    // 무입력 런이라 플레이어는 제자리에서 자동 사격만 한다 — 그래도 잡몹이 죽어 젬이 남는다.
    expect(w.gems + countKind(w, 'gem')).toBeGreaterThan(0);
  });

  it('보스 `enemyType` 이 행성 인덱스 그대로다 (의뢰 태깅이 새지 않는다)', () => {
    const w = createWorld(0x51ee, { ...DEFAULT_CONFIG, planet: 1 });
    expect(spawnBoss(w).enemyType).toBe(1);
  });

  it('제약 없는 의뢰 런의 3택 풀이 무의뢰 런과 **같은 시퀀스**다 (가중 총합 불변)', () => {
    // 제약 필터가 pool 진입이 아니라 사후 제거로 구현되면 `weights` 총합이 바뀌어 이 단언이
    // 깨진다. ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 필터가 아예 배선되지 않은 것 — 아래
    // 제약 계약 블록이 그쪽을 잡는다(둘이 한 쌍이다).
    const a = createWorld(0x777, plainCfg());
    const b = createWorld(0x777, cfg('constraint'));
    for (let i = 0; i < 8; i++) {
      expect(drawPowerupChoices(b, 3)).toEqual(drawPowerupChoices(a, 3));
    }
  });
});

// ---------------------------------------------------------------------------
// (d)(e) 정예 소집령 — ADR-0043
// ---------------------------------------------------------------------------

describe('(d) 정예 소집령 — 잡몹 0 · 젬 0', () => {
  it('잡몹이 한 마리도 나오지 않는다 (대조군은 나온다)', () => {
    const w = createWorld(0x1234, cfg('elite'));
    let trashSeen = 0;
    for (let i = 0; i < 900; i++) {
      stepWorld(w, emptyInput());
      trashSeen += countTrash(w);
    }
    expect(trashSeen).toBe(0);

    const plain = createWorld(0x1234, plainCfg());
    run(plain, 900);
    // 대조군이 0 이면 위 단언은 "적이 원래 안 나온다"를 재확인한 항진이다.
    expect(countTrash(plain), '대조군에 잡몹이 없다 — 위 단언이 항진이다').toBeGreaterThan(0);
  });

  it('젬이 하나도 남지 않는다 (바닥 젬 · 수거 카운터 둘 다)', () => {
    const w = createWorld(0x1234, cfg('elite'));
    let gemsSeen = 0;
    for (let i = 0; i < 900; i++) {
      stepWorld(w, emptyInput());
      gemsSeen += countKind(w, 'gem');
    }
    expect(gemsSeen).toBe(0);
    expect(w.gems).toBe(0);
    // 젬 0 → 레벨업 0 의 인과가 실제로 성립하는가. **별도 3택 차단이 있는지가 아니라**
    // 성장 자체가 안 일어났는지를 본다(진실이 하나인지의 검사).
    expect(w.xpTotal).toBe(0);
    expect(w.level).toBe(1);
    expect(w.pendingLevelUp).toBe(false);
  });

  it('젬을 막아도 **드랍 롤 RNG 는 계속 소비된다** (전리품 스트림이 밀리지 않는다)', () => {
    // ⚠️ 이것이 이 블록에서 가장 놓치기 쉬운 축이다. 젬을 막겠다고 `compact()` 의 드랍 판정을
    // 건너뛰면 `dropRng` 가 안 돌아 같은 시드의 전리품이 통째로 갈리는데, **화면엔 아무 증상도
    // 없다.** 정예를 죽여 판정을 태우고 스트림이 실제로 전진했는지 본다.
    const w = createWorld(0x1234, cfg('elite'));
    run(w, 5); // 첫 정예 투입
    const victim = w.entities.find((e) => e.kind === 'enemy' && isElite(e));
    expect(victim, '정예가 투입되지 않았다 — 이 테스트가 무의미하다').toBeDefined();
    if (victim === undefined) return;
    victim.hp = 0;
    victim.dead = true;
    const before = w.dropRng.getState();
    stepWorld(w, emptyInput());
    expect(w.dropRng.getState(), 'dropRng 가 멈췄다 — 드랍 스트림이 밀린다').not.toBe(before);
    expect(countKind(w, 'gem')).toBe(0);
    expect(w.kills).toBe(1); // 처치 집계는 그대로다(경제 축은 안 건드린다).
  });

  it('행성에 `elites` 정의가 없어도(카르곤) 정예가 내려온다 — 폴백이 없으면 빈 런이 된다', () => {
    expect(planetContent(0).elites.length, '카르곤에 elites 가 생겼다 — 이 테스트의 전제 갱신 필요').toBe(0);
    const w = createWorld(0x1234, cfg('elite'));
    run(w, 5);
    expect(countAliveElites(w)).toBeGreaterThan(0);
  });

  it('`elites` 정의가 있는 행성(베르단)에서도 내려온다', () => {
    expect(planetContent(1).elites.length).toBeGreaterThan(0);
    const w = createWorld(0x1234, cfg('elite', 0, {}, { planet: 1, planetMode: planetContent(1).mode }));
    run(w, 5);
    expect(countAliveElites(w)).toBeGreaterThan(0);
  });
});

describe('(e) 정예 겹침 — 직전 정예가 **살아 있을 때만** 추가된다 (고정 타이머가 아니다)', () => {
  const S0 = { alivePrev: 0, nextTick: 0, cap: COMMISSION_ELITE_OVERLAP_MIN };

  it('첫 정예는 즉시 투입된다', () => {
    const d = decideEliteDeploy(0, 0, S0);
    expect(d.deploy).toBe(true);
    expect(d.nextTick).toBe(COMMISSION_ELITE_OVERLAP_DELAY_TICKS);
  });

  it('직전 정예가 살아 있으면 간격 뒤에 겹침이 추가된다', () => {
    const d = decideEliteDeploy(COMMISSION_ELITE_OVERLAP_DELAY_TICKS, 1, {
      alivePrev: 1,
      nextTick: COMMISSION_ELITE_OVERLAP_DELAY_TICKS,
      cap: COMMISSION_ELITE_OVERLAP_MIN,
    });
    expect(d.deploy).toBe(true);
  });

  it('겹침 상한은 **하한에서 시작해 못 치우는 동안 오르고**, 절대 상한에서 멈춘다 (ADR-0043 압박 누적)', () => {
    // ⚠️ 예전 구현은 `OVERLAP_MIN` 을 **상한**으로 써서 겹침이 2기에 영구 고정됐다. 그러면
    //    "처치가 늦으면 빽빽해진다"가 성립하지 않아, 잡몹 소거로 사라진 런 길이 캡의 대체물이
    //    없어진다. 아래가 그 회귀를 막는 단언이다.
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 상한이 **무한정** 오르는 것. 그래서 절대 상한에서
    //    멈추는 것까지 같은 루프에서 잰다.
    let st = { alivePrev: 0, nextTick: 0, cap: COMMISSION_ELITE_OVERLAP_MIN };
    let alive = 0;
    let maxCap = st.cap;
    for (let t = 0; t < 20_000; t += COMMISSION_ELITE_OVERLAP_DELAY_TICKS) {
      const d = decideEliteDeploy(t, alive, st);
      if (d.deploy) alive++; // 아무도 안 죽는 최악 시나리오(화력 부족 빌드)
      st = { alivePrev: d.alivePrev, nextTick: d.nextTick, cap: d.cap };
      if (d.cap > maxCap) maxCap = d.cap;
      expect(d.cap, `tick ${t} 에 상한이 절대 상한을 넘었다`).toBeLessThanOrEqual(
        COMMISSION_ELITE_OVERLAP_MAX,
      );
    }
    expect(maxCap, '상한이 한 번도 안 올랐다 — 압박 누적이 없다').toBe(COMMISSION_ELITE_OVERLAP_MAX);
    expect(alive, '겹침이 절대 상한까지 실제로 쌓이지 않았다').toBe(COMMISSION_ELITE_OVERLAP_MAX);
  });

  it('절대 상한에 닿으면 시계가 흘러도 **더 나오지 않는다** (고정 주기 타이머면 계속 나온다)', () => {
    // ⚠️ 이것이 ADR-0043 의 A안(고정 간격 타이머) 기각을 지키는 단언이다. 구현이 시계만 보고
    // 뱉으면 여기서 `deploy === true` 가 되어 실패한다.
    for (let t = 0; t < 4000; t += 137) {
      const d = decideEliteDeploy(t, COMMISSION_ELITE_OVERLAP_MAX, {
        alivePrev: COMMISSION_ELITE_OVERLAP_MAX,
        nextTick: 0,
        cap: COMMISSION_ELITE_OVERLAP_MAX,
      });
      expect(d.deploy, `tick ${t}`).toBe(false);
    }
  });

  it('전멸하면 시계가 **처치 이후 경과 틱**으로 다시 잡히고 상한도 하한으로 되돌아간다', () => {
    const killed = decideEliteDeploy(1000, 0, {
      alivePrev: 1,
      nextTick: 900,
      cap: COMMISSION_ELITE_OVERLAP_MAX,
    });
    expect(killed.deploy).toBe(false);
    expect(killed.nextTick).toBe(1000 + COMMISSION_ELITE_REGROUP_TICKS);
    // 압박 해제 — 빠르게 치우면 누적된 겹침을 다시 안 본다.
    expect(killed.cap).toBe(COMMISSION_ELITE_OVERLAP_MIN);
    // 재집결 지연 도중에는 계속 안 나온다.
    expect(decideEliteDeploy(1000 + COMMISSION_ELITE_REGROUP_TICKS - 1, 0, {
      alivePrev: 0,
      nextTick: killed.nextTick,
      cap: killed.cap,
    }).deploy).toBe(false);
    // 지연이 끝나면 나온다.
    expect(decideEliteDeploy(1000 + COMMISSION_ELITE_REGROUP_TICKS, 0, {
      alivePrev: 0,
      nextTick: killed.nextTick,
      cap: killed.cap,
    }).deploy).toBe(true);
  });

  it('전멸 상태가 이어져도 시계를 **다시 잡지 않는다** (매 틱 다시 잡으면 정예가 영영 안 나온다)', () => {
    const d = decideEliteDeploy(1001, 0, {
      alivePrev: 0,
      nextTick: 1240,
      cap: COMMISSION_ELITE_OVERLAP_MIN,
    });
    expect(d.nextTick).toBe(1240);
  });

  it('통합: 3,000틱 동안 겹침이 절대 상한을 **한 번도 넘지 않고**, 하한에는 실제로 도달한다', () => {
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 정예가 **한 기도 안 나오는 것**(그러면 상한을
    // 넘을 리가 없다). 그래서 최댓값이 최소한 하한에 **도달**했음을 함께 단언한다.
    const w = createWorld(0x99, cfg('elite'));
    let maxAlive = 0;
    for (let i = 0; i < 3000; i++) {
      stepWorld(w, emptyInput());
      const alive = countAliveElites(w);
      expect(alive, `tick ${i} 에 정예가 절대 상한을 넘었다`).toBeLessThanOrEqual(
        COMMISSION_ELITE_OVERLAP_MAX,
      );
      if (alive > maxAlive) maxAlive = alive;
    }
    expect(maxAlive).toBeGreaterThanOrEqual(COMMISSION_ELITE_OVERLAP_MIN);
  });
});

describe('정예 겹침 시계는 **구간마다 리셋**된다 (승계 참조에 얹으면 2구간이 텅 빈다)', () => {
  it('2구간 월드의 시계가 0 에서 시작하고 정예가 실제로 내려온다', () => {
    // ⚠️ 이 축이 계약 초안과의 의도적 차이 지점이다(`WaveRuntime` 주석). 시계를
    // `CommissionRuntime` 에 얹으면 `commissionCarry` 가 그 객체를 **참조째** 승계하므로
    // `eliteNextTick` 이 1구간 말의 큰 값(여기선 1,000+)으로 넘어오고, `state.tick` 은 0 으로
    // 돌아가 **2구간 내내 정예가 한 기도 안 나온다.** 해시는 안 갈린다.
    const prev = createWorld(0x77, cfg('elite', 0));
    // ⚠️ **길이도 임계도 상수에서 파생시킨다.** 여기 "1,200틱 돌리고 시계 > 600" 을 손으로
    //    적어 뒀더니 2026-08-03 밴드 복구 레인이 겹침 축을 조이는 순간(DELAY 150 → 25 ·
    //    MAX 6 → 32) 두 군데가 동시에 깨졌다: ①시계 값이 550 이 되어 임계 미달 ②입력 없는
    //    파일럿이 1,200틱을 못 버티고 527틱에 죽어 `advanceCommissionSegment` 가 항등 반환.
    //    계약은 멀쩡했고 픽스처만 옛 상수를 들고 있었다(밸런스 큐 §R10·§R20 과 같은 형태).
    //    이 테스트에 필요한 것은 "시계가 여러 번 전진했고 런이 살아 있다"뿐이다.
    run(prev, COMMISSION_ELITE_OVERLAP_DELAY_TICKS * 8);
    expect(prev.gameOver, '1구간에서 죽었다 — 전환을 재는 이 테스트가 성립하지 않는다').toBe(false);
    expect(prev.wave.eliteNextTick, '1구간 시계가 안 움직였다 — 이 테스트가 무의미하다').toBeGreaterThan(
      COMMISSION_ELITE_OVERLAP_DELAY_TICKS * 4,
    );
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    expect(next).not.toBe(prev);
    expect(next.wave.eliteNextTick).toBe(0);
    expect(next.wave.eliteAlivePrev).toBe(0);
    run(next, 5);
    expect(countAliveElites(next), '2구간에 정예가 하나도 안 내려왔다').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 제약 계약 — 성장축 · 장비축
// ---------------------------------------------------------------------------

describe('제약 계약 — 위반이 원천 불가능한 두 축만 쓴다', () => {
  it('금지 계열은 3택 후보에 **한 번도** 오르지 않는다', () => {
    // 독립 전사본: 카탈로그를 순회해 뽑지 않는다(목록이 바뀌어도 이 테스트는 같은 것을 잰다).
    const BANNED = [1, 2, 3]; // 증설 포신 · 고폭탄 · 관통탄 — 셋 다 `universal` 이라 항상 후보다.
    for (const i of BANNED) {
      expect(POWERUPS[i], `POWERUPS[${i}] 가 사라졌다 — 전사본 갱신 필요`).toBeDefined();
      expect(POWERUPS[i]?.universal, `POWERUPS[${i}] 가 더는 universal 이 아니다`).toBe(true);
    }
    const w = createWorld(0x2222, cfg('constraint', 0, { constraints: { bannedPowerupLines: BANNED } }));
    for (let k = 0; k < 60; k++) {
      for (const idx of drawPowerupChoices(w, 4)) {
        expect(BANNED).not.toContain(idx);
      }
    }
    // 대조군: 제약이 없으면 그 셋이 실제로 뽑힌다(위 단언이 항진이 아니다).
    const free = createWorld(0x2222, cfg('constraint'));
    const seen = new Set<number>();
    for (let k = 0; k < 60; k++) for (const idx of drawPowerupChoices(free, 4)) seen.add(idx);
    expect(BANNED.some((i) => seen.has(i)), '대조군에서도 안 뽑힌다 — 위 단언이 항진이다').toBe(true);
  });

  it('장비축: 봉인 슬롯·희귀도 상한·금지 유니크가 **출격 조립에서** 빠진다 (sim 감시기가 아니다)', () => {
    // 관측 축을 **어픽스 합이 아니라 구조 필드**로 잡는다: `loadout.weaponType` 은 main 아이템의
    // `weaponType` 이 그대로 오고, `uniqueMask` 는 유니크 bit 이 OR 된다. 어픽스 합으로 재면
    // "어픽스가 0 인 아이템을 빼도 loadout 이 안 변해서" 단언이 거짓 통과한다(실제로 그렇게
    // 한 번 통과했다 — 이 주석이 그 재발 방어다).
    const profile = defaultProfile();
    const ship = activeShip(profile);
    const RAILGUN = 2;
    const PHASE_ARMOR = M2_UNIQUES.find((u) => u.id === 'phase-armor');
    expect(PHASE_ARMOR, '위상 장갑 유니크가 사라졌다 — 이 테스트의 전제 갱신 필요').toBeDefined();
    if (PHASE_ARMOR === undefined) return;

    ship.equipped.main = {
      id: 'i-main',
      slot: 'main',
      rarity: 'rare',
      affixes: [],
      weaponType: RAILGUN,
      source: { planet: 0, stage: 1 },
    } satisfies Item;
    ship.equipped.armor = {
      id: 'i-armor',
      slot: 'armor',
      rarity: 'unique',
      affixes: [],
      uniqueId: PHASE_ARMOR.id,
      source: { planet: 0, stage: 1 },
    } satisfies Item;

    const base = { planet: 0, stage: 1 } as const;
    const commissionOf = (
      equipRules: NonNullable<CommissionRunConfig['constraints']>['equipRules'],
    ): CommissionRunConfig => ({
      commissionId: '00000000-0000-4000-8000-0000000000d1',
      order: 'constraint',
      grade: 2,
      segments: [...TWO],
      replayBudgetTicks: 27000,
      segmentIndex: 0,
      constraints: equipRules === undefined ? {} : { equipRules },
    });
    const armorBit = 1 << PHASE_ARMOR.bit;
    /** `WorldConfig.loadout` 은 optional 이다 — 부재면 이 테스트가 잴 것이 없으므로 던진다. */
    const lo = (c: WorldConfig): NonNullable<WorldConfig['loadout']> => {
      if (c.loadout === undefined) throw new Error('loadout 이 스탬프되지 않았다');
      return c.loadout;
    };

    // 대조군 — 제약이 없으면 둘 다 실제로 실린다(아래 단언들이 항진이 아니다).
    const free = buildRunConfig(profile, { ...base, commission: commissionOf(undefined) });
    expect(lo(free).weaponType, '레일건 main 이 안 읽혔다 — 대조군이 무의미하다').toBe(RAILGUN);
    expect(lo(free).uniqueMask & armorBit).not.toBe(0);

    const bannedSlot = buildRunConfig(profile, {
      ...base,
      commission: commissionOf({ bannedSlots: ['main'] }),
    });
    expect(lo(bannedSlot).weaponType).not.toBe(RAILGUN);
    expect(lo(bannedSlot).uniqueMask & armorBit, 'main 봉인이 armor 까지 지웠다').not.toBe(0);

    const cappedRarity = buildRunConfig(profile, {
      ...base,
      commission: commissionOf({ maxRarity: RARITY_CODE.normal }),
    });
    expect(lo(cappedRarity).weaponType).not.toBe(RAILGUN);
    expect(lo(cappedRarity).uniqueMask & armorBit).toBe(0);

    const bannedUnique = buildRunConfig(profile, {
      ...base,
      commission: commissionOf({ bannedUniqueIds: [PHASE_ARMOR.bit] }),
    });
    expect(lo(bannedUnique).uniqueMask & armorBit).toBe(0);
    expect(lo(bannedUnique).weaponType, '유니크 봉인이 main 까지 지웠다').toBe(RAILGUN);
  });

  it('의뢰 런에 예비역 소집을 실으면 던진다 (장비축 제약 우회 차단)', () => {
    const profile = defaultProfile();
    expect(() =>
      buildRunConfig(profile, {
        planet: 0,
        stage: 1,
        commission: {
          commissionId: '00000000-0000-4000-8000-0000000000d2',
          order: 'constraint',
          grade: 2,
          segments: [...TWO],
          replayBudgetTicks: 27000,
          segmentIndex: 0,
        },
        pilot: { equipped: [], skillInvest: [], typeId: 0, performanceCP: 10000, activeSlots: [null, null] },
      }),
    ).toThrow(/예비역 소집/);
  });
});

// ---------------------------------------------------------------------------
// (b)(c) 현상금 표적 — 도주
// ---------------------------------------------------------------------------

describe('현상금 표적 — 도주 점화', () => {
  const bounty = (rule: 'hpThreshold' | 'surviveTicks', segmentIndex = 0): WorldConfig =>
    cfg('bounty', segmentIndex, { bounty: { targetKind: 2, escapeRule: rule } });

  it('`surviveTicks` 는 표적 등장 틱에 점화한다', () => {
    const w = createWorld(0x31, bounty('surviveTicks'));
    const b = spawnBoss(w);
    expect(b.aux1).not.toBe(0);
    expect(decodeBountyIgnition(b.aux1)).toBe(w.tick - 1); // 스폰 틱 = 이 stepWorld 의 tick
  });

  it('`hpThreshold` 는 HP 가 임계 아래로 떨어지기 전에는 점화하지 않는다', () => {
    const w = createWorld(0x31, bounty('hpThreshold'));
    const b = spawnBoss(w);
    b.hp = b.maxHp; // 만피로 되돌린다
    stepWorld(w, emptyInput());
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 배선이 통째로 없어 aux1 이 영영 0 인 것.
    // 바로 아래 케이스가 그쪽을 잡는다(둘이 한 쌍이다).
    expect(b.aux1).toBe(0);
  });

  it('`hpThreshold` 는 임계 아래로 떨어진 그 틱에 점화하고, 이후 시각이 고정된다', () => {
    const w = createWorld(0x31, bounty('hpThreshold'));
    const b = spawnBoss(w);
    b.hp = 1;
    stepWorld(w, emptyInput());
    const ignition = decodeBountyIgnition(b.aux1);
    expect(ignition).toBeGreaterThanOrEqual(0);
    b.hp = b.maxHp; // 회복해도 점화 시각은 안 움직인다(한 번 켜지면 끝)
    stepWorld(w, emptyInput());
    expect(decodeBountyIgnition(b.aux1)).toBe(ignition);
  });

  it('무의뢰 런·타 주문 런의 보스 `aux1` 은 끝까지 0 이다', () => {
    for (const c of [plainCfg(), cfg('chain'), cfg('elite')]) {
      const w = createWorld(0x31, c);
      const b = spawnBoss(w);
      b.hp = 1;
      stepWorld(w, emptyInput());
      expect(b.aux1).toBe(0);
    }
  });

  it('순수 함수: 점화 인코딩이 0 센티넬과 충돌하지 않는다 (0틱 점화 ≠ 미점화)', () => {
    expect(decodeBountyIgnition(0)).toBe(-1);
    expect(decodeBountyIgnition(encodeBountyIgnition(0))).toBe(0);
    expect(bountyEscaped(-1, 999999)).toBe(false);
    expect(bountyEscaped(0, COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS - 1)).toBe(false);
    expect(bountyEscaped(0, COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS)).toBe(true);
  });

  it('순수 함수: HP 점화 판정이 센티-퍼센트 정수 비교다(부동소수 환산이 아니다)', () => {
    const e = { hp: 0, maxHp: 10000 } as Entity;
    e.hp = 2001;
    expect(bountyIgnites(e, 'hpThreshold')).toBe(false);
    e.hp = 2000;
    expect(bountyIgnites(e, 'hpThreshold')).toBe(true);
    e.hp = 0;
    expect(bountyIgnites(e, 'surviveTicks')).toBe(true);
  });
});

describe('(b)(c) 현상금 표적 — 도주 성립의 3분기', () => {
  const bounty = (segmentIndex: number): WorldConfig =>
    cfg('bounty', segmentIndex, { bounty: { targetKind: 2, escapeRule: 'surviveTicks' } });

  /**
   * 표적을 세우고 **틱 0 에 점화한 것으로** 표시한 뒤 시계를 도주 임계까지 감는다.
   * 다음 `stepWorld` 에서 도주가 성립한다.
   *
   * ⚠️ 점화 시각을 `w.tick - SURVIVE` 로 잡으면 아직 그만큼 안 흐른 월드에서 **음수 틱**이
   * 되어 `bountyEscaped` 의 미점화 가드(`< 0`)에 걸린다 — 그러면 이 테스트가 "도주가 안
   * 일어난다"를 조용히 통과시킨다. 그래서 시계를 앞으로 감는다(뒤로 밀지 않는다).
   */
  function armEscape(w: WorldState, elapsed = COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS): Entity {
    const b = spawnBoss(w);
    b.hp = 1e9; // 도주 전에 처치되면 `cleared` 로 떨어져 이 테스트가 무의미해진다
    b.maxHp = 1e9;
    b.aux1 = encodeBountyIgnition(0);
    w.tick = elapsed;
    return b;
  }

  it('(c) 중간 구간 도주 → `segmentDone = 1`, victory/gameOver 는 서지 않는다', () => {
    const w = createWorld(0x41, bounty(0));
    const b = armEscape(w);
    stepWorld(w, emptyInput());
    expect(w.commissionRuntime?.segmentDone).toBe(1);
    expect(w.victory).toBe(false);
    expect(w.gameOver).toBe(false);
    // ⚠️ 핵심: 표적을 **죽여서** 도주를 표현하면 `compact()` 의 보스 사망 분기가
    // `endCommissionSegment('cleared')` 를 불러 **의뢰 실패가 성공(확정 유니크 지급)으로
    // 뒤집힌다.** 도주는 표적을 살려 둔 채 구간만 끝낸다.
    expect(b.dead).toBe(false);
    expect(b.hp).toBeGreaterThan(0);
  });

  it('(b) 마지막 구간 도주 → **gameOver = true · victory = false** (의뢰 실패)', () => {
    const w = createWorld(0x41, bounty(1));
    const b = armEscape(w);
    stepWorld(w, emptyInput());
    expect(w.gameOver).toBe(true);
    expect(w.victory).toBe(false);
    expect(w.commissionRuntime?.segmentDone).toBe(0);
    expect(b.dead).toBe(false);
  });

  it('도주 성립 전에는 아무 일도 없다 (한 틱 일찍 끝나지 않는다)', () => {
    const w = createWorld(0x41, bounty(1));
    armEscape(w, COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS - 1);
    stepWorld(w, emptyInput());
    expect(w.gameOver).toBe(false);
    expect(w.commissionRuntime?.segmentDone).toBe(0);
  });

  it('멱등: 도주가 성립한 뒤 더 진행해도 구간 신호가 두 번 서지 않는다', () => {
    const w = createWorld(0x41, bounty(0));
    armEscape(w);
    stepWorld(w, emptyInput());
    expect(w.commissionRuntime?.segmentDone).toBe(1);
    run(w, 5);
    expect(w.commissionRuntime?.segmentDone).toBe(1);
    expect(w.gameOver).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (E) 의뢰 보스 배치 + maxSegments
// ---------------------------------------------------------------------------

describe('의뢰 보스 — 주문이 보스를 고른다', () => {
  // 독립 전사본: `commissionBossIndex` 를 호출해 대조하면 그 함수의 오류를 절대 못 잡는다.
  const EXPECTED: ReadonlyArray<readonly [CommissionOrder, number]> = [
    ['chain', 0],
    ['constraint', 0],
    ['elite', 1],
    ['bounty', 2],
  ];

  for (const [order, index] of EXPECTED) {
    it(`${order} → 의뢰 보스 카탈로그 ${index} (enemyType = base + ${index})`, () => {
      const w = createWorld(0x61, cfg(order));
      const b = spawnBoss(w);
      expect(b.enemyType).toBe(COMMISSION_BOSS_ENEMY_TYPE_BASE + index);
      // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: `enemyType` 만 태깅되고 **체급은 행성 보스**인 것.
      // hp/radius 가 행성 보스와 다른지도 함께 본다.
      const planetBoss = planetContent(0).boss;
      expect(b.radius).not.toBe(planetBoss.radius);
    });
  }

  it('무의뢰 런은 행성 보스 그대로다 (의뢰 공간 아래)', () => {
    const w = createWorld(0x61, plainCfg());
    const b = spawnBoss(w);
    expect(b.enemyType).toBeLessThan(COMMISSION_BOSS_ENEMY_TYPE_BASE);
    expect(b.radius).toBe(planetContent(0).boss.radius);
  });
});

describe('의뢰 런의 `maxSegments`', () => {
  const base = { planet: 0, stage: 1 } as const;
  const cm: CommissionRunConfig = {
    commissionId: '00000000-0000-4000-8000-0000000000d3',
    order: 'chain',
    grade: 2,
    segments: [...TWO],
    replayBudgetTicks: 27000,
    segmentIndex: 0,
  };

  it('의뢰 런은 구간당 웨이브 세그먼트 상한이 실린다 (없으면 구간 틱 상한을 구조적으로 넘는다)', () => {
    expect(buildRunConfig(defaultProfile(), { ...base, commission: cm }).maxSegments).toBe(
      COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
    );
  });

  it('호출자가 명시로 준 값이 우선한다 (하네스·튜토리얼 단축판)', () => {
    expect(
      buildRunConfig(defaultProfile(), { ...base, commission: cm, maxSegments: 1 }).maxSegments,
    ).toBe(1);
  });

  it('무의뢰 런은 필드 자체가 실리지 않는다 (config 직렬화 바이트 불변)', () => {
    expect('maxSegments' in buildRunConfig(defaultProfile(), base)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 회귀 게이트 — 초록인 채로 통과하던 결함들
// ---------------------------------------------------------------------------

describe('회귀: 의뢰 보스 정의가 **매 틱에도** 적용된다 (스폰만 갈리면 패턴이 행성 보스 것이 된다)', () => {
  it('의뢰 런의 `bossDefFor` 가 주문 보스를 돌려준다 — 행성이 무엇이든', () => {
    // ⚠️ 결함 형상: 스폰(`world.ts`)만 의뢰 보스로 갈리고 `updateBoss` 는 계속
    //    `planetContent(config.planet).boss` 를 읽던 상태. 그러면 hp·radius·contactDamage 만
    //    의뢰 것이고 **3페이즈 패턴과 moveSpeed 는 전부 행성 보스 것**이 된다 — 화면엔 의뢰
    //    보스 모델이 뜨는데 싸우는 패턴이 그 행성 보스이고 예외·로그가 0 이다.
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 의뢰 보스와 행성 보스가 **우연히 같은 정의**인 것.
    //    그래서 행성을 바꿔 가며 재고, 행성 보스 정의와 **다르다**를 함께 단언한다.
    for (const planet of [0, 1, 2, 3, 4, 5]) {
      const w = createWorld(0x5b05, cfg('bounty', 0, {}, { planet, stage: 1 }));
      const def = bossDefFor(w);
      expect(def, `planet ${planet}`).toBe(commissionBossDef('bounty'));
      expect(def, `planet ${planet} 에서 행성 보스와 구분되지 않는다`).not.toBe(
        planetContent(planet).boss,
      );
    }
  });

  it('무의뢰 런은 행성 보스 그대로다 (회귀 0)', () => {
    for (const planet of [0, 1, 2, 3, 4, 5]) {
      const w = createWorld(0x5b05, { ...DEFAULT_CONFIG, planet, stage: 1 });
      expect(bossDefFor(w), `planet ${planet}`).toBe(planetContent(planet).boss);
    }
  });

  it('스폰된 보스의 실제 페이즈 정의가 의뢰 보스 것이다 (배선 증명 — 정의 조회가 아니라 런)', () => {
    // 단위로 `bossDefFor` 만 재면 두 호출자 중 하나가 여전히 옛 표현식이어도 통과한다.
    // 실제 런에서 보스를 세우고, 그 보스의 과열/패턴 시계가 **의뢰 정의의 값**으로 초기화됐는지 본다.
    const w = createWorld(0x5b06, cfg('elite'));
    const boss = spawnBoss(w);
    expect(boss.enemyType).toBe(COMMISSION_BOSS_ENEMY_TYPE_BASE + 1);
    const def = commissionBossDef('elite');
    const planetDef = planetContent(w.config.planet).boss;
    expect(def.moveSpeed, '이 테스트가 의미를 가지려면 두 정의의 이동속도가 달라야 한다').not.toBe(
      planetDef.moveSpeed,
    );
    // 보스를 몇 틱 굴려 이동 산술이 실제로 의뢰 정의를 쓰는지 본다(정지 상태면 구분이 안 된다).
    const x0 = boss.x;
    const y0 = boss.y;
    run(w, 30);
    expect(Math.abs(boss.x - x0) + Math.abs(boss.y - y0), '보스가 전혀 안 움직였다').toBeGreaterThan(0);
  });
});

describe('회귀: 같은 틱 도주+처치 경합에서 실패가 성공으로 뒤집히지 않는다', () => {
  it('`gameOver` 가 선 뒤의 `cleared` 는 `victory` 를 세우지 못한다', () => {
    // ⚠️ 결함 형상: 도주는 `stepBoss` 안에서(= resolveCollisions/compact 보다 **먼저**) 성립하는데
    //    같은 틱에 표적이 hp 0 이 되면 `compact()` 가 `'cleared'` 로 다시 불러 gameOver 위에
    //    victory 를 덧씌운다 → 의뢰 실패가 확정 유니크 지급 경로로 간다(ADR-0044 위조 가치 최고).
    const w = createWorld(0x5b07, cfg('bounty', 1)); // 마지막 구간
    endCommissionSegment(w, 'escaped');
    expect(w.gameOver).toBe(true);
    expect(w.victory).toBe(false);
    endCommissionSegment(w, 'cleared'); // 같은 틱의 뒤늦은 처치
    expect(w.victory, '실패가 성공으로 뒤집혔다').toBe(false);
    expect(w.gameOver).toBe(true);
  });

  it('반대 순서도 대칭이다 — 승리 뒤의 도주가 `gameOver` 를 세우지 못한다', () => {
    const w = createWorld(0x5b08, cfg('bounty', 1));
    endCommissionSegment(w, 'cleared');
    expect(w.victory).toBe(true);
    endCommissionSegment(w, 'escaped');
    expect(w.gameOver, '성공이 실패로 뒤집혔다').toBe(false);
  });

  it('대조군: 아무것도 안 선 상태에서는 두 분기가 정상 동작한다 (위가 항진이 아니다)', () => {
    const a = createWorld(0x5b09, cfg('bounty', 1));
    endCommissionSegment(a, 'escaped');
    expect(a.gameOver).toBe(true);
    const b = createWorld(0x5b09, cfg('bounty', 1));
    endCommissionSegment(b, 'cleared');
    expect(b.victory).toBe(true);
  });
});

describe('회귀: 현상금 의뢰에 `bounty` 블록이 없으면 조립에서 던진다', () => {
  const base = { planet: 0, stage: 1 } as const;
  const bountyCm = (bounty?: CommissionRunConfig['bounty']): CommissionRunConfig => ({
    commissionId: '00000000-0000-4000-8000-0000000000d4',
    order: 'bounty',
    grade: 2,
    segments: [...TWO],
    replayBudgetTicks: 27000,
    segmentIndex: 0,
    ...(bounty === undefined ? {} : { bounty }),
  });

  it('블록이 없으면 던진다 (없으면 도주 기제가 통째로 사라져 **항상 성공하는 의뢰**가 된다)', () => {
    expect(() =>
      buildRunConfig(defaultProfile(), { ...base, commission: bountyCm() }),
    ).toThrow(/bounty/);
  });

  it('대조군: 블록이 있으면 통과한다 (위 단언이 "현상금이면 무조건 던진다"가 아니다)', () => {
    expect(() =>
      buildRunConfig(defaultProfile(), {
        ...base,
        commission: bountyCm({ targetKind: 2, escapeRule: 'hpThreshold' }),
      }),
    ).not.toThrow();
  });

  it('대조군: 다른 주문은 `bounty` 없이도 통과한다', () => {
    expect(() =>
      buildRunConfig(defaultProfile(), {
        ...base,
        commission: { ...bountyCm(), order: 'chain' },
      }),
    ).not.toThrow();
  });
});
