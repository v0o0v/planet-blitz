/**
 * M8 시그니처 배선 — 말로우(typeId 5 / 비트 22) 완충.
 *
 * ## 무엇을 막는가
 * 1. **소진 규칙 부재** — 순수 함수 층은 적립·회복만 정의한다. world.ts 배선이 정한 소진 규칙
 *    ("무피격 임계를 채운 틱에 풀을 통째로 정산, 회복분은 소멸·나머지는 선체로")을 `cushionSettled`
 *    골든으로 못 박는다. 합 보존(회복분 + 정산분 = 적립분)이 깨지면 여기서 터진다.
 * 2. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:5}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 실제로 굴린다.
 * 3. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런. 이 대조군과 갈리는 것이 곧 "배선이 있다" 의 직접 측정이다.
 * 4. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  SIG_MALLOW_CUSHION,
  CUSHION_DEFER_BP,
  CUSHION_RECOVER_TICKS,
  CUSHION_RECOVER_BP,
  cushionDeferredDamage,
  cushionRecovered,
  cushionSettled,
  hasSignature,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 소진 규칙(cushionSettled)
// ---------------------------------------------------------------------------

describe('말로우 완충 — 정산 몫(cushionSettled) 경계 골든', () => {
  it('임계 179 / 180 / 181 에서 갈린다 (정산 자체가 임계 게이트)', () => {
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS - 1, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(400);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS + 1, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(400);
  });

  it('회복분 + 정산분 = 적립분 (미룬 피해는 회복된 만큼만 사라진다)', () => {
    for (let v = 0; v <= 400; v++) {
      const rec = cushionRecovered(v, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP);
      const due = cushionSettled(v, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP);
      expect(rec + due, `deferred=${v}`).toBe(v);
      expect(Number.isInteger(due), `deferred=${v}`).toBe(true);
      expect(due).toBeGreaterThanOrEqual(0);
    }
  });

  it('비정상 입력에서 0 이고 소수 입력도 정수로 나온다', () => {
    expect(cushionSettled(0, 999, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
    expect(cushionSettled(-40, 999, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
    expect(Number.isInteger(cushionSettled(77.4, 180.9, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP))).toBe(true);
  });

  it('한 피격의 순 경감이 설계 수치(35% × 60%)와 맞는다', () => {
    expect(CUSHION_DEFER_BP).toBe(3500);
    expect(CUSHION_RECOVER_BP).toBe(6000);
    const damage = 1000;
    const deferred = cushionDeferredDamage(damage); // 350
    const immediate = damage - deferred; // 650
    const due = cushionSettled(deferred, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP); // 140
    expect(immediate + due).toBe(790); // 21% 경감
  });
});

// ---------------------------------------------------------------------------
// ② 정규 경로 통합 — 실제로 배선이 살아 있는가
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

/**
 * ⚠️ 2026-08-06 — **`suppressSignature`(shipType:0 강제)는 ADR-0049 이후 오염된 대조군이라
 * 삭제했다.** ADR-0049 가 스트라이커(typeId 0)에 비트24(정조준 사이클)를 부여해
 * `shipTypeDef(0).signatureBit` 이 더 이상 -1 이 아니다 — shipType:0 강제는 "시그니처 없음"이
 * 아니라 "말로우 대신 스트라이커 정조준이 켜진 런"이 된다(상세 물증은
 * shipSignaturePhantom.test.ts 머리말). 유효 shipType 0~6 전부가 시그니처 비트를 하나씩
 * 가지므로 "시그니처 없음"은 이제 제품에 존재하지 않는 상태다.
 *
 * ## 말로우는 다른 다섯과 다르다 — "굶길 트리거"가 하나가 아니라 둘이고, 하나는 굶길 수 없다
 * 말로우의 완충은 두 단계다: ①**유예**(피격마다 35% 를 즉시 안 넣고 aux0 에 적립) — `cushionOn`
 * (= signatureOn(SIG_MALLOW_CUSHION), 런 생성 시 고정) 하나만 게이트한다. **임계·트리거가
 * 없다** — cushionOn 이 참이면 매 피격마다 무조건 실행된다. 그래서 팬텀·버블·해츨링처럼 "트리거
 * 입력을 굶겨 aux 임계에 못 닿게" 하는 기법이 안 통한다 — 애초에 임계가 없다. ②**정산**(무피격
 * aux1 이 CUSHION_RECOVER_TICKS 에 도달하면 적립분을 한꺼번에 청산) — 이쪽은 진짜 임계 트리거다.
 *
 * 그래서 이 파일은 두 축을 다르게 다룬다:
 *  · ①유예 자체의 배선 증거는 **직접 관측**으로 잰다(`live.maxAux0 > 0` — aux0 는 cushionOn
 *    게이트 안에서만 쓰인다. 이 값이 양수라는 것 자체가 유예 코드가 실행됐다는 무모호 증거이고,
 *    대조군이 없어도 성립한다).
 *  · ②정산은 **트리거 굶기기(ⓐ)** 가 그대로 통한다 — 매 틱 stepWorld 직전에 `aux1=0` 을 강제하면
 *    무피격 카운터가 임계(180)에 영영 못 닿아 정산이 한 번도 안 일어난다. **부호가 뒤집힌다는
 *    점에 주의**: 정산은 적립분의 40%("due")를 선체로 되돌리는 절차라, 정산을 굶긴 대조군은
 *    그 40%를 영영 안 돌려받는다 — 즉 **대조군이 live 보다 hp 를 덜 잃는다**(live 는 정산될
 *    때마다 그 몫을 추가로 깎인다). "시그니처 꺼짐"이 아니라 "정산 없는 완충"이므로, live 가
 *    ctrl 보다 hpLost 가 **작다**던 옛 방향이 아니라 **크다**로 뒤집어 잰다(아래 테스트 2).
 *    테스트 1(정산이 자연히 0 회인 고압 무대)은 이 축이 애초에 안 갈리므로 이 대조군을 쓰지
 *    않는다.
 */

