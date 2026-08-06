/**
 * M8 시그니처 배선 — 버블(typeId 6 / 비트 23) 방막.
 *
 * ## 무엇을 막는가
 * 1. **파열 규칙 부재** — 순수 함수 층은 흡수·재생 판정만 정의하고 "언제 터지는가 / 얼마나
 *    밀어내는가" 를 비워 두었다. world.ts 배선이 정한 규칙(막 내구가 **소진되는 순간** 파열,
 *    밀어내기는 좌표 1회 변위 `filmBurstPush()`)을 골든으로 못 박는다.
 * 2. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:6}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 실제로 굴린다.
 * 3. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런.
 * 4. **조용한 무해 파열** — 밀어내기를 `e.vx`/`e.vy` 로 구현하면 다음 틱 이동 컴포넌트가 덮어써
 *    화면상 아무 일도 안 일어난다. 그래서 파열 틱에 **적이 실제로 크게 이동했는지**를 잰다.
 * 5. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_BUBBLE_FILM,
  FILM_PERIOD_TICKS,
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
  FILM_BURST_PUSH,
  FILM_BURST_PUSH_TICKS,
  filmReady,
  filmAbsorbed,
  filmRemainingDamage,
  filmBurstPush,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 흡수 합 보존 + 파열 변위
// ---------------------------------------------------------------------------

describe('버블 방막 — 순수 산술 골든', () => {
  it('흡수분 + 잔여분 = 원래 피해 (막은 총량 흡수지 배율이 아니다)', () => {
    for (let d = 0; d <= 200; d++) {
      for (const s of [0, 1, 17, FILM_ABSORB_FLAT]) {
        const a = filmAbsorbed(d, s);
        const r = filmRemainingDamage(d, s);
        expect(a + r, `d=${d} s=${s}`).toBe(d);
        expect(Number.isInteger(a) && Number.isInteger(r)).toBe(true);
        expect(a).toBeLessThanOrEqual(s);
      }
    }
  });

  it('재생 임계 419 / 420 에서 갈린다', () => {
    expect(filmReady(FILM_PERIOD_TICKS - 1)).toBe(false);
    expect(filmReady(FILM_PERIOD_TICKS)).toBe(true);
  });

  it('파열 1회 변위가 반경보다 크다 (반경 안 적이 반경 밖으로 나간다)', () => {
    expect(filmBurstPush()).toBe((FILM_BURST_PUSH * FILM_BURST_PUSH_TICKS) / 100);
    expect(filmBurstPush()).toBe(260);
    expect(filmBurstPush()).toBeGreaterThan(FILM_BURST_RADIUS);
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
 * 아니라 "버블 대신 스트라이커 정조준이 켜진 런"이 된다(실측: `ctrl.maxAux0` 가 0 대신 정조준
 * 사이클 0..11 을 돈다 — shipSignaturePhantom.test.ts 머리말에서 상세 물증). 유효 shipType
 * 0~6 전부가 시그니처 비트를 하나씩 가지므로(shipSignature.ts SIGNATURE_BITS) "시그니처 없음"은
 * 이제 제품에 존재하지 않는 상태다 — 그 상태를 config 로 만들어 대조군 삼는 설계 자체가 틀렸다.
 *
 * ## 대신 무엇을 쓰는가 — 트리거 입력 굶기기(ⓐ)
 * 버블의 막 재형성은 **재생 타이머(aux1)가 FILM_PERIOD_TICKS(420)에 도달**해야 트리거된다(막이
 * 없을 때만, 즉 aux0===0 일 때만 aux1 이 돈다 — world.ts stepShipSignature 버블 분기). 그래서
 * 매 틱 stepWorld 직전에 aux1 을 0 으로 눌러 두면 — **시그니처 비트는 그대로 켜진 채로**(shipType·
 * mask 는 live 와 완전히 동일) — 재생 타이머가 임계에 영원히 도달하지 못해 막이 한 번도 서지
 * 않는다. 이것이 `runObserved` 의 `starve` 플래그다.
 *
 * shipType 을 바꾸지 않으므로 baseBp(damage/maxHp/moveSpeed) 오염이 없고, 다른 시그니처가 섞여
 * 들어올 여지도 없다 — 굶기는 것은 버블 자신의 재생 트리거뿐이다. 대가: `ctrl.maxAux1` 자체는
 * 우리가 직접 건드리므로(매 틱 stepWorld 직전 0 으로 리셋 — 그 직후 stepWorld 가 1 로 올릴
 * 여지는 있다) 항진에 가깝다. 그래서 막 형성 여부의 직접 증거는 우리가 안 건드리는 `aux0`
 * (막 내구, 재생 타이머와 다른 슬롯)로 잰다 — aux0 가 끝까지 0 이면 막이 한 번도 안 선 것이고,
 * 이는 world.ts 의 독립된 다른 코드 경로(재생 타이머 임계 판정)가 낸 결과다.
 */

