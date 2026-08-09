/**
 * 게스트 시작 프로필 — "3세대째 사령부" 프리셋 (2026-08-09).
 *
 * ## 왜 있는가
 * 게스트 로그인은 계정 없이 게임 전체를 보여 주는 입구다. 그런데 신규 프로필로 시작하면
 * 관제탑(침공)은 행성 1클리어 뒤에야 열리고, 촉매·계보·설계도는 그보다 훨씬 뒤다 — 잠깐
 * 둘러보는 사람에게는 **초반 몇 분이 게임의 전부**로 보인다. 이 프리셋은 그 창을 걷어낸다.
 *
 * ## 규율 — 리터럴로 짜지 않는다
 * 프로필을 손으로 적은 리터럴로 만들면 스키마가 바뀔 때마다 조용히 무효 상태가 된다(길이가
 * 어긋난 `skillInvest`, 해금 조건을 안 만족하는 `activeSlots`, 스냅샷 없는 수호기 등). 그래서
 * 여기서는 **실제 게임이 쓰는 순수 함수를 그대로 호출해** 상태를 만든다 — 레벨은 `grantXp`,
 * 투자는 `investSkill`, 퇴역은 `retireActiveShip`. 게임에서 도달할 수 없는 상태는 이 경로로
 * 만들어지지 않는다.
 *
 * ## 결정론
 * 장비는 고정 시드로 굴린다({@link GUEST_PRESET_SEED}). 같은 코드면 언제 눌러도 같은 프리셋이
 * 나오므로, 심사·재현·스크린샷이 전부 같은 것을 본다.
 *
 * ## 서버 재화는 여기 없다
 * 촉매·설계도·의뢰서·방어 배치·순위는 서버 테이블이 정본이라 클라 세이브로 만들 수 없다.
 * 그쪽은 `seed_guest_account` RPC 가 채운다 — 이 파일은 **세이브에 담기는 축만** 책임진다.
 */

import { PLANETS } from '../../data/planets/index.js';
import { LEVEL_CAP } from '../../data/waves.js';
import { activeSlotViews, equipActive } from '../items/activeSkills.js';
import { rollItem } from '../items/roll.js';
import { EQUIP_SLOTS, type Item, type ItemSource, type SlotKind } from '../items/types.js';
import { flattenShipNodes, shipTypeDef } from '../../data/ships/index.js';
import { retireActiveShip } from './guardianLifecycle.js';
import { investLineageBranch } from './guardianLifecycle.js';
import { activeShip, investSkill, newPlayerProfile, recordPlanetClear } from './profile.js';
import type { Profile, Ship } from './profile.js';
import { grantXp } from './settlement.js';

/**
 * 장비 굴림 고정 시드. 값 자체에 의미는 없다(황금비 상수) — **바뀌지 않는다**는 것만이 계약이다.
 * 바꾸면 그날 이후의 게스트가 다른 장비를 들고 시작한다.
 */
export const GUEST_PRESET_SEED = 0x9e3779b9;

/** 프리셋이 도달하는 세대 수. 2세대를 퇴역시키고 3세대째를 몰고 있다(= 수호기 2기). */
const GENERATIONS = 3;

/** 각 행성의 최고 클리어 단계. 개방 상한이 `max(10, 12 + 5)` 라 성계 지도가 넉넉히 열린다. */
const CLEARED_STAGE = 12;

/** 시작 재화 — 정련 몇 번, 창고 확장 한두 번, 리롤을 실제로 눌러 볼 수 있는 정도. */
const START_CREDITS = 480_000;
const START_MINERALS = 260_000;

/** 창고에 넣어 둘 여분 장비 수(정련·살베지·비교를 눌러 볼 거리). */
const STASH_ITEMS = 12;

/**
 * 마지막 세대가 **남겨 두는** 스킬 포인트 비율(%). 절반은 이미 찍힌 빌드를 보여 주고, 절반은
 * 심사자가 직접 찍어 수치가 어떻게 변하는지 확인하도록 남긴다(사용자 결정, 2026-08-09).
 */
const UNSPENT_PERCENT = 50;

/** 프리셋 장비의 출처 스탬프. `levelCap` 을 만렙으로 두어 요구 레벨 게이트에 걸리지 않는다. */
function presetSource(planet: number): ItemSource {
  return { planet, stage: CLEARED_STAGE, levelCap: LEVEL_CAP };
}

/**
 * 세대별 시드 — 세대가 다르면 장비도 다르게 굴린다. 곱셈 후 `>>> 0` 으로 32비트에 가둔다
 * (`rollItem` 이 `dropSeed >>> 0` 을 전제한다).
 */
function generationSeed(generation: number, slotIndex: number): number {
  return (Math.imul(GUEST_PRESET_SEED, generation * 31 + slotIndex + 1) ^ (generation << 16)) >>> 0;
}

/** 활성 기체를 만렙까지 올리고 얻은 스킬 포인트를 프로필 풀에 넣는다. */
function levelToCapture(profile: Profile): void {
  const ship = activeShip(profile);
  // XP 곡선을 직접 계산하지 않는다 — 넉넉한 값을 부어 `grantXp` 가 만렙에서 멈추게 둔다.
  // 만렙 도달 시 잔여 XP 는 그쪽이 0 으로 버린다(저금통 금지 규율).
  profile.skillPoints += grantXp(ship, Number.MAX_SAFE_INTEGER);
}

