/**
 * 침공 배선 계약 — **봇 실력에 의존하지 않는 것만** 남긴다 (ADR-0051 갈래 ③).
 *
 * ## 이 파일에서 무엇이 나갔는가
 * 이 파일은 원래 96/24시드 참조봇 런으로 밴드별 클리어율·승률 편차·로스터 게이트를 재고 그
 * 값을 단언으로 굳혔다. ADR-0051 이 판정 규칙 하나로 그것을 갈랐다:
 *
 * > **단언이 "봇이 이길 수 있는가"에 의존하면 게이트에서 내린다.**
 * > **"값이 흘러가는가"에만 의존하면 남기되, 완주가 아니라 최소 틱으로 증명한다.**
 *
 * 그래서 통계 계측 전량은 `bench/invasionBands.ts`(CLI, 단언 없음)로 나갔고, 측정 하네스는
 * `src/bench/invasionBands.ts` 가 소유한다. 여기 남은 것은 봇이 이기든 지든 참인 계약뿐이다:
 *   ① 레이어 진입 훅 배선 증명 — **최소 틱**으로 다시 썼다(아래 참조).
 *   ② 카탈로그 골든(순서·역할 코드) — sim 을 구동하지 않는다.
 *   ③ 시드 램프 미러 ↔ 마이그레이션 SQL 드리프트 가드 + 풀 카탈로그 노출 — sim 미구동.
 *   ④ `seedBases` 구조 회귀 — sim 미구동.
 *
 * ## 왜 이 배선 증명이 값진가
 * 레인별 단위 테스트는 자기 모듈만 부르므로 **"카탈로그는 다 그린인데 판이 통째로 비어 있다"**
 * 를 통과시킨다. 이 저장소가 여덟 번 겪은 그 결함이고, `src/sim/invasion/step.ts` 의
 * `DEFAULT_HOOKS` 주석이 경고하는 바로 그 실패 방식이다 — 훅이 비면 3레이어 런이 아무것도
 * 스폰하지 않고 **조용히 빈 맵을 5분간 스크롤한다**(예외도 타입 오류도 나지 않는다).
 *
 * ## 왜 최소 틱으로 쓸 수 있는가 — 페이즈 전이는 봇 실력과 무관하다
 * `shouldAdvancePhase`(`src/sim/invasion/phase.ts`)의 전이 조건은 둘이다:
 *   ⓐ **soft 예산 소진**(`INVASION_LAYER_TICKS`) → 강제 전이. 플레이어가 아무것도 못 해도 넘어간다.
 *   ⓑ 주파 길이 도달 → 조기 전이.
 * ⓐ 가 있으므로 "L3 까지 간다"는 봇의 실력이 아니라 **시간의 함수**다. 따라서 예산을 소진한
 * 것처럼 `phaseEnterTick` 을 당겨 주면(= 못 미는 플레이어가 실제로 밟는 경로) 같은 정규
 * 전이가 즉시 일어난다. 바꾸는 것은 "시간이 얼마나 흘렀다고 보는가" 하나뿐이고, 전이 자체는
 * `stepWorld` 안의 `advanceInvasionPhase` 가 그대로 수행한다.
 * 이 덕분에 종전 3런 x 최대 18,000틱이 **1런 x 수백 틱**이 된다.
 *
 * ⚠️ **버린 단언**: `state.victory`(코어 파괴로 끝난다)와 "사거리 투자 프로필이 승리한다".
 * 둘 다 봇이 이겨야 참이라 갈래 ②다. 사격 배선(`firedTicks > 0`)은 남았다 — 그쪽이
 * 이 파일이 실제로 지키려던 축이다(사거리 센티널 회귀는 "한 발도 안 나간다"로 나타난다).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import { INVASION_LAYER_TICKS } from '../src/sim/invasion/constants.js';
import { FORMATIONS } from '../data/invasion/formations.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { L3_PROPS } from '../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../data/invasion/defenseBosses.js';
import { SEED_BASES, SEED_BASE_COUNT, seedBaseUuid } from '../data/seedBases.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import {
  GEAR_REFERENCE,
  NON_STRIKER_SHIP_TYPES,
  RAMP,
  invasionConfig,
  seedBaseLayers,
} from '../src/bench/invasionBands.js';

// ---------------------------------------------------------------------------
// 램프 정본 SQL — 미러의 출처
// ---------------------------------------------------------------------------

/** SQL 헤더가 반드시 담고 있어야 하는 램프 식(문자열 그대로 대조). */
const RAMP_SQL_LINES: readonly string[] = [
  '-- RAMP: level = 20 + (17*(nn-1))/4',
  '-- RAMP: rarity = nn<=7 ? 0 : nn<=11 ? 1 : nn<=15 ? 2 : 3',
  '-- RAMP: ascension = nn<=7 ? 0 : 1',
  '-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1',
  '-- RAMP: waves = 6',
  '-- RAMP: formationKinds = nn<=7 ? 12 : min(8, 1 + (nn+1)/3)',
  '-- RAMP: formationShift = nn<=7 ? [0,1,2,3,5,7,9][nn] : (nn>=17 ? 2 : 0)',
  '-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)',
  '-- RAMP: facilityKinds = nn<=7 ? 17 : min(9, 2 + (nn*2)/5)',
  '-- RAMP: facilityShift = nn<=7 ? [0,2,4,7,10,14,1][nn] : 0',
  '-- RAMP: props = nn<=4 ? 0 : nn<=7 ? 2 : nn<=14 ? 4 : 3',
  '-- RAMP: propKinds = min(6, 1 + nn/4)',
  '-- RAMP: propShift = nn>=18 ? 3 : 0',
  '-- RAMP: boss = nn<=4 ? none : nn<=10 ? 2 : nn<=16 ? 0 : 1',
];

