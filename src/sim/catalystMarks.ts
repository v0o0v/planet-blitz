/**
 * 적 `aux0` 의 **촉매 비트 구역** — 인코딩 표와 접근자(ADR-0052 선결 ①).
 *
 * 촉매 규칙 여덟이 적 하나에 표식을 남겨야 하는데 적 엔티티에는 남는 칸이 없다. 그래서
 * `encounters/light.ts:32-44` 의 비트 패킹 선례를 따라 **`aux0` 한 칸을 비트로 나눠 쓴다.**
 *
 * ## ⚠️ `aux1` 은 절대 건드리지 마라
 * `MID_CLASH_LEADER_MARK`(`modes/midClash.ts:58,118`)가 **매 런 확정으로** 점유하고,
 * 세그먼트 전진 게이트가 **오직 그 마커로만** 판정한다(`midClash.ts:92`, `blockBreak.ts:228`).
 * 촉매가 덮으면 **중반 격전이 공짜로 통과된다.** `SEALED_GUARDIAN_MARK`(조우,
 * `encounters/light.ts:228`)도 같은 칸이다.
 *
 * ## ⚠️ 대상은 **`kind === 'enemy'` 뿐이다**
 * `aux0` 는 kind 마다 뜻이 다르다 — 플레이어는 장갑·클로크 임계(`world.ts:2515·2570`)와
 * 커션(`:2642`)이, **보스는 추격 모드 취약화 플래그**(`world.ts:370`)가 쓴다. 잡몹에만 찍어라.
 * 보스에 찍으면 니플헤임 포식자가 무적에서 풀리거나 반대로 영영 안 풀린다.
 *
 * ## 결정론
 * `aux0` 는 `hashEntity` 가 접는 칸이다 — 그래서 **모든 쓰기는 촉매 게이트 안쪽**이어야 한다
 * (`state.catalystOn` + 카드 소지 판정). 게이트 밖에서 한 비트라도 찍으면 무촉매 런의 골든이
 * 갈린다. 읽기는 게이트가 필요 없다(무촉매 런은 전 비트가 0 이라 판정이 자동으로 거짓이다).
 *
 * ## 비트 예산 — 31 / 32 (상위 1비트만 남았다)
 *
 * ⚠️ **이 표는 사람이 읽어 맞추는 것이 아니다.** `tests/catalystMarkBits.test.ts` 가
 * {@link CATALYST_MARK} 객체를 기계로 훑어 ①구간 겹침 0 ②`CATALYST_MARK_BITS` 가 실제 최대
 * 비트를 덮음 ③32 초과 없음 ④`aux1` 무접촉을 잠근다. 표를 고치면 그 테스트가 따라온다.
 * 다섯 레인이 이 표를 동시에 편집한 뒤 사람이 눈으로 검산했더니 **`plunder` 의 의미가 코드와
 * 반대인 채로 통과했다**(아래 참조) — 그래서 검사를 기계로 옮겼다.
 * ```
 *  비트  폭  소유 카드                          뜻
 *   0    1  id 1  plunder                     **강탈 완료**(이미 뜯은 엘리트) — ⚠️ 뜻이 반대다
 *   1-2  2  id 6  gilding                     도금 단계 0..3
 *   3    1  id 20 resonance(동조)             동조 중(같은 종류 셋이 모임)
 *   4    1  id 36 niflheim-pursuit            그림자다(죽일 수 없음·조준 제외·적 수 제외)
 *   5    1  id 29 ascendant                   이동 불능(대시 무적 중 통과당함)
 *   6    1  점화 약공명(불씨)                  밀려남(1초간 받는 피해 감소)
 *   7-14 8  id 17 greed                       금빛 액수(적이 진 자원, 8비트 눈금)
 *  15-22 8  id 15 extraction                  실린 액수(보급 습격 자원, 8비트 눈금)
 *  23-24 2  id 7  prospect                    광맥 0=아님 · 1=보유(개방) · 2=보유(무적)
 *  25    1  id 27 afterburner               이번 대시에 관통당했다(처치 시 최대 HP 되돌림)
 *  26    1  id 35 berdan-hive-queen          일벌이다(보스가 토한 개체 — HP 를 나눠 가졌다)
 *  27    1  id 38 niflheim-flagship         기함이다(일반 적 kind + 센티넬 — boss kind 를 늘리지 않는다)
 *  28-30 3  공명(불씨·덫 공용)                 공명 카운트다운(눈금 10틱 — 0 이면 표식 해제)
 * ```
 * 남은 상위 1비트(31)는 **비워 둔다** — 배선 레인이 새 카드에 쓸 자리다. 쓸 때 이 표를
 * 함께 갱신해라. 표와 코드가 갈리면 두 카드가 같은 비트를 조용히 덮는다.
 *
 * ⚠️ **액수 두 칸은 8비트 눈금이지 원값이 아니다**(0..255). sim 은 아이템·자원의 실제 값을
 * 모른다(`spawnLoot` 은 시드·등급코드만 싣고, 값은 `save/settlement.ts` 에만 있다) — 그러니
 * 여기 실리는 것은 **눈금**이고 환산은 정산 계층이 한다.
 */

