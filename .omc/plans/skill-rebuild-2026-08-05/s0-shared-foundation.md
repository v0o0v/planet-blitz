# S0 — 210스킬 배선의 공유 기반 (선행 커밋)

> 이 문서는 **구현 지시서**다. 설계 정본은 `charter.md` + 기체 7문서 + `affixes.md` 이고
> 여기를 고쳐서 설계를 바꾸지 않는다. 여기 적는 것은 **7레인이 공통으로 딛는 바닥의 형태**와
> **그 형태가 그렇게 정해진 실측 근거**다.
>
> 앞 인계: `.omc/handoffs/skill-rebuild-210-wiring.md` §5. 이 문서는 그 §5-8 이 「미확인」으로
> 남긴 5건 중 **넷을 실측으로 닫은 뒤** 쓰였다(닫힌 것: ②③④⑤ — 아래 §0).

기준 main `1bc40ef`. 기준선 실측(16코어): `npx pnpm verify` **exit 0 · 313파일 · 6732건**.

---

## S0 의 합격 조건 — **거동·해시 불변**

S0 는 소비자가 0인 배선을 만든다. 그래서 합격 조건이 특수하다:

1. `npx pnpm verify` exit 0 · **313파일 그대로**(신규 테스트분만 증가)
2. `npx pnpm test:sim` exit 0 · **골든 3종 재생성 0건**
3. S0 의 테스트는 **「앵커가 실제로 불린다」를 증명하되 「효과가 있다」를 단언하지 않는다**
   (호출 카운터로 증명한다 — 효과 단언은 배선 레인의 몫이고, 여기서 하면 항진이다)

---

## 0. 착수 전 조사로 **확정된 사실** (앞 인계 §5-8 의 미확인 5건 중 넷)

### 0-1. ② `affixes.md` 전문 독해 — `skillLv()` 정본 확보 ✅

**정본 4조**(`affixes.md` ①-4):

1. **투자 레벨 ≥ 1 인 스킬에만 가산한다.** 0레벨(미해금)은 어픽스로 안 켜진다.
2. **상한 20 을 초과한다.** 실효 상한 **24**(= 20 + 4). **clamp 하지 마라** — 20 초과가 설계다.
3. **발동 여부는 어픽스가 못 바꾼다.** 트레이드 스킬 본체는 투자 유무로만 발동한다.
4. **침공 판정을 상속한다.** 게이트된 스킬은 레벨이 얼마든 침공에서 no-op 이다.

> ⚠️ **문서 스니펫을 그대로 베끼지 마라 — 코드와 시그니처가 어긋난다.**
> `affixes.md:123-131` 의 의사코드는 `axisOfIndex(shipType, flatIndex)` 가 `0/1/2` 를 반환한다고
> 적었다. **실제 구현은 반대다**(`src/items/skills.ts:68-86`):
> ```ts
> export function axisOfIndex(flatIndex: number, typeId?: number): TreeAffinity | undefined
> ```
> — 인자 순서가 반대이고, 반환은 숫자가 아니라 `TreeAffinity | undefined` 다. 그 JSDoc 이
> *"범위 밖·손상 인덱스는 `undefined`. 호출부가 조용히 offense 로 흘리지 않도록 기본값을 주지
> 않는다"* 를 계약으로 못 박았으므로 **`skillLv()` 는 `undefined` 를 반드시 명시적으로 처리**해야
> 한다(스니펫대로 쓰면 `skillAffixLv[undefined]` 가 된다). 축 → 인덱스 변환은
> `TREE_AFFINITIES`(`data/ships/types.ts:47` = `['offense','defense','utility']`) 순서로 한다 —
> `deriveSkillAffixLv`(`loadout.ts:227`)가 정확히 그 순서로 배열을 만들기 때문이다.
> **축 수 3 을 하드코딩하지 마라. `TREE_AFFINITIES` 가 정본이다.**

