/**
 * 레벨업 오버레이 보조 로직 테스트 (src/ui/buildStatus.ts).
 *
 * 두 축을 검증한다:
 *  1) levelUpOverlayAction — 오버레이 표시/숨김이 sim의 pendingLevelUp의 순수 함수라,
 *     "픽 후 오버레이가 남고 뒤에서 게임이 진행"되던 레이스가 재발하지 않음(회귀 가드).
 *  2) readBuildStatus / choiceRelevance — 현재 빌드 표시 스냅샷과 카드 관련성 배지.
 */

import { describe, it, expect } from 'vitest';
import {
  levelUpOverlayAction,
  readBuildStatus,
  choiceRelevance,
  weaponTypeName,
} from '../src/ui/buildStatus.js';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';

describe('levelUpOverlayAction — 표시/숨김 결정(레이스 회귀 가드)', () => {
  // 인자: (pendingLevelUp, level, overlayVisible, shownLevel)
  it('레벨업 발생 + 미표시 → show', () => {
    expect(levelUpOverlayAction(true, 2, false, 0)).toBe('show');
  });

  it('표시 중 + 동일 레벨 → none (선택 대기 유지, 매 프레임 재표시 안 함)', () => {
    expect(levelUpOverlayAction(true, 2, true, 2)).toBe('none');
  });

  it('멀티 레벨업: 표시 중이나 레벨이 올라감 → show (새 카드로 갱신)', () => {
    expect(levelUpOverlayAction(true, 3, true, 2)).toBe('show');
  });

  it('픽 소비로 pendingLevelUp 하강 + 표시 중 → hide', () => {
    expect(levelUpOverlayAction(false, 2, true, 2)).toBe('hide');
  });

  it('레벨업 아님 + 미표시 → none', () => {
    expect(levelUpOverlayAction(false, 2, false, 0)).toBe('none');
  });

  it('소프트락 회귀: 멀티 레벨업에서 오퍼가 우연히 같은 순서여도 레벨이 다르면 show로 갱신된다', () => {
    // 오퍼 배열 동등성으로 판정하던 옛 로직은 이 경우 'none'을 반환해 오버레이가
    // picked 가드에 고정 → sim 영구 프리즈(소프트락). level 기준이면 항상 구분된다.
    expect(levelUpOverlayAction(true, 6, true, 5)).toBe('show');
  });

  it('회귀: 픽 직후 pendingLevelUp이 아직 참인 프레임엔 재표시하지 않고(none), 하강 시 정확히 hide로 종결된다', () => {
    // 픽 큐잉 시점(오버레이 표시 중, 동일 레벨) → none: 낙관적 숨김 없음.
    expect(levelUpOverlayAction(true, 4, true, 4)).toBe('none');
    // 픽 소비 후(pendingLevelUp=false) → hide: 오버레이가 고아로 남지 않는다.
    expect(levelUpOverlayAction(false, 4, true, 4)).toBe('hide');
  });
});

/**
 * XP를 임계까지 채워 레벨업(pendingLevelUp)을 유도한 월드를 만든다.
 *
 * ⚠️ **내구 파일럿이어야 한다**(2026-07-27 밸런스 패스). 기본 HP(100)로는 런 풀 커브 상향
 * (`xpToNext` 10+6L → 10+66L, ADR-0036 · Lane F)과 적 축 상향이 겹쳐 **무입력 파일럿이
 * 레벨업 임계 전에 죽는다** — 죽으면 `stepWorld` 가 즉시 반환해 XP 가 더 안 쌓이므로
 * 36,000틱을 돌려도 `pendingLevelUp` 이 서지 않는다(실측). 이 헬퍼가 재려는 것은 난이도가
 * 아니라 **레벨업 시점의 스냅샷**이므로, 파일럿을 죽지 않게 두는 것이 관측 조건의 정정이다.
 * 내구로 두면 같은 시드에서 **1,103틱**에 레벨업이 선다(실측).
 */
function worldAtLevelUp(): WorldState {
  const state = createWorld(0x1234, { ...DEFAULT_CONFIG, playerHp: 100_000_000 });
  // 무입력으로 진행하며 XP가 쌓여 레벨업이 걸릴 때까지 스텝(잡몹 처치 XP).
  for (let t = 0; t < 4000 && !state.pendingLevelUp; t++) stepWorld(state, emptyInput());
  return state;
}