import type { Entity } from './entities.js';

/** 촉매 비트 구역의 폭(하위 31비트). 상위 1비트는 예약. */
export const CATALYST_MARK_BITS = 31;

/**
 * 촉매 비트 구역 전체 마스크(하위 31비트 = `0x7fffffff`).
 *
 * ## ⚠️ `>>> 0` 이 **장식이 아니다** — 없으면 이 상수가 음수다
 * `CATALYST_MARK_BITS` 가 31 이므로 `1 << 31` 은 JS 에서 **`-2147483648`** 이고,
 * `(1 << 31) - 1` 은 `-2147483649` — **Int32 범위 밖의 음수**다.
 *
 * 지금까지 이것이 안 터진 이유는 두 소비자({@link markSnapshotValue}·{@link clearMarks})가
 * 둘 다 `&`/`~` 를 거쳐 **ToInt32 로 접히기** 때문이다(`-2147483649` → `0x7fffffff`). 즉
 * 결과는 우연히 맞았고 **거동은 이 수정 전후로 비트 동일**이다(실측 대조).
 *
 * 그러나 상수 자체를 비트 연산 밖에서 쓰는 소비자가 하나라도 생기면 즉시 깨진다 —
 * 비교(`v <= CATALYST_MARK_MASK` 가 항상 거짓), 로깅, 폭 계산이 전부 음수를 본다.
 * `tests/catalystMarkBits.test.ts` 의 «마스크가 음수로 돌지 않는다» 가 이 자리를 잠근다.
 */
export const CATALYST_MARK_MASK = ((1 << CATALYST_MARK_BITS) - 1) >>> 0;

