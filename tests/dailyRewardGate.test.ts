/**
 * 일일 보상 모달 진입 게이트 — 경로 무관성 · 재진입 · 비동기 창 (ADR-0048 · AC-18).
 *
 * ## 이 파일이 잠그는 것
 *
 * 리포 교훈이 정본이다: *"레이어 표시는 진입 경로가 아니라 화면 이름 단일 권위."*
 * 경로별 처방을 쓰면 하나를 놓친 경로의 유저가 그날 모달을 영영 못 보고, 그러면
 * **보상 예고를 못 봐서 ADR-0048 의 압력 설계 전체가 무용지물**이 된다. 그래서 판정을
 * 순수 함수로 뽑았고, 여기서는 그 판정이 **경로 개수와 무관**하다는 것을 시뮬레이션으로
 * 확인한다.
 *
 * 재진입 두 경로를 반드시 케이스로 잡는다:
 *  - `rerenderCurrentScreen()` — 언어 전환. `case 'base'` 가 `openBaseMap()` 을 다시 부른다.
 *  - `harnessRefreshScreen()` — `default:` 분기라 run/result 화면에서도 base 로 튄다.
 * 순수 판정이 없으면 둘 다에서 **모달이 재발한다.**
 */

import { describe, expect, it } from 'vitest';

import { DAILY_SEED_NEVER, shouldOpenDailyReward } from '../data/dailyReward.js';
import {
  clearDailySeenSeed,
  loadDailySeenSeed,
  saveDailySeenSeed,
} from '../src/save/dailySeen.js';
import type { KeyValueStore } from '../src/save/profile.js';

/** 테스트용 인메모리 스토어(`KeyValueStore` 최소 구현). */
function memStore(): KeyValueStore & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * `openBaseMap()` 의 게이트 부분만 떼어낸 모형.
 *
 * 실제 코드가 하는 일과 **같은 순서**여야 의미가 있다: 판정 → (열면) 기록.
 * 기록을 판정보다 먼저 하면 첫 진입에서도 안 뜬다.
 */
function enterBase(store: KeyValueStore, nowSeed: number): boolean {
  const seen = loadDailySeenSeed(store);
  if (!shouldOpenDailyReward(seen, nowSeed)) return false;
  saveDailySeenSeed(nowSeed, store);
  return true;
}

describe('진입 게이트 — 그날 한 번 (AC-18)', () => {
  it('그날 첫 진입에만 열린다', () => {
    const s = memStore();
    expect(enterBase(s, 20_000)).toBe(true);
    expect(enterBase(s, 20_000)).toBe(false);
    expect(enterBase(s, 20_000)).toBe(false);
  });

  it('날이 바뀌면 다시 열린다', () => {
    const s = memStore();
    expect(enterBase(s, 20_000)).toBe(true);
    expect(enterBase(s, 20_001)).toBe(true);
    expect(enterBase(s, 20_001)).toBe(false);
  });

  it('진입 경로가 몇 개든 결과가 같다 — 판정 입력이 (마지막 표시 시드, 오늘 시드) 둘뿐이다', () => {
    // 부팅 직행 · 런 종료 후 복귀 · 타이틀에서 진입 · 건물에서 뒤로 · 언어 전환 rerender ·
    // 하네스 refresh — 전부 openBaseMap() 한 지점으로 모이므로 같은 함수를 부르는 것과 같다.
    const s = memStore();
    const paths = ['boot', 'runEnd', 'title', 'buildingBack', 'rerender', 'harness'];
    const opened = paths.map(() => enterBase(s, 20_000));
    expect(opened.filter(Boolean).length).toBe(1);
    expect(opened[0]).toBe(true); // 첫 경로가 무엇이든 그것만 연다.
  });

  it('언어 전환 rerender 가 모달을 재발시키지 않는다', () => {
    const s = memStore();
    expect(enterBase(s, 20_000)).toBe(true);
    // rerenderCurrentScreen() → case 'base' → openBaseMap()
    for (let i = 0; i < 10; i++) expect(enterBase(s, 20_000)).toBe(false);
  });

  it('하네스 refresh(default: 분기)가 모달을 재발시키지 않는다', () => {
    const s = memStore();
    expect(enterBase(s, 20_000)).toBe(true);
    // harnessRefreshScreen() 은 default: 라 run/result 화면에서도 base 로 튄다.
    for (const _screen of ['run', 'result', 'base']) expect(enterBase(s, 20_000)).toBe(false);
  });
});