**이미 되어 있는 것 — 다시 만들지 마라**:
- `skillAffixLv` 파생(`deriveSkillAffixLv`, `loadout.ts:222-228`) · 조건부 스탬프
  (`runConfig.ts:239,339` — "전부 0이면 스탬프하지 않는다"까지 지켜져 있다) ·
  `hashWorld` 폴드(`replay.ts:670-684`) · clamp(`SKILL_AFFIX_LV_MAX = 4`, `clampSkillAffixLv`) ·
  `StatKey` 3키의 `zeroSums`/`zeroStatSums` 양쪽 등록
- **E7 은 완료됐다** — `bumpActiveTree` 의 투자 벡터 오염이 `activeTune0/1` 로 이관됐다
  (`world.ts:1117-1128`). 따라서 정본 1·3 은 **이제 규약이 아니라 불변식**이다.

**남은 빈 자리는 정확히 하나**: `skillLv` 이라는 이름의 심볼이 리포 전체에 **0개**이고 주석 2곳
(`world.ts:784-799` · `items/loadout.ts:144-148`)만 그것을 가리킨다. `skillAffixLv` 의 실코드
소비처는 배선·직렬화 4곳뿐이고 **값을 읽어 스킬 수치를 바꾸는 코드는 0개**다.

### 0-2. ④ 세이브 경로 — **누수 0 확인** ✅

`WorldState` 를 통째로 직렬화하는 경로가 **없다**. 전부 명시 필드 추출이다:
정산 `main.ts:1950-1968` → `RunResult`(닫힌 인터페이스, `settlement.ts:57-103`, `WorldState` 를
import 조차 안 한다) · 프로필 푸시는 인자가 `Profile` · `Replay` 는 `{seed, config?, inputs}` 뿐 ·
제출은 `hashStream`(uint32 배열)뿐. `normalizeSkillInvest`·`migrateV10toV11` 은 **영구 투자 벡터**
(`Profile`/`Ship`)만 다루므로 런타임 상태와 타입 접점 자체가 없다.

→ **새는 통로는 `hashWorld` 폴드 하나뿐이고, 그것이 의도된 통로다.**

### 0-3. ⑤ 침공 — ⚠️ **앞 레인의 판단이 뒤집혔다**

**침공 런도 `buildRunConfig` 를 타고 `skillInvest` 를 무조건 스탬프한다**
(`runConfig.ts:224,275` — `invasion3` 분기가 **없다**). `activeSlots` 도 마찬가지로 침공 예외가
없다(`:302-306`). 즉 **「침공은 스킬 상태가 전부 0」이라는 가정은 성립하지 않는다.**

이것이 무폴드 설계를 깨지는 않는다 — "16칸 전부 0이면 무폴드"는 여전히 성립한다. 바뀌는 것은
**침공에서도 폴드가 실릴 수 있다**는 사실이고, 그 귀결이 아래 §4-2 의 EF 재배포 판정이다.

`tests/invasionHash.test.ts` 는 **깨지지 않는다** — 하드코딩 골든 값이 없고, 잠그는 넷이
전부 자기 대조(`stepThrough` 120틱 `a).toEqual(b)`)·상대 비교(`not.toBe`)·엔티티 레벨
(`hashEntity`)이다. **깨지는 조건은 하나뿐: 폴드를 무조건 실행하거나 기존 폴드 사이에 끼우는 것.**

침공 게이트 술어는 **둘뿐**이고 새로 만들면 안 된다(`world.ts:468-470` 계약):
`state.config.invasion3 !== undefined`(설정) · `state.invasion3`(런타임).

### 0-4. ③ Entity 필드 전수 grep — 해츨링에서 **설계 공백 3건** 발견 ✅

말로우·버블의 A 태그는 **전부 안전**하다(재활용 대상이 자기 시그니처 `player.aux0/aux1` +
기존 헬퍼 + 기존 `WorldState` 필드뿐이고, 런당 기체가 1대라 원리적으로 공존 불가).

해츨링에서 셋이 나왔다 — **§5 에 별도로 적었다.** S0 를 막지는 않는다(전부 해츨링 레인 소관).

