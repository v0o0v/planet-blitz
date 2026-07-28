/**
 * 침공 진행 HUD 파생(`src/ui/invasionProgress.ts`) 단위 커버리지.
 *
 * 커버리지:
 *   1. 침공이 아닌 런 → null(패널을 아예 감춘다).
 *   2. L1/L2 진행률이 스크롤 오프셋에서 나온다(축이 갈린다 · 0·1 경계 클램프).
 *   3. 레이어 soft 예산·총 hard 예산 잔여 시간(0 하한).
 *   4. L3 진행률 = 코어 HP 소모율 + core/boss 필드.
 *   5. 방어 잔존 카운트(설비 3종·수호·기물·기만 홀로그램·적, 사망 제외).
 *
 * 전부 **순수 파생**이라 `stepWorld` 를 돌리지 않는다 — 스텝을 섞으면 스폰·전이가 관측값을
 * 흔들어 재는 대상이 뒤바뀐다(`tests/invasionPhase.test.ts` 머리말과 같은 규율).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import {
  INVASION_L1_TICKS,
  INVASION_L2_TICKS,
  INVASION_TOTAL_TICKS,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
} from '../src/sim/invasion/constants.js';
import { layerLength } from '../src/sim/invasion/scroll.js';
import { invasionHudState } from '../src/ui/invasionProgress.js';
import { t } from '../src/i18n/index.js';

const BASE: WorldConfig = {
  arenaWidth: 1920,
  arenaHeight: 1080,
  playerSpeed: 720,
  dashSpeed: 2800,
  dashCooldownTicks: 42,
  dashIframes: 10,
  hitIframes: 40,
  playerHp: 100,
};

function invasionWorld(timeLimitTicks = INVASION_TOTAL_TICKS): WorldState {
  return createWorld(7, {
    ...BASE,
    invasion3: { layers: emptyInvasionLayers(), timeLimitTicks },
  });
}

/** 테스트용 엔티티를 월드에 직접 얹는다(스폰 훅을 돌리지 않고 배치만 손으로 만든다). */
function push(state: WorldState, kind: Entity['kind'], hp = 1, maxHp = 1): Entity {
  const e = blankEntity(kind);
  e.id = state.nextEntityId++;
  e.hp = hp;
  e.maxHp = maxHp;
  e.radius = 40;
  state.entities.push(e);
  return e;
}

/**
 * 리포 소스 읽기. `readFileSync` 의 node 앰비언트 선언(tests/node-shims.d.ts)이 URL 오버로드를
 * 갖지 않으므로 반드시 `fileURLToPath` 로 문자열 경로를 만들어 넘긴다 — 안 그러면 vitest 는
 * 그린인데 `tsc --noEmit` 만 깨진다(그 선언 파일 머리말의 재발 경고).
 */
function repoSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('배선', () => {
  /**
   * 이 프로젝트의 #1 반복 결함은 "순수 파생 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다
   * (침공 배경 3장이 `InvasionBackdrop` 미배선으로 만들고도 안 나온 사례가 직전 것이다).
   * 파생이 아무리 맞아도 렌더 루프가 `hud.setInvasion` 을 부르지 않으면 화면엔 아무것도 안 뜬다.
   */
  it('main.ts 렌더 루프가 파생을 HUD 로 넘긴다', () => {
    const main = repoSource('../src/main.ts');
    expect(main).toContain('invasionHudState');
    expect(main).toContain('hud.setInvasion(');
  });

  it('HUD 는 침공 패널을 setVisible 로도 덮는다(정산 위 잔존 방지)', () => {
    // 정산 화면이 뜬 뒤에도 world 는 살아 있어 이 패널이 매 프레임 다시 켜진다 — `display` 만으로는
    // 못 막고 `setVisible` 의 visibility 축에 들어가 있어야 한다(사용자 신고 2026-07-28 계열 결함).
    const hud = repoSource('../src/ui/hud.ts');
    const setVisible = hud.slice(hud.indexOf('setVisible(visible: boolean)'));
    expect(setVisible.slice(0, setVisible.indexOf('}\n\n'))).toContain('this.invRoot');
  });
});

describe('침공이 아닌 런', () => {
  it('null 을 돌려준다(패널을 감춘다)', () => {
    expect(invasionHudState(createWorld(1, BASE))).toBeNull();
  });
});

describe('레이어 진행률', () => {
  it('L1 은 -scrollY 를 L1 길이로 나눈다', () => {
    const w = invasionWorld();
    const len = layerLength(PHASE_L1);
    w.invasion3!.scrollY = -Math.trunc(len / 4);
    // L2 축(scrollX)이 섞이면 안 된다 — 값을 넣어도 L1 진행률은 움직이지 않아야 한다.
    w.invasion3!.scrollX = 99999;
    expect(invasionHudState(w)!.layerFraction).toBeCloseTo(0.25, 3);
  });

  it('L2 는 scrollX 를 L2 길이로 나눈다', () => {
    const w = invasionWorld();
    w.invasion3!.phase = PHASE_L2;
    w.invasion3!.scrollX = Math.trunc(layerLength(PHASE_L2) / 2);
    expect(invasionHudState(w)!.layerFraction).toBeCloseTo(0.5, 3);
  });

  it('시작 시 0, 길이를 넘겨도 1 을 넘지 않는다', () => {
    const w = invasionWorld();
    expect(invasionHudState(w)!.layerFraction).toBe(0);
    w.invasion3!.scrollY = -layerLength(PHASE_L1) * 3;
    expect(invasionHudState(w)!.layerFraction).toBe(1);
    // 역주행(축 반대 방향)도 음수 게이지가 되지 않는다.
    w.invasion3!.scrollY = 4000;
    expect(invasionHudState(w)!.layerFraction).toBe(0);
  });

  it('레이어 라벨은 페이즈별로 갈린다(i18n 카탈로그 경유)', () => {
    const w = invasionWorld();
    expect(invasionHudState(w)!.layerLabel).toBe(t('hud.inv.layer0'));
    w.invasion3!.phase = PHASE_L2;
    expect(invasionHudState(w)!.layerLabel).toBe(t('hud.inv.layer1'));
    w.invasion3!.phase = PHASE_L3;
    const s = invasionHudState(w)!;
    expect(s.layerLabel).toBe(t('hud.inv.layer2'));
    expect(s.phase).toBe(2);
  });
});

