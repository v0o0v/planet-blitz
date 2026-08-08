/**
 * 연구소 스킬 **상세 표** — 수치가 sim 정본에서 나오는가 (사용자 요청 2026-08-09).
 *
 * ## 이 레인이 막으려는 실패 모드
 * 스킬 수치를 화면에 띄우는 방법은 셋이었고 둘이 **조용히 틀린다**:
 *  - 설계서 문안을 베낀다 → 설계서와 구현이 이미 갈려 있다(F6 이 증거 · sim 주석이 명시).
 *  - 화면이 자기 공식을 적는다 → 밸런스 한 줄이 바뀌는 날 조용히 갈린다.
 * 그래서 `src/sim/skills/strikerScaling.ts` 의 순수 함수가 **유일한 정본**이고 sim 과 화면이
 * 둘 다 그것을 부른다. 이 파일은 그 계약이 실제로 서 있는지를 잠근다.
 *
 * ## 잠그는 다섯
 *  ① 커버리지 — 스트라이커 30스킬이 **하나도 안 빠진다**(빠지면 화면이 조용히 한 줄로 접힌다).
 *  ② 수치가 **하드코딩이 아니다** — 레벨을 바꾸면 문자열이 따라 바뀐다.
 *  ③ 값이 **sim 함수와 같다** — 여러 레벨에서 대조해 "우연히 Lv1 만 맞는" 상태를 배제한다.
 *  ④ sim 이 인라인 산술을 **되돌리지 않았다**(되돌리면 화면과 sim 이 다시 갈린다).
 *  ⑤ 팝업 2단이 겹치지 않고 화면 안에 있다.
 *
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 적는다(이 리포 규율).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SHIP_TYPES, SKILLS_PER_AXIS, flattenShipNodes } from '../data/ships/index.js';
import { STRIKER_SKILL_DETAIL, skillDetailOf } from '../src/ui/skillDetail.js';
import {
  killMomentumCharge,
  shatterRadius,
  extendedMagBp,
  comboAbsorbPerStack,
  twinRechargeTicks,
  hullGrantHp,
  thrustWakeCount,
  thrustWakeDamage,
} from '../src/sim/skills/strikerScaling.js';
import { POPUP_COLUMNS } from '../src/ui/pixi/researchLab.js';
import { DESIGN_WIDTH } from '../src/render/app.js';

const STRIKER = SHIP_TYPES[0]!;
const NODES = flattenShipNodes(STRIKER);

/** 레벨 손잡이가 **없는** 셋. 설계 문면이 「만충」·「면역」·「반감」이라 벌릴 축이 원리적으로 없다. */
const FLAT_SKILLS = new Set([
  'striker-retaliation-sight',
  'striker-sustain-field',
  'striker-signal-chaser',
]);

// ===========================================================================
// ① 커버리지
// ===========================================================================

describe('① 스트라이커 30스킬 전부 상세가 있다', () => {
  it('기체가 스트라이커이고 축당 10스킬이다(전제 확인)', () => {
    expect(STRIKER.slug).toBe('striker');
    expect(NODES.length).toBe(STRIKER.trees.length * SKILLS_PER_AXIS);
    expect(NODES.length).toBe(30);
  });

  it('빠진 스킬이 하나도 없다', () => {
    const missing = NODES.filter((n) => skillDetailOf('striker', n.id) === null).map((n) => n.code);
    // 나쁜 상태: 빠진 스킬은 화면에서 **조용히** 예전 한 줄로 내려앉는다 — 눈으로 못 잡는다.
    expect(missing).toEqual([]);
  });

  it('표에 유령 항목이 없다 (스킬 id 오타 검출)', () => {
    // 표의 키는 `id` 에서 `striker-` 접두사를 뗀 부분이다(skillDetail.ts 표 주석).
    const ids = new Set(NODES.map((n) => n.id.replace(/^striker-/, '')));
    const ghosts = Object.keys(STRIKER_SKILL_DETAIL).filter((k) => !ids.has(k));
    // 나쁜 상태: 오타 난 키는 ①을 통과시키지 못하지만, id 를 바꾼 뒤 옛 키가 남으면 ①은
    // 초록인 채 죽은 문안이 쌓인다.
    expect(ghosts).toEqual([]);
  });

  it('모든 항목이 네 칸을 다 채운다', () => {
    for (const n of NODES) {
      const d = skillDetailOf('striker', n.id)!;
      expect(d.body.length, `${n.code} body`).toBeGreaterThan(10);
      expect(d.scale.length, `${n.code} scale`).toBeGreaterThan(5);
      expect(d.lv1.length, `${n.code} lv1`).toBeGreaterThan(5);
      expect(d.max.length, `${n.code} max`).toBeGreaterThan(5);
      expect(d.values(1).length, `${n.code} values`).toBeGreaterThan(0);
    }
  });

  it('본체가 `desc` 한 줄보다 **더 말한다**', () => {
    for (const n of NODES) {
      const d = skillDetailOf('striker', n.id)!;
      // 나쁜 상태: body 에 desc 를 그대로 복사해 두면 ①~④가 전부 초록인데 화면은 예전과 같다.
      expect(d.body, `${n.code}`).not.toBe(n.desc);
      expect(d.body.length, `${n.code}`).toBeGreaterThanOrEqual(n.desc.length);
    }
  });
});

