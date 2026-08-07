/**
 * 48C3 전수 상한 스윕 — 축별 총상한 최댓값을 손 계산이 아니라 전수로 확정한다.
 *
 * ## 왜 존재하는가
 * ADR-0052 §경제 결합 규율이 "최악 조합 탐색은 손으로 하지 말고 전수로 돌려라"를 계약으로
 * 못박았다. 손 계산이 2·3판 연속 틀렸다 — **최악 3장이 전부 같은 태그라 공명이 발동하는 것을
 * 두 번 놓쳤다.**
 *
 * ## 유효 조합 필터
 * 48C3 = 17,296 은 "카탈로그에서 3장을 고르는 모든 방법"의 수일 뿐, 실제로 출격 가능한 조합의
 * 수가 아니다. 두 게이트가 이미 서버·클라 양쪽에 있다:
 *   - `SIGNATURE_CAP`(=2): 특산 3장은 애초에 못 넣는다.
 *   - 특산은 **같은 행성끼리만 공존**한다 — 런은 한 행성에서 벌어지므로 서로 다른 행성 특산
 *     2장이 한 인벤토리에 같이 들어오는 상황 자체가 없다. 이 필터를 빼면 존재할 수 없는 조합이
 *     최악값을 밀어올려 상한이 과대평가된다.
 *
 * ## 공명 반영
 * 각 조합마다 {@link resolveResonance} 를 불러 발동한 공명(있다면)의 `cap` 을 **그 공명의 축
 * 합**에 얹는다 — `axisCapMult` 는 촉매분만 세므로(문서 자신이 그렇게 적어 두었다), 공명은
 * 이 스크립트가 직접 합성한다.
 *
 * ## 결정론
 * 순수 루프 전수 열거. `Math.random`·`Date.now` 없음.
 *
 * ## 실행
 *   pnpm cap:sweep
 * (내부적으로 `vite-node scripts/catalystCapSweep.ts` — `bench:*` 삼총사와 같은 러너.)
 */

import {
  CATALYSTS,
  CATALYST_CAP_AXES,
  CAP_COMPOSE_FACTOR,
  CAP_ALL_AXIS_FACTOR,
  SIGNATURE_CAP,
  type CatalystCapAxis,
  type CatalystDef,
} from '../src/data/catalysts.js';
import { resolveResonance, type ResonanceDef } from '../src/data/catalystResonance.js';

interface NodeProcess {
  readonly env?: Record<string, string | undefined>;
  exitCode?: number;
}

const proc = (globalThis as { process?: NodeProcess }).process;

export interface Combo {
  readonly defs: readonly [CatalystDef, CatalystDef, CatalystDef];
  readonly resonance: ResonanceDef | null;
}

/** ids 3개로 {@link Combo} 를 만든다(테스트가 대표 조합을 재구성할 때 쓴다). */
export function buildCombo(ids: readonly [number, number, number]): Combo {
  const byId = new Map(CATALYSTS.map((d) => [d.id, d] as const));
  const defs = ids.map((id) => {
    const def = byId.get(id);
    if (def === undefined) throw new Error(`unknown catalyst id: ${id}`);
    return def;
  }) as unknown as readonly [CatalystDef, CatalystDef, CatalystDef];
  return { defs, resonance: resolveResonance(ids) };
}

/** 축별 총상한(공명분 포함) — `1 + Σ(개별상한 − 1) × CAP_COMPOSE_FACTOR`. */
export function axisTotal(combo: Combo, axis: CatalystCapAxis): number {
  let sum = 0;
  for (const def of combo.defs) {
    if (def.cap.axis === axis) sum += def.cap.mult - 1;
  }
  if (combo.resonance !== null && combo.resonance.cap.axis === axis) {
    sum += combo.resonance.cap.mult - 1;
  }
  return 1 + sum * CAP_COMPOSE_FACTOR;
}

/** 전축 상한 = `max(축별 총상한) × CAP_ALL_AXIS_FACTOR`. */
export function allAxisTotal(combo: Combo): number {
  let max = 1;
  for (const axis of CATALYST_CAP_AXES) {
    const t = axisTotal(combo, axis);
    if (t > max) max = t;
  }
  return max * CAP_ALL_AXIS_FACTOR;
}