describe('마지막 표시 시드의 저장 — 손상이 기지 화면을 막지 않는다', () => {
  it('기록이 없으면 미표시로 읽는다', () => {
    expect(loadDailySeenSeed(memStore())).toBe(DAILY_SEED_NEVER);
  });

  it('왕복이 값을 보존한다', () => {
    const s = memStore();
    saveDailySeenSeed(20_123, s);
    expect(loadDailySeenSeed(s)).toBe(20_123);
  });

  it('손상된 값은 예외가 아니라 미표시로 접힌다 — 예외면 openBaseMap 안에서 터져 기지가 안 그려진다', () => {
    const s = memStore();
    for (const bad of ['', 'abc', 'NaN', '-5', '{}']) {
      s.setItem('planet-blitz:daily-seen', bad);
      expect(loadDailySeenSeed(s)).toBe(DAILY_SEED_NEVER);
    }
  });

  it('스토어가 없으면(사생활 보호 모드) 미표시로 읽고 쓰기는 조용히 no-op 이다', () => {
    expect(loadDailySeenSeed(null)).toBe(DAILY_SEED_NEVER);
    expect(() => saveDailySeenSeed(20_000, null)).not.toThrow();
    expect(() => clearDailySeenSeed(null)).not.toThrow();
  });

  it('던지는 스토어에서도 기지 화면을 막지 않는다', () => {
    const hostile: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDailySeenSeed(hostile)).toBe(DAILY_SEED_NEVER);
    expect(() => saveDailySeenSeed(20_000, hostile)).not.toThrow();
    expect(() => clearDailySeenSeed(hostile)).not.toThrow();
  });

  it('하네스 초기화가 다음 진입을 다시 열게 한다 — 30일차 치트 검증(AC-26)의 전제다', () => {
    const s = memStore();
    expect(enterBase(s, 20_000)).toBe(true);
    clearDailySeenSeed(s);
    expect(enterBase(s, 20_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 비동기 창 — openBaseMap 은 동기이고 수령은 서버 왕복이다
// ---------------------------------------------------------------------------

describe('비동기 창 — 응답이 늦게 와도 기지 없는 배경 위에 모달이 앉지 않는다', () => {
  /**
   * 실제 결함 형상: `openBaseMap()` 이 게이트를 통과시켜 수령 요청을 띄운 사이 플레이어가
   * 격납고를 누르면 `baseMap.hide()` 가 먼저 돌고, 그 **뒤에** 응답이 도착한다. 그때 화면은
   * 이미 base 가 아니다. 그래서 응답 도착 시점에 `currentScreenName === 'base'` 를 **다시**
   * 확인해야 한다 — 요청을 보낸 시점의 확인만으로는 이 창을 못 막는다.
   */
  function onClaimResolved(screenAtResponse: string): boolean {
    return screenAtResponse === 'base';
  }

  it('응답 도착 시점에 base 가 아니면 모달을 열지 않는다', () => {
    expect(onClaimResolved('hangar')).toBe(false);
    expect(onClaimResolved('starMap')).toBe(false);
    expect(onClaimResolved('run')).toBe(false);
  });

  it('여전히 base 면 연다', () => {
    expect(onClaimResolved('base')).toBe(true);
  });

  it('게이트 통과와 모달 표시가 분리돼 있다 — 통과했다고 무조건 열면 이 창이 열린다', () => {
    const s = memStore();
    // 게이트는 통과했지만(그래서 seed 는 기록됐지만) 화면이 떠났으면 안 연다.
    expect(enterBase(s, 20_000)).toBe(true);
    expect(onClaimResolved('hangar')).toBe(false);
    // ⚠️ 그 결과 그날 모달을 못 본다. 그것이 의도다 — 수령은 이미 서버에서 일어났고
    // (화면은 통지일 뿐이다) 헤더 칩으로 언제든 재열람할 수 있다(슬라이스 2, AC-20).
  });
});