// ===========================================================================
// ② 수치가 하드코딩이 아니다
// ===========================================================================

describe('② 레벨을 바꾸면 수치가 따라 바뀐다', () => {
  it('손잡이가 있는 27스킬은 Lv1 과 Lv20 의 문자열이 다르다', () => {
    const frozen = NODES.filter((n) => !FLAT_SKILLS.has(n.id)).filter(
      (n) =>
        skillDetailOf('striker', n.id)!.values(1).join('|') ===
        skillDetailOf('striker', n.id)!.values(20).join('|'),
    );
    // 나쁜 상태: 문안에 "+2" 를 손으로 적어 두면 모든 레벨에서 같은 값이 뜬다 — 그것이
    // 정확히 "수치를 보여 준다"의 반대다(틀린 수치를 확신 있게 보여 준다).
    expect(frozen.map((n) => n.code)).toEqual([]);
  });

  it('손잡이가 없는 셋은 레벨에 무관하고, 그 사실을 문장으로 말한다', () => {
    for (const id of FLAT_SKILLS) {
      const d = skillDetailOf('striker', id)!;
      expect(d.values(1)).toEqual(d.values(20));
      // 나쁜 상태: 말하지 않으면 플레이어가 20포인트를 붓고 나서야 안다.
      expect(d.scale, id).toContain('레벨 손잡이가 없다');
      expect(d.max, id).toContain('이득이 없다');
    }
  });
});

// ===========================================================================
// ③ 값이 sim 정본과 같다
// ===========================================================================

/** 그 스킬의 `values(lv)` 를 한 줄로 이어 붙인다(어느 줄에 있든 상관없이 대조). */
function joined(id: string, lv: number): string {
  return skillDetailOf('striker', id)!.values(lv).join(' | ');
}

describe('③ 화면 수치 = sim 함수 결과 (여러 레벨에서)', () => {
  const LEVELS = [1, 3, 7, 12, 20];

  it('F1 처치당 충전', () => {
    for (const lv of LEVELS) {
      expect(joined('striker-kill-momentum', lv), `Lv${lv}`).toContain(`+${killMomentumCharge(lv)}`);
    }
  });

  it('F4 폭발 반경', () => {
    for (const lv of LEVELS) {
      expect(joined('striker-shatter-round', lv), `Lv${lv}`).toContain(String(shatterRadius(lv)));
    }
  });

  it('F10 후속 볼리 배율(쌍곡선 — 정수 계단이 아니라 소수가 뜬다)', () => {
    for (const lv of LEVELS) {
      const pct = extendedMagBp(lv) / 100;
      const shown = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
      expect(joined('striker-extended-mag', lv), `Lv${lv}`).toContain(shown);
    }
  });

  it('S8 콤보 스택 흡수', () => {
    for (const lv of LEVELS) {
      expect(joined('striker-combo-shield', lv), `Lv${lv}`).toContain(String(comboAbsorbPerStack(lv)));
    }
  });

  it('S10 임계당 HP', () => {
    for (const lv of LEVELS) {
      expect(joined('striker-hull-accretion', lv), `Lv${lv}`).toContain(`+${hullGrantHp(lv)}`);
    }
  });

  it('M2 정지 탄 개수·피해·총량', () => {
    for (const lv of LEVELS) {
      const s = joined('striker-thrust-wake', lv);
      expect(s, `Lv${lv}`).toContain(`${thrustWakeCount(lv)}발`);
      // 총 피해는 파생 값이다 — 두 함수의 곱이 화면에 그대로 서는지까지 본다.
      expect(s, `Lv${lv}`).toContain(String(thrustWakeCount(lv) * thrustWakeDamage(lv)));
    }
  });

  it('M10 재충전 틱', () => {
    for (const lv of LEVELS) {
      expect(joined('striker-twin-thruster', lv), `Lv${lv}`).toContain(`${twinRechargeTicks(lv)}틱`);
    }
  });
});

