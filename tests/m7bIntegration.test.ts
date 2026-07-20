/**
 * M7b 통합 게이트 — **레인 사이 배선**만 보는 테스트.
 *
 * 각 레인의 단위 테스트는 배선이 통째로 빠져도 통과한다(순수 함수가 혼자 옳기 때문에).
 * 이 파일은 그 틈만 노린다:
 *   ① 정산이 실제로 설계도를 파생하는가(호출부가 부르지 않으면 파밍해도 0장).
 *   ② 지급 게이트웨이가 오프라인에서 조용히 죽고, 온라인에서 payload 를 그대로 넘기는가.
 *   ③ 부트스트랩이 방어체 게이트웨이 팩토리를 등록하는가(미등록이면 사령부가 영구 오프라인).
 *   ④ EF 확정 경로가 약탈 복제 RPC 를 실제로 부르는가(미호출이면 SQL 이 영원히 안 돈다).
 *   ⑤ 사령부 문구가 정본 카탈로그에 있는가(레인 로컬 폴백표가 철거됐는가).
 *   ⑥ 약탈 SQL 이 존재하는 컬럼을 읽는가(`invasions.status` 는 없다 — 실행 시점 폭발).
 *
 * 소스 문자열 대조를 쓰는 항목(③④)은 캔버스·Deno 런타임 없이 배선을 관찰할 유일한 수단이다
 * (defenseCommandPixi.test.ts 의 main.ts 패턴 가드와 같은 선례).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { settleRun } from '../src/save/settlement.js';
import { grantBlueprintDrops } from '../src/net/blueprints.js';
import { blueprintDropsFromLoot } from '../data/planets/index.js';
import { EN, KO } from '../src/i18n/catalog.js';
import { stripEmoji } from '../src/ui/pixi/text.js';
import {
  createCommandState,
  commitDraft,
  isDirty,
  setTab,
  placeRef,
  setTemplateId,
  setCoreHp,
} from '../src/ui/pixi/defenseCommand.js';
import { normalizeInvasionLayers, layersEqual } from '../src/sim/invasion/normalize.js';
import { MAP_TEMPLATE_STRAIGHT } from '../src/sim/invasion/constants.js';
import type { InvasionLayers, InvasionRef } from '../src/sim/invasion/types.js';
import { loadProfile } from '../src/save/profile.js';
import type { LootRecord } from '../src/sim/world.js';

/** 편집 표본 참조 2종(정수 5필드). */
const REF_A: InvasionRef = { catalogId: 0, level: 7, ascension: 1, affixSeed: 12345, rarity: 2 };
const REF_B: InvasionRef = { catalogId: 1, level: 3, ascension: 0, affixSeed: 777, rarity: 1 };

function src(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

/** rare 이상 드랍만 설계도를 낸다 — 파생이 실제로 터지는 표본을 시드 스윕으로 만든다. */
function lootSweep(planet: number, count: number): LootRecord[] {
  const out: LootRecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ seed: (i * 2654435761) >>> 0, rarity: 2, planet, tier: 0 } as LootRecord);
  }
  return out;
}

describe('M7b 통합 — 정산 → 설계도 파생', () => {
  it('settleRun 이 설계도 목록을 실제로 내놓는다(배선 누락이면 항상 빈 배열)', () => {
    const profile = loadProfile();
    const loot = lootSweep(0, 60);
    const out = settleRun(profile, { victory: true, loot, xpTotal: 0, resources: 0, planet: 0, tier: 0 });
    expect(Array.isArray(out.blueprintsGained)).toBe(true);
    expect(out.blueprintsGained.length).toBeGreaterThan(0);
  });

  it('정산이 내놓는 목록은 순수 파생과 정확히 같다(두 진실 금지)', () => {
    const profile = loadProfile();
    const loot = lootSweep(1, 40);
    const out = settleRun(profile, { victory: true, loot, xpTotal: 0, resources: 0, planet: 1, tier: 0 });
    expect(out.blueprintsGained).toEqual(blueprintDropsFromLoot(loot));
  });

  it('같은 런을 두 번 정산하면 같은 설계도가 나온다(결정론 — RNG 미소비)', () => {
    const loot = lootSweep(3, 40);
    const a = settleRun(loadProfile(), { victory: true, loot, xpTotal: 0, resources: 0, planet: 3, tier: 0 });
    const b = settleRun(loadProfile(), { victory: true, loot, xpTotal: 0, resources: 0, planet: 3, tier: 0 });
    expect(a.blueprintsGained).toEqual(b.blueprintsGained);
  });

  it('설계도는 프로필에 담기지 않는다 — 보유량은 서버가 진실이다', () => {
    const profile = loadProfile();
    settleRun(profile, {
      victory: true,
      loot: lootSweep(0, 20),
      xpTotal: 0,
      resources: 0,
      planet: 0,
      tier: 0,
    });
    expect(Object.keys(profile)).not.toContain('blueprints');
    expect(Object.keys(profile)).not.toContain('defenseBlueprints');
  });
});

