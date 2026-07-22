/**
 * 시나리오 실행·해싱·수학 표면 프로브 (Node/Deno 공용).
 *
 * fixtures.json에 굳는 모든 값은 이 모듈이 계산한다 — Node가 이 결과를 파일로
 * 저장하고, Deno가 같은 함수로 재계산해 bit-identical 비교한다. 계산 로직을 한
 * 곳에 모아 두 런타임이 문자 그대로 동일한 코드를 돌린다(교차 검증의 공정성).
 */

import { createWorld, stepWorld } from '../../src/sim/world.js';
import type { InputFrame } from '../../src/sim/world.js';
import { hashWorld } from '../../src/sim/replay.js';
import { rollItem, rerollAffixes } from '../../src/items/roll.js';
import { atan2, sin, cos, length } from '../../src/sim/math.js';
import type { Scenario, RollProbe } from './scenarios.js';

// ---------------------------------------------------------------------------
// FNV-1a(32-bit) — 임의 수열을 raw IEEE-754 비트로 접는다(replay.ts와 동일 방식).
// ---------------------------------------------------------------------------
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const _buf = new ArrayBuffer(8);
const _f64 = new Float64Array(_buf);
const _bytes = new Uint8Array(_buf);

function fnvByte(h: number, b: number): number {
  return Math.imul(h ^ (b & 0xff), FNV_PRIME) >>> 0;
}
function foldFloat(h: number, v: number): number {
  _f64[0] = v;
  let r = h;
  for (let i = 0; i < 8; i++) r = fnvByte(r, _bytes[i] as number);
  return r;
}
function foldU32(h: number, v: number): number {
  let r = h;
  r = fnvByte(r, v & 0xff);
  r = fnvByte(r, (v >>> 8) & 0xff);
  r = fnvByte(r, (v >>> 16) & 0xff);
  r = fnvByte(r, (v >>> 24) & 0xff);
  return r;
}

/** 입력 로그를 결정론적으로 해싱(입력 생성 자체의 런타임 일치 확인용). */
export function hashInputs(inputs: readonly InputFrame[]): number {
  let h = FNV_OFFSET;
  h = foldU32(h, inputs.length >>> 0);
  for (const f of inputs) {
    h = foldFloat(h, f.moveX);
    h = foldFloat(h, f.moveY);
    h = foldFloat(h, f.aim);
    h = foldU32(h, f.dash ? 1 : 0);
    h = foldU32(h, f.special >>> 0);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 수학 표면 프로브(과업 4): f64 산술 · 비트 연산 · Math.fround · sim 자체 trig가
// V8(Node) ↔ V8(Deno)에서 동일함을 단일 u32 해시로 증거화.
// ---------------------------------------------------------------------------
export function mathProbe(): number {
  let h = FNV_OFFSET;
  // f64 기본 산술(+ - * / sqrt)은 IEEE-754 correctly-rounded → 결정론.
  for (let i = 1; i <= 512; i++) {
    const x = i * 0.1234567890123 - 7.0;
    const y = (i * 2654435761) >>> 0; // Knuth 곱 해시(비트 연산).
    h = foldFloat(h, x * x - x / 3 + Math.sqrt(Math.abs(x)));
    h = foldU32(h, y);
    // Math.fround: 단정도 반올림 — 엔진 간 동일해야 함.
    h = foldFloat(h, Math.fround(x * 1.1));
    // 비트 연산 / imul.
    h = foldU32(h, Math.imul(y, 0x9e3779b1) >>> 0);
    h = foldU32(h, (y ^ (y >>> 13)) >>> 0);
    // sim 자체 trig(math.ts) — 플랫폼 무관 다항식 구현.
    const a = x;
    h = foldFloat(h, sin(a));
    h = foldFloat(h, cos(a));
    h = foldFloat(h, atan2(y % 97, (i % 13) - 6));
    h = foldFloat(h, length(x, x + 1));
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 롤(roll.ts) 교차 검증: 아이템을 안정 표현으로 직렬화.
// ---------------------------------------------------------------------------
export interface RollSnapshot {
  id: string;
  slot: string;
  rarity: string;
  weaponType: number | null;
  uniqueId: string | null;
  affixes: { id: string; stat: string; value: number }[];
}

export function snapshotRoll(p: RollProbe): RollSnapshot {
  let item = rollItem(p.dropSeed, p.rarity, p.source);
  if (p.reroll !== undefined) {
    item = rerollAffixes(item, p.reroll.rerollSeed, p.reroll.lockedIndex);
  }
  return {
    id: item.id,
    slot: item.slot,
    rarity: item.rarity,
    weaponType: item.weaponType ?? null,
    uniqueId: item.uniqueId ?? null,
    affixes: item.affixes.map((a) => ({ id: a.id, stat: a.stat, value: a.value })),
  };
}

// ---------------------------------------------------------------------------
// 시나리오 실행 → 기대 결과(fixtures.json 엔트리).
// ---------------------------------------------------------------------------
export interface Checkpoint {
  tick: number;
  hash: number;
}
export interface ScenarioResult {
  name: string;
  seed: number;
  ticks: number;
  inputsHash: number;
  checkpoints: Checkpoint[];
  finalHash: number;
  /** 드랍 시드 시퀀스(정산 입력) — bit-identical이어야 서버 재현이 같은 아이템. */
  loot: { seed: number; rarity: number; planet: number; stage: number }[];
  rolls: RollSnapshot[];
  /** 최종 상태 요약(가독 확인용, 해시 비교에는 미포함). */
  summary: {
    victory: boolean;
    gameOver: boolean;
    kills: number;
    level: number;
    bossSpawned: boolean;
    entityCount: number;
  };
}

export function computeScenario(sc: Scenario): ScenarioResult {
  const inputs = sc.buildInputs();
  const state = createWorld(sc.seed, sc.config);
  const checkpoints: Checkpoint[] = [];
  let finalHash = hashWorld(state);
  for (let t = 0; t < inputs.length; t++) {
    stepWorld(state, inputs[t] as InputFrame);
    finalHash = hashWorld(state);
    if ((t + 1) % sc.checkpointInterval === 0) {
      checkpoints.push({ tick: t + 1, hash: finalHash });
    }
  }
  return {
    name: sc.name,
    seed: sc.seed,
    ticks: inputs.length,
    inputsHash: hashInputs(inputs),
    checkpoints,
    finalHash,
    loot: state.loot.map((r) => ({
      seed: r.seed >>> 0,
      rarity: r.rarity,
      planet: r.planet,
      stage: r.stage,
    })),
    rolls: sc.rolls.map(snapshotRoll),
    summary: {
      victory: state.victory,
      gameOver: state.gameOver,
      kills: state.kills,
      level: state.level,
      bossSpawned: state.bossSpawned,
      entityCount: state.entities.length,
    },
  };
}

/** 전체 픽스처 문서 형태. */
export interface Fixture {
  meta: {
    generatedBy: string;
    node?: string;
    scenarioCount: number;
  };
  mathProbe: number;
  scenarios: ScenarioResult[];
}
