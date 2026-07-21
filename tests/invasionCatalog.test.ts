/**
 * 침공 3레이어 — 임시 카탈로그 레지스트리 + 기본 수비대 자동 충원 (M7a · L9-garrison-catalog).
 *
 * 커버리지:
 *   1. catalogId 가 종류별로 0부터 연속이고 i18n 식별자가 전역 유일하다.
 *   2. 배열 인덱스 append-only 골든 스냅샷(중간 삽입·재정렬을 즉시 잡는다).
 *   3. 기본 수비대 충원이 결정론적이다(같은 배치 → 같은 결과, 호출해도 원본 불변).
 *   4. 충원이 layers 직렬화·해시를 오염시키지 않는다(빈 슬롯과 '기본 수비대 명시 배치'가
 *      같은 해시가 되면 안 된다 — 그러면 위조 대조가 두 상태를 구분하지 못한다).
 *   5. **빈 배치 100% 기본 수비대로 런이 끝까지 돈다**(무저항 기지 방지의 최종 관문).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createWorld, stepWorld, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  emptyInvasionLayers,
  normalizeInvasionLayers,
  layersEqual,
} from '../src/sim/invasion/normalize.js';
import {
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
} from '../src/sim/invasion/constants.js';
import {
  invasionStepHooks,
  registerInvasionStepHooks,
  resetInvasionStepHooks,
} from '../src/sim/invasion/step.js';
import type {
  InvasionPhase,
  InvasionRuntime,
  InvasionStepContext,
  InvasionStepHooks,
} from '../src/sim/invasion/types.js';
import {
  CATALOG_BOSS,
  CATALOG_FACILITY,
  CATALOG_FORMATION,
  CATALOG_KIND_COUNT,
  CATALOG_KIND_COUNTS,
  CATALOG_MAP,
  CATALOG_PROP,
  DEF3_MESSAGE_KEYS,
  INVASION_CATALOG,
  INVASION_CATALOG_COUNT,
  catalogEntriesOfKind,
  catalogEntry,
  catalogI18nId,
  catalogSlug,
  def3DescKey,
  def3NameKey,
} from '../data/invasion/catalog.js';
import {
  GARRISON_FACILITY_CATALOG_ID,
  GARRISON_FORMATION_CATALOG_ID,
  garrisonFillCount,
  garrisonLayers,
  garrisonRef,
  withGarrison,
} from '../data/invasion/garrison.js';
import { FORMATIONS } from '../data/invasion/formations.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { L3_PROPS } from '../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../data/invasion/defenseBosses.js';
import { INVASION_MAP_TEMPLATES } from '../data/invasion/mapTemplates.js';
import { EN, KO } from '../src/i18n/catalog.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

// ---------------------------------------------------------------------------
// ① 레지스트리 규율
// ---------------------------------------------------------------------------

describe('침공 카탈로그 — 인덱스 계약', () => {
  it('종류별 catalogId 는 0부터 연속이고 등록 순서와 같다', () => {
    for (let kind = 0; kind < CATALOG_KIND_COUNT; kind++) {
      const entries = catalogEntriesOfKind(kind);
      expect(entries.length).toBe(CATALOG_KIND_COUNTS[kind]);
      entries.forEach((e, i) => {
        expect(e.catalogId).toBe(i);
        expect(e.kind).toBe(kind);
      });
    }
  });

  it('총수 = 종류별 등록 수의 합', () => {
    const sum = CATALOG_KIND_COUNTS.reduce((a, b) => a + b, 0);
    expect(INVASION_CATALOG_COUNT).toBe(sum);
    expect(INVASION_CATALOG.length).toBe(sum);
  });

  it('i18n 식별자는 전역 유일(종류가 달라도 겹치지 않는다)', () => {
    const ids = new Set(INVASION_CATALOG.map((e) => e.i18nId));
    expect(ids.size).toBe(INVASION_CATALOG.length);
  });

  it('catalogEntry 는 종류+catalogId 로 정확히 찾고 범위 밖은 undefined', () => {
    const first = INVASION_CATALOG[0]!;
    expect(catalogEntry(first.kind, first.catalogId)).toBe(first);
    expect(catalogEntry(CATALOG_FORMATION, 999)).toBeUndefined();
    expect(catalogEntry(CATALOG_KIND_COUNT, 0)).toBeUndefined();
  });

  it('catalogSlug 는 원본 접두(`fac.` / `formation-`)를 한 번만 벗긴다', () => {
    expect(catalogSlug(CATALOG_FACILITY, 'fac.rapid')).toBe('rapid');
    expect(catalogSlug(CATALOG_FORMATION, 'formation-assault')).toBe('assault');
    expect(catalogSlug(CATALOG_PROP, 'shieldGenerator')).toBe('shieldGenerator');
    expect(catalogI18nId(CATALOG_BOSS, 'steelGoliath')).toBe('boss.steelGoliath');
    expect(catalogI18nId(CATALOG_MAP, 'map.choke')).toBe('map.choke');
  });

  it('i18n 키는 def3.<식별자>.name / .desc 형태다', () => {
    expect(def3NameKey('fac.rapid')).toBe('def3.fac.rapid.name');
    expect(def3DescKey('fac.rapid')).toBe('def3.fac.rapid.desc');
    expect(DEF3_MESSAGE_KEYS.length).toBe(INVASION_CATALOG.length * 2);
  });

  /**
   * 골든 스냅샷 — **배열 인덱스가 곧 `defenses.layout` jsonb 계약**이라 중간 삽입·재정렬은
   * 저장된 배치의 의미를 조용히 바꾼다. 신규 항목은 반드시 각 종류의 **끝에만** append 하고,
   * 이 목록도 끝에만 늘어나야 한다.
   */
  it('카탈로그 순서 골든(append-only 가드)', () => {
    expect(INVASION_CATALOG.map((e) => e.i18nId)).toEqual([
      'formation.scout-drones',
      'formation.interceptors',
      'formation.assault',
      'formation.glide-flock',
      'formation.mine-layer',
      'formation.shield-escort',
      'formation.sniper-nest',
      'formation.support-escort',
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
      'fac.press',
      'fac.gravwell',
      'fac.shock',
      'prop.shieldGenerator',
      'prop.gravityAnchor',
      'prop.fixedCannon',
      'prop.repairPylon',
      'prop.decoyHologram',
      'prop.mineSwarm',
      'boss.steelGoliath',
      'boss.sporeQueen',
      'boss.phaseWarden',
      'map.straight',
      'map.curved',
      'map.choke',
    ]);
  });

  /**
   * 종류별 등록 수는 **원본 배열 length 파생**이어야 한다. 여기서 개수를 하드코딩하면 카탈로그가
   * 늘 때마다 두 곳을 고쳐야 하고, 한쪽만 고치면 `catalogEntriesOfKind` 가 조용히 잘린다.
   * (M7c 확장분 = 편대 8 · 설비 9 · 기물 6 · 보스 3 · 맵 3 — 아래 골든이 정본이다.)
   */
  it('CATALOG_KIND_COUNTS 는 원본 배열 length 에서 파생된다(하드코딩 금지)', () => {
    expect(CATALOG_KIND_COUNTS).toEqual([
      FORMATIONS.length,
      INVASION_FACILITIES.length,
      L3_PROPS.length,
      DEFENSE_BOSSES.length,
      INVASION_MAP_TEMPLATES.length,
    ]);
    expect(CATALOG_KIND_COUNTS.length).toBe(CATALOG_KIND_COUNT);
    // 종류마다 최소 1종은 있어야 한다(빈 종류는 배치 UI 가 고를 것이 없는 상태다).
    for (const n of CATALOG_KIND_COUNTS) expect(n).toBeGreaterThan(0);
  });

  /**
   * append-only 접두 골든 — 위 전체 골든이 "지금 순서"를 봉인한다면 이쪽은 **M7a 16종이 여전히
   * 각 종류의 맨 앞에 원래 순서 그대로 있다**를 따로 봉인한다. 전체 골든만 있으면 누군가
   * 앞쪽을 재배치하고 골든도 같이 고쳐 초록불로 만들 수 있다(이 프로젝트의 반복 결함 유형 —
   * 테스트가 코드와 같은 팬텀을 본다). 접두 골든은 "저장된 배치 jsonb 가 가리키던 catalogId 가
   * 아직 같은 것을 가리키는가"라는 별개 질문이라, 함께 고치려면 의도가 드러난다.
   */
  it('M7a 16종의 catalogId 가 이동하지 않았다(저장된 배치 jsonb 호환)', () => {
    const frozen: readonly (readonly [number, readonly string[]])[] = [
      [CATALOG_FORMATION, ['formation.scout-drones', 'formation.interceptors', 'formation.assault']],
      [CATALOG_FACILITY, ['fac.rapid', 'fac.rail', 'fac.mortar', 'fac.laser', 'fac.flame', 'fac.spawner']],
      [CATALOG_PROP, ['prop.shieldGenerator', 'prop.gravityAnchor', 'prop.fixedCannon']],
      [CATALOG_BOSS, ['boss.steelGoliath']],
      [CATALOG_MAP, ['map.straight', 'map.curved', 'map.choke']],
    ];
    for (const [kind, prefix] of frozen) {
      const ids = catalogEntriesOfKind(kind).map((e) => e.i18nId);
      expect(ids.slice(0, prefix.length), `kind ${kind} 접두 이동`).toEqual(prefix);
      // 신규분은 반드시 뒤에만 붙는다.
      expect(ids.length).toBeGreaterThanOrEqual(prefix.length);
    }
  });

  it('표시 식별자에 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    // 카탈로그 식별자는 ASCII 슬러그만 허용한다. 표시 문자열의 이모지 금지는 i18n 테스트가 본다.
    for (const e of INVASION_CATALOG) expect(e.i18nId).toMatch(/^[a-z][a-zA-Z0-9.-]*$/);
  });
});