describe('readBuildStatus — 현재 빌드 표시 스냅샷', () => {
  it('기본 무기(발칸=0)의 스탯을 표시용으로 읽는다', () => {
    const state = createWorld(0x999, { ...DEFAULT_CONFIG });
    const s = readBuildStatus(state);
    expect(s.weaponType).toBe(0);
    expect(s.weaponName).toBe('발칸');
    expect(s.level).toBe(1);
    expect(s.damage).toBe(8);
    expect(s.bulletCount).toBe(1);
    expect(s.shotsPerSec).toBeGreaterThan(0); // 60 / fireCooldown
    expect(s.maxHp).toBeGreaterThan(0);
  });

  it('읽기는 순수 추출이라 sim 해시에 영향을 주지 않는다', () => {
    const state = createWorld(0x321, { ...DEFAULT_CONFIG });
    for (let t = 0; t < 60; t++) stepWorld(state, emptyInput());
    const tickBefore = state.tick;
    readBuildStatus(state);
    readBuildStatus(state);
    expect(state.tick).toBe(tickBefore); // 미변경
  });

  it('레벨업 시점의 무기 상태를 그대로 반영한다', () => {
    const state = worldAtLevelUp();
    expect(state.pendingLevelUp).toBe(true);
    const s = readBuildStatus(state);
    expect(s.weaponType).toBe(state.weapon.weaponType);
    expect(s.bulletCount).toBe(state.weapon.bulletCount);
    expect(s.pierce).toBe(state.weapon.pierce);
  });
});

describe('choiceRelevance — 카드 관련성 배지', () => {
  it('현재 장착 무기와 같은 타입 파워업은 "현재 무기"로 강조된다', () => {
    // 발칸(0) 전용 파워업 = 인덱스 0 (rapid-fire, weaponType 0).
    const rel = choiceRelevance(0, 0);
    expect(rel.matchesWeapon).toBe(true);
    expect(rel.label).toBe('현재 무기');
  });

  it('다른 무기 타입 파워업은 해당 무기명 배지, 강조 없음', () => {
    // 인덱스 0(rapid-fire)은 weaponType 0 → 현재가 레일건(2)이면 "발칸 무기".
    const rel = choiceRelevance(0, 2);
    expect(rel.matchesWeapon).toBe(false);
    expect(rel.label).toBe('발칸 무기');
  });

  it('범용 파워업은 "범용" 배지', () => {
    // 인덱스 1(twin-shot)은 universal.
    const rel = choiceRelevance(1, 0);
    expect(rel.matchesWeapon).toBe(false);
    expect(rel.label).toBe('범용');
  });

  it('계열 파워업은 계열명 배지(예: 기동)', () => {
    // 인덱스 4(thrusters)는 tree=mobility.
    const rel = choiceRelevance(4, 0);
    expect(rel.label).toBe('기동');
  });
});

describe('weaponTypeName', () => {
  it('알려진 타입은 한글명, 미지 타입은 폴백', () => {
    expect(weaponTypeName(0)).toBe('발칸');
    expect(weaponTypeName(4)).toBe('빔');
    expect(weaponTypeName(99)).toBe('무기 99');
  });
});

describe('통합: 레벨업 → 픽 소비 사이클이 오버레이를 고아로 남기지 않는다', () => {
  it('레벨업 프레임엔 show, 픽 입력 소비 후 프레임엔 hide로 수렴한다', () => {
    const state = worldAtLevelUp();
    expect(state.pendingLevelUp).toBe(true);

    // 렌더 루프 1: 미표시 → show. shownLevel을 현재 레벨로 세팅.
    expect(levelUpOverlayAction(state.pendingLevelUp, state.level, false, 0)).toBe('show');
    const shown = state.level;

    // 픽 큐잉(오버레이 표시 중, 동일 레벨) → none: 낙관적 숨김 없음.
    expect(levelUpOverlayAction(state.pendingLevelUp, state.level, true, shown)).toBe('none');

    // 픽 입력을 sim이 소비 → pendingLevelUp 하강.
    stepWorld(state, { ...emptyInput(), special: packPowerupPick(0) });
    expect(state.pendingLevelUp).toBe(false);

    // 렌더 루프: 표시 중이나 pendingLevelUp=false → hide.
    expect(levelUpOverlayAction(state.pendingLevelUp, state.level, true, shown)).toBe('hide');
  });
});
