/**
 * 행성 콘텐츠 레지스트리 — 데이터 주도 행성 메타(plan Phase E3, AC8).
 *
 * 한 행성의 "전투 콘텐츠 묶음"(로스터·엘리트·웨이브 카드 풀·보스·드랍 테이블·특산
 * 광물 2종)을 한 곳에 모아 index로 노출한다. 시뮬(웨이브 디렉터·보스)과 정산/성계
 * 지도(다른 레인)가 모두 이 레지스트리를 `state.config.planet`으로 조회해 소비한다 —
 * 새 행성 추가 = 여기에 행 하나 추가(코드 아닌 데이터 작업, plan 원칙4).
 *
 * planetIndex는 WorldConfig.planet(0 카르곤 / 1 베르단)과 1:1. 드랍 테이블은
 * src/sim/drops.ts가 rarity odds 기준으로 소비하고, 특산 광물은 정산 레이어(Lane 2)가
 * 분해 환산에 쓴다(광물 id·이름만 데이터로 고정, 수치 밸런스는 정산에서).
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';
import type { BossDef } from '../boss.js';
import { KARGON_ROSTER } from '../enemies.js';
import { CARD_POOL } from '../waves.js';
import { LAVA_FORTRESS } from '../boss.js';
import { BERDAN_ROSTER, BERDAN_ELITES, BERDAN_CARD_POOL } from './berdan.js';
import { BERDAN_QUEEN } from '../bosses/berdan-queen.js';
import { NIFLHEIM_ROSTER, NIFLHEIM_ELITES, NIFLHEIM_CARD_POOL } from './niflheim.js';
import { NIFLHEIM_FLAGSHIP } from '../bosses/niflheim-flagship.js';
import { ARKE_ROSTER, ARKE_ELITES, ARKE_CARD_POOL } from './arke.js';
import { ARKE_OBELISK } from '../bosses/arke-obelisk.js';

/** 행성×티어 드랍 rarity 기준 확률(src/sim/drops.ts가 소비). */
export interface PlanetDropTable {
  /** 엘리트 레어 기본 확률(정찰 티어). */
  readonly eliteRareBase: number;
  /** 엘리트 유니크 기본 확률(정찰 티어). */
  readonly eliteUniqueBase: number;
  /** 보스 유니크 기본 확률(나머지는 레어 확정). */
  readonly bossUniqueBase: number;
}

/** 행성 특산 광물(분해 환산·상점 재료). 데이터 id·이름만 고정. */
export interface Mineral {
  readonly id: string;
  /** 한글 표기(툴팁/정산). */
  readonly name: string;
}

/** 한 행성의 전투 콘텐츠 묶음. */
export interface PlanetContent {
  readonly index: number;
  readonly id: string;
  /** 한글 표기(성계 지도/HUD). */
  readonly name: string;
  /** 역할 슬롯 로스터(웨이브 카드가 역할로 참조). */
  readonly roster: Record<EnemyRole, EnemyDef>;
  /** 정예(엘리트-타입) 적. 웨이브 카드의 elite 인덱스가 참조. */
  readonly elites: readonly EnemyDef[];
  readonly cardPool: readonly WaveCard[];
  readonly boss: BossDef;
  readonly dropTable: PlanetDropTable;
  /** 특산 광물 2종. */
  readonly minerals: readonly [Mineral, Mineral];
}

/** 카르곤(0) — M1 화산 행성. 기존 로스터/카드/보스 재사용. */
export const KARGON: PlanetContent = {
  index: 0,
  id: 'kargon',
  name: '카르곤',
  roster: KARGON_ROSTER,
  elites: [],
  cardPool: CARD_POOL,
  boss: LAVA_FORTRESS,
  // 카르곤 드랍 기준값 = src/sim/drops.ts 기존 상수(정합). 변경 시 함께 유지.
  dropTable: { eliteRareBase: 0.25, eliteUniqueBase: 0.03, bossUniqueBase: 0.15 },
  minerals: [
    { id: 'kargon-obsidian', name: '흑요석 파편' },
    { id: 'kargon-magmite', name: '용암정' },
  ],
};

/** 베르단(1) — M2 곤충 군체 행성. 물량 압박·소환 여왕. */
export const BERDAN: PlanetContent = {
  index: 1,
  id: 'berdan',
  name: '베르단',
  roster: BERDAN_ROSTER,
  elites: BERDAN_ELITES,
  cardPool: BERDAN_CARD_POOL,
  boss: BERDAN_QUEEN,
  // 물량 행성: 레어는 카르곤과 비슷하되 유니크가 살짝 후하다(파밍 유인).
  dropTable: { eliteRareBase: 0.27, eliteUniqueBase: 0.04, bossUniqueBase: 0.18 },
  minerals: [
    { id: 'berdan-chitin', name: '경화 키틴' },
    { id: 'berdan-royal-jelly', name: '여왕 젤리' },
  ],
};

/** 니플헤임(2) — M3 빙설·유령 함대 행성. 그물·감속 압박·유령 기함. */
export const NIFLHEIM: PlanetContent = {
  index: 2,
  id: 'niflheim',
  name: '니플헤임',
  roster: NIFLHEIM_ROSTER,
  elites: NIFLHEIM_ELITES,
  cardPool: NIFLHEIM_CARD_POOL,
  boss: NIFLHEIM_FLAGSHIP,
  // 서리 행성: 레어는 베르단과 비슷하되 유니크가 살짝 더 후하다(심층 파밍 유인).
  dropTable: { eliteRareBase: 0.28, eliteUniqueBase: 0.05, bossUniqueBase: 0.2 },
  minerals: [
    { id: 'niflheim-rime-crystal', name: '서리 결정' },
    { id: 'niflheim-ghost-alloy', name: '유령 합금' },
  ],
};

/** 아르케(3) — M3 고대 기계 행성. 정밀 포격·기하학 탄막·수호자 오벨리스크. */
export const ARKE: PlanetContent = {
  index: 3,
  id: 'arke',
  name: '아르케',
  roster: ARKE_ROSTER,
  elites: ARKE_ELITES,
  cardPool: ARKE_CARD_POOL,
  boss: ARKE_OBELISK,
  // 심층 행성: 최고 난도인 만큼 레어·유니크 확률이 가장 높다.
  dropTable: { eliteRareBase: 0.3, eliteUniqueBase: 0.06, bossUniqueBase: 0.22 },
  minerals: [
    { id: 'arke-ancient-core', name: '고대 코어' },
    { id: 'arke-relic-plating', name: '유물 장갑판' },
  ],
};

/** 행성 레지스트리(index 순). 새 행성은 여기에 append. */
export const PLANETS: readonly PlanetContent[] = [KARGON, BERDAN, NIFLHEIM, ARKE];

/** planet index → 콘텐츠. 범위를 벗어나면 카르곤(0)으로 안전 폴백. */
export function planetContent(index: number | undefined): PlanetContent {
  return PLANETS[index ?? 0] ?? KARGON;
}
