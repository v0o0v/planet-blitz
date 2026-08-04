/**
 * 행성 로스터 표시 정본 — **성계 지도 전장 정찰 패널**이 읽는 "이 행성에서 무엇이 나오는가".
 *
 * ## 왜 별도 모듈인가 (보스 표시명 선례)
 * `src/ui/bossLabels.ts` 가 같은 이유로 존재한다 — 화면마다 목록을 조립하면 행성이 늘거나
 * 로스터가 바뀔 때 한 화면만 갱신되고 나머지는 조용히 낡는다. 여기서 **콘텐츠 레지스트리
 * (`data/planets/index.ts`)에서 전부 파생**하므로 새 행성 = 데이터 한 줄이면 정찰 패널이
 * 자동으로 따라온다. 하드코딩 목록은 만들지 않는다.
 *
 * ## 세 갈래를 한 줄로 세운다
 * | 출처 | 표시 | 스프라이트 |
 * | --- | --- | --- |
 * | `content.boss` | `boss.<id>` (bossLabels 와 같은 키) | `BOSS_ASSET_FILES[planet]` |
 * | `content.roster` (역할 4종) | `enemy.<id>` | `ENEMY_ASSET_FILES[typeIndex]` |
 * | `content.elites` | `enemy.<id>` | `ENEMY_ASSET_FILES[typeIndex]` |
 *
 * ⚠️ 스프라이트는 **`typeIndex` 로만** 찾는다(배열 순서 = 전역 typeIndex 계약). 이름이나 역할로
 * 유도하면 정예 두 종이 같은 파일을 다투고, 그 어긋남은 "런에는 맞게 뜨는데 정찰창만 틀리다"
 * 로만 드러난다. 파일명 정본은 `src/render/textures.ts` 하나다(전사본 금지).
 *
 * ⚠️ 정예의 표시 역할은 `EnemyDef.role`(gunner/charger)이 **아니라** `elite` 다 — 로스터 4종과
 * 같은 태그를 달면 "사수형이 둘"로 읽혀 정예임이 사라진다. 데이터의 role 은 웨이브 카드가
 * 쓰는 것이고 여기서는 표시 축만 바꾼다(데이터는 손대지 않는다).
 *
 * 순수 문자열/배열 유도(Pixi·DOM 미의존) — 캔버스 없이 테스트한다.
 */

import { planetContent } from '../../data/planets/index.js';
import type { EnemyDef, EnemyRole } from '../sim/patterns/types.js';
import { ENEMY_ASSET_FILES, BOSS_ASSET_FILES } from '../render/textures.js';
import { t } from '../i18n/index.js';
import { tShipKey, humanizeSlug } from './pixi/shipLabels.js';
import { bossName } from './bossLabels.js';

/** 정찰 로스터 한 칸의 표시 축(정예·보스는 데이터 role 이 아니라 표시 역할을 쓴다). */
export type ReconRole = EnemyRole | 'elite' | 'boss';

/** 로스터를 훑는 고정 순서 — 역할 4종은 항상 이 순서로 선다(행성이 바뀌어도 자리가 안 움직인다). */
export const ROSTER_ROLE_ORDER: readonly EnemyRole[] = ['charger', 'gunner', 'special', 'support'];

/** 정찰 패널 한 칸. 화면은 이 서술만 보고 그린다(레지스트리를 다시 뒤지지 않는다). */
export interface ReconUnit {
  /** `EnemyDef.id` 또는 `BossDef.id`(안정 식별자 — 테스트·하네스가 이름 문자열에 안 기댄다). */
  readonly id: string;
  /** 표시명(현재 로케일). */
  readonly name: string;
  readonly role: ReconRole;
  /** 역할 태그 표시명(현재 로케일). */
  readonly roleLabel: string;
  /** 스프라이트 basename. 등재 밖 typeIndex 면 `null`(호출부가 도형 폴백을 그린다). */
  readonly asset: string | null;
  /**
   * sim 히트박스 반지름. 정찰 창은 런과 **같은 배율**이라 `radius × 2` 를 지름으로 그리면
   * 화면에서 보는 크기가 실제 교전에서 보게 될 크기와 같다 — 크기 자체가 정보다(용암샘이
   * 수리드론보다 크다는 사실이 임의 크기로 그리면 지워진다).
   */
  readonly radius: number;
  /** 보스 칸인가(칩이 아니라 큰 자리를 받는다). */
  readonly boss: boolean;
}

