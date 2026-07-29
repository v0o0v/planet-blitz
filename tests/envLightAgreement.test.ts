/**
 * 광원 단일 소스 가드 — 레인 간 광원 합의가 조용히 갈라지는 것을 막는다.
 *
 * ## 이 테스트의 임무가 바뀌었다
 * 예전에는 두 레이어가 각자 광원 상수를 들고 있어서(`terrainLight.TO_LIGHT_Y`,
 * `decals.LIGHT_X/LIGHT_Y`) **"두 값이 우연히 같은 방향인가"** 를 코사인 유사도로 검사했다.
 * 테마 전환 이후 둘 다 `EnvTheme.light` 한 곳에서 읽으므로 **합의는 구조적으로 보장**된다.
 *
 * 그래서 이제 겨눌 것은 합의가 아니라 **복제의 재발**이다. 누군가 편의상 모듈 상수로
 * `Math.PI / 2 + 0.32` 를 다시 적어 넣으면, 그날부터 두 레이어는 각자의 태양을 갖고 화면에
 * 광원이 둘이 된다. 그리고 그건 **각 레인의 단위 테스트를 전부 통과한다** — 각자 자기 상수와만
 * 일관하기 때문이다. 이 리포는 같은 함정을 이미 두 번 밟았다:
 *  - `UPPER_THRESHOLD` 복제본이 0.5 / 0.57 로 갈라져 발광이 **지형이 그리지 않는 등고선**에 붙었다.
 *  - 적탄 색 팔레트 복제본이 `textures.ts` 와 갈라질 뻔했다.
 *
 * 그래서 검사는 두 층이다:
 *  1. **소스 텍스트 가드** — 레이어 파일에 광원 각도 리터럴이 되살아나면 잡는다.
 *  2. **전 테마 계약** — 등록된 모든 테마의 광원이 물리적으로 성립하는지.
 *
 * ## 데칼이 `shadowBias` 를 쓰지 않는 것은 의도다
 * 리팩터 전 데칼은 `shadowBias` 를 참조한 적이 없고(드롭 섀도 거리는 지형 픽셀 배수 고정),
 * 지금 도입하면 오프셋이 0.55 배로 바뀌어 **픽셀이 움직인다**. 테마 전환 레인의 성공 기준이
 * "카르곤 화면 무변경"이라 보류했다 — 도입하려면 값 변경 레인으로 따로 해야 한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { ENV_THEMES } from '../src/render/env/themes/index.js';
import { lightX, lightY } from '../src/render/env/theme.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_DIR = join(ROOT, 'src', 'render', 'env');

/** 광원을 소비하는 레이어들. 여기 파일에 각도 리터럴이 있으면 복제다. */
const LIGHT_CONSUMERS = ['decals.ts', 'terrainLight.ts'];

describe('광원은 테마 한 곳에서만 온다', () => {
  it.each(LIGHT_CONSUMERS)('%s 가 광원 각도를 리터럴로 다시 적지 않는다', (file) => {
    const src = readFileSync(join(ENV_DIR, file), 'utf8');
    // 카르곤 광원은 `Math.PI / 2 + 0.32`(= π*0.5 + 0.32). 공백·표기 변형을 모두 잡는다.
    // 이 패턴이 다시 나타나면 그건 `EnvTheme.light` 의 복제이고, 화면에 태양이 둘이 된다.
    const dupe = /Math\s*\.\s*PI\s*[*/]\s*[\d.]+\s*\+\s*0\.32/;
    expect(src).not.toMatch(dupe);
  });

  it.each(LIGHT_CONSUMERS)('%s 가 광원 상수를 export 하지 않는다', async (file) => {
    const mod = (await import(`../src/render/env/${file.replace(/\.ts$/, '.js')}`)) as Record<string, unknown>;
    // 옛 이름들이 되살아나면 그건 테마를 우회하는 통로가 다시 생겼다는 뜻이다.
    for (const name of ['LIGHT_ANGLE', 'LIGHT_X', 'LIGHT_Y', 'TO_LIGHT_Y', 'SHADOW_LIGHT_BIAS']) {
      expect(mod[name]).toBeUndefined();
    }
  });

  it('소스 가드가 항진이 아니다 — 복제 패턴을 실제로 잡는다', () => {
    // 위 두 검사가 통과하는 이유가 "패턴이 아무것도 매칭하지 않아서"일 수 있다. 그 가능성을 막는다.
    const dupe = /Math\s*\.\s*PI\s*[*/]\s*[\d.]+\s*\+\s*0\.32/;
    expect('const LIGHT_ANGLE = Math.PI / 2 + 0.32;').toMatch(dupe);
    expect('const LIGHT_ANGLE = Math.PI * 0.5 + 0.32;').toMatch(dupe);
    expect('const a = theme.light.angle;').not.toMatch(dupe);
  });
});

