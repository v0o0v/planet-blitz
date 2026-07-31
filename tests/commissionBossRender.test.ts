/**
 * 의뢰 보스 3종 **렌더 배선** 구조 대조 (Phase F).
 *
 * ## 이 테스트가 막는 결함
 *
 * `data/commissionBosses.ts` 의 계약(`COMMISSION_BOSS_ENEMY_TYPE_BASE = 6`)은 두 렌더 카탈로그가
 * 정확히 그 지점에서 이어붙기를 요구한다 — `bossActor.ts` 의 `BOSS_MODELS`(3D)와 `textures.ts` 의
 * `BOSS_ASSET_FILES`(2D 폴백). 이 등식이 어긋나면:
 *  - 카탈로그가 **짧으면** 의뢰 보스가 행성 보스 모델/텍스처를 뒤집어쓴다(인덱스가 남의 슬롯을
 *    가리킨다).
 *  - 카탈로그가 어긋나면 `resolveSpriteSlot`/`hasBossModel` 이 빈 슬롯 또는 엉뚱한 슬롯을 집는다.
 * 두 경우 다 예외도 로그도 없이 **조용히 잘못된 그림만** 나온다(`invasionAssetPresence.test.ts`
 * 머리말과 같은 실패 형태) — 그래서 등식 자체를 구조로 잠근다.
 *
 * 의뢰 보스 3종의 GLB(`boss_cm_salvage`/`boss_cm_warlord`/`boss_cm_runner`)는 이미 생성·등재돼
 * 있다(`assets/models/manifest.json`, 원장 자체의 정합은 `modelManifest.test.ts` 가 별도로 건다).
 * 여기서는 **그 GLB 가 정확히 6·7·8 슬롯에 배선됐는가**만 본다.
 *
 * ## 왜 목록을 순회하지 않는가
 * `BOSS_ASSET_FILES`/`BOSS_MODELS` 를 그대로 순회해 자기 자신과 대조하면, 두 배열이 **함께**
 * 실수로 줄거나 늘어도 루프는 통과한다(대조군이 없다). 그래서 이 파일 안에 **독립 전사본**
 * (파일명 리터럴)을 두고, 검증은 그 전사본 → 소스 → 디스크 순으로 돌린다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BOSS_ASSET_FILES } from '../src/render/textures.js';
import { BOSS_MODELS, hasBossModel } from '../src/render/three3d/bossActor.js';
import { COMMISSION_BOSS_ENEMY_TYPE_BASE, COMMISSION_BOSSES } from '../data/commissionBosses.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const MODELS_DIR = join(ROOT, 'assets', 'models');
// `node-shims.d.ts` 는 `existsSync` 를 선언하지 않는다(최소 표면 규율) — 기존 자산 대조 테스트
// (`invasionAssetPresence.test.ts`)와 같이 `readdirSync` + `Set` 로 존재를 확인한다.
const ASSET_FILES = new Set(readdirSync(ASSETS));
const MODEL_FILES = new Set(readdirSync(MODELS_DIR));

/**
 * **독립 전사본** — 행성 보스 6종 + 의뢰 보스 3종의 기대 2D 파일명. `BOSS_ASSET_FILES` 를 베껴
 * 온 것이 아니라 계획서·주석을 보고 손으로 다시 적은 것이다(대조군). 이 리터럴이 바뀌지 않는 한,
 * 소스가 몰래 줄거나(9→8) 순서가 뒤섞이면(카르곤과 아르케가 자리를 바꾸면) 여기서 잡힌다.
 */
const EXPECTED_BOSS_ASSET_FILES: readonly string[] = [
  'boss.png', // 0 카르곤
  'boss_berdan.png', // 1 베르단
  'boss_niflheim.png', // 2 니플헤임
  'boss_arke.png', // 3 아르케
  'boss_toxar.png', // 4 톡사르
  'boss_kras.png', // 5 크라스
  'boss.png', // 6 연쇄 원정(의뢰) — 전용 2D 없어 잠정 재사용
  'boss_arke.png', // 7 정예 소집령(의뢰) — 전용 2D 없어 잠정 재사용
  'boss_niflheim.png', // 8 현상금 표적(의뢰) — 전용 2D 없어 잠정 재사용
];

