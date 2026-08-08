/**
 * W2b — `autoAttack` 발사 로직 추출(`emitVolley`, `activeTypes.ts`)의 **거동 불변 계약**
 * (배치7 F2b, ADR-0049 선결 — 스트라이커 F10「연장 탄창」· M8「도약 사격」).
 *
 * `autoAttack` 은 비-export 모듈 사설이라 `activeHandlers/striker.ts:92-95` 의 주석이 이미
 * 적어 뒀듯 leaf(액티브 핸들러)가 재사용할 수 없었다. 이 커밋은 **발사 자체**(아키타입별
 * 탄 스폰 — 레일건·미사일·빔·발칸/스프레드 + 쌍둥이 항성 유니크 배율)를 `emitVolley` 로
 * 뽑아 `activeTypes.ts` 에 옮겼다. 표적 선택(`nearestTarget`)과 쿨다운(`player.cooldown`
 * 소비·적립)은 그대로 `autoAttack` 에 남아 있다 — 그 함수·`emitVolley` 양쪽 doc 이 근거다.
 *
 * ## ⭐ 이 파일이 잠그는 것 — **추출 전후 해시 비트 동일**
 * 아래 6개 골든 해시는 **추출 전 코드(`git stash` 로 되돌린 `world.ts`/`activeTypes.ts`/
 * `constants.ts`)로 직접 재실측해 추출 후와 일치를 확인한 값**이다(재생성이 아니다 — 근거는
 * `constants.ts`/`activeTypes.ts`/`skillHooks.ts` 변경 **전** 해시와 같다는 것을 별도로 실측
 * 했다). 아키타입 4종(레일건·미사일·빔·발칸) + 스프레드 파생 유니크(쌍둥이 항성) 1종을
 * 전부 덮는다 — `emitVolley` 의 아키타입 분기 네 갈래 전부를 최소 한 번씩 실행하지 않으면
 * 이 잠금이 항진이 되므로, 각 설정이 어느 분기를 태우는지 주석에 명시한다.
 *
 * ## 재동결 — 2026-08-08 (출시 전 밸런스 확정)
 * 6건 전량이 갈렸다. 원인은 이 파일이 아니라 **플레이어·적 기본 스탯 일괄 개정**이고
 * (공격력 8 → 18.24 · HP 100 → 151 · 적 밀도 +30% · 단계 HP 앵커 · 보스 HP ×2 · 해저드 절반),
 * 이 픽스처는 `createWorld`+`stepWorld` 로 웨이브가 도는 무대를 쓰므로 그 전부를 통과한다.
 * **교환 대조를 재생성보다 먼저 했다** — 레인이 바꾼 밸런스 상수 14개를 전부 되돌리자 6건이
 * 옛 값으로 복원됐다(동일 6 / 발산 0). 아래 ⚠️ 가 요구하는 "회귀 조사 먼저" 를 그렇게 지켰다.
 *
 * ## 재동결 — 2026-08-08 (조우 확률 확정)
 * 같은 날 두 번째 재동결이고, 이번에도 6건 전량이 갈렸다. 원인은 **`ENCOUNTER_SPAWN_PROB`
 * 0.02 → 0.20** 하나다. 이 픽스처는 90틱만 도는데 조우 스폰 틱은 1800~9000 이라 조우가
 * 실제로 뜨지는 않지만, `rollEncounter` 가 런 시작에 굴린 **예약 레코드가 월드 상태에
 * 실려 `hashWorld` 에 접힌다** — 시드 777 이 2% 에서는 미당첨, 20% 에서는 당첨이라 6건이
 * 한꺼번에 움직였다.
 *
 * **교환 대조를 재생성보다 먼저 했다**: `ENCOUNTER_SPAWN_PROB` 만 0.02 로 되돌리자 6건이
 * 옛 값으로 전량 복원됐다(동일 6 / 발산 0). 같은 레인의 다른 두 축(설계도 런 게이트 ·
 * 의뢰서 발령 확률)은 이 해시에 **닿지 않음이 그 대조로 증명됐다** — 둘 다 정산·서버
 * 레이어라 sim 해시 밖이라는 설계 주장과 실측이 일치한다.
 *
 * ⚠️ 이 해시들이 갈리면 **골든 재생성이 아니라 회귀 조사가 먼저다** — 이 픽스처는
 * `src/sim/**` 를 하나도 안 만졌다(순수 리팩터), 그런데도 갈렸다면 그 자체가 결함 증거다.
 * 위 두 번의 재동결이 지킨 절차가 그것이다: **먼저 되돌려서 귀속을 확정하고, 그 다음에 언다.**
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { neutralLoadout } from '../src/items/loadout.js';
import { blankEntity, addEntity, type Entity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';

const WEAPON_VULCAN = 0;
const WEAPON_SPREAD = 1;
const WEAPON_RAILGUN = 2;
const WEAPON_MISSILE = 3;
const WEAPON_BEAM = 4;
/** `src/sim/uniques.ts` 의 `UQ_TWIN_STAR` 비트(=7). 값 복제가 아니라 리터럴 재확인 — 그 값이
 * 바뀌면 이 픽스처의 `uniqueMask` 도 같이 갱신해야 한다는 신호로 일부러 여기 적는다. */
