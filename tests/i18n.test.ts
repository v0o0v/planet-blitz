/**
 * 로컬라이즈 코어 검증 (src/i18n — M5 Phase C3, AC8).
 *
 * 카탈로그 완전성(EN↔KO 키 동수)·초기 로케일 선택(순수)·`t()` 조회/치환/폴백을 검증한다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EN, KO } from '../src/i18n/catalog.js';
import { t, setLocale, getLocale, pickInitialLocale, isLocale } from '../src/i18n/index.js';
import { STICKERS } from '../data/stickers.js';
import { INVASION_CATALOG, DEF3_MESSAGE_KEYS, def3NameKey, def3DescKey } from '../data/invasion/catalog.js';
import {
  DEFENSE_UNIT_AFFIXES,
  DEFENSE_UNIQUES,
  DEFENSE_UNIQUE_MESSAGE_KEYS,
  defenseUnitAffixNameKey,
  defenseUnitAffixDescKey,
  defenseUniqueNameKey,
  defenseUniqueDescKey,
} from '../data/defenseUnits.js';
import {
  CORE_MODULE_UNIQUES,
  MODULE_AFFIXES,
  moduleUniqueNameKey,
  moduleUniqueDescKey,
  moduleAffixNameKey,
  moduleAffixDescKey,
} from '../data/coreModules.js';
import { SHIP_TYPES, shipTypeDef, zeroSkillInvest } from '../data/ships/index.js';
import {
  shipTypeName,
  shipTypeRole,
  shipSignatureDesc,
  shipTreeName,
  hasMessageKey,
} from '../src/ui/pixi/shipLabels.js';
import {
  LEGACY_SHOWCASE,
  SHIP_SHOWCASE_NAMES,
  UI_ASSET_NAMES,
  shipShowcaseName,
} from '../src/ui/pixi/uiTextures.js';
import {
  LEGACY_SHIP_SPRITE,
  SHIP_SPRITE_NAMES,
  shipSpriteName,
  applyShipSprite,
  resolveShipTextures,
} from '../src/render/textures.js';
import { panelMessageKey } from '../src/ui/pixi/modulesView.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';

afterEach(() => {
  setLocale('en'); // 다른 테스트에 로케일 누수 방지.
});

describe('카탈로그 완전성', () => {
  it('EN 과 KO 가 정확히 같은 키 집합을 가진다(누락/잉여 0)', () => {
    const enKeys = Object.keys(EN).sort();
    const koKeys = Object.keys(KO).sort();
    expect(koKeys).toEqual(enKeys);
  });

  it('모든 문구가 비어 있지 않다', () => {
    for (const v of Object.values(EN)) expect(v.length).toBeGreaterThan(0);
    for (const v of Object.values(KO)) expect(v.length).toBeGreaterThan(0);
  });

  it('도발 스티커 전종(STICKERS) 키가 EN·KO 양쪽에 존재한다', () => {
    // stickerPicker.stickerTextKey 는 `sticker.<id>` 로 무검증 캐스팅하므로, 신규 id 추가 시
    // i18n 키 누락을 이 테스트가 잡도록 하드코딩 목록이 아닌 STICKERS 정본에서 파생한다(LOW#2).
    expect(STICKERS.length).toBeGreaterThan(0);
    for (const s of STICKERS) {
      expect(EN, `EN missing sticker.${s.id}`).toHaveProperty(`sticker.${s.id}`);
      expect(KO, `KO missing sticker.${s.id}`).toHaveProperty(`sticker.${s.id}`);
    }
  });

  /**
   * 침공 3레이어 콘텐츠명 규약(`def3.<식별자>.name` / `.desc` — L9-garrison-catalog).
   * 검증 목록을 하드코딩하지 않고 **카탈로그 배열에서 파생**한다(STICKERS 선례). 그래야 M7c 에서
   * 방어체를 append 할 때 문구를 채우기 전까지 이 테스트가 빨간불로 남는다.
   */
  it('침공 카탈로그 전종의 def3.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(INVASION_CATALOG.length).toBeGreaterThan(0);
    expect(DEF3_MESSAGE_KEYS.length).toBe(INVASION_CATALOG.length * 2);
    for (const e of INVASION_CATALOG) {
      for (const key of [def3NameKey(e.i18nId), def3DescKey(e.i18nId)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 방어체 어픽스(M7b · data/defenseUnits.ts)의 `def3.affix.<id>.name/.desc` 전수.
   * 어픽스 정의 배열에서 파생하므로, 어픽스를 append 하면 문구를 채우기 전까지 빨간불이다.
   */
  it('방어체 어픽스 전종의 def3.affix.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(DEFENSE_UNIT_AFFIXES.length).toBeGreaterThan(0);
    for (const a of DEFENSE_UNIT_AFFIXES) {
      for (const key of [defenseUnitAffixNameKey(a.id), defenseUnitAffixDescKey(a.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 모듈 어픽스(M7b · data/coreModules.ts)의 `def3.affix.<id>.name/.desc` 전수.
   * 구 카드 어픽스는 데이터에 한글 `name` 필드를 들고 있었다 — 그 리터럴을 i18n 으로 옮기면서
   * 검증도 **배열 파생**으로 세워, 어픽스를 추가하면 문구를 채우기 전까지 빨간불이게 만든다.
   */
  it('모듈 어픽스 전종의 def3.affix.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(MODULE_AFFIXES.length).toBeGreaterThan(0);
    for (const a of MODULE_AFFIXES) {
      for (const key of [moduleAffixNameKey(a.id), moduleAffixDescKey(a.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /** 코어 모듈 유니크(M7b · data/coreModules.ts)의 `def3.module.<id>.name/.desc` 전수. */
  it('코어 모듈 유니크 전종의 def3.module.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(CORE_MODULE_UNIQUES.length).toBeGreaterThan(0);
    for (const u of CORE_MODULE_UNIQUES) {
      for (const key of [moduleUniqueNameKey(u.id), moduleUniqueDescKey(u.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 유니크 방어체 고유 효과(M7b · data/defenseUnits.ts)의 `def3.duq.<id>.name/.desc` 전수.
   *
   * 이 테스트가 없던 동안 duq 16키는 EN·KO 양쪽에 **하나도 없는데 스위트가 전부 그린**이었다
   * (통합 게이트 finding #7). 카탈로그·어픽스·모듈은 전부 배열 파생 검증이 있었는데 유니크만
   * 빠져 있었던 것 — 검증 사각지대 자체가 결함이었다. DEF3_MESSAGE_KEYS 선례대로 정본 배열에서
   * 파생하므로 유니크를 append 하면 문구를 채우기 전까지 빨간불로 남는다.
   */
  it('유니크 방어체 고유 효과 전종의 def3.duq.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(DEFENSE_UNIQUES.length).toBeGreaterThan(0);
    expect(DEFENSE_UNIQUE_MESSAGE_KEYS.length).toBe(DEFENSE_UNIQUES.length * 2);
    for (const u of DEFENSE_UNIQUES) {
      for (const key of [defenseUniqueNameKey(u.id), defenseUniqueDescKey(u.id)]) {
        expect(DEFENSE_UNIQUE_MESSAGE_KEYS).toContain(key);
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 고아 키 가드 — 카탈로그에서 **파생되지 않는** `def3.<카탈로그 종류>.*` 키가 EN·KO 에 남아
   * 있으면 잡는다. 카탈로그 항목을 지우거나 슬러그를 개명했을 때 문구만 남아 조용히 썩는 자리다
   * (존재 검증만으로는 절대 안 잡힌다 — 방향이 반대라서).
   * `def3.affix.*` / `def3.module.*` / `def3.duq.*` / `def3.cmd.*` 는 카탈로그 파생이 아니므로
   * 대상에서 제외한다(각자 별도 배열 파생 테스트가 위에 있다).
   */
  it('카탈로그에 없는 고아 def3.<종류>.* 키가 EN·KO 에 남아 있지 않다', () => {
    const kindPrefixes = ['formation', 'fac', 'prop', 'boss', 'map'];
    const derived = new Set(DEF3_MESSAGE_KEYS);
    const isCatalogKey = (k: string): boolean =>
      kindPrefixes.some((p) => k.startsWith(`def3.${p}.`));
    for (const [label, table] of [
      ['EN', EN as unknown as Record<string, string>],
      ['KO', KO as unknown as Record<string, string>],
    ] as const) {
      const orphans = Object.keys(table).filter((k) => isCatalogKey(k) && !derived.has(k));
      expect(orphans, `${label} orphan def3 keys`).toEqual([]);
    }
  });

  it('def3.affix.* / def3.module.* / def3.duq.* 문구도 비지 않고 컬러 이모지를 쓰지 않는다', () => {
    const table = (o: Record<string, string>, k: string): string => o[k] ?? '';
    const keys = [
      ...DEFENSE_UNIT_AFFIXES.flatMap((a) => [
        defenseUnitAffixNameKey(a.id),
        defenseUnitAffixDescKey(a.id),
      ]),
      ...CORE_MODULE_UNIQUES.flatMap((u) => [moduleUniqueNameKey(u.id), moduleUniqueDescKey(u.id)]),
      ...MODULE_AFFIXES.flatMap((a) => [moduleAffixNameKey(a.id), moduleAffixDescKey(a.id)]),
      ...DEFENSE_UNIQUE_MESSAGE_KEYS,
    ];
    for (const key of keys) {
      for (const [label, t] of [
        ['EN', EN as unknown as Record<string, string>],
        ['KO', KO as unknown as Record<string, string>],
      ] as const) {
        const v = table(t, key);
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('def3.* 문구는 비어 있지 않고 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    const record = (o: Record<string, string>, k: string): string => o[k] ?? '';
    for (const key of DEF3_MESSAGE_KEYS) {
      for (const [label, table] of [
        ['EN', EN as unknown as Record<string, string>],
        ['KO', KO as unknown as Record<string, string>],
      ] as const) {
        const v = record(table, key);
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 확인 팝업·조회 실패 전용 문구 (플레이테스트 F-1/F-2)
// ---------------------------------------------------------------------------
//
// 실측 결함: 두 화면 모두 **전용 키가 없어 다른 상황의 문구를 빌려 썼다**. [시험 침공] 확인
// 팝업은 버튼 라벨을 이어 붙여 "저장하지 않은 변경 · 시험 침공"이라는 문장 아닌 문장을 띄웠고,
// 코어 모듈 조회 실패는 서버 연결 안내를 대신 띄워 "연결 없음"과 "조회 실패"를 뭉갰다.
// 키 존재만 보면 다시 빌려 쓰는 회귀를 놓치므로 **화면 배선까지 함께** 대조한다.

describe('전용 문구 — 시험 침공 확인 팝업 / 코어 모듈 조회 실패', () => {
  const readSource = (rel: string): string =>
    new TextDecoder().decode(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
  const table = (o: unknown): Record<string, string> => o as Record<string, string>;

  const CONFIRM_KEYS = [
    'def3.cmd.test.confirm.title',
    'def3.cmd.test.confirm.body',
    'def3.cmd.test.confirm.saveAndGo',
    'def3.cmd.test.confirm.discardAndGo',
    'def3.cmd.test.confirm.cancel',
  ] as const;
  const LOAD_KEYS = ['mod.load.failed', 'mod.load.retry'] as const;

  it('신규 키가 EN·KO 양쪽에 있고 비어 있지 않다', () => {
    for (const key of [...CONFIRM_KEYS, ...LOAD_KEYS]) {
      for (const [label, t] of [
        ['EN', table(EN)],
        ['KO', table(KO)],
      ] as const) {
        expect(t[key], `${label} missing ${key}`).toBeTypeOf('string');
        expect((t[key] ?? '').length, `${label} empty ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('신규 문구에 컬러 이모지가 없다(Pixi 두부 방지 — ▶ ◀ 만 예외)', () => {
    for (const key of [...CONFIRM_KEYS, ...LOAD_KEYS]) {
      for (const [label, t] of [
        ['EN', table(EN)],
        ['KO', table(KO)],
      ] as const) {
        expect(t[key], `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('확인 팝업 세 갈래가 서로 다른 문구다(버튼 라벨 재활용 금지)', () => {
    for (const [label, t] of [
      ['EN', table(EN)],
      ['KO', table(KO)],
    ] as const) {
      const choices = [
        t['def3.cmd.test.confirm.saveAndGo'],
        t['def3.cmd.test.confirm.discardAndGo'],
        t['def3.cmd.test.confirm.cancel'],
      ];
      expect(new Set(choices).size, `${label} duplicate choice labels`).toBe(3);
      // 빌려 쓰던 원 문구와도 달라야 한다(되돌아가면 이 단정이 깨진다).
      for (const borrowed of ['def3.cmd.dirty', 'def3.cmd.test', 'def3.cmd.save', 'def3.cmd.back']) {
        expect(t['def3.cmd.test.confirm.body'], `${label} body == ${borrowed}`).not.toBe(t[borrowed]);
        expect(t['def3.cmd.test.confirm.title'], `${label} title == ${borrowed}`).not.toBe(t[borrowed]);
      }
    }
  });

  it('조회 실패 문구가 오프라인 안내와 다르다(mod.slot.offline 재활용 금지)', () => {
    for (const [label, t] of [
      ['EN', table(EN)],
      ['KO', table(KO)],
    ] as const) {
      expect(t['mod.load.failed'], `${label} failed == offline`).not.toBe(t['mod.slot.offline']);
      expect(t['mod.load.failed'], `${label} failed == inv.empty`).not.toBe(t['mod.inv.empty']);
    }
  });

  it('방어 사령부 확인 팝업이 전용 키를 실제로 쓴다(배선 대조)', () => {
    const src = readSource('../src/ui/pixi/defenseCommand.ts');
    for (const key of CONFIRM_KEYS) expect(src, `unused ${key}`).toContain(key);
  });

  it('코어 모듈 화면의 실패 안내가 mod.load.* 로 갈아 끼워졌다(배선 대조)', () => {
    // 판정 함수가 돌려주는 키 자체를 못 박는다 — 문구만 추가하고 매핑을 안 바꾸면 여기서 걸린다.
    expect(panelMessageKey('failed')).toBe('mod.load.failed');
    const src = readSource('../src/ui/pixi/modulesView.ts');
    expect(src).toContain('mod.load.failed');
    expect(src).toContain('mod.load.retry');
    // 실패 분기가 다시 서버 연결 안내로 폴백하면 두 상태가 도로 뭉개진다.
    expect(src).not.toMatch(/panelMessageKey\([^)]*\)\s*\?\?\s*'mod\.slot\.offline'/);
  });
});

// ---------------------------------------------------------------------------
// 기체 타입 문자열 (M8-L9) — 검증 목록은 전부 `SHIP_TYPES` 파생이다.
//
// 하드코딩 목록을 쓰면 `data/ships/index.ts` 에 타입이 append 될 때 이 스위트가 새 키를
// **모르고 그대로 그린**이 된다(설계서 §10-6 이 예측한 지점). STICKERS·INVASION_CATALOG
// 선례대로 정본 배열에서 파생해, 타입을 추가하면 문구를 채우기 전까지 빨간불로 남긴다.
// ---------------------------------------------------------------------------

/** `ship.<slug>.name` / `.role` — 전 타입 필수. */
function shipNameKeys(): string[] {
  return SHIP_TYPES.flatMap((d) => [`ship.${d.slug}.name`, `ship.${d.slug}.role`]);
}

/**
 * `ship.<slug>.signature` — **시그니처를 가진 타입만.** 스트라이커는 `signatureBit = -1`
 * (설계서 §11: 의도된 부재)이라 키가 있으면 고아다. `shipSignatureDesc` 도 같은 조건으로
 * 갈라지므로 화면과 검증이 같은 규칙을 쓴다.
 */
function shipSignatureKeys(): string[] {
  return SHIP_TYPES.filter((d) => d.signatureBit >= 0).map((d) => `ship.${d.slug}.signature`);
}

/** `lab.tree.<treeSlug>` — 전 타입 × 3계열. 스트라이커 3개는 기존 키가 그대로 맞는다. */
function shipTreeKeys(): string[] {
  return [...new Set(SHIP_TYPES.flatMap((d) => d.trees.map((t) => `lab.tree.${t.slug}`)))];
}

/**
 * `champion.bp.<축>` — 라벨 목록이 아니라 **`baseBp` 필드 파생**이다. 섀시 보정 축이 하나
 * 늘면(예: 관통) 라벨이 없다는 것을 이 테스트가 즉시 말한다.
 */
function shipBpKeys(): string[] {
  const axes = new Set<string>();
  for (const d of SHIP_TYPES) {
    for (const k of Object.keys(d.baseBp)) axes.add(`champion.bp.${k.replace(/Bp$/, '')}`);
  }
  return [...axes];
}

/** 챔피언 선택 화면이 부르는 그 밖의 키(배열 파생이 불가능한 화면 크롬). */
const CHAMPION_CHROME_KEYS = [
  'champion.title',
  'champion.roster',
  'champion.rosterSub',
  'champion.confirm',
  'champion.current',
  'champion.signature',
  'champion.signature.none',
  'champion.chassis',
  'champion.trees',
  'champion.tree.meta',
  'champion.retire.title',
  'champion.retire.body',
  'champion.retire.yes',
  'champion.retire.no',
  'hangar.act.swapShip',
];

function allShipKeys(): string[] {
  return [
    ...shipNameKeys(),
    ...shipSignatureKeys(),
    ...shipTreeKeys(),
    ...shipBpKeys(),
    ...CHAMPION_CHROME_KEYS,
  ];
}

describe('기체 타입 카탈로그 완전성 (SHIP_TYPES 파생)', () => {
  it('전 기체 타입의 ship.<slug>.name/.role 이 EN·KO 양쪽에 존재한다', () => {
    expect(SHIP_TYPES.length).toBeGreaterThan(0);
    for (const key of shipNameKeys()) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('시그니처를 가진 타입만 ship.<slug>.signature 를 갖는다(스트라이커는 없다)', () => {
    const keys = shipSignatureKeys();
    expect(keys.length).toBe(SHIP_TYPES.filter((d) => d.signatureBit >= 0).length);
    for (const key of keys) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
    for (const d of SHIP_TYPES) {
      if (d.signatureBit >= 0) continue;
      expect(EN, `EN orphan ship.${d.slug}.signature`).not.toHaveProperty(
        `ship.${d.slug}.signature`,
      );
      expect(KO, `KO orphan ship.${d.slug}.signature`).not.toHaveProperty(
        `ship.${d.slug}.signature`,
      );
    }
  });

  it('전 타입 3계열의 lab.tree.<slug> 가 EN·KO 양쪽에 존재한다', () => {
    const keys = shipTreeKeys();
    // 스트라이커 3 + 신규 4종 × 3 = 15(중복 없음). 계열 slug 가 겹치면 이 수가 줄어든다.
    expect(keys.length).toBe(new Set(keys).size);
    for (const key of keys) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('섀시 보정 4축(baseBp 파생)과 챔피언 화면 크롬 키가 EN·KO 양쪽에 존재한다', () => {
    for (const key of [...shipBpKeys(), ...CHAMPION_CHROME_KEYS]) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('기체 문구가 비어 있지 않고 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    for (const key of allShipKeys()) {
      for (const [label, table] of [
        ['EN', EN as unknown as Record<string, string>],
        ['KO', KO as unknown as Record<string, string>],
      ] as const) {
        const v = table[key] ?? '';
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  /**
   * **반려된 컨셉 어휘 가드**(2026-07-21 사용자 지시).
   *
   * typeId 4 는 원래 곤충·생체(`bion`, 계열 `swarm`/`mutate`/`blight`) 컨셉이었고 사용자가
   * 명시적으로 반려했다 — "벌레 말고 다른 컨셉. 너무 징그럽다. 귀여운 걸로." 개명은 slug 만
   * 바꾸면 끝나지 않는다: 문구는 사람이 손으로 쓰므로 다음에 이 기체 텍스트를 손볼 때 옛
   * 어휘가 조용히 되돌아올 수 있고, 그때 잡아주는 것이 아무것도 없다. 그래서 **기체 표시
   * 문자열 전역**(이름·소개·시그니처·계열명)에 대해 금지 어휘를 테스트로 못박는다.
   *
   * 적·이상현상 쪽 문구(`anomaly.swarm`·`def3.boss.sporeQueen` 등)는 대상이 아니다 — 반려된
   * 것은 **플레이어가 조종하는 기체**의 컨셉이지 적 진영의 세계관이 아니다.
   */
  it('기체 문구에 반려된 곤충·생체 어휘가 없다(4번 기체 개명 후퇴 방지)', () => {
    const bannedKo = ['벌레', '곤충', '군체', '군집', '역병', '변이', '포자', '유충', '촌충',
      '촉수', '점액', '기생', '감염', '징그'];
    const bannedEn = /\b(bug|bugs|insect|insects|larva|larvae|swarm|swarms|plague|blight|spore|spores|mutate|mutation|parasite|infest\w*|vermin|maggot)\b/i;
    const keys = [...shipNameKeys(), ...shipSignatureKeys(), ...shipTreeKeys()];
    for (const key of keys) {
      const en = (EN as unknown as Record<string, string>)[key] ?? '';
      const ko = (KO as unknown as Record<string, string>)[key] ?? '';
      expect(en, `EN banned concept vocabulary in ${key}`).not.toMatch(bannedEn);
      for (const w of bannedKo) {
        expect(ko.includes(w), `KO "${w}" in ${key}: ${ko}`).toBe(false);
      }
    }
  });

  /**
   * 고아 키 가드 — 레지스트리에서 **파생되지 않는** `ship.*` / `lab.tree.*` 키가 남아 있으면
   * 잡는다. 존재 검증은 방향이 반대라 이것을 절대 못 잡는다: 타입·계열 slug 를 개명하면 옛
   * 문구가 조용히 남아 썩는다(`def3` 고아 가드와 같은 논리).
   */
  it('레지스트리에서 파생되지 않는 고아 ship.* / lab.tree.* 키가 없다', () => {
    // `lab.tree.sub` 는 계열 이름이 아니라 트리 패널 부제다 — 접두사만 겹친다.
    const treeAllow = new Set([...shipTreeKeys(), 'lab.tree.sub']);
    const shipAllow = new Set([...shipNameKeys(), ...shipSignatureKeys()]);
    for (const [label, table] of [
      ['EN', EN as unknown as Record<string, string>],
      ['KO', KO as unknown as Record<string, string>],
    ] as const) {
      const keys = Object.keys(table);
      expect(
        keys.filter((k) => k.startsWith('ship.') && !shipAllow.has(k)),
        `${label} orphan ship.* keys`,
      ).toEqual([]);
      expect(
        keys.filter((k) => k.startsWith('lab.tree.') && !treeAllow.has(k)),
        `${label} orphan lab.tree.* keys`,
      ).toEqual([]);
    }
  });
});

describe('기체 표시명 — 정규 경로 통합 (Profile → buildRunConfig → createWorld → stepWorld)', () => {
  /**
   * 설계서 §10-6 의 결함은 "카탈로그에 키를 넣었는데 화면이 다른 키를 본다" 이므로, 키 존재만
   * 봐서는 닫히지 않는다. **런을 실제로 굴린 뒤** 그 런의 `shipType` 으로 화면 함수를 호출해
   * 자리표시자(`humanizeSlug` 결과)가 아니라 카탈로그 문자열이 나오는지 확인한다.
   */
  it('실제로 굴린 런의 shipType 으로 뽑은 이름·시그니처·계열명이 자리표시자가 아니다', () => {
    for (const def of SHIP_TYPES) {
      const p = defaultProfile();
      const ship = activeShip(p);
      ship.typeId = def.id;
      ship.skillInvest = zeroSkillInvest(def.id);

      const cfg = buildRunConfig(p, { planet: 0, stage: 1 });
      expect(cfg.shipType, `${def.slug} shipType`).toBe(def.id);

      const state = createWorld(4242, { ...cfg, playerHp: 100_000_000 });
      for (let i = 0; i < 30; i++) stepWorld(state, emptyInput());

      const live = shipTypeDef(state.config.shipType ?? 0);
      expect(live.slug).toBe(def.slug);

      for (const [locale, table] of [
        ['en', EN as unknown as Record<string, string>],
        ['ko', KO as unknown as Record<string, string>],
      ] as const) {
        setLocale(locale);
        // 등재 여부를 먼저 못박는다 — `tShipKey` 는 미등재 키를 자리표시자로 덮으므로,
        // 반환값만 보면 "키가 없는데 그럴듯한 문자열"이 통과한다(EN 'Striker' 가 실제로
        // 자리표시자와 같다). 등재 + 카탈로그 값 일치를 함께 본다.
        expect(hasMessageKey(`ship.${live.slug}.name`), `${locale}/${def.slug} name key`).toBe(true);
        expect(shipTypeName(live), `${locale}/${def.slug} name`).toBe(
          table[`ship.${live.slug}.name`],
        );
        expect(shipTypeRole(live), `${locale}/${def.slug} role`).toBe(
          table[`ship.${live.slug}.role`],
        );
        if (live.signatureBit >= 0) {
          expect(shipSignatureDesc(live), `${locale}/${def.slug} signature`).toBe(
            table[`ship.${live.slug}.signature`],
          );
        } else {
          expect(shipSignatureDesc(live)).toBe('');
        }
        for (const tree of live.trees) {
          expect(hasMessageKey(`lab.tree.${tree.slug}`), `${locale}/${tree.slug} key`).toBe(true);
          expect(shipTreeName(tree), `${locale}/${tree.slug}`).toBe(table[`lab.tree.${tree.slug}`]);
        }
      }
    }
  });
});

describe('기체 아트 슬롯 — 파일이 없어도 폴백이 동작한다', () => {
  it('쇼케이스·인게임 스프라이트 basename 이 SHIP_TYPES 파생이고 중복이 없다', () => {
    expect(SHIP_SHOWCASE_NAMES.length).toBe(SHIP_TYPES.length);
    expect(SHIP_SPRITE_NAMES.length).toBe(SHIP_TYPES.length);
    expect(new Set(SHIP_SHOWCASE_NAMES).size).toBe(SHIP_TYPES.length);
    expect(new Set(SHIP_SPRITE_NAMES).size).toBe(SHIP_TYPES.length);
    // 타입 0 만 레거시 이름을 유지한다(파일 개명 금지 — 설계서 §9).
    expect(SHIP_SHOWCASE_NAMES[0]).toBe(LEGACY_SHOWCASE);
    expect(SHIP_SPRITE_NAMES[0]).toBe(LEGACY_SHIP_SPRITE);
    for (const d of SHIP_TYPES.slice(1)) {
      expect(SHIP_SHOWCASE_NAMES[d.id]).toBe(`ship_showcase_${d.slug}.png`);
      expect(SHIP_SPRITE_NAMES[d.id]).toBe(`ship_${d.slug}.png`);
    }
  });

  it('쇼케이스 전종이 UI 로더 목록에 등재돼 있다(등재 누락 = 조용한 null)', () => {
    for (const name of SHIP_SHOWCASE_NAMES) expect(UI_ASSET_NAMES).toContain(name);
  });

  /**
   * 아트는 코드보다 늦게 온다. 실 PNG 가 하나도 없는 상태(= 로더가 전 슬롯 null)에서도
   * 소비 측 폴백 사슬이 **예외 없이** 값을 낸다는 것을 확인한다. 격납고
   * (`src/ui/pixi/hangar.ts:543`)와 같은 식이다.
   */
  it('로드된 텍스처가 하나도 없어도 쇼케이스 조회가 예외 없이 폴백한다', () => {
    const empty: Record<string, string | null> = {};
    const legacyOnly: Record<string, string | null> = { [LEGACY_SHOWCASE]: 'legacy' };
    for (const d of SHIP_TYPES) {
      const name = shipShowcaseName(d.id);
      expect(() => empty[name] ?? empty[LEGACY_SHOWCASE] ?? null).not.toThrow();
      expect(empty[name] ?? empty[LEGACY_SHOWCASE] ?? null).toBeNull(); // Graphics 폴백으로 내려간다
      expect(legacyOnly[name] ?? legacyOnly[LEGACY_SHOWCASE]).toBe('legacy');
    }
  });

  it('손상된 typeId 도 존재하지 않는 파일명을 만들지 않는다(0 으로 복귀)', () => {
    for (const bad of [999, -1, Number.NaN, SHIP_TYPES.length]) {
      expect(shipShowcaseName(bad)).toBe(LEGACY_SHOWCASE);
      expect(shipSpriteName(bad)).toBe(LEGACY_SHIP_SPRITE);
    }
  });

  /**
   * **아트 부채를 코드에 명시한다.** 신규 6종의 PNG 는 아직 없다(생성은 별도 파이프라인).
   * 이 테스트는 "없어도 괜찮다"를 고정하는 것이 아니라, 파일이 도착했을 때 목록이 자동으로
   * 따라오는지를 본다 — 존재 여부는 폴백이 흡수하므로 실패시키지 않는다.
   */
  /**
   * `applyShipSprite` = 런 시작 시점의 **동기** 교체(W4 게이트 신규). basename 유도만 보는
   * 위 케이스들은 "이름은 맞는데 플레이어 슬롯에 실제로 안 들어간다"를 못 잡는다.
   */
  it('applyShipSprite 가 플레이어 슬롯을 그 타입의 스프라이트로 실제로 바꾼다', () => {
    const stub = {
      player: 'procedural' as unknown,
      shipByType: SHIP_TYPES.map((d) => `tex:${d.slug}` as unknown),
    } as unknown as Parameters<typeof applyShipSprite>[0];

    for (const d of SHIP_TYPES) {
      applyShipSprite(stub, d.id);
      expect(stub.player as unknown as string).toBe(`tex:${d.slug}`);
    }
    // 손상 typeId 는 0(스트라이커)으로 복귀 — 조용히 다른 기체를 그리지 않는다.
    for (const bad of [999, -1, Number.NaN, SHIP_TYPES.length]) {
      applyShipSprite(stub, bad);
      expect(stub.player as unknown as string).toBe(`tex:${SHIP_TYPES[0]!.slug}`);
    }
  });

  /**
   * **정규 경로**: `Profile{typeId}` → `buildRunConfig` → `createWorld` → `stepWorld` 로 실제
   * 런을 굴린 뒤, **그 런의 `config.shipType`** 으로 스프라이트를 고른다. 위 케이스들은
   * `applyShipSprite(stub, def.id)` 처럼 typeId 를 손으로 넣으므로 "프로필의 기체가
   * WorldConfig 까지 도달하지 못한다"(설계서 §10-2)를 못 잡는다 — 그 결함이 있으면 단위
   * 테스트는 전부 그린인데 화면에는 늘 스트라이커가 뜬다.
   *
   * 로더의 폴백 조립도 같은 코드(`resolveShipTextures`)로 통과시켜, "이름은 맞는데 슬롯이
   * 레거시로 덮인다"까지 함께 본다.
   */
  it('실제로 굴린 런의 shipType 이 그 기체의 스프라이트 슬롯을 고른다', () => {
    // 전 타입 PNG 가 존재하는 상태를 흉내 낸다(파일명 = 로더가 실제로 tryLoad 하는 이름).
    const loaded = SHIP_SPRITE_NAMES.map((n, id) =>
      id === 0 ? null : (`tex:${n}` as unknown as string),
    );
    const legacy = 'tex:player.png';

    for (const def of SHIP_TYPES) {
      const p = defaultProfile();
      const ship = activeShip(p);
      ship.typeId = def.id;
      ship.skillInvest = zeroSkillInvest(def.id);

      const cfg = buildRunConfig(p, { planet: 0, stage: 1 });
      const state = createWorld(4242, { ...cfg, playerHp: 100_000_000 });
      for (let i = 0; i < 30; i++) stepWorld(state, emptyInput());

      const live = state.config.shipType ?? 0;
      expect(live, `${def.slug} run shipType`).toBe(def.id);
      expect(shipSpriteName(live), `${def.slug} sprite name`).toBe(
        def.id === 0 ? LEGACY_SHIP_SPRITE : `ship_${def.slug}.png`,
      );

      const tex = {
        player: legacy as unknown,
        shipByType: resolveShipTextures(loaded, legacy) as unknown[],
      } as unknown as Parameters<typeof applyShipSprite>[0];
      applyShipSprite(tex, live);
      expect(tex.player as unknown as string, `${def.slug} player slot`).toBe(
        def.id === 0 ? legacy : `tex:ship_${def.slug}.png`,
      );
    }
  });

  /** 아트가 없는 타입은 레거시(`player.png`) 슬롯으로 내려간다 — 예외 없이, 조용히. */
  it('타입 전용 PNG 가 하나도 없으면 전 슬롯이 레거시로 폴백한다', () => {
    const legacy = 'tex:player.png';
    const none = SHIP_TYPES.map(() => null);
    const slots = resolveShipTextures(none, legacy);
    expect(slots.length).toBe(SHIP_TYPES.length);
    for (const s of slots) expect(s).toBe(legacy);
  });

  /**
   * **디스크에 실재하는** 기체 PNG 의 규격 가드(2026-07-21 아트 배치분).
   *
   * 존재를 강제하지 않는다 — 아트는 코드보다 늦게 오고 폴백이 흡수한다. 대신 **있는 파일은**
   * 레지스트리 파생 이름이어야 하고 인게임 스프라이트는 64×64 여야 한다(쇼케이스 128×128 을
   * 인게임 슬롯에 잘못 떨어뜨리면 화면에서만 티가 난다). typeId 0 의 `player.png` 는 M8 이전
   * 자산이라 반드시 있어야 한다.
   */
  it('assets/ 에 있는 기체 스프라이트는 레지스트리 이름 + 64x64 이다', () => {
    const png = (name: string): Uint8Array | null => {
      try {
        return readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)));
      } catch {
        return null; // 아직 안 온 아트 — 폴백이 흡수한다.
      }
    };
    const be32 = (b: Uint8Array, off: number): number =>
      new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, false);

    expect(png(LEGACY_SHIP_SPRITE), 'player.png 은 M8 이전 자산이라 반드시 존재한다').not.toBeNull();
    for (const name of SHIP_SPRITE_NAMES) {
      const buf = png(name);
      if (buf === null) continue;
      expect([...buf.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), `${name} PNG`).toBe(
        'PNG',
      );
      expect(be32(buf, 16), `${name} width`).toBe(64);
      expect(be32(buf, 20), `${name} height`).toBe(64);
    }
  });

  it('필요한 기체 아트 파일 목록이 레지스트리와 정확히 일치한다', () => {
    const need = [...SHIP_SHOWCASE_NAMES.slice(1), ...SHIP_SPRITE_NAMES.slice(1)];
    expect(need).toEqual([
      'ship_showcase_bruiser.png',
      'ship_showcase_arccaster.png',
      'ship_showcase_phantom.png',
      'ship_showcase_hatchling.png',
      'ship_showcase_mallow.png',
      'ship_showcase_bubble.png',
      'ship_bruiser.png',
      'ship_arccaster.png',
      'ship_phantom.png',
      'ship_hatchling.png',
      'ship_mallow.png',
      'ship_bubble.png',
    ]);
  });
});

describe('초기 로케일 선택(순수)', () => {
  it('저장된 수동 선택이 최우선', () => {
    expect(pickInitialLocale('ko', 'en-US')).toBe('ko');
    expect(pickInitialLocale('en', 'ko-KR')).toBe('en');
  });

  it('저장값 없으면 브라우저 언어의 ko 접두사를 감지', () => {
    expect(pickInitialLocale(null, 'ko-KR')).toBe('ko');
    expect(pickInitialLocale(null, 'ko')).toBe('ko');
  });

  it('그 외에는 영어 기본(글로벌 우선)', () => {
    expect(pickInitialLocale(null, 'en-US')).toBe('en');
    expect(pickInitialLocale(null, undefined)).toBe('en');
    expect(pickInitialLocale('garbage', 'fr-FR')).toBe('en');
  });

  it('isLocale 가드', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('jp')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('t() 조회·치환·폴백', () => {
  it('현재 로케일 문자열을 돌려준다', () => {
    setLocale('en');
    expect(t('result.win.title')).toBe('Planet Conquered');
    setLocale('ko');
    expect(t('result.win.title')).toBe('행성 정복');
    expect(getLocale()).toBe('ko');
  });

  it('{name} 플레이스홀더를 params 로 치환한다', () => {
    setLocale('en');
    expect(t('result.levelShort', { n: 42 })).toBe('Lv 42');
    expect(t('planet.launch', { name: 'Kargon' })).toBe('▶ Launch Kargon');
  });

  it('params 없으면 플레이스홀더를 그대로 둔다(치환 실패 방어)', () => {
    setLocale('en');
    expect(t('result.levelShort')).toBe('Lv {n}');
  });
});