describe('전 테마 광원 계약', () => {
  it('등록된 테마가 하나 이상 있다(빈 배열 위에서 아래 검사가 항진하지 않도록)', () => {
    expect(ENV_THEMES.length).toBeGreaterThan(0);
  });

  it.each(ENV_THEMES.map((t) => [t.id, t] as const))('%s 의 광원이 단위 벡터로 성립한다', (_id, t) => {
    const len = Math.hypot(lightX(t.light), lightY(t.light));
    expect(len).toBeCloseTo(1, 12);
  });

  it.each(ENV_THEMES.map((t) => [t.id, t] as const))('%s 의 그림자 편향이 [0,1] 이다', (_id, t) => {
    expect(t.light.shadowBias).toBeGreaterThanOrEqual(0);
    expect(t.light.shadowBias).toBeLessThanOrEqual(1);
  });

  it('카르곤 광원은 화면 아래(지형 저지의 용암 쪽)에 있다', () => {
    // 화면 좌표는 y 가 아래로 자란다. 표면 → 광원 벡터의 y 가 양수 = 광원이 아래.
    // 이건 카르곤 고유의 서사("바닥 용암이 유일한 광원, 하늘은 검다")라 전 테마 계약이 아니다.
    const kargon = ENV_THEMES.find((t) => t.id === 'kargon');
    expect(kargon).toBeDefined();
    expect(lightY(kargon!.light)).toBeGreaterThan(0);
    // 값 자체도 못 박는다 — 리팩터가 각도를 바꾸지 않았음의 증거다.
    expect(kargon!.light.angle).toBeCloseTo(Math.PI / 2 + 0.32, 12);
    expect(kargon!.light.shadowBias).toBeCloseTo(0.55, 12);
  });
});

/**
 * 행성별 광원 **골든 표**.
 *
 * ## 왜 필요한가 — 부호가 뒤집혀도 전 테스트가 그린이었다
 * 위의 "전 테마 광원 계약"이 보는 것은 단위 벡터인지와 `shadowBias ∈ [0,1]` 뿐이다. 니플헤임
 * 레인이 뮤테이션으로 확인했다: **광원 각도의 부호를 반전(태양을 발밑으로)해도 전 테스트가
 * 그린이었다.** 못 박는 테스트는 위의 카르곤 것 하나뿐이었기 때문이다. 그런데 광원 방향은
 * 지형광의 띠 방향과 데칼의 림·드롭 섀도를 동시에 결정하므로, 뒤집히면 그 행성의 조명 서사가
 * 통째로 반대가 된다(눈 행성의 태양이 설면 아래에서 뜬다).
 *
 * ## 표를 고칠 때 무엇을 고치는 것인가
 * 각 줄의 `story` 는 장식이 아니라 **그 부호가 왜 그 부호인지의 근거**다. 여기 숫자를 바꾸려는
 * 사람은 서사도 함께 고쳐야 하고, 그 순간 "나는 이 행성의 조명을 바꾸고 있다"를 자각한다.
 * 값만 슬쩍 옮기는 경로를 없애는 것이 이 표의 목적이다.
 *
 * `vertical` 이 `angle` 과 별도 필드인 것도 같은 이유다. 테마와 골든 `angle` 을 **함께** 고쳐
 * 검사를 통과시키려 해도 세로 방향 검사가 따로 남아 있어, 조명이 뒤집히는 변경은 반드시
 * 두 자리를 명시적으로 고쳐야 통과한다(실측: 그 이중 뮤테이션에서 세로 검사만 단독 발화한다).
 *
 * 새 테마를 등록하고 여기 줄을 안 넣으면 "표가 전 테마를 덮는다"가 실패한다.
 */