/**
 * **독립 전사본** — 의뢰 보스 3종의 기대 GLB 파일명(순서 = 카탈로그 인덱스 0/1/2, 실제
 * `BOSS_MODELS` 인덱스는 `COMMISSION_BOSS_ENEMY_TYPE_BASE` 만큼 밀린 6/7/8). `assets/models/
 * manifest.json` 의 `usedBy` 필드에 적힌 문자열을 보고 손으로 옮겨 적었다(대조군) — 소스가
 * `BOSS_MODELS` 배열의 파일명만 바꾸거나(오타·순서 뒤바뀜) 배선을 빠뜨리면 잡는다.
 */
const EXPECTED_COMMISSION_BOSS_GLB: readonly string[] = [
  'boss_cm_salvage.glb', // 0(enemyType 6) 연쇄 원정 — 잔해 포식자
  'boss_cm_warlord.glb', // 1(enemyType 7) 정예 소집령 — 정예 군주
  'boss_cm_runner.glb', // 2(enemyType 8) 현상금 표적 — 도주자
];

/** 행성 보스 수의 독립 리터럴(현재 6: 카르곤·베르단·니플헤임·아르케·톡사르·크라스). */
const EXPECTED_PLANET_BOSS_COUNT = 6;

/** 의뢰 보스 수의 독립 리터럴(현재 3: 연쇄 원정·정예 소집령·현상금 표적). */
const EXPECTED_COMMISSION_BOSS_COUNT = 3;

describe('의뢰 보스 렌더 카탈로그 ↔ 계약 등식', () => {
  it('COMMISSION_BOSS_ENEMY_TYPE_BASE 는 행성 보스 수와 같다', () => {
    // 나쁜 상태: 이 값이 어긋나면(행성이 늘었는데 상수를 안 올리면 작아지고, 실수로 크면
    // 인덱스 공간에 구멍이 생긴다) 의뢰 보스가 행성 보스 모델을 뒤집어쓰거나(작으면) 렌더가
    // 빈 슬롯을 집는다(크면) — 둘 다 조용히 잘못된 그림만 나오고 이 단언 없이는 아무 게이트도
    // 안 울린다.
    expect(COMMISSION_BOSS_ENEMY_TYPE_BASE).toBe(EXPECTED_PLANET_BOSS_COUNT);
  });

  it('의뢰 보스 카탈로그(sim)는 정확히 3종이다', () => {
    // 나쁜 상태: 새 의뢰 보스를 하나 추가하고 렌더 카탈로그(BOSS_MODELS/BOSS_ASSET_FILES) append 를
    // 잊으면, sim 은 enemyType=9 를 실어도 렌더 배열은 여전히 9칸(0~8)이라 범위를 벗어나
    // resolveSpriteSlot 이 조용히 index 0(카르곤)으로 폴백한다.
    expect(COMMISSION_BOSSES.length).toBe(EXPECTED_COMMISSION_BOSS_COUNT);
  });

  it('3D·2D 두 렌더 카탈로그의 길이가 계약 등식(행성 수 + 의뢰 보스 수)과 정확히 같다', () => {
    const expectedTotal = EXPECTED_PLANET_BOSS_COUNT + EXPECTED_COMMISSION_BOSS_COUNT;
    // 나쁜 상태: 이 셋 중 하나만 어긋나도(예: BOSS_MODELS 만 append 를 깜빡하면 8) 인덱스 6~8 중
    // 일부가 다른 배열에서만 유효해 3D 는 있는데 2D 는 없는(또는 그 반대) 비대칭 폴백이 생긴다.
    expect(BOSS_MODELS.length).toBe(expectedTotal);
    expect(BOSS_ASSET_FILES.length).toBe(expectedTotal);
    expect(COMMISSION_BOSS_ENEMY_TYPE_BASE + COMMISSION_BOSSES.length).toBe(expectedTotal);
  });
});