/**
 * 램프 정본 SQL. **최신 재시드 파일을 가리켜야 한다** — 이미 원격에 적용된 마이그레이션은
 * 본문을 고쳐도 재실행되지 않으므로, 램프를 바꿀 때마다 "덮어쓰는 신규 파일"이 새 정본이
 * 된다(이 리포의 선례: 20260721010000 → 20260723000000 → 20260727011000 → 20260727020000
 * → 20260728000000 → 20260728013000 → 20260803020000 → 20260810010000).
 * 미러는 `src/bench/invasionBands.ts` 의 {@link RAMP} 다.
 */
const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260810010000_invasion_ramp_reanchor.sql', import.meta.url),
);

/**
 * 마이그레이션 SQL 원문. `tests/node-shims.d.ts` 의 `readFileSync` 선언이 인코딩 인자를
 * 받지 않아(바이트 반환) 여기서 디코드한다 — 공유 shim 을 이 레인이 넓히지 않기 위해서다.
 */
function readMigrationSql(): string {
  return new TextDecoder().decode(readFileSync(MIGRATION_PATH));
}

// ---------------------------------------------------------------------------
// ① 레이어 진입 훅 배선 증명 — 최소 틱
// ---------------------------------------------------------------------------

/**
 * 진입 훅 스폰이 관측되기에 충분한 관찰 창. L2·L3 는 진입 훅이 정적 배치를 **한 틱에** 깔지만
 * (`enterFacilityLayer` · `enterCoreRoom`), L1 편대는 진입 1회 스폰이 아니라 스크롤 진행에
 * 따른 지속 스폰이라 조금 더 필요하다.
 */
const OBSERVE_TICKS = 240;

/** 배치가 네 축(편대·설비·기물·보스)을 모두 갖는 기지. `props(20)=3` · `boss(20)=1`. */
const WIRING_BASE_NN = 20;

function stepFor(state: WorldState, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.gameOver || state.victory) return;
  }
}

/**
 * 창 안에서 **한 번이라도 살아 있었던** 엔티티 종류를 모은다.
 *
 * ⚠️ 최종 상태만 보면 안 된다 — 참조봇이 편대를 즉시 격추하므로 창이 끝난 시점에는 아무것도
 * 안 남는다(이 파일 재작성 중 실제로 밟은 함정이다). 배선 증명이 재려는 것은 "지금 있는가"가
 * 아니라 "스폰 경로가 돌았는가"이므로 누적이 맞다. 관찰은 현재 상태 스냅샷부터 시작한다 —
 * 진입 훅의 정적 배치(L2 설비·L3 코어)는 전이 틱에 이미 깔려 있다.
 */
function observeKinds(state: WorldState, ticks: number): ReadonlySet<string> {
  const seen = new Set<string>();
  const snap = (): void => {
    for (const e of state.entities) if (!e.dead) seen.add(e.kind);
  };
  snap();
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, autopilotInput(state));
    snap();
    if (state.gameOver || state.victory) break;
  }
  return seen;
}

function hasAny(seen: ReadonlySet<string>, ...kinds: readonly string[]): boolean {
  return kinds.some((k) => seen.has(k));
}