interface Observed {
  hpLost: number;
  /**
   * 지연 풀이 통째로 정산된 횟수(aux0 이 양수 → 0 으로 떨어진 전이 수).
   * ⚠️ 2026-08-06: 이 전이 패턴은 더 이상 말로우 전용이 아니다 — 스트라이커 정조준 사이클도
   * aux0 를 0..11 로 돌리다 12번째 발사에서 0 으로 되돌린다(같은 "양수→0" 전이). 스트라이커
   * 런에서는 이 값 대신 `cushionHealed`(world.ts 가 SIG_MALLOW_CUSHION 게이트 안에서만 올리는
   * 사연 메타)로 무모호하게 잰다.
   */
  settlements: number;
  /** world.ts `state.cushionHealed` — 정산으로 회복(소멸)된 HP 누적. 완충 게이트 안에서만 는다. */
  cushionHealed: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

/**
 * `starve=true` 면 매 틱 stepWorld **직전에** `aux1=0` 을 강제한다(무피격 카운터를 정산
 * 임계(180)에 영영 못 닿게 굶긴다) — 위 헤더 주석의 ②정산 축 트리거 굶기기. `aux0`(적립된
 * 지연 풀)·시그니처 비트는 손대지 않는다 — ①유예 자체는 굶길 트리거가 없다(무조건 발동).
 */
function runObserved(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  starve = false,
): Observed {
  // 함선 시그니처 관측은 **중립 서바이벌 아레나**(vampire)에서 돈다. planet 2(니플헤임)는 Lane6 에서
  // chase 로 배정돼 무적 포식자가 정지·저속 플레이어를 접촉 즉사시키므로(MED-1 수정 후 치명적),
  // planetMode 를 vampire 로 덮어 장시간 관측 런이 조기 종료되지 않게 한다(로스터는 유지, chase 만 끔).
  const state = createWorld(seed, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let settlements = 0;
  let prevAux0 = 0;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    if (starve) state.entities[0]!.aux1 = 0;
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    // aux0 이 줄어드는 유일한 경로가 정산이므로(적립은 증가만 한다) 이 전이가 곧 정산이다.
    if (prevAux0 > 0 && p.aux0 === 0) settlements++;
    prevAux0 = p.aux0;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    settlements,
    cushionHealed: state.cushionHealed,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('말로우(typeId 5) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  // 무대 선정도 계약의 일부다: p0/t0 는 3600틱 누적 피해가 수십뿐이라 21% 경감이 정수
  // 반올림에 먹힌다. p2/t2 는 신호가 크다(정찰 실측 기준).
  const STAGE = { planet: 2, stage: 21 } as const;
  const SEED = 3311;
  // 첫 피격 + CUSHION_RECOVER_TICKS(180) 이후 첫 정산 → 반복 발현까지 보려면 넉넉히.
  const TICKS = 1800;

  it('완충(유예)이 실제로 발현한다 — 직접 증거(지연 풀 적립), 대조군 없이 잰다', () => {
    // ⚠️ 이 무대(p2/t21)는 압박이 끊기지 않아 **정산이 자연히 0 회**다(테스트 2 참조 — 소진
    // 규칙 자체는 저압 무대에서 딴다). 즉 정산 축을 굶긴 대조군을 여기 붙여도 live 와 똑같이
    // "한 번도 정산 안 함"이 되어 갈리지 않는다 — 무의미한 비교라 만들지 않는다(위 헤더 주석의
    // "테스트 1은 이 대조군을 쓰지 않는다" 문단). 유예(①) 자체는 트리거가 없어 원천적으로
    // 굶길 수 없으므로, 이 절은 **직접 증거**만으로 배선을 증명한다.
    const cfg = buildRunConfig(profileWithType(5), STAGE);
    expect(cfg.shipType).toBe(5);
    expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, SIG_MALLOW_CUSHION)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);

    // 공허 런 가드 — 월드가 멈춰 있거나 아무도 안 때리면 이 케이스는 아무것도 증명 못 한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(live.hpLost).toBeGreaterThan(0);

    // 핵심 단언: 지연 풀이 실제로 쌓인다. aux0 는 `cushionOn`(signatureOn(SIG_MALLOW_CUSHION))
    // 게이트 안에서만 쓰이므로 — 이 값이 양수라는 것 자체가 유예 코드가 실행됐다는 무모호
    // 직접 증거다(대조군이 없어도 성립한다 — 이 게이트 밖에서는 aux0 를 쓸 방법이 없다).
    expect(live.maxAux0).toBeGreaterThan(0);
    expect(Number.isInteger(live.maxAux0), '지연 풀이 정수가 아니다(u32 해시 오염)').toBe(true);
    // 이 무대는 정산이 안 일어난다(위 주석) — settlements=0 자체가 무대 선정이 맞다는 방증이다.
    expect(live.settlements).toBe(0);
  });

  it('교전이 끊기면 지연 풀이 정산된다 — 무피격 임계 통과 + 풀 소진 관측', () => {
    // 무대가 계약의 일부인 두 번째 사례: p2/t2 는 압박이 끊기지 않아 **정산이 한 번도
    // 일어나지 않는다**(실측 무피격 최대 146틱 < 180). 소진 규칙 자체를 관측하려면 교전
    // 밀도가 낮은 p0/t0 무대가 필요하다 — 이 케이스가 없으면 "적립만 하고 영원히 안
    // 들어오는" 배선(= 순수 감쇄)도 위 케이스를 통과해 버린다.
    //
    // ⚠️ SEED 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인 seed 555 는 밀도가
    // 오르며 정산이 한 번도 안 일어나는 쪽으로 넘어갔다(무피격 최대가 253틱으로 임계는 넘지만
    // settlements=0 — 다음 교전이 aux0=0 이 되기 전에 다시 피격을 리셋하는 정확한 타이밍을
    // 놓쳤다). seed 42 는 1800틱에 settlements=2·maxAux1=600(임계 180 이상)으로 소진 규칙 자체가
    // 실제로 도는 것을 확인할 수 있다.
    //
    // ⚠️ SEED 재선정 2026-08-04(42 → 10, 카르곤 정예 2종). 카드 풀 8 → 10 이라 카드열이 통째로
    // 재추첨되고 seed 42 는 정산이 0 회가 됐다(적립만 하고 소진 규칙을 못 태운다 = 이 케이스가
    // 재는 것이 사라진다). 200시드 재표본에서 **seed 10** 이 정산 2회 · 무피격 최대 239틱 ·
    // 순 경감 86 vs 142 로 규칙이 반복 발현하는 것을 가장 또렷하게 보여준다.
    //
    // ⚠️ SEED 재선정 2026-08-04(10 → 3, 해저드 반감). 박격포 쿨다운 2배 · 용암 기둥 6→3 ·
    // 지형 해저드 4%→2% 로 굴림 값이 갈려 seed 10 은 정산이 0 회가 됐다. 1..300 재표본에서
    // **seed 3** 이 정산 **2회** · 무피격 최대 285틱 · 순 경감 60 vs 98 로 이 절이 재려는
    // 소진 규칙을 가장 또렷하게 태운다(1·2·6·7 도 통과하지만 전부 정산 1회다).
    const cfg = buildRunConfig(profileWithType(5), { planet: 0, stage: 1 });
    const live = runObserved(3, cfg, 1800);
    // starve=true: 같은 cfg(같은 shipType·마스크, 시그니처는 계속 켜져 있다) · 매 틱 aux1=0 을
    // 강제해 정산 임계(180)에 영영 못 닿게 한다(위 헤더 주석의 ②정산 축).
    const ctrl = runObserved(3, cfg, 1800, true);

    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.hpLost).toBeGreaterThan(0);
    // 무피격 카운터가 임계를 넘고, 그 시점에 풀이 통째로 정산된다(실측 2회).
    expect(live.maxAux1).toBeGreaterThanOrEqual(CUSHION_RECOVER_TICKS);
    expect(live.settlements).toBeGreaterThan(0);
    expect(live.cushionHealed).toBeGreaterThan(0);
    // ctrl 은 정산 임계에 영영 못 닿으므로 한 번도 청산되지 않는다 — 직접·독립 증거
    // (cushionHealed 는 우리가 안 건드리는 값, aux1 만 우리가 강제로 0 에 묶는다).
    expect(ctrl.settlements).toBe(0);
    expect(ctrl.cushionHealed).toBe(0);
    // ⚠️ 부호가 옛 버전과 반대다(위 헤더 주석) — 정산은 적립분의 40%("due")를 선체로 되돌리는
    // 절차라서, 정산을 굶긴 ctrl 은 그 몫을 영영 안 돌려받아 live 보다 hp 를 **덜** 잃는다.
    // "시그니처 꺼짐"이 아니라 "정산 없는 완충"이라는 뜻 — live 는 정산될 때마다 due 만큼
    // 추가로 깎이므로 hpLost 가 ctrl 보다 크다.
    expect(live.hpLost).toBeGreaterThan(ctrl.hpLost);
  });

  it('스트라이커(typeId 0) 런은 완충을 쓰지 않는다 (다른 시그니처를 쓰지만 말로우 축은 끝까지 미발현)', () => {
    // ⚠️ 2026-08-06: ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여해 aux0(정조준 카운터,
    // 0..11 순환)를 이제 스트라이커도 쓴다 — "aux 를 끝까지 0"은 더 이상 참이 아니다(상세는
    // shipSignaturePhantom.test.ts 머리말). 게다가 정조준 사이클도 12번째 발사에서 aux0 를
    // 0 으로 되돌리므로 `settlements`(양수→0 전이 계량)도 더는 말로우 전용이 아니다. 그래서
    // **말로우 고유 축**으로 옮긴다 — aux1(정조준이 안 건드리는 슬롯)과 cushionHealed(world.ts
    // 가 SIG_MALLOW_CUSHION 게이트 안에서만 올리는 사연 메타, 슬롯 공유와 무관하게 무모호하다).
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 600);
    expect(obs.maxAux0).toBeGreaterThanOrEqual(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.cushionHealed).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(300);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(5), STAGE);
    expect(runObserved(SEED, cfg(), 400).hashes).toEqual(runObserved(SEED, cfg(), 400).hashes);
  });
});