describe('잔여 시간', () => {
  it('레이어 잔여 = 예산 − (tick − phaseEnterTick), 총 잔여 = 제한 − tick', () => {
    const w = invasionWorld();
    w.tick = 1200;
    w.invasion3!.phaseEnterTick = 600;
    const s = invasionHudState(w)!;
    expect(s.layerRemainSec).toBeCloseTo((INVASION_L1_TICKS - 600) / 60, 6);
    expect(s.totalRemainSec).toBeCloseTo((INVASION_TOTAL_TICKS - 1200) / 60, 6);
  });

  it('L2 로 넘어가면 그 레이어 예산에서 다시 잰다', () => {
    const w = invasionWorld();
    w.tick = 6000;
    w.invasion3!.phase = PHASE_L2;
    w.invasion3!.phaseEnterTick = 5400;
    expect(invasionHudState(w)!.layerRemainSec).toBeCloseTo((INVASION_L2_TICKS - 600) / 60, 6);
  });

  it('예산을 넘겨도 음수가 되지 않는다(0 하한)', () => {
    const w = invasionWorld(1000);
    w.tick = 9999;
    w.invasion3!.phaseEnterTick = 0;
    const s = invasionHudState(w)!;
    expect(s.layerRemainSec).toBe(0);
    expect(s.totalRemainSec).toBe(0);
  });
});

describe('L3 코어·보스', () => {
  it('진행률이 코어 HP 소모율이다', () => {
    const w = invasionWorld();
    w.invasion3!.phase = PHASE_L3;
    const core = push(w, 'core', 8000, 8000);
    expect(invasionHudState(w)!.layerFraction).toBe(0);
    core.hp = 2000;
    const s = invasionHudState(w)!;
    expect(s.layerFraction).toBeCloseTo(0.75, 6);
    expect(s.core).toEqual({ hp: 2000, maxHp: 8000 });
  });

  it('코어가 아직 없으면 진행률 0 이고 core 필드도 없다', () => {
    const w = invasionWorld();
    w.invasion3!.phase = PHASE_L3;
    const s = invasionHudState(w)!;
    expect(s.layerFraction).toBe(0);
    expect(s.core).toBeUndefined();
    expect(s.boss).toBeUndefined();
  });

  it('방어 보스가 있으면 체력을 싣는다', () => {
    const w = invasionWorld();
    w.invasion3!.phase = PHASE_L3;
    push(w, 'defenseBoss', 1500, 3000);
    expect(invasionHudState(w)!.boss).toEqual({ hp: 1500, maxHp: 3000 });
  });

  it('죽은 코어·보스는 세지 않는다', () => {
    const w = invasionWorld();
    w.invasion3!.phase = PHASE_L3;
    push(w, 'core', 8000, 8000).dead = true;
    push(w, 'defenseBoss', 1500, 3000).dead = true;
    const s = invasionHudState(w)!;
    expect(s.core).toBeUndefined();
    expect(s.boss).toBeUndefined();
  });
});

describe('방어 잔존 요약', () => {
  it('설비 3종·수호·기물(기만 홀로그램 포함)·적을 각각 센다', () => {
    const w = invasionWorld();
    push(w, 'facilityGun');
    push(w, 'facilityHazard');
    push(w, 'facilitySpawner');
    push(w, 'guardian');
    push(w, 'prop');
    push(w, 'prop');
    // 기만 홀로그램은 kind 가 `decoyCore` 이고 `enemyType`(역할 코드) 이 0 이상일 때만 배치
    // 기물이다(코어 모듈 유니크의 신기루 코어는 -1 이라 제외된다).
    push(w, 'decoyCore').enemyType = 4;
    push(w, 'decoyCore').enemyType = -1;
    push(w, 'enemy');
    push(w, 'enemy');
    push(w, 'enemy');
    expect(invasionHudState(w)!.defense).toEqual({
      facilities: 3,
      guardians: 1,
      props: 3,
      enemies: 3,
    });
  });

  it('죽은 엔티티는 빠진다', () => {
    const w = invasionWorld();
    push(w, 'facilityGun').dead = true;
    push(w, 'guardian').dead = true;
    push(w, 'prop').dead = true;
    push(w, 'enemy').dead = true;
    push(w, 'enemy');
    expect(invasionHudState(w)!.defense).toEqual({
      facilities: 0,
      guardians: 0,
      props: 0,
      enemies: 1,
    });
  });

  it('배치가 비어 있으면 전부 0 이다(플레이어는 어디에도 안 센다)', () => {
    const w = invasionWorld();
    expect(invasionHudState(w)!.defense).toEqual({
      facilities: 0,
      guardians: 0,
      props: 0,
      enemies: 0,
    });
  });
});
