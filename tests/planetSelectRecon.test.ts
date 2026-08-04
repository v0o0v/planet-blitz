/**
 * 성계 지도 **전장 정찰 로스터**의 불변식 (2026-08-04).
 *
 * ## 이 테스트가 막는 결함
 * 정찰 패널은 세 갈래가 맞물려야 한 칸이 완성된다 — 레지스트리(어떤 적이 나오나) · i18n
 * (뭐라고 부르나) · 자산(무슨 그림인가). 셋 중 **무엇이 빠져도 화면은 죽지 않는다**:
 * 이름이 없으면 slug 자리표시자가, 그림이 없으면 도형 폴백이 조용히 대신한다. 그래서
 * 결손은 예외도 로그도 없이 "그 칸만 이상한" 형태로만 드러난다 — 이 리포가 스킬 아이콘·
 * 침공 방어체에서 두 번 밟은 유형이다. 세 갈래를 여기서 함께 잠근다.
 *
 * 좌표는 캔버스 없이 검증된다(`reconLayout` 이 순수 함수) — 겹침·창 이탈은 눈으로만 잡히는
 * 유형이라 `planetSelectAaaLayout.test.ts` 와 같은 규율로 단위 테스트가 본다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { reconScene, ARENA_VIEWPORT } from '../src/ui/pixi/planetSelect.js';
import {
  planetReconRoster,
  enemyName,
  reconRoleLabel,
  reconUnitLabel,
  ROSTER_ROLE_ORDER,
} from '../src/ui/enemyLabels.js';
import { PLANETS as PLANET_CONTENT } from '../data/planets/index.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';
import { ENEMY_ASSET_FILES } from '../src/render/textures.js';
import { RECON_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';
import { CATALOG } from '../src/i18n/catalog.js';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const FILES = new Set(readdirSync(ASSETS));

describe('로스터 파생 — 콘텐츠 레지스트리가 정본', () => {
  for (const content of PLANET_CONTENT) {
    it(`${content.name}: 보스 1 + 역할 ${ROSTER_ROLE_ORDER.length} + 정예 ${content.elites.length}`, () => {
      const units = planetReconRoster(content.index);
      expect(units).toHaveLength(1 + ROSTER_ROLE_ORDER.length + content.elites.length);

      // 보스가 **맨 앞** 한 칸(화면이 큰 자리를 그 하나에 준다).
      expect(units.filter((u) => u.boss)).toHaveLength(1);
      expect(units[0]?.boss).toBe(true);
      expect(units[0]?.id).toBe(content.boss.id);
      expect(units[0]?.role).toBe('boss');

      // 역할 4종은 항상 같은 순서(행성을 바꿔도 자리가 안 움직인다).
      ROSTER_ROLE_ORDER.forEach((role, i) => {
        const u = units[1 + i];
        expect(u?.role).toBe(role);
        expect(u?.id).toBe(content.roster[role].id);
      });

      // 정예는 데이터 role(gunner/charger)이 아니라 **표시 역할 elite** 를 단다.
      content.elites.forEach((def, i) => {
        const u = units[1 + ROSTER_ROLE_ORDER.length + i];
        expect(u?.id).toBe(def.id);
        expect(u?.role).toBe('elite');
      });
    });

    it(`${content.name}: 한 행성 안에서 표시명이 겹치지 않는다`, () => {
      const names = planetReconRoster(content.index).map((u) => u.name);
      expect(new Set(names).size).toBe(names.length);
    });
  }

  it('범위 밖 행성 index 는 카르곤으로 되돌아간다(손상 세이브 방어)', () => {
    expect(planetReconRoster(999).map((u) => u.id)).toEqual(
      planetReconRoster(0).map((u) => u.id),
    );
  });
});

describe('표시명 — 전 적/역할이 카탈로그에 등재돼 있다', () => {
  it('ENEMY_BY_TYPE 전량이 en·ko 양쪽에 `enemy.<id>` 를 갖는다', () => {
    const missing: string[] = [];
    for (const def of ENEMY_BY_TYPE) {
      const key = `enemy.${def.id}`;
      const en = (CATALOG.en as Record<string, string>)[key];
      const ko = (CATALOG.ko as Record<string, string>)[key];
      if (en === undefined || en.length === 0) missing.push(`en:${key}`);
      if (ko === undefined || ko.length === 0) missing.push(`ko:${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('표시명이 slug 자리표시자로 내려앉지 않는다(등재 누락 신호)', () => {
    for (const def of ENEMY_BY_TYPE) {
      // 자리표시자는 `Kargon Charger` 처럼 slug 를 다듬은 영문이다 — 등재돼 있으면 안 나온다.
      expect(enemyName(def)).not.toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
    }
  });

  it('이름표 한 줄에 이름과 역할이 함께 들어간다', () => {
    for (const c of PLANET_CONTENT) {
      for (const u of planetReconRoster(c.index)) {
        const line = reconUnitLabel(u);
        expect(line).toContain(u.name);
        expect(line).toContain(u.roleLabel);
      }
    }
  });

  it('역할 태그 6종이 전부 등재돼 있다', () => {
    for (const role of [...ROSTER_ROLE_ORDER, 'elite', 'boss'] as const) {
      const label = reconRoleLabel(role);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(role);
    }
  });
});

describe('스프라이트 — 등재 ↔ 실물', () => {
  it('ENEMY_ASSET_FILES 는 typeIndex 축과 1:1 이고 중복이 없다', () => {
    expect(ENEMY_ASSET_FILES).toHaveLength(ENEMY_BY_TYPE.length);
    expect(new Set(ENEMY_ASSET_FILES).size).toBe(ENEMY_ASSET_FILES.length);
  });

  it('정찰이 부르는 모든 이름이 assets/ 에 실재한다', () => {
    expect(RECON_ASSET_NAMES.filter((n) => !FILES.has(n))).toEqual([]);
  });

  it('전 행성 로스터의 스프라이트가 결손 없이 잡힌다', () => {
    const holes: string[] = [];
    for (const content of PLANET_CONTENT) {
      for (const u of planetReconRoster(content.index)) {
        if (u.asset === null || !FILES.has(u.asset)) holes.push(`${content.id}:${u.id}`);
        // 로더가 실제로 읽는 목록에 없으면 텍스처가 없어 도형으로 떨어진다(조용한 결손).
        else if (!RECON_ASSET_NAMES.includes(u.asset)) holes.push(`unloaded:${u.id}`);
      }
    }
    expect(holes).toEqual([]);
  });
});

describe('편성 배치 — 지형 위에서 겹치지 않고 창을 안 벗어난다', () => {
  const W = ARENA_VIEWPORT.w;
  const H = ARENA_VIEWPORT.h;

  /** 실제 행성의 (보스 지름, 잡몹 지름들) — 화면이 쓰는 것과 같은 입력으로 검사한다. */
  const cases = PLANET_CONTENT.map((c) => {
    const units = planetReconRoster(c.index);
    const boss = units.find((u) => u.boss)!;
    return {
      name: c.name,
      bossD: boss.radius * 2,
      mobDs: units.filter((u) => !u.boss).map((u) => u.radius * 2),
    };
  });

  for (const c of cases) {
    const at = reconScene(W, H, c.bossD, c.mobDs);

    it(`${c.name}: 잡몹 ${c.mobDs.length}마리와 이름표가 창 안에 있다`, () => {
      for (const s of at.mobs) {
        expect(s.x - s.d / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + s.d / 2).toBeLessThanOrEqual(W);
        expect(s.y - s.d / 2).toBeGreaterThanOrEqual(0);
        // 이름표까지 창 안이어야 한다(밖으로 나가면 마스크가 잘라 먹는다).
        expect(s.labelY + 24).toBeLessThanOrEqual(H);
      }
    });

    it(`${c.name}: 잡몹끼리 가로로 겹치지 않는다`, () => {
      for (let i = 1; i < at.mobs.length; i++) {
        const prev = at.mobs[i - 1]!;
        const cur = at.mobs[i]!;
        expect(cur.x - cur.d / 2).toBeGreaterThanOrEqual(prev.x + prev.d / 2 - 0.001);
      }
    });

    it(`${c.name}: 보스는 캡션 아래·잡몹 줄 위에 서고 가장 크다`, () => {
      expect(at.boss.d).toBeGreaterThan(0);
      expect(at.boss.y - at.boss.d / 2).toBeGreaterThanOrEqual(at.caption.y);
      expect(at.boss.x - at.boss.d / 2).toBeGreaterThanOrEqual(0);
      expect(at.boss.x + at.boss.d / 2).toBeLessThanOrEqual(W);
      const rowTop = Math.min(...at.mobs.map((s) => s.y - s.d / 2));
      expect(at.boss.labelY + 24).toBeLessThanOrEqual(rowTop);
      for (const s of at.mobs) expect(at.boss.d).toBeGreaterThan(s.d);
    });

    it(`${c.name}: 그려지는 크기 순서가 sim 반지름 순서와 같다`, () => {
      // 축소는 전부 같은 비율이라 입력 지름의 대소 관계가 보존된다(크기 = 정보).
      const byInput = [...c.mobDs.keys()].sort((a, b) => c.mobDs[a]! - c.mobDs[b]!);
      const byDrawn = [...at.mobs.keys()].sort((a, b) => at.mobs[a]!.d - at.mobs[b]!.d);
      expect(byDrawn.map((i) => c.mobDs[i])).toEqual(byInput.map((i) => c.mobDs[i]));
    });
  }

  it('좁은 창에서도 전부 같은 비율로 줄어 창 안에 담긴다', () => {
    const mobDs = [108, 96, 88, 72, 64, 56];
    for (const w of [420, 700, W]) {
      const at = reconScene(w, H, 256, mobDs);
      for (const s of at.mobs) {
        expect(s.x - s.d / 2).toBeGreaterThanOrEqual(-0.001);
        expect(s.x + s.d / 2).toBeLessThanOrEqual(w + 0.001);
      }
      const ratio = at.mobs[0]!.d / at.mobs[at.mobs.length - 1]!.d;
      expect(ratio).toBeCloseTo(mobDs[0]! / mobDs[mobDs.length - 1]!, 5);
    }
  });

  it('잡몹이 없어도(방어적) 보스가 창 안에 남는다', () => {
    const at = reconScene(W, H, 256, []);
    expect(at.mobs).toEqual([]);
    expect(at.boss.y + at.boss.d / 2).toBeLessThanOrEqual(H);
  });
});