### 0-5. ① 기존 테스트 잠금 — **별도 조사 중** (이 문서 갱신 대상)

---

## 1. `WorldState` 신규 필드 — `skillCarry` / `skillStage` 고정폭 8 × 2벌

### 왜 8인가

기체 7문서의 `구현: B` 전수 집계상 **한 런의 동시 필요분 최대 6칸**(기체가 하나뿐이므로 36칸이
동시에 필요할 수 없다). 폭 8 = 실측 6 + 여유 2.

⚠️ **"넉넉하게 32"는 반대다.** 미배정 슬롯이 영구 0으로 남으면 오인덱스가 **조용한 무연산**이
된다 — 이 저장소의 지배적 실패 모드다.

### 왜 두 벌인가

의뢰 다구간 런에서 **구간을 넘어 살아야 하는 상태**(런당 1회 소진 표식 · 누적 저금 · 락온 스택)와
**구간마다 새로 시작해야 하는 상태**(창 잔여 틱 · 이번 구간 킬 스냅샷)가 갈린다.
`skillCarry` = 이월, `skillStage` = 구간 초기화.

### 배치·분류

`WorldState` 의 **맨 끝**(`filmBurstReqY1` 뒤)에 append. append-only 규율.

`src/sim/commissionCarry.ts` 의 `_WorldExhaustive` 컴파일 게이트가 **분류를 안 적으면 빌드를
깨뜨린다**(`:279-284`). 셋 중 하나에 키를 넣는다:
- `skillCarry` → **`WORLD_CARRY`**(선례: `activeCd0`·`activeBuff0`·`activeTune0` 전부 여기, `:78-88`)
- `skillStage` → **`WORLD_FRESH`**

> ⚠️ **여기에 이 문서 전체에서 가장 조용한 함정이 있다.**
> `WORLD_CARRY` 는 `copyKeys(prev, next, WORLD_CARRY)`(`:319`)로 옮기는데, 이것은 **참조 대입**이다
> (`weapon`·`loot` 선례, `:57-58`). 배열을 그냥 CARRY 에 넣으면 **두 구간이 같은 배열 객체를
> 공유**한다. 그러면 새 구간에서 쓴 값이 옛 구간 월드에도 보이고, 리플레이 재생 시 구간 경계에서
> 값이 갈린다. **`_WorldExhaustive` 는 이것을 못 잡는다** — `keyof` 는 최상위 키만 본다(`:24-28`).
> **→ `skillCarry` 는 CARRY 로 분류하되 값 복사(`slice()` 또는 원소별 대입)를 명시적으로 배선하고,
> 그 사실을 `commissionCarry.ts` 에 주석으로 못 박고, 참조 공유가 아님을 단언하는 테스트를 써라**
> (`next.skillCarry !== prev.skillCarry` + 원소 동일).

`createWorld` 는 **둘 다 길이 8 의 0 배열**로 초기화한다(§3-3 규율: 초기값 전 슬롯 0).

### 슬롯 배정

슬롯 번호는 **기체별로 겹친다**(런당 기체 1대라 가능). 배정표는 각 레인이
`src/sim/skills/{ship}.ts` 상단에 `const enum` 으로 선언하고, **`skillSlots.ts` 한 파일이
7기체 배정표를 모아 놓는다**(중복·누락을 한눈에 볼 수 있게).

---

## 2. `hashWorld` 조건부 꼬리 폴드

### 선례 (그대로 복제한다 — `src/sim/replay.ts:599-608`)

```ts
const acd0 = state.activeCd0 >>> 0;
const acd1 = state.activeCd1 >>> 0;
const abf0 = state.activeBuff0 >>> 0;
const abf1 = state.activeBuff1 >>> 0;
if (acd0 !== 0 || acd1 !== 0 || abf0 !== 0 || abf1 !== 0) {
  h = hashU32(h, acd0);
  h = hashU32(h, acd1);
  h = hashU32(h, abf0);
  h = hashU32(h, abf1);
}
```

### 규율 4개 (전부 `replay.ts:576,584-598,632-654` 에 명문화돼 있다)