const UQ_TWIN_STAR_BIT = 7;

/** 웨이브가 매 틱 다시 채우는 무대에서 **더미 하나만** 살려 발사 조건을 고정한다. */
function addDummyEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 1_000_000;
  e.maxHp = 1_000_000;
  e.enemyType = -1; // enemyDefFor → undefined → 제자리에 서서 표적 노릇만 한다.
  return addEntity(state, e);
}

/** 무기 하나로 90틱을 돌려 해시를 낸다. 시드·더미 위치·틱 수가 곧 픽스처 정의다. */
function runHash(weaponType: number, uniqueMask = 0): string {
  const state = createWorld(777, {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    loadout: { ...neutralLoadout(), weaponType, uniqueMask },
  });
  const player = state.entities[0] as Entity;
  addDummyEnemy(state, player.x + 300, player.y);
  for (let i = 0; i < 90; i++) {
    // 플레이어 + 더미 + 살아 있는 아군탄만 남긴다 — 웨이브 스폰이 섞이면 매 실행마다
    // 다른 표적이 끼어들어 이 골든이 시드 재현성을 잃는다.
    state.entities = state.entities.filter(
      (e) => e === player || e.enemyType === -1 || e.kind === 'bullet',
    );
    stepWorld(state, emptyInput());
  }
  return hashWorld(state).toString(16);
}

describe('W2b emitVolley 추출 — 해시 비트 동일 (배치7 F2b)', () => {
  it('발칸(기본) — 부채꼴 분기', () => {
    expect(runHash(WEAPON_VULCAN)).toBe('5ee28ead');
  });

  it('스프레드 — 부채꼴 분기(발칸과 같은 갈래, 무기 베이스라인만 다르다)', () => {
    expect(runHash(WEAPON_SPREAD)).toBe('283fca91');
  });

  it('스프레드 + 쌍둥이 항성(유니크) — 부채꼴 분기의 배율 갈래', () => {
    expect(runHash(WEAPON_SPREAD, 1 << UQ_TWIN_STAR_BIT)).toBe('d918ac06');
  });

  it('레일건 — 단발 분기', () => {
    expect(runHash(WEAPON_RAILGUN)).toBe('34e7595d');
  });

  it('미사일 — 유도탄 분기(`MISSILE_MARK` 스탬프 포함)', () => {
    expect(runHash(WEAPON_MISSILE)).toBe('c153e4b7');
  });

  it('빔 — 정지 세그먼트 분기(`reach` 별도 인자 경로)', () => {
    expect(runHash(WEAPON_BEAM)).toBe('f028d3fe');
  });
});

describe('W2b emitVolley 추출 — 비-공허 증거(실제로 탄이 난다)', () => {
  it('레일건 설정에서 90틱 안에 아군탄이 최소 1발 태어난다', () => {
    // 위 해시 픽스처와 같은 설정 — 해시가 "아무 일도 안 일어난 채 우연히 같다" 가 아님을
    // 별도로 실증한다(해시 동일은 발사가 0 번이어도 통과하는 항진일 수 있다).
    const state = createWorld(777, {
      ...DEFAULT_CONFIG,
      planet: 0,
      stage: 1,
      loadout: { ...neutralLoadout(), weaponType: WEAPON_RAILGUN },
    });
    const player = state.entities[0] as Entity;
    addDummyEnemy(state, player.x + 300, player.y);
    let sawBullet = false;
    for (let i = 0; i < 90 && !sawBullet; i++) {
      if (state.entities.some((e) => e.kind === 'bullet' && !e.dead)) sawBullet = true;
      stepWorld(state, emptyInput());
    }
    expect(sawBullet, 'emitVolley 가 한 발도 안 쐈다 — 위 해시 잠금이 공허하다').toBe(true);
  });
});
