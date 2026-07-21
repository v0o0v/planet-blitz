/**
 * Deno 교차 검증 픽스처 생성 + Node 자기 결정론 게이트 (M4 선행 스파이크).
 *
 * 이 테스트는 두 가지를 한다:
 *   1. scripts/deno-verify/scenarios.ts의 4개 대표 시나리오를 Node(V8)에서
 *      실행해 기대 해시·드랍 시퀀스·롤 결과·수학 프로브를 fixtures.json으로 굳힌다
 *      (Deno 러너 verify.ts가 이 파일을 읽어 재현 비교).
 *   2. Node에서 두 번 실행해 bit-identical 함을 확인한다(입력 생성·시뮬·해시가
 *      Node 안에서도 완전 결정론임을 보장 — Deno 비교의 전제).
 *
 * fixtures.json은 커밋되어 `deno task verify`가 단독 실행 가능하다.
 *
 * ## ⚠️ 픽스처는 기본적으로 **비교만** 한다 (적대적 리뷰 MED-1 / LOW-1)
 * 초판은 매 `npx vitest run` 이 fixtures.json 을 **무조건 덮어썼다.** 그래서
 *   ① 이 테스트는 자기가 방금 만든 값과 자기를 비교할 뿐이라 **sim 이 바뀌어도 절대 실패하지
 *      않았다** — 회귀 게이트로 기능하지 않았다.
 *   ② 어떤 목적으로든 vitest 를 돌리면 git 추적 파일이 조용히 오염됐다. 실제로 적대적 리뷰 중
 *      음성 대조를 위해 소스를 임시 훼손한 채 전체 스위트를 돌리자 픽스처가 오염됐고, 소스만
 *      원복한 뒤 `deno task verify` 가 **⑨ 43건 불일치**를 내 존재하지 않는 결정론 버그를
 *      쫓게 만들었다.
 * 이제 기본 경로는 **커밋된 파일과의 비교**이고, 재생성은 `REGEN_DENO_FIXTURES=1` 을 명시할
 * 때만 일어난다. sim 을 의도적으로 바꾼 커밋은 그 환경변수로 픽스처를 함께 갱신해야 한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { computeScenario, mathProbe } from '../scripts/deno-verify/common.js';
import type { Fixture } from '../scripts/deno-verify/common.js';
import { SCENARIOS } from '../scripts/deno-verify/scenarios.js';
import { shipSkillNodeCount } from '../data/ships/index.js';
import { OVERCHARGE_STILL_TICKS } from '../src/sim/shipSignature.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
} from '../src/sim/shipSignature.js';

/** 비스트라이커 시나리오 마크 — 아래 두 케이스가 같은 목록을 본다(한쪽만 늘어나면 구멍이 난다). */
const NON_STRIKER_MARKS = ['⑦', '⑧', '⑨', '⑩', '⑪', '⑫'] as const;

/** 픽스처 재생성 스위치. 없으면 커밋된 파일과 **비교만** 한다(회귀 게이트). */
const REGEN = process.env.REGEN_DENO_FIXTURES === '1';

const FIXTURE_PATH = fileURLToPath(
  new URL('../scripts/deno-verify/fixtures.json', import.meta.url),
);