/**
 * soft 예산을 소진한 것처럼 `phaseEnterTick` 을 당긴다 — 다음 `stepWorld` 안에서
 * `advanceInvasionPhase` 가 **정규 전이**를 수행한다(못 미는 플레이어가 실제로 밟는 경로).
 * `state.tick` 은 `stepWorld` 끝에서 증가하므로, 반환 직후의 `state.tick` 을 기준으로 당기면
 * 다음 틱의 `elapsed`(= `state.tick + 1 - phaseEnterTick`)가 정확히 예산과 같아진다.
 */
function exhaustLayerBudget(state: WorldState): void {
  const rt = state.invasion3;
  if (rt === undefined) throw new Error('invasion3 런타임이 없다 — 침공 런이 아니다');
  rt.phaseEnterTick = state.tick + 1 - (INVASION_LAYER_TICKS[rt.phase] ?? 0);
}

describe('배선 증명 — 3레이어 진입 훅이 배치를 실제로 스폰한다', () => {
  it('L1→L2→L3 순으로 전이하며 각 레이어가 자기 배치를 스폰한다', () => {
    const state = createWorld(1, invasionConfig(seedBaseLayers(WIRING_BASE_NN), GEAR_REFERENCE));

    // --- L1: 편대 ---
    expect(state.invasion3?.phase, 'L1 에서 시작하지 않았다').toBe(0);
    const l1 = observeKinds(state, OBSERVE_TICKS);
    expect(
      hasAny(l1, 'formation', 'formationDrone', 'enemy'),
      'L1 에서 적이 한 번도 스폰되지 않았다 — stepFormation 훅 미배선 신호',
    ).toBe(true);

    // --- L2: 회랑 벽 + 설비 ---
    exhaustLayerBudget(state);
    stepFor(state, 1); // 이 틱 끝에서 정규 전이(advanceInvasionPhase)가 일어난다
    expect(state.invasion3?.phase, 'soft 예산 소진에도 L2 로 전이하지 않았다').toBe(1);
    const l2 = observeKinds(state, OBSERVE_TICKS);
    expect(
      hasAny(l2, 'facilityGun', 'facilityHazard', 'facilitySpawner'),
      'L2 배치에 설비가 있는데 엔티티가 없다 — enterFacility 훅 미배선 신호',
    ).toBe(true);
    expect(hasAny(l2, 'wall'), 'L2 회랑 벽이 스폰되지 않았다').toBe(true);

    // --- L3: 코어 + 보스 + 기물 ---
    exhaustLayerBudget(state);
    stepFor(state, 1);
    expect(state.invasion3?.phase, 'soft 예산 소진에도 L3 로 전이하지 않았다').toBe(2);
    const l3 = observeKinds(state, OBSERVE_TICKS);
    expect(hasAny(l3, 'core'), 'L3 코어가 스폰되지 않았다 — enterCoreRoom 훅 미배선 신호').toBe(
      true,
    );
    expect(hasAny(l3, 'defenseBoss'), `#${WIRING_BASE_NN} 배치에 보스가 있는데 엔티티가 없다`).toBe(
      true,
    );
    expect(hasAny(l3, 'prop'), `#${WIRING_BASE_NN} 배치에 기물이 있는데 엔티티가 없다`).toBe(true);
  });

  it('사거리에 투자한 프로필도 실제로 사격한다', () => {
    // 이 하네스는 오래도록 `rangeAdd: 0` 한 점만 밟았다(`GEAR_REFERENCE`). 그 사이
    // `weapon.range` 는 `0 = 무제한` 센티널이라 **사거리에 투자할수록 조준 상한이 좁아졌고**,
    // 오토파일럿 카이팅 거리(460)보다 짧아지면 침공 공격자가 한 발도 쏘지 못했다.
    // 회귀는 승패가 아니라 "한 발도 안 나간다"로 나타나므로 발사만 본다(승리 단언은 갈래 ②).
    const state = createWorld(
      1,
      invasionConfig(seedBaseLayers(1), { ...GEAR_REFERENCE, rangeAdd: 400 }),
    );
    let firedTicks = 0;
    for (let t = 0; t < OBSERVE_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (state.entities.some((e) => e.kind === 'bullet' && !e.dead)) firedTicks++;
      if (state.gameOver || state.victory) break;
    }
    expect(firedTicks, '사거리 투자 프로필이 한 발도 쏘지 못했다').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ② 카탈로그 골든 가드 — 수치 튜닝이 인덱스 계약을 건드리지 않았는지
// ---------------------------------------------------------------------------

describe('카탈로그 계약 — 수치 튜닝이 인덱스를 건드리지 않았다', () => {
  it('편대 카탈로그 순서·개수 골든', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual([
      'formation-scout-drones',
      'formation-interceptors',
      'formation-assault',
      'formation-glide-flock',
      'formation-mine-layer',
      'formation-shield-escort',
      'formation-sniper-nest',
      'formation-support-escort',
      'formation-toxar-corrosion',
      'formation-toxar-blight',
      'formation-kras-breaker',
      'formation-kras-piercer',
    ]);
    FORMATIONS.forEach((f, i) => expect(f.catalogId).toBe(i));
  });

  it('설비 카탈로그 순서·개수 골든', () => {
    expect(INVASION_FACILITIES.map((f) => f.key)).toEqual([
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
      'fac.press',
      'fac.gravwell',
      'fac.shock',
      'fac.venomvent',
      'fac.blightpool',
      'fac.corrosivemist',
      'fac.toxinturret',
      'fac.heavyrail',
      'fac.siegecannon',
      'fac.breachturret',
      'fac.demolisher',
    ]);
  });

  it('기물 카탈로그 순서·역할 골든', () => {
    expect(L3_PROPS.map((p) => p.id)).toEqual([
      'shieldGenerator',
      'gravityAnchor',
      'fixedCannon',
      'repairPylon',
      'decoyHologram',
      'mineSwarm',
    ]);
    // 역할 코드가 인덱스와 어긋나면 스텝 디스패치가 통째로 바뀐다.
    L3_PROPS.forEach((p, i) => expect(p.role).toBe(i));
  });

  it('방어 보스 카탈로그 순서 골든', () => {
    expect(DEFENSE_BOSSES.map((b) => b.id)).toEqual([
      'steelGoliath',
      'sporeQueen',
      'phaseWarden',
    ]);
  });

  it('스트라이커가 typeId 0 이고 나머지 기체가 존재한다', () => {
    // 로스터 계측(`bench/invasionBands.ts`)이 "비-스트라이커"를 카탈로그에서 유도하는 전제다.
    // 카탈로그가 재정렬되면 그 계측이 엉뚱한 기체를 재게 된다.
    expect(SHIP_TYPES[0]?.id).toBe(0);
    expect(NON_STRIKER_SHIP_TYPES.length).toBeGreaterThan(0);
    expect(NON_STRIKER_SHIP_TYPES).not.toContain(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 시드 램프 드리프트 가드 + 풀 카탈로그 노출
// ---------------------------------------------------------------------------

describe('시드 재조정 — SQL 정본과의 정합', () => {
  it('마이그레이션 헤더의 RAMP 식이 미러와 일치한다', () => {
    // 미러는 `src/bench/invasionBands.ts` 의 `RAMP` 이고 정본은 이 SQL 이다. 사본이 조용히
    // 갈라지면 계측이 원격 DB 와 무관한 숫자가 된다.
    const sql = readMigrationSql();
    for (const line of RAMP_SQL_LINES) {
      expect(sql, `SQL 램프 주석이 미러와 다르다: ${line}`).toContain(line);
    }
  });

  it('마이그레이션이 NPC 고정 UUID 20행만 건드린다', () => {
    const sql = readMigrationSql();
    // WHERE 절이 고정 UUID 동등 비교 하나뿐이어야 실유저 방어가 안전하다.
    expect(sql).toContain('where id = v_def_id');
    expect(sql).toContain("'000000de-f000-4000-8000-'");
    expect(sql).not.toMatch(/update\s+public\.defenses[\s\S]{0,400}?where\s+true/i);
  });

  it('20기지가 시드 램프 목표 카탈로그를 전부 노출한다(미사용 시드 콘텐츠 0)', () => {
    const formations = new Set<number>();
    const facilities = new Set<number>();
    const props = new Set<number>();
    const bosses = new Set<number>();
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      for (const s of l.l1.waveSlots) if (s !== null) formations.add(s.catalogId);
      for (const s of l.l2.sockets) if (s !== null) facilities.add(s.catalogId);
      for (const s of l.l3.props) if (s !== null) props.add(s.catalogId);
      if (l.l3.boss !== null) bosses.add(l.l3.boss.catalogId);
    }
    // 램프의 `kinds` 상한이 카탈로그 뒷부분을 잘라내 Lane9 신규 방어체 12종(편대 8~11 ·
    // 설비 9~16)이 20기지 전부에서 한 번도 안 나온 적이 있다. 하위 밴드가 카탈로그를 순회
    // 노출하도록 창(shift)을 열어 이제 네 축 모두 **전량**을 요구한다 — 카탈로그에 종을
    // append 하고 램프를 안 열면 **이 단언이 먼저 깨진다**.
    //
    // ⚠️ 기물 `id 5`(mineSwarm)는 `#20` 한 곳에서만 노출된다(`propKinds(20)=6` ·
    //    `propShift(20)=3` · `props>=3` 일 때 i=2 → id 5). 중위 `props` 를 3 미만으로 내리면
    //    승률보다 **이 단언이 먼저** 깨진다.
    expect([...formations].sort((a, b) => a - b)).toEqual(FORMATIONS.map((_, i) => i));
    expect([...facilities].sort((a, b) => a - b)).toEqual(INVASION_FACILITIES.map((_, i) => i));
    expect([...props].sort((a, b) => a - b)).toEqual(L3_PROPS.map((_, i) => i));
    expect([...bosses].sort((a, b) => a - b)).toEqual(DEFENSE_BOSSES.map((_, i) => i));
    // 시드가 참조하는 편대·설비 id 는 전부 실재 카탈로그다(댕글링 시드 0).
    for (const id of formations) expect(FORMATIONS[id]).toBeDefined();
    for (const id of facilities) expect(INVASION_FACILITIES[id]).toBeDefined();
  });

  it('하위 밴드 창 크기가 카탈로그 길이와 같다(종을 append 하면 램프가 먼저 깨진다)', () => {
    // 하위 밴드는 창 크기를 **전 카탈로그**로 열고 shift 로 순회한다. 그 창 크기가 SQL 에
    // 상수(`c_form_len` · `c_fac_len`)로 박혀 있으므로, 카탈로그에 종을 append 하고 SQL
    // 상수를 안 올리면 새 종은 다시 안 보인다. 이 단언이 그 순간을 잡는다.
    expect(RAMP.formationKinds(1)).toBe(FORMATIONS.length);
    expect(RAMP.facilityKinds(1)).toBe(INVASION_FACILITIES.length);
    const sql = readMigrationSql();
    expect(sql).toContain(`c_form_len constant integer := ${FORMATIONS.length};`);
    expect(sql).toContain(`c_fac_len  constant integer := ${INVASION_FACILITIES.length};`);
  });

  it('중하·중위(nn 8..20) 배치가 Lane9 노출 확장 전과 바이트 동일하다', () => {
    // Lane9 레인의 난이도 중립은 "다시 쟀더니 같더라"가 아니라 **입력이 동일해서 같다**로
    // 성립한다. 확장 전 식(shift 없음 · 상한 min(8,…)/min(9,…))을 여기 그대로 두고
    // nn>=8 의 catalogId 를 대조한다 — 미래에 하위 창을 손대다 중하·중위로 새면 즉시 깨진다.
    const beforeFormationKinds = (nn: number) => Math.min(8, 1 + Math.floor((nn + 1) / 3));
    const beforeFacilityKinds = (nn: number) => Math.min(9, 2 + Math.floor((nn * 2) / 5));
    const beforeFormationShift = (nn: number) => (nn >= 17 ? 2 : 0);
    for (let nn = 8; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      l.l1.waveSlots.forEach((s, i) => {
        if (s !== null) {
          expect(s.catalogId, `#${nn} 웨이브 ${i}`).toBe(
            (i + beforeFormationShift(nn)) % beforeFormationKinds(nn),
          );
        }
      });
      l.l2.sockets.forEach((s, i) => {
        if (s !== null) {
          expect(s.catalogId, `#${nn} 소켓 ${i}`).toBe(i % beforeFacilityKinds(nn));
        }
      });
    }
  });

  it('시드 배치가 전부 정규형이다(정규화 멱등)', () => {
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      expect(normalizeInvasionLayers(l)).toEqual(l);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ seedBases 구조 회귀 0 (설명 재작성이 구조를 건드리지 않았는지)
// ---------------------------------------------------------------------------

describe('seedBases — 재조정이 구조를 건드리지 않았다', () => {
  it('개수 20 · UUID 스킴 · 밴드 분포 7/7/6 유지', () => {
    expect(SEED_BASES.length).toBe(20);
    SEED_BASES.forEach((b, i) => {
      expect(b.order).toBe(i + 1);
      expect(b.profileId).toBe(seedBaseUuid(i + 1));
    });
    const counts = { 하위: 0, 중하: 0, 중위: 0 };
    for (const b of SEED_BASES) counts[b.difficultyBand]++;
    expect(counts).toEqual({ 하위: 7, 중하: 7, 중위: 6 });
  });

  it('설명은 전부 비어 있지 않고 이모지를 담지 않는다', () => {
    // 정찰 뷰가 Pixi 라 컬러 이모지는 두부로 렌더된다.
    for (const b of SEED_BASES) {
      expect(b.description.length).toBeGreaterThan(10);
      expect(b.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
