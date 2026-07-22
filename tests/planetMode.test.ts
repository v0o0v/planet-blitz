/**
 * Lane2 — 행성 모드 프레임워크 회귀 + 정규경로 통합 게이트 (ADR-0021, 스펙 §7b).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 이다. 그래서 아래
 * 케이스는 상수 계약(§1·§2·§3)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로
 * config 를 만들고 `createWorld`/`stepWorld` 를 진짜로 굴려 조건부 폴드가 sim 까지 도달함을
 * per-tick 해시로 증명한다(§7b-4 가 핵심 증거).
 *
 * Lane2 는 프레임워크 골격만 — sim 은 모드로 분기하지 않는다(각 모드 거동은 Lane3~8).
 * 따라서 모드 4(shrink)와 모드 0(vampire)의 sim 상태는 tick 마다 동일하고, 유일한 차이는
 * `hashWorld` 꼬리의 조건부 폴드다. 모드 0 은 한 폴드도 실행하지 않아 뱀서류/침공 해시가
 * 바이트 불변이다.
 */

import { describe, it, expect } from 'vitest';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { planetContent } from '../data/planets/index.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { drawPowerupChoices, POWERUPS } from '../src/sim/powerups.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/index.js';

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;
const SEED = 0x51a2;
/** 소규모 틱(스펙 §7b-4: 120~180). */
const TICKS = 150;

/** 골든과 같은 방식으로 실제 sim 을 굴려 per-tick 해시를 모은다. */
function runHashes(seed: number, cfg: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    out.push(hashWorld(state));
  }
  return out;
}

// ---------------------------------------------------------------------------
// §7b-1 · §7b-2 · §7b-3 — 상수 계약 + 레지스트리 배정 + 정규경로 스탬프
// ---------------------------------------------------------------------------

describe('행성 모드 계약 (append-only 못박기)', () => {
  it('PLANET_MODE 값이 정확히 일치한다 (재번호 금지)', () => {
    expect(PLANET_MODE).toEqual({
      vampire: 0,
      blockBreak: 1,
      racing: 2,
      chase: 3,
      shrink: 4,
      contamination: 5,
    });
  });

  it('레지스트리(PlanetContent.mode)가 ADR-0021 배정을 담는다', () => {
    expect(planetContent(0).mode).toBe(PLANET_MODE.vampire); // 카르곤
    expect(planetContent(1).mode).toBe(PLANET_MODE.shrink); // 베르단
    expect(planetContent(2).mode).toBe(PLANET_MODE.chase); // 니플헤임
    expect(planetContent(3).mode).toBe(PLANET_MODE.racing); // 아르케
  });

  it('정규경로: buildRunConfig 가 레지스트리 모드를 스탬프한다', () => {
    expect(buildRunConfig(defaultProfile(), { planet: 1, stage: 1 }).planetMode).toBe(
      PLANET_MODE.shrink,
    );
    expect(buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }).planetMode).toBe(
      PLANET_MODE.vampire,
    );
  });
});

// ---------------------------------------------------------------------------
// §7b-4 — 조건부 폴드 (핵심): 실제 sim 을 굴려 폴드 활성/dormant 를 증명한다.
// ---------------------------------------------------------------------------

describe('조건부 폴드 (정규경로 sim 도달 증거)', () => {
  it('berdan(mode4) vs 강제 mode0 은 전 틱 해시가 발산한다 (폴드 활성)', () => {
    const base = buildRunConfig(defaultProfile(), { planet: 1, stage: 1 });
    expect(base.planetMode).toBe(PLANET_MODE.shrink);
    // 유일한 차이는 planetMode(4 → 0). Lane2 는 sim 이 모드로 분기하지 않으므로 폴드 이전
    // 상태는 tick 마다 동일하고, 발산은 오직 꼬리 폴드에서만 온다.
    const forced0: WorldConfig = { ...base, planetMode: PLANET_MODE.vampire };
    const mode4 = runHashes(SEED, base, TICKS);
    const mode0 = runHashes(SEED, forced0, TICKS);
    expect(mode4.length).toBe(TICKS);
    for (let i = 0; i < TICKS; i++) {
      expect(mode4[i], `틱 ${i + 1}: 폴드 활성이면 발산해야 한다`).not.toBe(mode0[i]);
    }
  });

  it('kargon(mode0) vs planetMode 미지정 은 전 틱 해시가 동일하다 (폴드 dormant)', () => {
    const kargon = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    expect(kargon.planetMode).toBe(PLANET_MODE.vampire);
    // 미지정 = vampire(0). 명시 0 과 미지정 모두 `?? 0` → 0 → 무폴드라 바이트 동일해야 한다.
    const { planetMode: _omit, ...unspecified } = kargon;
    const explicit0 = runHashes(SEED, kargon, TICKS);
    const noField = runHashes(SEED, unspecified, TICKS);
    expect(explicit0).toEqual(noField);
    // 월드가 정지하지 않았음을 확인(공허 비교 방지) — 서로 다른 해시가 충분히 많다.
    expect(new Set(explicit0).size).toBeGreaterThan(TICKS / 2);
  });
});

// ---------------------------------------------------------------------------
// §7b-5 — 침공 안전: 침공 런(planet0)은 mode0 이라 verify-invasion 무영향.
// ---------------------------------------------------------------------------

describe('침공 안전 (verify-invasion 무영향 못박기)', () => {
  it('침공 런(planet0)의 planetMode 는 0 이다', () => {
    const invasion3 = {
      layers: normalizeInvasionLayers(undefined),
      timeLimitTicks: 600,
      maintenance: 10_000,
    };
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1, invasion3 });
    expect(cfg.planetMode).toBe(PLANET_MODE.vampire);
    expect(cfg.planetMode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §7b-6 — 파워업 dormancy: 모드 태그 파워업 0 개라 필터/가중이 무효.
// ---------------------------------------------------------------------------

describe('파워업 dormancy (weapons/powerupIcons 회귀 방지)', () => {
  it('POWERUPS.length === 24 (Lane2 신규 파워업 없음)', () => {
    expect(POWERUPS.length).toBe(24);
  });

  it('모드 태그 파워업이 하나도 없다 (필터가 무효 = dormant)', () => {
    expect(POWERUPS.every((p) => p.mode === undefined)).toBe(true);
  });

  it('drawPowerupChoices 가 planetMode 0/4 에서 동일하다 (필터/가중 무영향)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const a = createWorld(0x1234, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
    const b = createWorld(0x1234, { ...cfg, planetMode: PLANET_MODE.shrink, playerHp: DURABLE_HP });
    const drawA = drawPowerupChoices(a, 4);
    const drawB = drawPowerupChoices(b, 4);
    expect(drawA).toEqual(drawB);
    expect(drawA.length).toBeGreaterThan(0);
  });
});