describe('Deno 교차 검증 픽스처 (M4 스파이크)', () => {
  it('대표 시나리오가 커밋된 fixtures.json 과 일치한다 (재생성은 REGEN_DENO_FIXTURES=1)', () => {
    const scenarios = SCENARIOS.map((sc) => computeScenario(sc));
    const fixture: Fixture = {
      meta: {
        generatedBy: 'tests/denoFixture.test.ts (Node/vitest)',
        node: process.version,
        scenarioCount: scenarios.length,
      },
      mathProbe: mathProbe(),
      scenarios,
    };
    if (REGEN) {
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    }

    // 12종 시나리오(M2 4 + M3 표면 2 + M8 비스트라이커 6 = 로스터 전량), 최종 해시가 유효 u32.
    expect(scenarios.length).toBe(12);
    for (const s of scenarios) {
      expect(Number.isInteger(s.finalHash)).toBe(true);
      expect(s.finalHash).toBeGreaterThanOrEqual(0);
      expect(s.ticks).toBeGreaterThan(0);
    }

    // ⚠️ **본 게이트**: 커밋된 픽스처와 지금 sim 이 만드는 값이 같아야 한다. `node` 버전만
    // 환경 의존이라 비교에서 제외한다(수학 프로브·시나리오 수·해시 전량은 비교한다).
    const committed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    expect(committed.mathProbe, '수학 프로브가 커밋된 픽스처와 다르다').toEqual(fixture.mathProbe);
    expect(committed.meta.scenarioCount, '시나리오 수가 커밋된 픽스처와 다르다').toBe(
      fixture.meta.scenarioCount,
    );
    expect(
      committed.scenarios,
      'sim 결과가 커밋된 fixtures.json 과 다르다 — 의도한 변경이면 REGEN_DENO_FIXTURES=1 로 재생성하라',
    ).toEqual(fixture.scenarios);
  }, 300_000);

  it('Node 안에서 두 번 실행이 bit-identical(입력·시뮬·해시 완전 결정론)', () => {
    for (const sc of SCENARIOS) {
      const a = computeScenario(sc);
      const b = computeScenario(sc);
      expect(a.finalHash).toBe(b.finalHash);
      expect(a.inputsHash).toBe(b.inputsHash);
      expect(a.checkpoints).toEqual(b.checkpoints);
      expect(a.loot).toEqual(b.loot);
      expect(a.rolls).toEqual(b.rolls);
    }
    expect(mathProbe()).toBe(mathProbe());
  });

  it('대표 시나리오가 실제로 의미 있는 상태를 만든다(공허 런 방지)', () => {
    const results = SCENARIOS.map((sc) => computeScenario(sc));
    // ②·④ 내구 파일럿 런은 보스까지 도달해 loot가 쌓여야 한다.
    const berdan = results.find((r) => r.name.startsWith('②'))!;
    expect(berdan.summary.bossSpawned).toBe(true);
    expect(berdan.loot.length).toBeGreaterThan(0);
    // 모든 시나리오가 체크포인트를 남길 만큼 충분히 길다.
    for (const r of results) {
      expect(r.checkpoints.length).toBeGreaterThan(0);
    }
  });

  it('⑦⑧⑨ 가 실제로 비스트라이커다 — EF 가 shipType 을 모르면 여기서 갈린다 (설계서 §10-8)', () => {
    // 이 케이스가 지키는 것: 누군가 ⑦⑧⑨ 의 config 에서 shipType/skillInvest 를 떨어뜨려도
    // 다른 테스트는 전부 그린이고, **비스트라이커 커버리지만 조용히 사라진다.**
    const cases: { mark: string; typeId: number; bit: number }[] = [
      { mark: '⑦', typeId: 4, bit: SIG_HATCHLING_BROOD },
      { mark: '⑧', typeId: 5, bit: SIG_MALLOW_CUSHION },
      { mark: '⑨', typeId: 6, bit: SIG_BUBBLE_FILM },
      { mark: '⑩', typeId: 1, bit: SIG_BRUISER_ARMOR },
      { mark: '⑪', typeId: 2, bit: SIG_ARC_OVERCHARGE },
      { mark: '⑫', typeId: 3, bit: SIG_PHANTOM_CLOAK },
    ];
    for (const { mark, typeId, bit } of cases) {
      const sc = SCENARIOS.find((s) => s.name.startsWith(mark));
      expect(sc, `${mark} 비스트라이커 시나리오가 존재해야 한다`).toBeDefined();
      expect(sc!.config.shipType).toBe(typeId);
      expect(sc!.config.skillInvest?.length).toBe(shipSkillNodeCount(typeId));
      // 시그니처 비트가 실제 로드아웃 마스크에 OR 돼 있다(§10-1 을 fixture 축에서 재확인).
      expect(hasCapstone(sc!.config.loadout!.uniqueMask, bit)).toBe(true);
    }
    // ⚠️ **길이 축은 ⑦ 전담이다.** 말로우·버블은 `nodesPerTree` 가 스트라이커와 같아 스킬 노드
    // 수가 63 으로 동일하다 — ⑧·⑨ 는 "길이가 다른 skillInvest" 를 대신하지 못하므로, ⑦ 이
    // 사라지면 길이 프리픽스 폴드 커버리지가 통째로 없어진다.
    const hatchling = SCENARIOS.find((s) => s.name.startsWith('⑦'))!;
    expect(hatchling.config.skillInvest?.length).not.toBe(shipSkillNodeCount(0));
    // 그리고 스트라이커 시나리오들은 여전히 shipType 미지정이어야 한다(골든 불변의 전제).
    for (const s of SCENARIOS) {
      if (NON_STRIKER_MARKS.some((m) => s.name.startsWith(m))) continue;
      expect(s.config.shipType, `${s.name} 는 스트라이커여야 한다`).toBeUndefined();
    }
  });

  it('⑧⑨ 가 공허 런이 아니다 — 시그니처 분기가 실제로 실행된 런인가 (aux 궤적)', () => {
    // 이 파일의 비교는 bit-identical 해시라, **분기가 한 번도 실행되지 않으면** EF 가 그 분기를
    // 통째로 빠뜨려도 두 런타임의 해시가 같다(= 커버리지 0). 그래서 시나리오 자체가 시그니처
    // aux 를 움직였는지를 여기서 못 박는다 — 무대(planet/tier)나 seed 를 바꿔 효과가 사라지면
    // 이 케이스가 즉시 빨개진다.
    // ⚠️ `slot` 은 그 시그니처의 **왕복하는** 슬롯이다. 브루저만 aux1(피격 이후 경과 틱)을 본다 —
    // aux0(장갑 스택)은 압박이 이어지는 런에서 0 으로 되돌아오지 않아 "왕복" 계량이 성립하지
    // 않는다. 반면 aux1 은 피격마다 0 으로 리셋되고 매 틱 오르므로 두 분기를 모두 덮는다.
    for (const { mark, slot, minRaise, minSettleOrBurst, minMaxAux0 } of [
      // 말로우: 지연 적립(aux0 상승)과 정산(aux0 → 0)이 모두 일어나야 두 분기가 다 돈다.
      { mark: '⑧', slot: 0, minRaise: 1, minSettleOrBurst: 1 , minMaxAux0: 1 },
      // 버블: 막 재생(aux0 0 → 60)과 파열(aux0 → 0)이 모두 일어나야 한다.
      { mark: '⑨', slot: 0, minRaise: 1, minSettleOrBurst: 1 , minMaxAux0: 1 },
      // 브루저: 소멸 타이머 상승과 피격 리셋이 모두 돌아야 한다(위 주석).
      { mark: '⑩', slot: 1, minRaise: 1, minSettleOrBurst: 1 , minMaxAux0: 1 },
      // 아크캐스터: 정지 파일럿이라 카운터가 0 으로 되돌아오지 않는다(리셋은 **이동 입력**에서만
      // 일어나고 driveDurable 은 보스 추격 구간 외에는 정지다). 그래서 왕복 대신 아래
      // `minMaxAux0` 로 **증폭 임계를 실제로 넘겼는지**를 본다 — 그것이 이 시그니처의 분기다.
      { mark: '⑪', slot: 0, minRaise: 1, minSettleOrBurst: 0, minMaxAux0: OVERCHARGE_STILL_TICKS },
      // 팬텀: 무피격 스트릭 상승과 (피격/유지창 종료) 리셋이 모두 돌아야 한다.
      { mark: '⑫', slot: 0, minRaise: 1, minSettleOrBurst: 1 , minMaxAux0: 1 },
    ]) {
      const sc = SCENARIOS.find((s) => s.name.startsWith(mark))!;
      const inputs = sc.buildInputs();
      const state = createWorld(sc.seed, sc.config);
      let prev = 0;
      let raise = 0;
      let drop = 0;
      let maxAux0 = 0;
      for (const f of inputs) {
        stepWorld(state, f);
        const p0 = state.entities[0]!;
        const aux0 = slot === 0 ? p0.aux0 : p0.aux1;
        if (prev === 0 && aux0 > 0) raise++;
        if (prev > 0 && aux0 === 0) drop++;
        if (aux0 > maxAux0) maxAux0 = aux0;
        prev = aux0;
      }
      expect(maxAux0, `${mark} 시그니처 aux 가 한 번도 움직이지 않았다`).toBeGreaterThanOrEqual(
        minMaxAux0,
      );
      expect(raise, `${mark} 적립/재생 횟수`).toBeGreaterThanOrEqual(minRaise);
      expect(drop, `${mark} 정산/파열 횟수`).toBeGreaterThanOrEqual(minSettleOrBurst);
    }
  }, 300_000);
});
