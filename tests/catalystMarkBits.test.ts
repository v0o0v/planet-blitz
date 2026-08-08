/**
 * **`catalystMarks` 비트표 정합 — 기계 검사**(ADR-0052 과제 3).
 *
 * ## 왜 이 파일이 필요한가
 * `CATALYST_MARK` 의 비트 구역을 **다섯 레인이 동시에 편집**했다(`prospect`·`pierced`·
 * `hiveWorker`·`flagship`·`resoTicks`). 각 레인은 자기 칸만 보고 표 주석을 눈으로 검산했고,
 * 그 방식으로 실제로 결함이 하나 통과했다 — `plunder` 의 **의미가 코드와 반대**인 채 남았다
 * (표 "강탈 가능" vs 코드 "강탈 완료"). 겹침이 안 난 것은 운이지 절차가 아니다.
 *
 * 사람이 표를 읽어 확인하는 방식은 **다음 레인이 또 밟는다.** 그래서 검사를 여기로 옮긴다.
 *
 * ## ⚠️ 이 파일은 골든 상수를 갖지 않는다
 * 단언은 전부 **`CATALYST_MARK` 객체에서 파생한 것끼리의 관계**다(겹침·덮개·상한). 기대 비트를
 * 여기 베껴 적으면 표를 고칠 때 이 파일도 같이 고치게 되어 **검사가 표의 사본**이 된다 —
 * 그 순간 두 곳이 같이 틀릴 수 있고 검사가 항진이 된다. 유일한 예외는 §32비트 상한인데,
 * 그것은 표가 아니라 **`aux0` 가 u32 라는 엔진 사실**에서 온다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALYST_MARK,
  CATALYST_MARK_BITS,
  CATALYST_MARK_MASK,
  readMark,
  writeMark,
  clearMarks,
} from '../src/sim/catalystMarks.js';
import type { CatalystMarkField } from '../src/sim/catalystMarks.js';
import type { Entity } from '../src/sim/entities.js';

/** 표의 항목을 `[이름, shift, width]` 로 편다. */
const FIELDS = Object.entries(CATALYST_MARK).map(
  ([name, spec]) => [name as CatalystMarkField, spec.shift, spec.width] as const,
);

/** 그 필드가 점유하는 비트 마스크. */
function maskOf(shift: number, width: number): number {
  return (((1 << width) - 1) << shift) >>> 0;
}