/** 특산 최대 2장 + 특산 2장이면 같은 행성이어야 한다(런은 한 행성에서 벌어진다). */
export function isValidCombo(defs: readonly [CatalystDef, CatalystDef, CatalystDef]): boolean {
  const sigs = defs.filter((d) => d.kind === 'signature');
  if (sigs.length > SIGNATURE_CAP) return false;
  if (sigs.length === 2 && sigs[0]!.planet !== sigs[1]!.planet) return false;
  return true;
}

function comboLabel(combo: Combo): string {
  const parts = combo.defs
    .map((d) => `#${d.id} ${d.slug} [${d.tags.join(',')}]`)
    .join(' + ');
  const res = combo.resonance !== null ? `${combo.resonance.tag}:${combo.resonance.tier} (${combo.resonance.slug})` : '없음';
  return `${parts} | 공명: ${res}`;
}

function main(): void {
  const n = CATALYSTS.length;
  let totalCombos = 0;
  let filteredOut = 0;
  let validCombos = 0;
  let resonanceHits = 0;
  const resonanceCounts = new Map<string, number>();

  const axisMax = new Map<CatalystCapAxis, { value: number; combo: Combo | null }>();
  for (const axis of CATALYST_CAP_AXES) axisMax.set(axis, { value: -Infinity, combo: null });
  let allAxisMax = { value: -Infinity, combo: null as Combo | null };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        totalCombos++;
        const defs: readonly [CatalystDef, CatalystDef, CatalystDef] = [
          CATALYSTS[i]!,
          CATALYSTS[j]!,
          CATALYSTS[k]!,
        ];
        if (!isValidCombo(defs)) {
          filteredOut++;
          continue;
        }
        validCombos++;
        const ids = [defs[0].id, defs[1].id, defs[2].id];
        const resonance = resolveResonance(ids);
        const combo: Combo = { defs, resonance };

        if (resonance !== null) {
          resonanceHits++;
          const key = `${resonance.tag}:${resonance.tier} (${resonance.slug})`;
          resonanceCounts.set(key, (resonanceCounts.get(key) ?? 0) + 1);
        }

        for (const axis of CATALYST_CAP_AXES) {
          const t = axisTotal(combo, axis);
          const cur = axisMax.get(axis)!;
          if (t > cur.value) axisMax.set(axis, { value: t, combo });
        }

        const all = allAxisTotal(combo);
        if (all > allAxisMax.value) allAxisMax = { value: all, combo };
      }
    }
  }

  console.log('--- 48C3 전수 상한 스윕 (ADR-0052 §경제 결합 규율) ---');
  console.log(`필터 전 조합 수: ${totalCombos} (48C3 = 17296 이어야 한다)`);
  console.log(`필터로 제외된 조합 수: ${filteredOut} (특산 3장 또는 서로 다른 행성 특산 2장)`);
  console.log(`유효 조합 수: ${validCombos}`);
  console.log('');

  console.log('--- 축별 최댓값 ---');
  for (const axis of CATALYST_CAP_AXES) {
    const { value, combo } = axisMax.get(axis)!;
    console.log(`[${axis}] x${value.toFixed(4)}`);
    if (combo !== null) console.log(`  최악 조합: ${comboLabel(combo)}`);
  }
  console.log('');

  console.log('--- 전축 상한 최댓값 ---');
  console.log(`x${allAxisMax.value.toFixed(4)}`);
  if (allAxisMax.combo !== null) console.log(`  최악 조합: ${comboLabel(allAxisMax.combo)}`);
  console.log('');

  console.log('--- 공명 발동 통계 ---');
  console.log(
    `공명이 발동한 조합 비율: ${resonanceHits}/${validCombos} (${((resonanceHits / validCombos) * 100).toFixed(2)}%)`,
  );
  const sortedResonance = [...resonanceCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedResonance) {
    console.log(`  ${key}: ${count}건`);
  }

  if (validCombos === 0) {
    console.error('[NO-OUTPUT] 유효 조합이 0건이다 -- 필터 로직을 확인하라.');
    if (proc !== undefined) proc.exitCode = 1;
  }
}

// vite-node 는 argv 에서 스크립트 경로를 지우므로(`bench/runCurve.ts` 머리말 참조) 여기서는
// argv 대조 대신 vitest 여부로 게이트한다 — 계약 테스트가 이 파일을 순수 함수 라이브러리로
// import 할 때 17,296 건 전수 스윕이 import 부작용으로 따라붙지 않게 하기 위함이다.
const runningUnderVitest = proc?.env?.VITEST !== undefined;
if (!runningUnderVitest) main();