describe('M7b 통합 — grant_blueprints 게이트웨이', () => {
  it('빈 목록은 RPC 를 부르지 않는다', async () => {
    let called = false;
    const n = await grantBlueprintDrops([], {
      config: { url: 'https://x.test', anonKey: 'k' },
      grant: async () => {
        called = true;
        return 9;
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });

  it('Supabase 미설정이면 완전 no-op 이다(throw 금지)', async () => {
    let called = false;
    const n = await grantBlueprintDrops([{ kind: 0, catalogId: 1, count: 1 }], {
      config: null,
      grant: async () => {
        called = true;
        return 9;
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });

  it('설정이 있으면 payload 를 그대로 넘기고 지급 장수를 돌려준다', async () => {
    let seen: readonly { kind: number; catalogId: number; count: number }[] = [];
    const grants = [
      { kind: 1, catalogId: 2, count: 1 },
      { kind: 3, catalogId: 0, count: 2 },
    ];
    const n = await grantBlueprintDrops(grants, {
      config: { url: 'https://x.test', anonKey: 'k' },
      grant: async (_c, g) => {
        seen = g;
        return 3;
      },
    });
    expect(n).toBe(3);
    expect(seen).toEqual(grants);
  });

  it('RPC 가 터져도 삼킨다 — 정산은 오프라인에서도 끝나야 한다', async () => {
    const n = await grantBlueprintDrops([{ kind: 0, catalogId: 0, count: 1 }], {
      config: { url: 'https://x.test', anonKey: 'k' },
      grant: async () => {
        throw new Error('boom');
      },
    });
    expect(n).toBe(0);
  });
});

describe('M7b 통합 — 부트스트랩 배선(main.ts)', () => {
  const main = src('../src/main.ts');

  it('정산 블록에서 설계도 지급을 부른다', () => {
    expect(main).toContain('grantBlueprintDrops(lastOutcome.blueprintsGained)');
  });

  it('설계도 지급은 오염 런 격리 블록 **안**에 있다(하네스/치트 런은 지급 없음)', () => {
    const guard = main.indexOf('if (!w.tainted && !harnessInvasionRun)');
    const call = main.indexOf('grantBlueprintDrops(lastOutcome.blueprintsGained)');
    const settle = main.indexOf('lastOutcome = settleRun(profile, {');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    // 정산이 먼저 돌아야 blueprintsGained 가 채워져 있다.
    expect(call).toBeGreaterThan(settle);
  });

  it('방어체 게이트웨이 팩토리를 등록한다(미등록이면 사령부가 영구 오프라인)', () => {
    expect(main).toContain('setDefenseUnitsGatewayFactory');
    expect(main).toContain('SupabaseDefenseUnitsGateway');
  });

  it('게이트웨이는 설정이 있을 때만 동적 import 한다(SDK 를 메인 청크에 싣지 않는다)', () => {
    expect(main).toContain("import('./net/defenseUnitsGateway.js')");
    expect(main).not.toContain("from './net/defenseUnitsGateway.js'");
  });
});

describe('M7b 통합 — 침공 확정 → 설계도 약탈(verify-invasion EF)', () => {
  const ef = src('../supabase/functions/verify-invasion/index.ts');

  it('확정 경로가 loot_defense_blueprint 를 부른다', () => {
    expect(ef).toContain("service.rpc('loot_defense_blueprint'");
    expect(ef).toContain('p_invasion_id: invasionId');
  });

  it('약탈 호출은 apply_invasion_result **뒤**에 온다(확정 전 지급 금지)', () => {
    expect(ef.indexOf("rpc('loot_defense_blueprint'")).toBeGreaterThan(
      ef.indexOf("rpc('apply_invasion_result'"),
    );
  });

  it('공격자 승리에서만 부른다', () => {
    const call = ef.indexOf("rpc('loot_defense_blueprint'");
    const guard = ef.lastIndexOf('if (attackerWon) {', call);
    expect(guard).toBeGreaterThan(-1);
  });

  it('service_role 클라이언트로만 부른다(callerClient 금지 — RPC 는 service 전용)', () => {
    expect(ef).not.toContain("callerClient.rpc('loot_defense_blueprint'");
  });
});

describe('M7b 통합 — 약탈 SQL 이 실재 컬럼만 읽는다', () => {
  const sql = src('../supabase/migrations/20260722020000_m7b_blueprint_drops.sql');
  const schema = src('../supabase/migrations/20260717000000_m4_initial_schema.sql');

  it('invasions 에는 status 컬럼이 없다(전제 확인)', () => {
    const table = schema.slice(schema.indexOf('create table if not exists public.invasions'));
    const body = table.slice(0, table.indexOf(');'));
    expect(body).toContain('verified_status');
    expect(body).not.toMatch(/^\s{2}status\s/m);
  });

  it('loot_defense_blueprint 는 verified_status 로 확정을 판별한다', () => {
    const fn = sql.slice(sql.indexOf('function public.loot_defense_blueprint'));
    expect(fn).toContain('v_inv.verified_status');
    expect(fn).not.toMatch(/v_inv\.status\b/);
  });

  it('배치는 침공이 상대한 방어 행(defense_id 스냅샷)에서 읽는다', () => {
    const fn = sql.slice(sql.indexOf('function public.loot_defense_blueprint'));
    expect(fn).toContain('v_inv.defense_id');
    // 폴백 경로도 활성 방어 1행으로 좁힌다(프로필당 활성 방어는 유일).
    expect(fn).toContain('and active');
  });

  it('ADR-0003 방어자 무손실 — 방어자 자산을 깎는 문장이 없다', () => {
    const fn = sql.slice(sql.indexOf('function public.loot_defense_blueprint'));
    expect(fn).not.toMatch(/delete\s+from\s+public\.defense_units/i);
    expect(fn).not.toMatch(/delete\s+from\s+public\.defense_blueprints/i);
    expect(fn).not.toMatch(/update\s+public\.defenses/i);
  });
});

describe('M7b 통합 — 편집 → 저장 → 재로드 정규화 왕복', () => {
  /** 사령부에서 실제로 하는 편집을 한 벌 쌓는다(4종 슬롯 + 템플릿 + 코어). */
  function editedDraft(): InvasionLayers {
    const st = createCommandState(null);
    st.draft = setTemplateId(st.draft, MAP_TEMPLATE_STRAIGHT);
    st.draft = placeRef(st.draft, { kind: 'wave', index: 2 }, REF_A);
    st.draft = placeRef(st.draft, { kind: 'socket', index: 5 }, REF_B);
    st.draft = placeRef(st.draft, { kind: 'prop', index: 1 }, REF_A);
    st.draft = placeRef(st.draft, { kind: 'boss', index: 0 }, REF_B);
    st.draft = setCoreHp(st.draft, 9500);
    commitDraft(st);
    return st.saved;
  }

  it('저장본을 다시 정규화해도 바이트 동일하다(normalizeInvasionLayers 멱등)', () => {
    const saved = editedDraft();
    expect(layersEqual(saved, normalizeInvasionLayers(saved))).toBe(true);
    expect(JSON.stringify(normalizeInvasionLayers(saved))).toBe(JSON.stringify(saved));
  });

  it('저장본으로 화면을 다시 열면 같은 배치가 나온다(왕복 무손실)', () => {
    const saved = editedDraft();
    const reopened = createCommandState(saved);
    expect(layersEqual(reopened.draft, saved)).toBe(true);
    expect(layersEqual(reopened.saved, saved)).toBe(true);
    expect(isDirty(reopened)).toBe(false);
  });

  it('직렬화 왕복(JSON)도 동일한 정규형으로 수렴한다 — 서버 저장·재로드 경로', () => {
    const saved = editedDraft();
    const wire = JSON.parse(JSON.stringify(saved)) as unknown;
    expect(layersEqual(normalizeInvasionLayers(wire as InvasionLayers), saved)).toBe(true);
  });

  it('탭을 옮겨도 미저장 편집이 남는다', () => {
    const st = createCommandState(null);
    st.draft = placeRef(st.draft, { kind: 'wave', index: 0 }, REF_A);
    expect(isDirty(st)).toBe(true);
    setTab(st, 1);
    setTab(st, 2);
    setTab(st, 0);
    expect(isDirty(st)).toBe(true);
    expect(st.draft.l1.waveSlots[0]).toEqual(REF_A);
  });
});

describe('M7b 통합 — 코어 모듈 차감 멱등(SQL 구조 가드)', () => {
  const sql = src('../supabase/migrations/20260722010000_m7b_core_modules.sql');
  const fn = sql.slice(sql.indexOf('function public.apply_invasion_result'));

  it('차감은 pending 게이트 **뒤**에 있다(확정 1회에만 돈다)', () => {
    const gate = fn.indexOf("v_inv.verified_status <> 'pending'");
    const dec = fn.indexOf('set charges_left = greatest(0, charges_left - 1)');
    expect(gate).toBeGreaterThan(-1);
    expect(dec).toBeGreaterThan(gate);
  });

  it('차감은 verified 확정 update 뒤에 있다(되돌아갈 수 없는 지점)', () => {
    expect(fn.indexOf('set charges_left = greatest(0, charges_left - 1)')).toBeGreaterThan(
      fn.indexOf("set verified_status = 'verified'"),
    );
  });

  it('쿨다운 거부 경로는 차감 전에 반환한다', () => {
    expect(fn.indexOf("'cooldown-violation'")).toBeLessThan(
      fn.indexOf('set charges_left = greatest(0, charges_left - 1)'),
    );
  });

  it('차감은 바닥 0 에서 멈춘다(음수 charges 금지)', () => {
    expect(fn).toContain('greatest(0, charges_left - 1)');
  });

  it('장착 배열 정리가 빈 슬롯을 밀집화하지 않는다(슬롯 i 의미 보존)', () => {
    const cleanup = fn.slice(fn.indexOf('update public.defenses d'));
    expect(cleanup).toContain('when x is null then null');
  });
});

describe('M7b 통합 — 사령부 문구가 정본 카탈로그에 있다', () => {
  const screen = src('../src/ui/pixi/defenseCommand.ts');
  const cmdKeys = Object.keys(EN).filter((k) => k.startsWith('def3.cmd.'));

  it('def3.cmd.* 키가 EN 정본에 등재돼 있다', () => {
    expect(cmdKeys.length).toBeGreaterThanOrEqual(60);
  });

  it('KO 가 같은 키를 전부 채운다', () => {
    for (const k of cmdKeys) {
      expect(typeof (KO as Record<string, string>)[k]).toBe('string');
      expect((KO as Record<string, string>)[k]).not.toBe('');
    }
  });

  it('레인 로컬 폴백표(i18n 임시 다리)가 철거됐다', () => {
    expect(screen).not.toContain('CMD_FALLBACK_EN');
    expect(screen).not.toContain('CMD_FALLBACK_KO');
    expect(screen).not.toContain('getLocale');
  });

  it('화면이 참조하는 def3.cmd 키가 모두 카탈로그에 있다', () => {
    const used = new Set<string>();
    for (const m of screen.matchAll(/'(def3\.cmd\.[A-Za-z0-9.]+)'/g)) used.add(m[1] as string);
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((k) => !(k in EN));
    expect(missing).toEqual([]);
  });

  it('사령부 문구에 컬러 이모지가 없다(Pixi 두부 방지)', () => {
    // 판정은 프로젝트 자신의 규칙(stripEmoji)으로 한다 — ◀ ▶ 같은 기하 기호는 흑백
    // 글리프가 있어 보존 대상이므로, 범용 이모지 정규식으로 재정의하면 규칙이 갈린다.
    for (const k of cmdKeys) {
      const en = (EN as Record<string, string>)[k] ?? '';
      const ko = (KO as Record<string, string>)[k] ?? '';
      expect(stripEmoji(en)).toBe(en);
      expect(stripEmoji(ko)).toBe(ko);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑦ 코어 모듈 화면 배선 (ModulesUI 레인) — 단위 테스트가 못 보는 틈.
// ---------------------------------------------------------------------------
// modulesView 의 순수 함수(pickEquipSlot·가격·합성 사전검증)는 화면이 부트스트랩에 아예
// 연결되지 않아도 전부 통과한다. 여기서 보는 것은 "정말 열리는가/정말 공개되는가" 뿐이다.
describe('M7b 통합 — 코어 모듈 화면 배선(main.ts)', () => {
  const main = src('../src/main.ts');

  it('방어 사령부의 모듈 열기가 ModulesScreen 으로 간다(미배선이면 화면이 영원히 안 열린다)', () => {
    expect(main).toContain("import { ModulesScreen } from './ui/pixi/modulesView.js'");
    expect(main).toContain('new ModulesScreen(');
    const open = main.indexOf('onOpenModules:');
    expect(open).toBeGreaterThan(-1);
    // 콜백 본문이 실제로 화면을 띄운다(빈 콜백이면 사령부 버튼이 먹통).
    expect(main.slice(open, open + 200)).toContain('modulesScreen.show(');
  });

  it('진입은 suspend/resume 경로다 — resume 콜백을 실제로 부른다(미저장 편집 보존)', () => {
    const open = main.indexOf('onOpenModules:');
    const body = main.slice(open, open + 200);
    expect(body).toContain('resume()');
  });

  it('레거시 카드 화면 경로가 남아 있지 않다(마이그레이션 적용 즉시 죽는 경로)', () => {
    expect(main).not.toContain('CardsScreen');
    expect(main).not.toContain('cardsView');
  });

  it('정찰 공개는 begin_invasion 스냅샷의 authority.modules 에서 온다(라이브 재조회 금지)', () => {
    expect(main).toContain('pendingRevealModules');
    const from = main.indexOf('pendingRevealModules = runModules');
    const use = main.indexOf('showOpts.revealModules = pendingRevealModules');
    expect(from).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(-1);
  });

  it('공개는 매 런 시작에 초기화된다(이전 침공분이 새지 않는다)', () => {
    // 대입이 최소 3곳: 초기화 선언 · 런 시작 리셋 · 결과 소비 후 리셋.
    const resets = main.split('pendingRevealModules = ').length - 1;
    expect(resets).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 어픽스가 sim 에 실제로 닿는가 (AffixWiring 레인).
// ---------------------------------------------------------------------------
// affix.ts 의 순수 함수는 세 레이어 중 어디에도 import 되지 않아도 단독으로 통과한다.
// 리롤 축이 전투 영향 0 이던 결함이 정확히 그 형태였다.
describe('M7b 통합 — 어픽스 sim 배선', () => {
  it('세 레이어(편대·설비·코어방)가 전부 affix 를 import 한다', () => {
    for (const rel of [
      '../src/sim/invasion/formation.ts',
      '../src/sim/invasion/facility.ts',
      '../src/sim/invasion/coreRoom.ts',
    ]) {
      expect(src(rel)).toContain("from './affix.js'");
    }
  });

  it('affix 는 sim 결정론 규율을 지킨다(Math.random·Date.now·performance.now 금지)', () => {
    const affix = src('../src/sim/invasion/affix.ts');
    // 주석까지 포함해 전수 — 산문에도 안 쓰이므로 오탐이 없다.
    expect(affix).not.toContain('Math.random');
    expect(affix).not.toContain('Date.now');
    expect(affix).not.toContain('performance.now');
  });
});