interface Observed {
  hpLost: number;
  /**
   * 막이 소진된(= 파열한) 횟수. aux0 이 양수 → 0 으로 떨어진 전이 수.
   * ⚠️ 2026-08-06: 이 전이 패턴은 더 이상 버블 전용이 아니다 — 스트라이커 정조준 사이클도
   * aux0 를 0..11 로 돌리다 12번째 발사에서 0 으로 되돌린다(같은 "양수→0" 전이). 스트라이커
   * 런에서 이 값이 0이 아닐 수 있다 — 배선 오염이 아니라 aux0 슬롯을 공유하는 두 시그니처의
   * 우연한 전이 형태 일치다. 버블 단독 증거로 쓸 때는 `filmPops`(아래, world.ts 가
   * SIG_BUBBLE_FILM 게이트 안에서만 올리는 사연 메타)를 대신 써라.
   */
  bursts: number;
  /** 파열 틱에 적 하나가 이동한 최대 거리(밀어내기가 좌표에 실렸는지의 직접 측정). */
  maxBurstJump: number;
  /**
   * world.ts `state.filmPops` — 막이 **버블 시그니처 게이트 안에서** 소진돼 파열한 횟수(비-해시
   * 사연 메타). `signatureOn(state, SIG_BUBBLE_FILM) && player.aux0 > 0` 안에서만 오르므로,
   * 이 값이 양수라는 것 자체가 "버블 배선이 실제로 실행됐다"의 직접·무모호 증거다(aux0 슬롯을
   * 공유하는 다른 시그니처의 전이와 헷갈릴 여지가 없다).
   */
  filmPops: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

/**
 * `starve=true` 면 매 틱 stepWorld **직전에** `aux1=0` 을 강제한다(재생 타이머를 임계에 영영 못
 * 닿게 굶긴다) — 위 헤더 주석의 트리거 굶기기 기법. `aux0`(막 내구)·시그니처 비트는 손대지 않는다.
 */
function runObserved(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  starve = false,
): Observed {
  // 함선 시그니처 관측은 **중립 서바이벌 아레나**(vampire)에서 돈다. 이 케이스가 쓰는 planet 2
  // (니플헤임)는 Lane6 에서 chase 로 배정돼 무적 포식자가 정지·저속 플레이어를 접촉 즉사시키므로
  // (MED-1 수정 후 치명적), planetMode 를 vampire 로 덮어 장시간 관측 런이 조기 종료되지 않게 한다.
  // planet 2 의 로스터는 그대로 두고 chase 규칙만 끈다(테스트가 원래 관측하려던 중립 런 복원).
  const state = createWorld(seed, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let bursts = 0;
  let maxBurstJump = 0;
  let prevAux0 = 0;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    if (starve) state.entities[0]!.aux1 = 0;
    // 파열 틱의 적 이동량을 재기 위해 스텝 직전 좌표를 떠 둔다.
    const before = new Map<number, { x: number; y: number }>();
    for (const e of state.entities) {
      if (e.kind === 'enemy' && !e.dead) before.set(e.id, { x: e.x, y: e.y });
    }
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    if (prevAux0 > 0 && p.aux0 === 0) {
      bursts++;
      for (const e of state.entities) {
        if (e.kind !== 'enemy' || e.dead) continue;
        const b = before.get(e.id);
        if (b === undefined) continue;
        const jump = Math.hypot(e.x - b.x, e.y - b.y);
        if (jump > maxBurstJump) maxBurstJump = jump;
      }
    }
    prevAux0 = p.aux0;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    bursts,
    maxBurstJump,
    filmPops: state.filmPops,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('버블(typeId 6) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  // 무대 선정도 계약의 일부다: 막 1장의 흡수량이 FILM_ABSORB_FLAT(60) 고정이라 교전 밀도가
  // 낮은 무대에서는 누적 피해 자체가 그보다 작아 신호가 묻힌다. p2/t2 는 신호가 크다.
  const STAGE = { planet: 2, stage: 21 } as const;
  const SEED = 3311;
  // 첫 막(420틱) → 소진 → 재생(420틱)까지 최소 두 사이클을 보려면 넉넉히.
  const TICKS = 1800;

  it('방막이 실제로 발현한다 — 트리거 굶긴 대조군보다 피해가 작고 막 내구가 소모된다', () => {
    const cfg = buildRunConfig(profileWithType(6), STAGE);
    expect(cfg.shipType).toBe(6);
    expect(hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_BUBBLE_FILM)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);
    // starve=true: 같은 cfg(같은 shipType·마스크, 시그니처는 계속 켜져 있다) · 재생 타이머만
    // 매 틱 굶겨 막이 한 번도 안 서게 한다(위 헤더 주석 참조).
    const ctrl = runObserved(SEED, cfg, TICKS, true);

    // 공허 런 가드 — 월드가 멈춰 있거나 아무도 안 때리면 이 케이스는 아무것도 증명 못 한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.hpLost).toBeGreaterThan(FILM_ABSORB_FLAT);

    // 핵심 단언: 재생 트리거만 굶기면 피해가 늘어난다(= 배선이 실제로 산 상태다). 두 config 는
    // shipType·마스크가 완전히 같으므로(옛 suppressSignature 와 달리 baseBp 오염이 없다) 갈리는
    // 유일한 원인은 ctrl 이 막을 못 세운 것뿐이다.
    expect(live.hpLost).toBeLessThan(ctrl.hpLost);

    // 런타임 상태가 실제로 굴러간다: 막이 서고(aux0 = FILM_ABSORB_FLAT) 재생 타이머가 돈다.
    expect(live.maxAux0).toBe(FILM_ABSORB_FLAT);
    expect(live.maxAux1).toBeGreaterThanOrEqual(FILM_PERIOD_TICKS - 1);
    // 트리거 굶긴 대조군은 막이 한 번도 안 선다 — aux0(막 내구, 우리가 안 건드리는 슬롯)가
    // 끝까지 0 이라는 것이 그 직접 증거다(aux1 은 우리가 직접 0 으로 고정하므로 항진이라
    // 여기서 재지 않는다).
    expect(ctrl.maxAux0).toBe(0);
    expect(ctrl.bursts).toBe(0);
  });

  it('막이 소진되면 파열해 주변 적을 좌표로 밀어낸다 (속도 배선이면 잡히는 케이스)', () => {
    const cfg = buildRunConfig(profileWithType(6), STAGE);
    const live = runObserved(SEED, cfg, TICKS);

    expect(live.bursts).toBeGreaterThan(0);
    // 적 한 틱 이동량은 수 유닛 수준이다. 파열 틱에 수백 유닛을 뛰었다면 그 원인은
    // burstFilm 의 좌표 변위뿐이다(속도 필드에 실었다면 다음 틱에 덮어써져 여기서 안 잡힌다).
    // 실측: 파열 2회, 최대 이동 267 유닛(= 변위 260 + 그 틱의 자체 이동).
    expect(live.maxBurstJump).toBeGreaterThan(FILM_BURST_RADIUS);
  });

  it('스트라이커(typeId 0) 런은 막이 서지 않는다 (다른 시그니처를 쓰지만 버블 축은 끝까지 미발현)', () => {
    // ⚠️ 2026-08-06: ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여해 aux0(정조준 카운터,
    // 0..11 순환)를 이제 스트라이커도 쓴다 — "aux 를 끝까지 0"은 더 이상 참이 아니다(상세는
    // shipSignaturePhantom.test.ts 머리말). 게다가 정조준 사이클도 12번째 발사에서 aux0 를
    // 0 으로 되돌리므로 `bursts`(양수→0 전이 계량) 도 더는 버블 전용이 아니다(실측: 스트라이커
    // 런에서 bursts=8, 위 Observed.bursts 주석 참조). 그래서 **버블 고유 축**으로 옮긴다 —
    // aux1(재생 타이머, 정조준이 안 건드리는 슬롯)과 filmPops(world.ts 가 SIG_BUBBLE_FILM
    // 게이트 안에서만 올리는 사연 메타, 슬롯 공유와 무관하게 무모호하다).
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 600);
    expect(obs.maxAux0).toBeGreaterThanOrEqual(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.filmPops).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(300);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(6), STAGE);
    expect(runObserved(SEED, cfg(), 400).hashes).toEqual(runObserved(SEED, cfg(), 400).hashes);
  });
});
