/**
 * 행성 보스 표시명 — 순수 유도 + **프로덕션 배선** 회귀 (사용자 신고 2026-07-27:
 * "행성 격추 위에 해당 행성 이름이 계속 카르곤으로만 표시 됨").
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 다. 이름 유도 함수가
 * 아무리 옳아도 **HUD 가 그것을 부르지 않으면** 화면은 예전 하드코딩 그대로다 — 실제로 그랬다
 * (`hud.ts` 생성자가 '카르곤 · 용암 요새 전차' 를 박아 두고 한 번도 갱신하지 않았다). 그래서
 * 두 층으로 방어한다.
 *  ① 순수 유도: 6행성이 **서로 다른** 이름을 내고, 키는 `BossDef.id` 에서 파생된다.
 *  ② grep 게이트: `src/main.ts` 가 HUD 보스 상태에 `bossHudName(w.config.planet)` 을 싣고,
 *     정산 상태에 `planet` 을 실어 승리 문구가 보스 이름을 파생하는지 정적 단언한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { bossName, bossHudName, planetDisplayName } from '../src/ui/bossLabels.js';
import { PLANETS } from '../data/planets/index.js';
import { CATALOG } from '../src/i18n/catalog.js';

/** 저장소 상대 경로의 소스를 읽는다(`tests/node-shims.d.ts` 의 readFileSync 는 인코딩 인자 없음). */
function readSrc(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

describe('① 보스 표시명 유도(행성 파생)', () => {
  it('6행성이 서로 다른 보스 이름을 낸다 — 카르곤 고정이 아니다', () => {
    const names = PLANETS.map((p) => bossName(p.index));
    expect(names.length).toBe(PLANETS.length);
    expect(new Set(names).size, `중복: ${names.join(',')}`).toBe(names.length);
    for (const n of names) expect(n.length).toBeGreaterThan(0);
    // 회귀 못박기: 카르곤(0) 이름이 다른 행성에서 나오면 안 된다.
    const kargon = bossName(0);
    for (const p of PLANETS.slice(1)) expect(bossName(p.index), `행성 ${p.index}`).not.toBe(kargon);
  });

  it('표시명 키는 BossDef.id 파생이라 카탈로그에 6종이 전부 등재돼 있다', () => {
    // 하드코딩 목록이 아니라 레지스트리 순회 — 행성이 늘면 이 테스트가 누락을 잡는다.
    for (const p of PLANETS) {
      const key = `boss.${p.boss.id}`;
      expect(
        Object.prototype.hasOwnProperty.call(CATALOG.en, key),
        `${key} 가 영어 카탈로그에 없다`,
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(CATALOG.ko, key),
        `${key} 가 한국어 카탈로그에 없다`,
      ).toBe(true);
    }
  });

  it('HUD 머리글은 `행성 · 보스` 이고 둘 다 그 행성 값이다', () => {
    for (const p of PLANETS) {
      const line = bossHudName(p.index);
      expect(line).toContain(planetDisplayName(p.index));
      expect(line).toContain(bossName(p.index));
    }
    // 범위 밖·미지정은 카르곤으로 안전 폴백(planetContent 계약) — 던지지 않는다.
    expect(bossHudName(undefined).length).toBeGreaterThan(0);
    expect(bossHudName(999).length).toBeGreaterThan(0);
  });
});

describe('② 프로덕션 배선 grep 게이트(src/main.ts · src/ui/hud.ts)', () => {
  const MAIN = readSrc('src/main.ts');
  const HUD = readSrc('src/ui/hud.ts');

  it('HUD 보스 상태에 런의 행성에서 파생한 이름을 싣는다', () => {
    expect(/name:\s*bossHudName\(w\.config\.planet\)/.test(MAIN), 'main.ts 가 bossHudName 을 싣지 않는다').toBe(
      true,
    );
  });

  it('hud.ts 는 이름을 하드코딩하지 않고 매 갱신마다 상태에서 읽는다', () => {
    expect(/this\.bossName\.textContent\s*=\s*s\.boss\.name/.test(HUD), '갱신 배선 없음').toBe(true);
    // 리터럴 대입이 남아 있으면 안 된다(주석 속 결함 서술은 무관하므로 **대입문**만 본다).
    expect(
      /this\.bossName\.textContent\s*=\s*['"`]/.test(HUD),
      '보스 이름을 문자열 리터럴로 박아 두고 있다',
    ).toBe(false);
  });

  it('정산 상태에 planet 을 실어 승리 문구가 보스 이름을 파생한다', () => {
    expect(/planet:\s*w\.config\.planet\s*\?\?\s*0/.test(MAIN), 'ResultState.planet 미전달').toBe(true);
    for (const rel of ['src/ui/resultOverlay.ts', 'src/ui/pixi/resultOverlay.ts']) {
      const src = readSrc(rel);
      expect(
        /t\('result\.win\.sub',\s*\{\s*name:\s*bossName\(s\.planet\)/.test(src),
        `${rel} 가 승리 문구에 보스 이름을 넣지 않는다`,
      ).toBe(true);
    }
  });
});

describe('③ 정산 "다시 출격" 은 성계 지도로 간다(사용자 신고 2026-07-27)', () => {
  const MAIN = readSrc('src/main.ts');

  it('resultOverlay.show 의 재출격 콜백이 openStarMap 이다', () => {
    // show(state, onRestart, onInventory) 의 **두 번째 인자**가 재출격이다. 예전에는
    // openBaseMap 이라 기지 지도로 돌아가 성계 지도를 다시 열어야 했다.
    const call = MAIN.match(/resultOverlay\.show\(([\s\S]*?)\n {4}\);/);
    expect(call, 'main.ts 에서 resultOverlay.show 호출을 찾지 못했다').not.toBeNull();
    const body = call?.[1] ?? '';
    expect(/\(\)\s*=>\s*openStarMap\(\)/.test(body), '재출격이 성계 지도로 가지 않는다').toBe(true);
  });
});