describe('BOSS_ASSET_FILES(2D 폴백) ↔ 독립 전사본 ↔ 실물 대조', () => {
  it('소스의 BOSS_ASSET_FILES 가 독립 전사본과 완전히 일치한다(순서 포함)', () => {
    // 나쁜 상태: 순서가 바뀌면(예: 6·7 자리가 뒤집히면) 연쇄 원정 보스가 정예 소집령의 아트를
    // 뒤집어쓴다 — 파일이 전부 존재해도(다음 테스트는 통과) 틀린 그림이 뜬다. 그래서 배열
    // 동등성(toEqual, 순서 민감)으로 건다.
    expect(BOSS_ASSET_FILES).toEqual(EXPECTED_BOSS_ASSET_FILES);
  });

  it('전사본의 모든 파일이 assets/ 에 실제로 있다(의뢰 보스 6~8 포함)', () => {
    // 나쁜 상태: 여기 실물이 없는 파일명을 적으면 `tryLoad` 가 조용히 null 을 돌려주고 2D
    // 폴백조차 안 뜬다(스프라이트가 완전히 빈다) — 이 리포가 8번 넘게 겪은 실패의 정확한 형태.
    for (const file of EXPECTED_BOSS_ASSET_FILES) {
      expect(ASSET_FILES.has(file), `assets/${file} 없음`).toBe(true);
    }
  });
});

describe('BOSS_MODELS(3D) — 의뢰 보스 3칸이 실제 GLB 로 배선됐다', () => {
  it('행성 보스 6칸은 여전히 모델 정의를 갖는다(회귀 0)', () => {
    for (let i = 0; i < EXPECTED_PLANET_BOSS_COUNT; i++) {
      expect(BOSS_MODELS[i], `BOSS_MODELS[${i}] 가 null — 행성 보스 모델 소실`).not.toBeNull();
    }
  });

  it('의뢰 보스 3칸(6·7·8)이 독립 전사본과 일치하는 GLB 파일을 가리킨다', () => {
    // 나쁜 상태: 파일명이 하나라도 다르면(오타·순서 뒤바뀜) 사자산이 된 GLB 하나와 아예 로드
    // 안 되는 슬롯 하나가 동시에 생긴다 — 둘 다 신호 없이 조용하다.
    for (let i = 0; i < EXPECTED_COMMISSION_BOSS_COUNT; i++) {
      const idx = COMMISSION_BOSS_ENEMY_TYPE_BASE + i;
      const entry = BOSS_MODELS[idx];
      expect(entry, `BOSS_MODELS[${idx}] 가 null — 의뢰 보스 GLB 미배선`).not.toBeNull();
      expect(entry?.file, `BOSS_MODELS[${idx}].file`).toBe(EXPECTED_COMMISSION_BOSS_GLB[i]);
    }
  });

  it('배선된 의뢰 보스 GLB 가 assets/models/ 에 실제로 있다', () => {
    for (const file of EXPECTED_COMMISSION_BOSS_GLB) {
      expect(MODEL_FILES.has(file), `assets/models/${file} 없음`).toBe(true);
    }
  });

  it('hasBossModel 은 행성 보스·의뢰 보스 인덱스 전부에서 true 를 돌려준다(둘 다 GLB 존재)', () => {
    for (let i = 0; i < EXPECTED_PLANET_BOSS_COUNT + EXPECTED_COMMISSION_BOSS_COUNT; i++) {
      expect(hasBossModel(i), `hasBossModel(${i})`).toBe(true);
    }
  });

  it('범위 밖 인덱스는 안전하게 false 다(방어적 폴백 회귀 0)', () => {
    expect(hasBossModel(999)).toBe(false);
    expect(hasBossModel(-1)).toBe(false);
  });
});