/** 비트 위치·폭 표. **이 객체가 유일 정본이다** — 리터럴 시프트를 코드에 흩지 마라. */
export const CATALYST_MARK = {
  /**
   * `id 1 plunder` — **1 = 이미 강탈했다**(0 = 아직 안 뜯긴 엘리트).
   *
   * ## ⚠️ 옛 표는 뜻을 거꾸로 적고 있었다 — 코드가 정본이다
   * 표에는 *"강탈 가능(아직 안 뜯긴)"* 이라 적혀 있었지만 유일한 쓰기 지점
   * ({@link import('./catalyst/drops.js').dropsOnEnemyContact})은 **몸으로 부딪혀 뜯은 순간**
   * `1` 을 쓴다. 읽는 쪽도 `readMark(target,'plunder') === 0` 을 *"아직 안 뜯겼다"* 로 해석한다
   * (`drops.ts` 의 전리품 잠금·개수 배율 두 자리). 즉 **코드는 처음부터 일관됐고 표만 반대**였다.
   *
   * ## 왜 이 방향이 유일한 해였는가 (drops 레인 사유 — 뒤집지 마라)
   *  1. 1비트로는 *"안 봤다 / 안 뜯김 / 뜯김"* 3상태를 못 담는다.
   *  2. 엘리트 스폰 지점이 그 레인의 소유가 아니라 **초기화를 걸 자리가 없었다.**
   *  3. `aux0` 기본값은 0 이고, 그 0 을 *"안 뜯김"* 으로 읽는 것이 **§A(무촉매 바이트 불변)를
   *     지키는 유일한 해**다. 반대로 두면 스폰 시점에 전 엘리트에 1 을 찍어야 하고, 그 쓰기가
   *     무촉매 런의 `aux0` 를 오염시켜 골든이 갈린다.
   *
   * ## ⚠️ 렌더가 이 비트를 쓰게 될 때
   * *"뜯을 수 있다"* 를 금색 외곽선으로 그리려면 술어가 **`=== 0`** 이다(`!== 0` 이 아니다).
   * 그대로 쓰면 이미 뜯어 먹은 엘리트만 금색이 되어 화면이 정확히 반대로 안내한다.
   * (현재 `src/render/**`·`src/ui/**` 에 이 비트 소비자는 **없다** — 실측.)
   */
  plunder: { shift: 0, width: 1 },
  /** `id 6 gilding` — 도금 단계 0..3. */
  gilding: { shift: 1, width: 2 },
  /** `id 20 resonance`(동조) — 동조 중. */
  attuned: { shift: 3, width: 1 },
  /** `id 36 niflheim-pursuit` — 그림자. */
  shadow: { shift: 4, width: 1 },
  /** `id 29 ascendant` — 이동 불능. */
  rooted: { shift: 5, width: 1 },
  /** 점화 약공명(불씨) — 밀려나 피해 감소 중. */
  emberPushed: { shift: 6, width: 1 },
  /** `id 17 greed` — 금빛 액수(눈금 0..255). */
  greedAmount: { shift: 7, width: 8 },
  /** `id 15 extraction` — 실린 액수(눈금 0..255). */
  extractionAmount: { shift: 15, width: 8 },
  /**
   * `id 7 prospect` — 광맥 보유자 상태. **0 = 아님 · 1 = 보유(개방) · 2 = 보유(무적)**.
   *
   * 폭이 2인 이유는 "보유자인가"와 "지금 무적인가"가 **둘 다 필요한데 비트를 둘로 나누면
   * 두 표식이 어긋난 조합(무적인데 보유자가 아님)이 표현 가능해지기** 때문이다. 한 필드의
   * 3-상태로 두면 그 조합이 원천적으로 안 생긴다.
   *
   * 무적 여부를 여기 접어 두는 것이 핵심이다 — 실제 판정은 근접 호위 수(공간 질의)인데,
   * 소비자가 아군탄 명중 루프와 조준 술어라 **탄 × 표적마다** 질의하면 핫 경로가 무너진다.
   * 틱당 한 번만 재서 여기 적고(`catalyst/refine.ts` 의 `prospectTick`), 소비자는 비트 읽기
   * 하나로 끝낸다.
   */
  prospect: { shift: 23, width: 2 },
  /**
   * `id 27 afterburner` — **이번 대시에 관통당한 잡몹**.
   *
   * 표식이 필요한 이유: 카드의 되돌림 조항이 *"대시로 관통해 죽이면 3이 돌아온다"* 인데,
   * 관통(`onDashPierceCatalyst`)과 처치(`onEnemyDamagedCatalyst`)가 **다른 앵커·다른 틱**이라
   * 둘을 잇는 통로가 적 개체 위에 있어야 한다. 슬롯은 "어느 적인가"를 표현할 수 없다.
   *
   * ⚠️ 창(窓)은 **대시 하나**다 — {@link import('./catalyst/power.js').powerOnDashFired} 가
   * 새 대시마다 전 잡몹의 이 비트를 지운다. 안 지우면 오래전에 스친 적을 나중에 잡아도
   * 되돌림이 나가 "대시로 죽였다"가 아니게 된다.
   */
  pierced: { shift: 25, width: 1 },
  /**
   * `id 35 berdan-hive-queen` — **일벌**이다(보스가 토해 낸 개체).
   *
   * ⚠️ 일벌은 반드시 **일반 적 kind** 다. `boss` kind 를 늘리면 그 하나가 죽는 순간 런이 그
   * 자리에서 승리로 끝난다(`world.ts:4356`) — 카탈로그 §코드 계약 1 이 이름으로 금지한 형태다.
   * 그래서 "보스의 동반 개체"라는 사실을 kind 가 아니라 **이 비트**가 진다.
   *
   * 이 비트가 여는 둘: ① 일벌 처치를 알아채 보스 HP 를 그만큼 깎는다 ② 살아 있는 일벌 수를
   * 세어 추가 소환 여부를 정한다. 둘 다 **슬롯을 한 칸도 안 쓴다**(HP 연동은 파생 계산이다).
   */
  hiveWorker: { shift: 26, width: 1 },
  /**
   * `id 38 niflheim-flagship` — **기함**.
   *
   * ⚠️ 기함은 **일반 적 kind + 센티넬 마커**다. `boss` kind 를 늘리면 `world.ts` 가
   * "boss 하나가 죽으면 그 자리에서 런 승리" 로 잡아 **한 기만 잡아도 런이 끝난다**
   * (카탈로그 §코드 계약 1). 그래서 판별을 kind 가 아니라 이 비트로 한다.
   *
   * `shadow`(shift 4)와 **다른 비트인 것이 계약이다** — 그림자는 죽일 수 없고 조준·적 수에서
   * 빠지지만 기함은 **격추 대상**이라 셋 다 정반대다. 한 비트를 공유하면 기함이 무적이 된다.
   */
  flagship: { shift: 27, width: 1 },
  /**
   * **공명 카운트다운** — 눈금 하나가 10틱이다(`catalyst/resonance.ts` 의 `RESO_MARK_UNIT`).
   *
   * 한 런에 발동하는 공명은 **하나**뿐이라(`resolveResonance` 가 유일 정본) 이 칸을
   * **점화 약 '불씨'(밀려남)와 수확 약 '덫'(붙잡힘)이 공유**한다 — 둘이 동시에 뜨는 조합이
   * 구조적으로 존재하지 않으므로 의미가 섞이지 않는다. 슬롯 배정표가 공명 구역(20·21)을
   * 같은 사유로 재사용하는 것과 같은 결이다.
   *
   * ## ⭐ 그 전제("한 런에 공명은 하나")의 **근거**와 깨지는 조건
   * 근거는 **반환 타입**이다 — `resolveResonance(ids): ResonanceDef | null`
   * (`src/data/catalystResonance.ts:139`)이 배열이 아니라 **단일 값**을 돌려주고, 소비자
   * (`catalyst/resonance.ts` 의 `activeResonance`)가 그 하나만 읽는다. 즉 전제는 주석의
   * 약속이 아니라 **시그니처가 강제**한다.
   *
   * ⚠️ 그래서 **깨지는 조건도 하나**다: 누군가 `resolveResonance` 를 복수 반환으로 바꾸는 순간
   * 불씨와 덫이 같은 런에 공존할 수 있고, 그때 이 칸은 두 의미가 겹쳐 **한쪽의 카운트다운이
   * 다른 쪽을 조기 해제**한다(3비트뿐이라 분리도 불가). 그 변경을 하려면 **여기부터 갈라라** —
   * 상위 예약 비트(31) 하나로는 폭 3짜리 둘을 못 담으므로 `aux0` 밖의 칸이 필요하다.
   * `tests/catalystMarkBits.test.ts` 가 이 칸의 폭·위치를 잠그지만 **의미 겹침은 못 잡는다**.
   *
   * 0 이 되는 틱에 {@link CATALYST_MARK.emberPushed} 도 같이 지운다 — 표식만 남으면
   * "영영 밀려난 적"이 되어 대가(받는 피해 감소)가 이득으로 뒤집힌다.
   */
  resoTicks: { shift: 28, width: 3 },
} as const;