1. **부분 폴드 금지 — all-or-nothing.** 필드별로 "0이면 그 필드만 생략"하면 `(1,0,0,0)` 과
   `(0,1,0,0)` 이 같은 바이트열이 되어 충돌한다. → **16칸을 하나의 OR 조건으로 묶고, 참이면
   16칸 전부를 고정 폭으로 접는다.** 배열별 독립 조건도 금지(carry 전0/stage 비0 과 그 반대가
   충돌할 수 있다).
2. **append-only 맨 꼬리.** 현재 꼬리 순서: `planetMultCenti` → 액티브①런타임 → 액티브②슬롯 →
   의뢰 → 액티브③조율 → **(여기가 S0 자리)**. 기존 폴드 사이 삽입 금지.
   ⚠️ **커밋 직전에 `replay.ts` 꼬리를 다시 열어 「진짜 맨 끝」을 확인하라** — 병렬 레인이
   그 사이에 append 했을 수 있다.
3. **런 도중 토글은 안전하다.** `hashWorld` 는 매 호출 `FNV_OFFSET` 에서 새로 시작하는 **틱
   스냅샷**이지 누적 체인이 아니다(`:592-596`).
4. **길이 프리픽스를 접지 마라.** 고정폭 8 이라 길이는 상수다 — 접으면 정보량 0 의 파생 폴드로
   금지 규율 위반이다(`:632-633`).

### 「전부 0이면 무폴드」가 깨지는 조건 — 전수 (앞 인계 §5-3 + 이번 조사)

1. **`-1` 센티넬**(`(-1)>>>0 = 4294967295`) → **규약: 0 = "없음"**. 엔티티 id 는 1부터라 자연 센티넬.
2. **투자 게이트 밖 쓰기** → 모든 쓰기는 `skillLv(...) >= 1` 안쪽.
3. **`createWorld` 가 0 아닌 초기값** → 초기값 전 슬롯 0. "만충 시작"은 **0을 만충으로 해석**한다.
4. **다른 기체 코드가 게이트 없이 쓰기**(슬롯이 기체별로 겹친다) → 앵커에서 `state.sigBit` 디스패치.
5. 구간 승계로 carry 가 0이 아닌 것은 **의도된 거동**.
6. ~~침공에서는 항상 0~~ → **거짓이다**(§0-3). 침공에서도 스킬은 실린다. 이것은 무폴드를 깨지
   않지만, **EF 재배포 판정을 바꾼다**(§4-2).

---

## 3. `skillLv()` 정본 헬퍼

`src/items/skills.ts` 에 단일 export(`axisOfIndex` 와 같은 파일 — 정본을 흩지 않는다).
sim 의 **모든 스킬 훅이 이것만 부른다.** 중복 구현 금지.

계약(§0-1 의 정본 4조 + 코드 정합):
- `base <= 0` 이면 **0 을 반환하고 끝**(어픽스를 더하지 않는다). 이 한 줄이 "해금은 포인트로만"의 전부다.
- `axisOfIndex` 가 `undefined` 를 주면 **어픽스 가산 없이 base 를 반환**한다(조용히 offense 로
  흘리지 않는다 — 그 함수의 JSDoc 계약).
- 결과를 **clamp 하지 않는다**(실효 상한 24 는 입력 쪽 `clampSkillAffixLv` 가 이미 보장).

성능: sim 루프가 매 틱 부른다. **나눗셈이 낀 레벨 스케일은 `createWorld` 에서 1회 정수 확정**해
`skillDerived` 에 싣는다(§6) — 이 헬퍼 자체는 정수 덧셈뿐이라 루프에 두어도 된다.

---

## 4. 감쇠 사슬 스킬 슬롯 2칸 + `survivedLethalBlow`

### 4-1. 현행 사슬 (실측, `world.ts:4015-4132`)

```
무대 배율(objectiveModeDamageScale) → PLAYER_DAMAGE_TAKEN_MULT
  → 브루저 장갑 감소 → 버블 막 흡수 → 말로우 완충 지연 → hp 차감
```