describe('catalystMarks 비트표 — 구간 겹침', () => {
  it('어느 두 필드도 비트를 한 칸도 공유하지 않는다', () => {
    // ⚠️ 쌍마다 마스크 AND 로 본다. "shift 가 다르다"만 보면 폭이 겹치는 경우를 놓친다 —
    // `greedAmount`(7,폭8)와 `extractionAmount`(15,폭8)처럼 폭이 큰 칸이 이웃한 자리가 실제로
    // 있어서, shift 비교만으로는 한 칸 밀린 편집이 통과한다.
    const collisions: string[] = [];
    for (let i = 0; i < FIELDS.length; i++) {
      for (let j = i + 1; j < FIELDS.length; j++) {
        const [an, ash, aw] = FIELDS[i] as readonly [CatalystMarkField, number, number];
        const [bn, bsh, bw] = FIELDS[j] as readonly [CatalystMarkField, number, number];
        const overlap = (maskOf(ash, aw) & maskOf(bsh, bw)) >>> 0;
        if (overlap !== 0) {
          collisions.push(`${an}(${ash}+${aw}) ∩ ${bn}(${bsh}+${bw}) = 0x${overlap.toString(16)}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('폭은 전부 1 이상이고 shift 는 음수가 아니다', () => {
    for (const [name, shift, width] of FIELDS) {
      expect(width, `${name}.width`).toBeGreaterThanOrEqual(1);
      expect(shift, `${name}.shift`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('catalystMarks 비트표 — 예산', () => {
  it('CATALYST_MARK_BITS 가 실제 최대 비트를 덮는다 (표가 마스크 밖으로 자라지 않는다)', () => {
    // 덮지 못하면 `clearMarks`/`markSnapshotValue` 가 상위 필드를 **조용히 흘린다** —
    // 표식이 안 지워져 "영영 밀려난 적" 같은 상태가 남는다.
    let highest = 0;
    for (const [, shift, width] of FIELDS) {
      const top = shift + width; // 배타적 상한
      if (top > highest) highest = top;
    }
    expect(CATALYST_MARK_BITS).toBeGreaterThanOrEqual(highest);
  });

  it('32 비트를 넘지 않는다 — 넘으면 u32 폴드가 경고 없이 잘린다', () => {
    // `aux0` 는 `hashEntity` 가 u32 로 접는 칸이다. 33번째 비트는 저장은 되는 듯 보여도
    // 해시·스냅샷 경로에서 사라져 **재현성이 조용히 깨진다**.
    for (const [name, shift, width] of FIELDS) {
      expect(shift + width, `${name} 이 32비트를 넘는다`).toBeLessThanOrEqual(32);
    }
    expect(CATALYST_MARK_BITS).toBeLessThanOrEqual(32);
    // 마스크가 음수로 돌지 않는다(`1 << 31` 은 음수다 — 폭이 32 가 되면 여기서 터진다).
    expect(CATALYST_MARK_MASK).toBeGreaterThan(0);
  });

  it('마스크가 표의 전 필드를 포함한다', () => {
    for (const [name, shift, width] of FIELDS) {
      const m = maskOf(shift, width);
      expect((m & CATALYST_MARK_MASK) >>> 0, `${name} 이 마스크 밖이다`).toBe(m);
    }
  });
});

describe('catalystMarks 비트표 — 접근자 왕복', () => {
  function mob(): Entity {
    return { aux0: 0 } as Entity;
  }

  it('한 필드에 최대값을 써도 이웃 필드가 0 그대로다', () => {
    // 겹침 검사(마스크 AND)와 **다른 축**이다 — 저쪽은 표를, 이쪽은 `writeMark` 의 절삭·마스킹
    // 구현을 본다. 표가 맞아도 접근자가 틀리면 이웃이 오염된다.
    for (const [name, , width] of FIELDS) {
      const e = mob();
      const max = (1 << width) - 1;
      writeMark(e, name, max);
      expect(readMark(e, name), `${name} 왕복`).toBe(max);
      for (const [other] of FIELDS) {
        if (other === name) continue;
        expect(readMark(e, other), `${name} 에 쓰자 ${other} 가 오염됐다`).toBe(0);
      }
    }
  });

  it('폭을 넘는 값은 절삭되고 이웃을 침범하지 않는다', () => {
    for (const [name, , width] of FIELDS) {
      const e = mob();
      const max = (1 << width) - 1;
      writeMark(e, name, max + 7);
      expect(readMark(e, name), `${name} 절삭`).toBe(max);
      for (const [other] of FIELDS) {
        if (other === name) continue;
        expect(readMark(e, other), `${name} 절삭이 ${other} 를 침범했다`).toBe(0);
      }
    }
  });

  it('clearMarks 가 전 필드를 0 으로 되돌리고 촉매 구역 밖은 보존한다', () => {
    const e = mob();
    for (const [name, , width] of FIELDS) writeMark(e, name, (1 << width) - 1);
    // 촉매 구역 **밖**의 상위 예약 비트를 세워 둔다 — `clearMarks` 가 이것까지 지우면
    // 다른 kind 의 용도(보스 취약화 플래그 등)를 밟는다.
    const reserved = (1 << 31) >>> 0;
    e.aux0 = (e.aux0 | reserved) >>> 0;
    clearMarks(e);
    for (const [name] of FIELDS) expect(readMark(e, name), `${name} 이 안 지워졌다`).toBe(0);
    expect(e.aux0 >>> 0).toBe(reserved);
  });
});

describe('catalystMarks — aux1 무접촉', () => {
  /**
   * `src/sim/catalyst/**` 전 파일 + 비트표·디스패처 모듈.
   *
   * ⚠️ 경로는 `process.cwd()` 가 아니라 **이 파일 기준**이다 — vitest 를 다른 cwd 에서 돌리면
   * `cwd` 기반 경로가 조용히 빈 목록을 만들고, 그러면 이 검사가 **항상 통과하는 무연산**이 된다.
   */
  const SIM_DIR = fileURLToPath(new URL('../src/sim/', import.meta.url));

  function catalystSources(): { file: string; text: string }[] {
    const dir = join(SIM_DIR, 'catalyst');
    const out = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ file: `src/sim/catalyst/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
    out.push({
      file: 'src/sim/catalystMarks.ts',
      text: readFileSync(join(SIM_DIR, 'catalystMarks.ts'), 'utf8'),
    });
    out.push({
      file: 'src/sim/catalystHooks.ts',
      text: readFileSync(join(SIM_DIR, 'catalystHooks.ts'), 'utf8'),
    });
    return out;
  }

  it('스캔 대상이 비어 있지 않다 (경로가 틀리면 검사가 무연산이 된다)', () => {
    const srcs = catalystSources();
    expect(srcs.length).toBeGreaterThan(13);
    expect(srcs.every((s) => s.text.length > 0)).toBe(true);
  });

  /**
   * `aux1` 쓰기 전수. `guarded` = 같은 함수 안 가까이에 `isShelter(` 가림막이 있는가.
   *
   * ⚠️ **금지 대상은 "모든 `aux1` 쓰기"가 아니라 "`enemy` 의 `aux1` 쓰기"** 다(실측):
   *  - 위험한 칸 — `MID_CLASH_LEADER_MARK` 는 `modes/midClash.ts:92` 에서
   *    **`e.kind === 'enemy' && e.aux1 === MARK`** 로만 판정한다. 즉 적의 `aux1` 이다.
   *  - 안전한 칸 — `shelter` kind 는 `aux1` 을 **확보 플래그**로 쓰는 것이 원래 규약이고
   *    (`modes/chase.ts:241` `isShelterSecured = aux1 === 1`), 촉매(`id 36`·`id 38`)는 그
   *    술어를 chase 에서 **import 해서** 같은 표현으로 쓴다. kind 가 달라 겹치지 않는다.
   *
   * 그래서 통째로 금지하면 정당한 배선이 걸린다. 가림막 근접 검사로 그 둘을 가른다 —
   * 새로 들어온 무가림 쓰기(= 적일 수 있는 쓰기)는 그대로 걸린다.
   */
  function aux1Writes(): { where: string; guarded: boolean }[] {
    const out: { where: string; guarded: boolean }[] = [];
    for (const { file, text } of catalystSources()) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (code.trimStart().startsWith('*')) return; // 블록 주석 본문
        // `X.aux1 =` · `X.aux1 +=` · `X.aux1++` 같은 **쓰기** 형태만 잡는다.
        // (주석 안의 `aux1` 언급은 허용한다 — 사유를 적어 두는 것이 이 저장소의 규율이다.)
        if (!/\baux1\s*(=[^=]|\+=|-=|\|=|&=|\^=|\+\+|--)/.test(code)) return;
        // 가림막은 대입보다 **위**에 있다. 25줄이면 `broken` 처럼 루프에서 집어 온 뒤
        // 조금 떨어져 쓰는 형태(niflheim.ts:483 → :496, 13줄)까지 덮는다.
        const from = i - 25 < 0 ? 0 : i - 25;
        const guarded = lines.slice(from, i + 1).some((l) => l.includes('isShelter('));
        out.push({ where: `${file}:${i + 1}: ${line.trim()}`, guarded });
      });
    }
    return out;
  }

  it('촉매 모듈은 적의 aux1 에 쓰지 않는다 — 중반 격전 전진 게이트가 그 칸에 산다', () => {
    // `MID_CLASH_LEADER_MARK` 가 **매 런 확정으로** 점유하고 세그먼트 전진 게이트가 오직 그
    // 마커로만 판정한다. 촉매가 덮으면 **중반 격전이 공짜로 통과된다.**
    expect(aux1Writes().filter((w) => !w.guarded)).toEqual([]);
  });

  it('가림막이 붙은 aux1 쓰기는 전부 shelter 규약이다 (사유가 사라지면 알아챈다)', () => {
    // 가림막 있는 쓰기가 **0 이 되면** 그것도 신호다 — `id 36`·`id 38` 배선이 통째로
    // 사라졌거나 대피소 규약이 다른 칸으로 옮겨 갔다는 뜻이라 이 파일의 전제가 낡는다.
    const guarded = aux1Writes().filter((w) => w.guarded);
    expect(guarded.length).toBeGreaterThan(0);
    for (const w of guarded) expect(w.where).toContain('src/sim/catalyst/niflheim.ts');
  });
});