/** 8칸을 레어로 채운다. 모듈 2칸은 같은 `module` 종류라 슬롯 오버라이드가 같다. */
function equipGeneration(ship: Ship, generation: number): void {
  EQUIP_SLOTS.forEach((slotId, i) => {
    const kind: SlotKind = slotId === 'module0' || slotId === 'module1' ? 'module' : slotId;
    const item = rollItem(
      generationSeed(generation, i),
      // 마지막 세대만 레어 — 앞 세대는 매직으로 굴려 "세대를 거치며 좋아졌다"가 보이게 한다.
      generation === GENERATIONS - 1 ? 'rare' : 'magic',
      presetSource(i % PLANETS.length),
      kind,
    );
    ship.equipped[slotId] = item;
  });
}

/**
 * 보유 포인트를 노드 순서대로 붓는다. 앞에서부터 한 축을 최대치까지 채우므로 **한 축이 깊게
 * 파인 빌드**가 되고, 그 형태가 액티브 해금(누적 8·40) 조건과도 맞는다.
 *
 * `investSkill` 이 최대치·잔여 포인트를 스스로 판정하므로 여기서 규칙을 복제하지 않는다.
 */
function investPoints(profile: Profile, budget: number): void {
  const ship = activeShip(profile);
  const nodeCount = flattenShipNodes(shipTypeDef(ship.typeId)).length;
  let spent = 0;
  for (let index = 0; index < nodeCount && spent < budget; index++) {
    // 한 노드가 최대치에 닿으면 false 를 내므로 다음 노드로 넘어간다.
    while (spent < budget && investSkill(profile, index)) spent++;
  }
}

/** 해금된 액티브를 앞에서 두 개 장착한다(2칸). 해금 판정은 `equipActive` 가 한다. */
function equipActives(ship: Ship): void {
  for (const view of activeSlotViews(ship.typeId, ship.skillInvest, ship.activeSlots)) {
    if (!view.unlocked) continue;
    const res = equipActive(ship.typeId, ship.skillInvest, ship.activeSlots, view.def.id);
    if (!res.ok) continue;
    ship.activeSlots = res.slots;
    if (!ship.activeSlots.includes(null)) break;
  }
}

/** 창고 여분 장비 — 정련·살베지를 눌러 볼 거리. 등급을 섞어 비교 대상이 되게 한다. */
function fillStash(profile: Profile): void {
  const items: Item[] = [];
  for (let i = 0; i < STASH_ITEMS; i++) {
    const kind = EQUIP_SLOTS[i % EQUIP_SLOTS.length] ?? 'main';
    const slot: SlotKind = kind === 'module0' || kind === 'module1' ? 'module' : kind;
    items.push(
      rollItem(
        generationSeed(GENERATIONS + 1, i),
        i % 3 === 0 ? 'rare' : 'magic',
        presetSource(i % PLANETS.length),
        slot,
      ),
    );
  }
  profile.stash.push(...items);
}

/**
 * 게스트 시작 프로필. 호출할 때마다 **새 객체**를 만든다(공유 배열이 새지 않게).
 *
 * 인트로 4컷은 그대로 보여 준다(게임 소개의 일부이고 언제든 스킵된다). 강제 튜토리얼만
 * 건너뛴다 — 만렙 기체를 몰고 튜토리얼로 들어가는 것은 앞뒤가 안 맞는다.
 */
export function guestPresetProfile(): Profile {
  const profile = newPlayerProfile();
  profile.tutorialDone = true;
  profile.credits = START_CREDITS;
  profile.minerals = START_MINERALS;

  for (let planet = 0; planet < PLANETS.length; planet++) {
    recordPlanetClear(profile, planet, CLEARED_STAGE);
  }

  for (let generation = 0; generation < GENERATIONS; generation++) {
    const last = generation === GENERATIONS - 1;
    levelToCapture(profile);
    equipGeneration(activeShip(profile), generation);
    // 마지막 세대만 절반을 남긴다. 앞 세대는 전부 찍은 채 퇴역해야 수호기 빌드가 비지 않는다
    // (수호기는 퇴역 순간의 `skillInvest` 를 그대로 박제한다 — ADR-0024).
    const budget = last
      ? Math.floor((profile.skillPoints * (100 - UNSPENT_PERCENT)) / 100)
      : profile.skillPoints;
    investPoints(profile, budget);
    equipActives(activeShip(profile));
    if (!last) {
      // 퇴역 = 수호기 1기 + 계보 +50. 실패하면(만렙이 아니면) 조용히 넘어가지 않고 멈춘다 —
      // 그 상태로 계속하면 세대 수만 맞고 수호기가 없는 프로필이 나온다.
      if (retireActiveShip(profile) === null) {
        throw new Error(`게스트 프리셋: ${generation}세대 퇴역 실패(레벨 ${activeShip(profile).level})`);
      }
    }
  }

  // 계보 — 퇴역 2회로 받은 100 포인트를 두 가지에 나눠 붓는다. 비용이 레벨마다 오르므로
  // `investLineageBranch` 가 false 를 낼 때까지 번갈아 넣는다(잔액 규칙을 복제하지 않는다).
  for (let i = 0; ; i++) {
    const branch = i % 2 === 0 ? 'ship' : 'guardian';
    if (!investLineageBranch(profile, branch)) {
      // 한쪽이 막혀도 다른 쪽은 더 쌀 수 있다 — 양쪽이 모두 막히면 끝.
      if (!investLineageBranch(profile, i % 2 === 0 ? 'guardian' : 'ship')) break;
    }
  }

  fillStash(profile);
  return profile;
}