**S0 가 끼울 자리**(스트라이커 S4 문서가 지정한 위치 그대로):
`PLAYER_DAMAGE_TAKEN_MULT` **직후**, 브루저 장갑 **앞**. 순서는 **감소 먼저, 흡수 나중**으로 고정.

```
… → PLAYER_DAMAGE_TAKEN_MULT → [스킬 감소 슬롯] → [스킬 흡수 슬롯] → 브루저 장갑 → …
```

**계수 0이면 `v*1===v` · `v-0===v` 라 비트 동일**이므로 S0 자체는 해시 불변이다.
⚠️ 반올림을 **게이트 밖에 두지 마라** — 시그니처 없는 런의 소수 접촉 피해(엘리트 배율)까지
바뀐다. 이 경고가 코드에 네 번 반복돼 있다.

### 4-2. `survivedLethalBlow` 단일 정본 (C-2 처방)

브루저 FO5 · 아크캐스터 BR10 이 **같은 술어**를 쓴다 — 복제하면 조용히 갈린다.
정의: **경감 전 피해가 현재 hp 이상이었는데, 사슬(장갑·막·완충·스킬 슬롯)을 거친 뒤 hp > 0 으로
살아남은 틱.** 사슬 안 한 곳에서만 계산해 두 기체가 읽는다.

「런 1회」 억제는 **캡스톤이 제공하던 것**이라 함께 이관해야 한다 — 안 옮기면 죽을 뻔할 때마다
발동해 두 스킬이 설계 의도보다 훨씬 강해진다. 억제 표식은 **플레이어 `targetX` 재사용**
(캡스톤이 쓰던 바로 그 칸, sim 쓰기 0건, 이미 `commissionCarry` WORLD-carry 목록에 있어
의뢰 다구간에서도 "런당 1회"가 정확히 성립).

---

## 5. 앵커 9개 — 빈 디스패처로 추출

각각 `if (!state.skillsOn) return;` 후 `switch (state.sigBit)`. **S0 시점에는 전 분기가 비어 있다.**

| 앵커 | 자리 (실측 좌표 — 커밋 직전 심볼로 재확인하라) |
|---|---|
| `onVolleyFired` | 주무기 볼리 발사 지점(`world.ts` 2600~2800 구간의 발사 분기) |
| `onDashFired` | `world.ts:2065` `if (input.dash && player.dashCooldown === 0)` |
| `onGemCollected` | `world.ts:4176` `collectGem` |
| `onPlayerDamaged` | `world.ts:4114` 부근 — **실제로 hp 가 깎인** 피격 후속 블록 |
| `onKillsDelta` | `world.ts:4268` `compact` (킬 집계 단일 수렴점) |
| `onBulletExpired` | `world.ts:3877-3880` 관통 예산 소멸 분기 |
| `onWallContact` | `world.ts:2109` `slideCircleWalls` 직후(= `wallContactTicks` 갱신 지점) |
| `onDamageChain` | §4-1 의 신규 슬롯 자리 |
| `onSignatureStep` | `world.ts:2263` `stepShipSignature` |

`state.skillsOn` 은 **신설**한다(현재 리포에 없다) — `createWorld` 가 `config.skillInvest` 에
1 이상이 하나라도 있으면 `true`. 파생값이므로 **해시에 접지 않는다**(`sigBit`·`armorMaxStacks` 와
같은 규율). 미투자 런은 이 게이트에서 즉시 반환하므로 **바이트 단위로 종전과 같다.**

### S0 의 테스트 (합격 조건 3)

앵커마다 **호출 카운터**를 세우는 테스트를 쓴다 — "이 앵커가 그 사건에서 실제로 불린다"만
증명하고 **"효과가 있다"는 단언하지 않는다.** 효과 단언을 여기서 하면 배선 레인의 검증이
항진이 된다.