// ---------------------------------------------------------------------------
// ② 기본 수비대 충원 — 순수 계층
// ---------------------------------------------------------------------------

describe('기본 수비대 — 충원 규칙', () => {
  it('충원 Ref 는 lv1 · 승급 0 · 노말 · 시드 0(전 필드 정수)', () => {
    const r = garrisonRef(GARRISON_FORMATION_CATALOG_ID);
    expect(r).toEqual({
      catalogId: GARRISON_FORMATION_CATALOG_ID,
      level: 1,
      ascension: 0,
      affixSeed: 0,
      rarity: 0,
    });
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
  });

  it('빈 웨이브 슬롯은 정찰 드론편대, 빈 소켓은 속사포로 채운다', () => {
    const filled = garrisonLayers(emptyInvasionLayers());
    expect(filled.l1.waveSlots.length).toBe(INVASION_WAVE_SLOTS);
    for (const s of filled.l1.waveSlots) {
      expect(s?.catalogId).toBe(GARRISON_FORMATION_CATALOG_ID);
      expect(s?.level).toBe(1);
    }
    expect(filled.l2.sockets.length).toBeGreaterThan(0);
    for (const s of filled.l2.sockets) expect(s?.catalogId).toBe(GARRISON_FACILITY_CATALOG_ID);
  });

  it('명시 배치는 그대로 두고 빈 자리만 채운다', () => {
    const layers = normalizeInvasionLayers({
      l1: { waveSlots: [{ catalogId: 2, level: 7, ascension: 1, affixSeed: 9, rarity: 3 }] },
      l2: { templateId: 0, sockets: [null, { catalogId: 1, level: 4 }] },
    });
    const filled = garrisonLayers(layers);
    expect(filled.l1.waveSlots[0]).toEqual(layers.l1.waveSlots[0]);
    expect(filled.l1.waveSlots[1]?.catalogId).toBe(GARRISON_FORMATION_CATALOG_ID);
    expect(filled.l2.sockets[0]?.catalogId).toBe(GARRISON_FACILITY_CATALOG_ID);
    expect(filled.l2.sockets[1]).toEqual(layers.l2.sockets[1]);
  });

  it('L3 는 충원하지 않는다 — 기물은 비우고 보스는 coreRoom 이 스폰 단계에서 채운다', () => {
    const filled = garrisonLayers(emptyInvasionLayers());
    expect(filled.l3.boss).toBeNull();
    for (const p of filled.l3.props) expect(p).toBeNull();
    for (const g of filled.l3.guardians) expect(g).toBeNull();
    for (const m of filled.l3.modules) expect(m).toBeNull();
  });

  it('원본을 변형하지 않는다(파생 사본)', () => {
    const layers = emptyInvasionLayers();
    const before = JSON.stringify(layers);
    const filled = garrisonLayers(layers);
    expect(JSON.stringify(layers)).toBe(before);
    expect(filled).not.toBe(layers);
    expect(layersEqual(layers, emptyInvasionLayers())).toBe(true);
  });

  it('결정론 — 같은 배치를 두 번 통과시키면 완전히 같은 결과', () => {
    const a = garrisonLayers(emptyInvasionLayers());
    const b = garrisonLayers(emptyInvasionLayers());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('garrisonFillCount 가 충원 자리 수를 센다', () => {
    const empty = emptyInvasionLayers();
    const n = garrisonFillCount(empty);
    expect(n.waves).toBe(INVASION_WAVE_SLOTS);
    expect(n.sockets).toBe(empty.l2.sockets.length);
    expect(garrisonFillCount(garrisonLayers(empty))).toEqual({ waves: 0, sockets: 0 });
  });

  it('withGarrison 은 runtime 을 참조로 유지한다(페이즈 갱신이 훅에 그대로 보여야 한다)', () => {
    const runtime: InvasionRuntime = {
      phase: PHASE_L1 as InvasionPhase,
      phaseEnterTick: 0,
      scrollX: 0,
      scrollY: 0,
      accelCp: 100,
    };
    const ctx = { layers: emptyInvasionLayers(), runtime, maintenance: 10000 };
    const wrapped = withGarrison(ctx);
    expect(wrapped.runtime).toBe(runtime);
    expect(wrapped.maintenance).toBe(10000);
    expect(wrapped.layers.l1.waveSlots[0]).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ③ 직렬화·해시 무오염
// ---------------------------------------------------------------------------

function emptyInvasionConfig(playerHp?: number): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(playerHp === undefined ? {} : { playerHp }),
    invasion3: {
      layers: emptyInvasionLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 10000,
    },
  } as WorldConfig;
}

/** 정본 훅을 garrison 충원본으로 감싼다(통합 시 makeInvasionContext 가 할 일과 동일 의미). */
function garrisonHooks(): InvasionStepHooks {
  resetInvasionStepHooks();
  const base = { ...invasionStepHooks() };
  type Hook = (s: WorldState, c: InvasionStepContext) => void;
  const wrap = (fn: Hook | undefined): Hook | undefined =>
    fn === undefined ? undefined : (s, c) => fn(s, withGarrison(c));
  const out: InvasionStepHooks = {};
  const keys = [
    'enterFormation',
    'stepFormation',
    'enterFacility',
    'stepFacility',
    'enterCoreRoom',
    'stepCoreRoom',
  ] as const;
  for (const k of keys) {
    const wrapped = wrap(base[k]);
    if (wrapped !== undefined) out[k] = wrapped;
  }
  return out;
}

function countKinds(state: WorldState, kinds: readonly string[]): number {
  let n = 0;
  for (const e of state.entities) if (!e.dead && kinds.includes(e.kind)) n++;
  return n;
}

afterEach(() => {
  resetInvasionStepHooks();
});

describe('기본 수비대 — 직렬화·해시 무오염', () => {
  it('런이 끝나도 config 의 layers 는 빈 정규형 그대로다', () => {
    registerInvasionStepHooks(garrisonHooks());
    const config = emptyInvasionConfig();
    const state = createWorld(3, config);
    for (let i = 0; i < 600; i++) stepWorld(state, IDLE);
    expect(layersEqual(state.config.invasion3!.layers, emptyInvasionLayers())).toBe(true);
  });

  it('충원 배선 유무가 tick 0 해시를 바꾸지 않는다(직렬화가 아니라 스폰 단계라서)', () => {
    resetInvasionStepHooks();
    const plain = hashWorld(createWorld(3, emptyInvasionConfig()));
    registerInvasionStepHooks(garrisonHooks());
    const garrisoned = hashWorld(createWorld(3, emptyInvasionConfig()));
    expect(garrisoned).toBe(plain);
  });

  it('빈 슬롯과 기본 수비대 명시 배치는 서로 다른 배치로 남는다', () => {
    const explicit = normalizeInvasionLayers({
      l1: { waveSlots: [garrisonRef(GARRISON_FORMATION_CATALOG_ID)] },
    });
    expect(layersEqual(explicit, emptyInvasionLayers())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ 스모크 — 빈 배치 100% 기본 수비대 런
// ---------------------------------------------------------------------------

describe('기본 수비대 — 빈 배치 런 스모크', () => {
  it('충원 없이는 빈 배치가 무저항 기지가 된다(대조군)', () => {
    resetInvasionStepHooks();
    const state = createWorld(5, emptyInvasionConfig());
    for (let i = 0; i < 300; i++) stepWorld(state, IDLE);
    expect(countKinds(state, ['enemy'])).toBe(0);
  });

  it('빈 배치가 L1 편대·L2 설비·L3 코어방을 모두 채운 채 끝까지 돈다', () => {
    registerInvasionStepHooks(garrisonHooks());
    // 무입력 플레이어는 기본 수비대 화력만으로도 L1 에서 격추된다(그 자체가 충원이 살아 있다는
    // 증거다). 세 레이어를 전부 관찰하려면 격추를 미뤄야 하므로 HP 만 크게 준다 — 방어 쪽은
    // 손대지 않으므로 스폰·전이 경로는 정본 그대로다.
    const state = createWorld(5, emptyInvasionConfig(1_000_000));

    let sawFormation = 0;
    let sawFacility = 0;
    let sawCore = 0;
    let sawBoss = 0;
    let ticks = 0;
    while (ticks < INVASION_TOTAL_TICKS && !state.gameOver && !state.victory) {
      // 레벨업이 뜨면 sim 이 선택을 받을 때까지 얼어붙는다(stepWorld 프리즈). 실제 런에서는
      // 오버레이가 처리하는 자리라, 스모크는 첫 후보를 즉시 집어 런을 계속 굴린다.
      stepWorld(state, state.pendingLevelUp ? { ...IDLE, special: packPowerupPick(0) } : IDLE);
      ticks++;
      const phase = state.invasion3!.phase;
      if (phase === PHASE_L1) sawFormation = Math.max(sawFormation, countKinds(state, ['enemy']));
      else if (phase === PHASE_L2) {
        sawFacility = Math.max(
          sawFacility,
          countKinds(state, ['facilityGun', 'facilityHazard', 'facilitySpawner']),
        );
      } else if (phase === PHASE_L3) {
        sawCore = Math.max(sawCore, countKinds(state, ['core']));
        sawBoss = Math.max(sawBoss, countKinds(state, ['defenseBoss']));
      }
    }

    // 세 레이어 전부가 실제로 콘텐츠를 세웠다.
    expect(sawFormation).toBeGreaterThan(0);
    expect(sawFacility).toBeGreaterThan(0);
    expect(sawCore).toBe(1);
    expect(sawBoss).toBe(1);
    // 런이 매달리지 않고 종료된다(격추 또는 총 예산 소진).
    expect(state.gameOver || state.victory).toBe(true);
    expect(ticks).toBeLessThanOrEqual(INVASION_TOTAL_TICKS);
  });

  /**
   * ⑤ **정규 경로 통합** — M7c 신규 13종만 꽂은 배치로 `createWorld → stepWorld` 를 실제로
   * 돌린다. 이 프로젝트의 반복 결함이 "단위 테스트는 그린인데 배선이 통째로 없다"이므로,
   * 신규 항목이 ①실제 런에서 스폰되고 ②그 항목의 표시 문구가 EN·KO 양쪽에서 해석되는지를
   * 한 테스트에서 같이 본다. 문구만 있고 스폰이 없으면(또는 그 반대면) 여기서 빨간불이다.
   */
  it('M7c 신규 13종이 실제 런에서 스폰되고 표시 문구가 EN·KO 로 해석된다', () => {
    resetInvasionStepHooks(); // 정본 훅 그대로(충원 래핑 없음 — 신규분만 관찰하려고).
    const layers = normalizeInvasionLayers({
      // 편대 3~7(신규 5종)을 웨이브 슬롯에 그대로 꽂는다.
      l1: { waveSlots: [3, 4, 5, 6, 7].map((id) => ({ catalogId: id, level: 1 })) },
      // 설비 6~8(프레스·견인 자기장·충격파)만 소켓에 반복 배치한다.
      l2: {
        templateId: 0,
        sockets: [6, 7, 8, 6, 7, 8].map((id) => ({ catalogId: id, level: 1 })),
      },
      // 기물 3~5(회복 파일런·기만 홀로그램·자폭 지뢰군) + 보스 1(포자 여왕).
      l3: {
        boss: { catalogId: 1, level: 1 },
        props: [{ catalogId: 3, level: 1 }, { catalogId: 4, level: 1 }, { catalogId: 5, level: 1 }],
      },
    });
    const config = {
      ...DEFAULT_CONFIG,
      playerHp: 1_000_000, // 무입력 플레이어가 L1 에서 격추되면 L2·L3 을 관찰할 수 없다.
      invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 },
    } as WorldConfig;

    const state = createWorld(11, config);
    let sawEnemy = 0;
    let sawFacility = 0;
    let sawWall = 0;
    let sawProp = 0;
    let sawDecoy = 0;
    let sawBoss = 0;
    for (let i = 0; i < INVASION_TOTAL_TICKS && !state.gameOver && !state.victory; i++) {
      stepWorld(state, state.pendingLevelUp ? { ...IDLE, special: packPowerupPick(0) } : IDLE);
      sawEnemy = Math.max(sawEnemy, countKinds(state, ['enemy']));
      sawFacility = Math.max(
        sawFacility,
        countKinds(state, ['facilityGun', 'facilityHazard', 'facilitySpawner']),
      );
      sawWall = Math.max(sawWall, countKinds(state, ['wall']));
      sawProp = Math.max(sawProp, countKinds(state, ['prop']));
      sawDecoy = Math.max(sawDecoy, countKinds(state, ['decoyCore']));
      sawBoss = Math.max(sawBoss, countKinds(state, ['defenseBoss']));
    }

    expect(sawEnemy, '신규 편대가 한 기도 스폰되지 않았다').toBeGreaterThan(0);
    expect(sawFacility, '견인 자기장·충격파가 세워지지 않았다').toBeGreaterThan(0);
    expect(sawWall, '압축 프레스의 이동 판이 스폰되지 않았다').toBeGreaterThan(0);
    expect(sawProp, '신규 기물이 스폰되지 않았다').toBeGreaterThan(0);
    expect(sawDecoy, '기만 홀로그램(decoyCore)이 스폰되지 않았다').toBeGreaterThan(0);
    expect(sawBoss, '포자 여왕이 스폰되지 않았다').toBeGreaterThan(0);

    // 배치에 실제로 꽂은 항목 전부의 표시 문구가 두 로케일에서 해석된다(키 그대로 노출 금지).
    const placed: readonly (readonly [number, number])[] = [
      ...[3, 4, 5, 6, 7].map((id) => [CATALOG_FORMATION, id] as const),
      ...[6, 7, 8].map((id) => [CATALOG_FACILITY, id] as const),
      ...[3, 4, 5].map((id) => [CATALOG_PROP, id] as const),
      [CATALOG_BOSS, 1] as const,
      [CATALOG_BOSS, 2] as const,
    ];
    for (const [kind, id] of placed) {
      const entry = catalogEntry(kind, id);
      expect(entry, `카탈로그 미등록: kind ${kind} / id ${id}`).toBeDefined();
      for (const key of [def3NameKey(entry!.i18nId), def3DescKey(entry!.i18nId)]) {
        for (const [label, table] of [
          ['EN', EN as unknown as Record<string, string>],
          ['KO', KO as unknown as Record<string, string>],
        ] as const) {
          const v = table[key] ?? '';
          expect(v.length, `${label} 문구 없음: ${key}`).toBeGreaterThan(0);
          expect(v, `${label} 이모지: ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
        }
      }
    }
  });

  it('충원 런도 결정론적이다(같은 seed·입력 → 매 틱 같은 해시)', () => {
    registerInvasionStepHooks(garrisonHooks());
    const a = createWorld(9, emptyInvasionConfig());
    const b = createWorld(9, emptyInvasionConfig());
    for (let i = 0; i < 400; i++) {
      stepWorld(a, IDLE);
      stepWorld(b, IDLE);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });
});