// ===========================================================================
// ④ sim 이 인라인 산술로 되돌아가지 않았다
// ===========================================================================

describe('④ sim 은 스케일 모듈을 쓴다', () => {
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/sim/skills/striker.ts', import.meta.url))),
  );

  it('스케일 모듈을 import 한다', () => {
    expect(src).toContain("from './strikerScaling.js'");
  });

  it('뽑아낸 공식이 인라인으로 되살아나지 않았다', () => {
    // 나쁜 상태: 누군가 급히 고치면서 인라인으로 되돌리면 sim 은 새 값을, 화면은 옛 값을
    // 말한다. 증상은 "설명이 실제와 다르다" 하나뿐이고 테스트는 전부 초록이다.
    const revived = [
      '1 + Math.ceil(f1 / 4)',
      '60 + 6 * f4',
      '10000 - Math.round(120000',
      '240 + Math.floor(4000',
      '90 + 8 * s2',
      '45 + 5 * s9',
    ].filter((frag) => src.includes(frag));
    expect(revived).toEqual([]);
  });
});

// ===========================================================================
// ⑤ 팝업 2단 배치
// ===========================================================================

describe('⑤ 목록 단과 상세 단', () => {
  it('두 단이 겹치지 않는다', () => {
    // 나쁜 상태: 겹치면 상세 글자가 목록 행 위에 얹혀 둘 다 못 읽는다(격납고 헤더 선례).
    expect(POPUP_COLUMNS.detailX).toBeGreaterThan(POPUP_COLUMNS.listRight);
  });

  it('상세 단이 콘텐츠 상자를 안 넘는다', () => {
    expect(POPUP_COLUMNS.detailRight).toBeLessThanOrEqual(POPUP_COLUMNS.boxRight);
  });

  it('넓어진 팝업이 화면 안에 있다', () => {
    // 나쁜 상태: 1920 을 넘으면 상세 단이 화면 밖으로 잘려 나가는데 캔버스가 없어 안 보인다.
    expect(POPUP_COLUMNS.panelX).toBeGreaterThanOrEqual(0);
    expect(POPUP_COLUMNS.panelX + POPUP_COLUMNS.panelW).toBeLessThanOrEqual(DESIGN_WIDTH);
  });
});

// ===========================================================================
// ⑥ 아직 안 채운 기체는 조용히 내려앉는다
// ===========================================================================

describe('⑥ 파일럿 범위 밖', () => {
  it('스트라이커가 아닌 기체는 `null` 이다', () => {
    // 나쁜 상태: id 만으로 찾으면 다른 기체의 같은 이름 스킬 문안을 보여 줄 수 있다.
    expect(skillDetailOf('bruiser', 'kill-momentum')).toBeNull();
    expect(skillDetailOf('phantom', 'shatter-round')).toBeNull();
  });

  it('스트라이커의 모르는 id 도 `null` 이다', () => {
    expect(skillDetailOf('striker', 'striker-no-such-skill')).toBeNull();
    // 접두사가 없으면 형식 위반이라 조회 자체를 거부한다.
    expect(skillDetailOf('striker', 'kill-momentum')).toBeNull();
  });
});