⚠️ **뮤테이션으로 계측기를 검사하라.** 앞 레인에서 벽 게이트 단언이 실은 "대시가 벽에
부딪힌다"를 재고 있었다 — 정책을 지운 뮤턴트에서 살아남았다. 각 앵커 테스트에 대해
"이 앵커 호출을 지우면 빨개지는가"를 확인하라.

---

## 6. `skillDerived` 파생 블록 — `createWorld` 에서 1회 확정

구현 고지 ③: **레벨 스케일의 나눗셈은 `createWorld` 에서 1회 정수 확정, sim 루프는 정수만 읽는다.**
선례는 `armorMaxStacks`(`world.ts:1130-1153`)가 근거까지 주석에 적어 뒀다 — 그 형태를 따른다.

해시 폴드 **안 한다**: 이미 접히는 입력(`config.loadout` 의 `skillInvest`·`skillAffixLv`)의 순수
파생이므로, 두 런의 파생값이 다르면 그 원인 입력이 먼저 갈려 해시가 이미 다르다. 파생 폴드는
정보량 0 이고 접는 순간 골든 전량 재생성이다.

⚠️ **이 근거는 "파생원이 config·loadout 안에 있다"에 전적으로 의존한다.** 파생을 그 밖의
입력에서 끌어오게 되면 근거가 깨진다 — 그때는 주석을 고치기 전에 폴드부터 다시 판단하라.

---

## 7. 7레인 경계면

S0 이후 각 레인이 만지는 것:
```
src/sim/skills/{ship}.ts        (신규 — 그 기체의 30스킬 훅 본체)
src/sim/activeHandlers/{ship}.ts
data/ships/{ship}.ts
src/sim/skillSlots.ts           (자기 블록만)
tests/skill{Ship}*.test.ts      (신규)
```
`world.ts` 는 **앵커의 `switch` 안 자기 `case` 한 줄**(자기 기체 모듈 호출)만 건드린다.
**이 경계면에서 `isolation: "worktree"` 가 비로소 유효해진다.**

---

## 8. 해츨링 설계 공백 3건 — **배선 착수 전 판정 필요** (S0 는 안 막는다)

`src/sim/**` 전수 grep 이 찾았다. 셋 다 `hatchling.md` 가 미해결로 남긴 확인 항목이거나
문서가 사실과 다르게 적은 전제다.

| # | 무엇 | 실측 | 처방 후보 |
|---|---|---|---|
| **X-1** | `hatchling.md:506` 이 *"침공 런에 젬 경제·레벨업이 없어 NU2·NU7 은 자연 no-op"* 이라고 적었다 | **거짓.** `compact`(`world.ts:4301-4305,4384`)가 `kind==='enemy' && hp<=0` 에서 젬을 뿌리고, 게이트는 `commissionSuppressesGems` 하나뿐이라 침공과 무관하다. 게다가 **침공 편대원·스포너 드론이 `summonEnemy` 경유라 kind 가 `enemy`** 다(`facility.ts:1027`) → NU2·NU7 은 침공에서 **실제로 발동**한다 | 헌장 침공 기준으로 재판정. 억제(젬 수거 요구)가 침공에서도 그대로 걸리므로 **「허용」이 자연스러운 답**이지만, 판정표를 고치는 일이라 착수 전 확인 |
| **X-2** | 해츨링 SH9 둥지벽에 **정체성 마커 설계가 없다** | "동시 상한 2, 초과 시 최고령 소멸"을 세려면 둥지벽만 식별해야 하는데 `wall && hp>0` 은 blockBreak 코스 벽(`modes/blockBreak.ts:151,156`)과 구분이 안 된다. `wall.ownerId` 는 `RACING_WALL_MARK`(`racing.ts:168`)와 침공 프레스 `PRESS_SIDE_POS/NEG`(`movingWall.ts:451`)가 이미 쓴다 | `NEST_WALL_MARK` 신설 + **침공에서 SH9 no-op**(프레스와 같은 칸을 다투지 않게) |
| **X-3** | 해츨링 NU9 가 `magnetEmitter` 동형을 스폰하는데 `isGimmick`(`world.ts:1822`)의 `e.kind === 'magnetEmitter'` 는 **조건 없는 참**이다 | 그대로 두면 ①`MAX_ACTIVE_GIMMICKS`(48) 예산을 잡아먹고 ②컬 반경 3000 밖에서 `dead` 로 지워진다 — **"가끔 안 나온다"로만 관측된다** | `turretPickup` 이 `DRONE_MARK`·`BROOD_MARK` 예외를 갖는 선례(`:1824`) 그대로 `&& e.ownerId !== NEST_BEACON_MARK` 추가. **판단 불요 — 명백한 필수 작업** |