const LIGHT_GOLDEN: readonly {
  id: string;
  angle: number;
  shadowBias: number;
  /** 광원의 세로 방향. `+1` = 화면 아래(발밑), `-1` = 화면 위(하늘). */
  vertical: 1 | -1;
  story: string;
}[] = [
  {
    id: 'kargon', angle: Math.PI / 2 + 0.32, shadowBias: 0.55, vertical: 1,
    story: '지형 저지의 용암이 유일한 광원이고 하늘은 검다 → 발밑',
  },
  {
    id: 'berdan', angle: -Math.PI / 2 + 0.26, shadowBias: 0.62, vertical: -1,
    story: '포자 안개를 통과한 확산 천공광 → 위. 0.26 rad 기울기는 데칼 하이라이트의 좌우 대칭을 깨기 위한 것',
  },
  {
    id: 'niflheim', angle: -Math.PI / 2 + 0.28, shadowBias: 0.82, vertical: -1,
    story: '지평선에 걸린 저각 태양이 유일한 광원, 설면은 빛을 내지 않는다 → 위. bias 0.82 가 "저각"을 기하로 만든다',
  },
  {
    id: 'arke', angle: -Math.PI / 2 - 0.43, shadowBias: 0.62, vertical: -1,
    story: '무너진 상부 구조 사이로 드는 저각 태양·하늘광 → 위. 기울기가 음수(왼쪽)인 것이 저녁 유적의 방향감',
  },
  {
    id: 'toxar', angle: Math.PI / 2 - 0.24, shadowBias: 0.38, vertical: 1,
    story: '저지에 고인 독성 웅덩이·개천이 광원이고 하늘은 독무에 덮였다 → 발밑. 기울기 부호만 카르곤과 반대(두 행성이 같아 보이지 않게)',
  },
  {
    id: 'kras', angle: -Math.PI / 2 + 0.28, shadowBias: 0.45, vertical: -1,
    story: '무너진 천장 사이 흐린 하늘의 확산광 → 위. 바닥 잔불은 국소 광원일 뿐 장면을 조명하지 않는다',
  },
  {
    id: 'invasion_l1', angle: -Math.PI / 2 + 0.3, shadowBias: 0.5, vertical: -1,
    story: '구름 갑판은 위에서 조명된다 → 위',
  },
  {
    id: 'invasion_l2', angle: -Math.PI / 2 + 0.55, shadowBias: 0.45, vertical: -1,
    story: '천장 조명 → 위. 실내라 광원이 가깝고 그림자가 길어 L1 보다 비스듬하다',
  },
  {
    id: 'invasion_l3', angle: Math.PI / 2 - 0.25, shadowBias: 0.6, vertical: 1,
    story: '코어가 바닥에서 뛴다 → 발밑',
  },
];

describe('행성별 광원 서사 골든', () => {
  it('표가 등록된 전 테마를 정확히 덮는다', () => {
    // 테마를 새로 등록하고 서사를 안 적으면 여기서 걸린다. 반대로 표에만 남은 유령 줄도 걸린다.
    expect([...LIGHT_GOLDEN.map((g) => g.id)].sort()).toEqual([...ENV_THEMES.map((t) => t.id)].sort());
    expect(LIGHT_GOLDEN.every((g) => g.story.length > 10)).toBe(true);
  });

  it.each(LIGHT_GOLDEN.map((g) => [g.id, g] as const))('%s 의 광원 각도·편향이 골든과 같다', (_id, g) => {
    const t = ENV_THEMES.find((x) => x.id === g.id);
    expect(t).toBeDefined();
    expect(t!.light.angle, `${g.id} 광원 각도: ${g.story}`).toBeCloseTo(g.angle, 12);
    expect(t!.light.shadowBias, `${g.id} 그림자 편향: ${g.story}`).toBeCloseTo(g.shadowBias, 12);
  });

  it.each(LIGHT_GOLDEN.map((g) => [g.id, g] as const))('%s 의 광원이 서사가 말하는 쪽에 있다', (_id, g) => {
    const t = ENV_THEMES.find((x) => x.id === g.id);
    expect(t).toBeDefined();
    expect(Math.sign(lightY(t!.light)), `${g.id}: ${g.story}`).toBe(g.vertical);
  });

  it('세로 방향이 전부 같은 값이 아니다(검사가 항진이 아님의 증거)', () => {
    // 만약 전 행성이 같은 방향이면 위 검사는 "부호 하나"만 잠그는 것이라 힘이 약하다.
    const dirs = new Set(LIGHT_GOLDEN.map((g) => g.vertical));
    expect(dirs.size).toBe(2);
  });
});