/**
 * 적 표시명 — 키는 `enemy.<EnemyDef.id>`. 미등재 키는 slug 자리표시자로 내려앉아 화면에 키가
 * 노출되지 않는다(`tShipKey` 규율, 보스 표시명과 같은 처리).
 */
export function enemyName(def: EnemyDef): string {
  return tShipKey(`enemy.${def.id}`, humanizeSlug(def.id));
}

/** 역할 태그 표시명. 키는 `enemy.role.<role>`(전 역할 등재 — 폴백은 역할 코드 그대로). */
export function reconRoleLabel(role: ReconRole): string {
  return tShipKey(`enemy.role.${role}`, humanizeSlug(role));
}

/** typeIndex → 스프라이트 basename(등재 밖이면 null). 순수. */
export function enemyAssetFor(typeIndex: number): string | null {
  return ENEMY_ASSET_FILES[typeIndex] ?? null;
}

/** 행성 index → 보스 스프라이트 basename(등재 밖이면 null). 순수. */
export function bossAssetFor(planet: number): string | null {
  return BOSS_ASSET_FILES[planet] ?? null;
}

/**
 * 행성 index → 정찰 로스터(**보스 먼저**, 그다음 역할 4종, 마지막에 정예).
 *
 * 카르곤은 정예가 없어 5칸, 나머지 다섯 행성은 7칸이다 — 칸 수가 행성마다 다르므로 화면
 * 레이아웃은 **개수를 인자로 받는 순수 함수**여야 한다(`planetSelect.ts` 의 `reconLayout`).
 * 범위를 벗어난 index 는 `planetContent` 가 카르곤으로 되돌린다(손상 세이브 방어).
 */
export function planetReconRoster(planet: number): ReconUnit[] {
  const content = planetContent(planet);
  const out: ReconUnit[] = [
    {
      id: content.boss.id,
      name: bossName(content.index),
      role: 'boss',
      roleLabel: reconRoleLabel('boss'),
      asset: bossAssetFor(content.index),
      radius: content.boss.radius,
      boss: true,
    },
  ];
  for (const role of ROSTER_ROLE_ORDER) {
    const def = content.roster[role];
    out.push({
      id: def.id,
      name: enemyName(def),
      role,
      roleLabel: reconRoleLabel(role),
      asset: enemyAssetFor(def.typeIndex),
      radius: def.radius,
      boss: false,
    });
  }
  for (const def of content.elites) {
    out.push({
      id: def.id,
      name: enemyName(def),
      role: 'elite',
      roleLabel: reconRoleLabel('elite'),
      asset: enemyAssetFor(def.typeIndex),
      radius: def.radius,
      boss: false,
    });
  }
  return out;
}

/** 정찰 창 캡션 = `행성 · 부제`. 화면이 문자열을 조립하지 않게 여기서 만든다. */
export function reconCaption(name: string, subtitle: string): string {
  return t('planet.recon.caption', { name, subtitle });
}

/**
 * 이름표 한 줄 = `이름 · 역할`.
 *
 * ⚠️ **두 줄로 쪼개지 않는다.** 역할은 정찰에서 실제로 쓰는 정보인데(지원형은 우선 처치 대상,
 * 특수형은 자리를 깐다) 줄을 늘리면 이름표가 지형을 그만큼 더 가리고 잡몹 줄의 세로 여백도
 * 함께 커진다. 한 줄에 가운뎃점으로 붙이면 자리를 안 먹고 같은 것을 말한다.
 */
export function reconUnitLabel(unit: ReconUnit): string {
  return t('planet.recon.unit', { name: unit.name, role: unit.roleLabel });
}
