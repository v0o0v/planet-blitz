/**
 * 계정 스코프 가드 — 계정이 바뀌면 로컬을 버린다.
 *
 * 이 가드가 없으면 계정 A 의 프로필과 미전송 정산 큐가 계정 B 의 세션으로 올라간다(재화 이전).
 * 아래 마지막 테스트가 특히 중요하다 — **새 로컬 키를 만들고 목록에 안 넣는 누락**을 잡는다.
 * 그 누락은 런타임에 아무 증상이 없다가 계정 전환 때만 조용히 데이터를 섞는다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_SCOPED_KEYS,
  reconcileAccountScope,
  clearAccountScope,
} from '../src/net/accountScope.js';
import type { KeyValueStore } from '../src/save/profile.js';

/** 메모리 KeyValueStore. */
function memStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 계정 스코프 키 전부에 값이 든 스토어. */
function seededStore(): ReturnType<typeof memStore> {
  const seed: Record<string, string> = {};
  for (const k of ACCOUNT_SCOPED_KEYS) seed[k] = 'stale';
  return memStore(seed);
}

describe('reconcileAccountScope', () => {
  it('처음 보는 계정이면 로컬을 비운다(익명으로 놀던 잔재가 딸려 올라가는 것을 막는다)', () => {
    const store = seededStore();
    expect(reconcileAccountScope(store, 'uid-a')).toBe(true);
    for (const k of ACCOUNT_SCOPED_KEYS) expect(store.getItem(k), k).toBeNull();
  });

  it('같은 계정으로 다시 부팅하면 아무것도 안 지운다', () => {
    const store = seededStore();
    reconcileAccountScope(store, 'uid-a'); // 1회차 — 비운다.
    for (const k of ACCOUNT_SCOPED_KEYS) store.setItem(k, 'fresh');

    expect(reconcileAccountScope(store, 'uid-a')).toBe(false);
    for (const k of ACCOUNT_SCOPED_KEYS) expect(store.getItem(k), k).toBe('fresh');
  });

  it('계정이 바뀌면 전부 버린다 — 이것이 막으려는 재화 이전 경로다', () => {
    const store = seededStore();
    reconcileAccountScope(store, 'uid-a');
    store.setItem('planet-blitz:profile', 'A 의 진행도');
    store.setItem('planet-blitz:net:pending-settlements', 'A 가 번 재화');

    expect(reconcileAccountScope(store, 'uid-b')).toBe(true);
    expect(store.getItem('planet-blitz:profile')).toBeNull();
    expect(store.getItem('planet-blitz:net:pending-settlements')).toBeNull();
  });

  it('기기 설정(pb.*)은 계정이 바뀌어도 살아남는다', () => {
    const store = seededStore();
    store.setItem('pb.locale', 'ko');
    store.setItem('pb.graphics', 'high');
    store.setItem('pb.audio', '{"bgm":0.5}');

    reconcileAccountScope(store, 'uid-a');
    reconcileAccountScope(store, 'uid-b');

    expect(store.getItem('pb.locale')).toBe('ko');
    expect(store.getItem('pb.graphics')).toBe('high');
    expect(store.getItem('pb.audio')).toBe('{"bgm":0.5}');
  });

  it('스토어가 없으면 아무것도 하지 않는다(사생활 모드)', () => {
    expect(reconcileAccountScope(null, 'uid-a')).toBe(false);
  });

  it('setItem 이 throw 해도 삭제는 끝까지 한다', () => {
    const inner = seededStore();
    const hostile: KeyValueStore = {
      getItem: (k) => inner.getItem(k),
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: (k) => inner.removeItem(k),
    };
    expect(reconcileAccountScope(hostile, 'uid-a')).toBe(true);
    for (const k of ACCOUNT_SCOPED_KEYS) expect(inner.getItem(k), k).toBeNull();
  });
});

describe('clearAccountScope', () => {
  it('로그아웃하면 주인 기록까지 지운다 — 다음 로그인은 "처음 보는 계정"이 된다', () => {
    const store = seededStore();
    reconcileAccountScope(store, 'uid-a');
    for (const k of ACCOUNT_SCOPED_KEYS) store.setItem(k, 'fresh');

    clearAccountScope(store);
    for (const k of ACCOUNT_SCOPED_KEYS) expect(store.getItem(k), k).toBeNull();
    // 주인 기록이 지워졌으므로 같은 계정으로 다시 로그인해도 "처음"으로 판정된다.
    expect(reconcileAccountScope(store, 'uid-a')).toBe(true);
  });
});

describe('키 목록 누락 방지', () => {
  /**
   * `src/**` 를 훑어 `'planet-blitz:...'` 리터럴을 전부 모은다.
   *
   * 런타임에서 접두사로 일괄 삭제하지 못하는 이유는 `KeyValueStore` 에 키 열거 API 가 없기
   * 때문이다(getItem/setItem/removeItem 뿐). 그래서 목록을 손으로 유지하는데, 손으로 유지하는
   * 목록은 반드시 낡는다 — 그 낡음을 여기서 잡는다.
   */
  function scanKeys(dir: string, found: Set<string>): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scanKeys(full, found);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/'(planet-blitz:[^']*)'/g)) found.add(m[1] as string);
    }
  }

  it('소스의 planet-blitz: 키가 전부 ACCOUNT_SCOPED_KEYS 에 있다(주인 기록 제외)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const found = new Set<string>();
    scanKeys(join(here, '..', 'src'), found);

    // 주인 기록 자체는 목록 밖이다 — 지우는 주체가 자기를 지우면 매 부팅 초기화가 돈다.
    const allowed = new Set<string>([...ACCOUNT_SCOPED_KEYS, 'planet-blitz:net:last-uid']);
    const missing = [...found].filter((k) => !allowed.has(k)).sort();

    expect(
      missing,
      `새 로컬 키를 만들었으면 src/net/accountScope.ts 의 ACCOUNT_SCOPED_KEYS 에 추가하라. ` +
        `계정 전환 때 이 키만 안 지워져 이전 계정 데이터가 남는다: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('목록의 키가 전부 소스에 실재한다(죽은 키가 쌓이지 않게)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const found = new Set<string>();
    scanKeys(join(here, '..', 'src'), found);

    const dead = ACCOUNT_SCOPED_KEYS.filter((k) => !found.has(k));
    expect(dead, `소스에 없는 키가 목록에 남아 있다: ${dead.join(', ')}`).toEqual([]);
  });
});