부수 확정:
- **`turretPickup` 의 `timer`·`aux0`·`aux1` 은 전 경로 미점유**(생성 `entities.ts:408-420` → 접촉
  `world.ts:3972-3975` → `activateTurret`(`events.ts:75-79`, `phase`/`life`/`cooldown` 만) →
  `stepTurrets`(`world.ts:3335-3351`, `life`/`cooldown` 만)). ⓐ 닫힘.
  ⚠️ 단 **"레이아웃 불변 = 골든 불변"이 아니다** — `replay.ts:156` 이 `timer` 를 이미 접으므로
  값이 0에서 변하면 골든은 갈린다.
- **아군탄 `ownerId` 마커 9종은 값이 전부 다르다.** 무대 충돌 1건: 분열탄 유니크 장착 런에서
  병아리 탄의 파편이 `SPLIT_FRAGMENT_MARK` 로 **덮여** BROOD 정체성을 잃는다(`world.ts:3904`) →
  SH5 냉기·BD4 표적 공유가 파편에 안 붙는다. 설계에 "파편은 병아리 탄이 아니다"를 명문화한다.
  detour·냉기와는 무충돌(detour 중 `stepTurrets` 자체가 안 돈다 — `world.ts:1578-1582` 조기 return).
- **`defenseBoss`·`guardian` 은 `enemy` kind 밖이다.** SH5 는 **반드시 `t.kind === 'enemy'` 게이트
  안**에 넣어라 — 밖에 두면 `defenseBoss.ownerId` 에 감속 틱이 박히는데 `tickEnemyStatus` 가
  defenseBoss 를 안 돌아 **감산 주체가 없어 영구 감속**이 된다. ⓒ 닫힘(정의상 제외로 확정).
- `facility.ts:123` 의 *"`enemy` kind 에서 `aux1` 쓰는 곳이 없다"* 주석은 **여전히 거짓**이다.
  실제 점유: 스포너 드론의 생산자 id(`:1029`) · `SEALED_GUARDIAN_MARK`(`light.ts:484`) ·
  `MID_CLASH_LEADER_MARK`. **"미사용" 주석은 근거가 아니다.**

---

## 9. 배포 판정 — §0-3 의 귀결

침공에서도 스킬 폴드가 실리므로, **210스킬이 라이브가 되는 순간 `verify-invasion`·
`verify-commission` 이 그 폴드를 모르는 번들로 재실행해 정직한 제출을 `defense-mismatch` 로
오거부한다**(`tests/invasionHash.test.ts:373-375` 가 M8 사례로 정확히 이 함정을 못 박아 뒀다).

그런데 ADR-0050 §1 은 그 두 EF 에서 **sim 재실행 자체를 삭제**하기로 했다. 즉 두 길이 있다:
- (a) 배선 착지 시 EF 재배포 → 나중에 §1 삭제 배포에서 다시 배포
- (b) **§1 삭제 배포를 먼저 내보내면 재배포 자체가 불필요해진다**

⚠️ **단계 5 의 순서(`① verify-* 삭제 → ② 클라 → ③ daily-reward`)를 지키면 (b) 가 자동으로
성립한다** — 클라(=210스킬)가 나가기 **전에** 재실행이 이미 사라져 있다. 이 순서를 뒤집으면
(a) 의 이중 배포를 치른다. **재배포 여부는 번들 바이트로 판단하라**(소스를 건드렸나로는 두
방향으로 틀린다).