export type CatalystMarkField = keyof typeof CATALYST_MARK;

/** 그 필드의 값을 읽는다. 무촉매 런은 전 비트가 0 이라 전부 0 을 돌려준다. */
export function readMark(e: Entity, field: CatalystMarkField): number {
  const { shift, width } = CATALYST_MARK[field];
  return (e.aux0 >>> shift) & ((1 << width) - 1);
}

/**
 * 그 필드에 값을 쓴다(폭을 넘는 값은 **절삭**한다 — 이웃 비트를 침범하지 않는다).
 *
 * ⚠️ **반드시 촉매 게이트 안쪽에서만 불러라**(헤더 §결정론). 그리고 **잡몹에만** 써라 —
 * 보스·플레이어의 `aux0` 는 다른 뜻이다.
 */
export function writeMark(e: Entity, field: CatalystMarkField, value: number): void {
  const { shift, width } = CATALYST_MARK[field];
  const max = (1 << width) - 1;
  const v = Math.trunc(value);
  const clamped = v < 0 ? 0 : v > max ? max : v;
  e.aux0 = ((e.aux0 & ~(max << shift)) | (clamped << shift)) >>> 0;
}

/** 촉매 비트 구역만 0 으로 되돌린다(상위 예약 비트와 다른 kind 의 용도를 보존). */
export function clearMarks(e: Entity): void {
  e.aux0 = (e.aux0 & ~CATALYST_MARK_MASK) >>> 0;
}

/** 렌더로 보낼 촉매 비트 구역 값(`EntitySnapshot.catalystMark`). */
export function markSnapshotValue(e: Entity): number {
  return (e.aux0 & CATALYST_MARK_MASK) >>> 0;
}
