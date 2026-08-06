# 210스킬 배선이 깨뜨리는 기존 테스트 잠금 — 전수 (인계 §5-8 ① 의 답)

> 앞 인계가 **미확인**으로 남긴 항목 ①("어떤 기존 테스트 잠금이 깨지는가")의 조사 결과다.
> 앞 설계가 *"칸이 몇 개 필요한가(분자)만 셌고 그 칸을 세울 때 깨지는 잠금(분모)은 인용만
> 옮겼다"* 고 자인한 그 분모다.
>
> 조사 3조각(액티브·파워업 / 상태·해시·사슬 / 문서미결·자산)의 합본. 근거는 전부 `파일:줄`.
> **첫 시도는 33분 무진행 hang 으로 죽었다** — 원인은 프롬프트가 320개 테스트 파일을 탐색하게
> 둔 것이었고, 열 파일을 명시 목록으로 못박아 재시도해 셋 다 4~6분에 끝났다.

---

## ⓪ 가장 큰 것 — `activeSkillPowerScope.test.ts` 의 **하네스 전제가 배선과 함께 무너진다**

**두 조각이 서로 모른 채 같은 결론에 도달했다**(교차검증됨).

### 기전

`tests/activeSkillPowerScope.test.ts:50-57` `investExactly()`:
```ts
const { start } = shipTreeRange(ship, treeIndex);
v[start] = total;          // 축 40점을 그 축의 첫 칸 한 곳에 몰아넣는다
```

구 트리에서는 "계열 합만 읽히므로 어느 칸이든 같다"가 성립해 이것이 무해했다. **flat 재편 후
`v[start]` 는 실제 스킬 노드다** — 각 축의 **머리 노드**(스트라이커 F1·M1·S1, 말로우 SQ1·ME1·CU1,
버블 PO1·DR1·FI1, …).

그 노드가 관측량에 닿는 순간 둘이 동시에 터진다:
- **`:139` 음성 25종** — 투자를 gate→gate+40 으로 올려도 900틱 관측량이 **바이트 불변**
  (`firstDivergence === -1`). `observe()`(`:70-91`)가 탄수·탄피해·적HP합·**플레이어HP**·좌표·
  `activeBuff0` 을 전부 본다 → 머리 노드가 무엇이든 하면 실패.
- **`:131` 양성 A(strike 14종)** — 갈리는 첫 틱이 **정확히 `FIRE_TICK`(30)** 이어야 한다.
  머리 노드가 상시 효과를 주면 0~29틱에서 이미 갈려 실패.

즉 이 파일은 **"`skillInvest` 델타 = 액티브 축 델타"** 라는 전제 위에 서 있고, 그 전제가 배선의
정의상 거짓이 된다. 파일 헤더(`:18-20`)의 *"`skillInvest` 는 sim 안에서 딱 두 곳에만 도달한다"*
라는 서술 자체가 낡는다.

### 문서 미결 둘의 정답도 이것이었다 — **지목된 스킬은 무관하다**

`mallow.md` ⑥-5(`:479-485`)와 `bubble.md` ⑥-8(`:443-444`)이 이 충돌을 예감하고 남긴 미결인데,
**지목한 스킬이 틀렸다**:

| 문서가 지목 | 실제 판정 | 이유 |
|---|---|---|
| mallow **SQ6·SQ10** | **무관** | squish 트리 6·10번이라 `investExactly` 가 붓는 0번 칸에 한 점도 안 들어간다. SQ10 의 숙주 `cushion_hi` 는 `treeIndex:2` 라 점수가 아예 다른 트리로 간다 |
| bubble **PO9·FI6** | **무관** | 같은 이유. 게다가 FI6 의 숙주 `as_bubble_film_hi` 는 `EXPIRE_ONLY_IDS`(`:47`) 등재분이라 양성 B(`gain > 0`, `:179`)이고, FI6 가 만료 폭발을 키우는 방향은 **테스트가 원하는 방향**이다 |
| — | **진짜 충돌원 = 트리 0번 노드 6종** | 말로우 **SQ1**(aux0 비례 볼리 증폭) · **ME1**(젬 수거 → 정산 앞당김) · **CU1**(임계 초과 피해 이관) / 버블 **PO1**(파열 즉발 피해) · **DR1**(파열 틱 젬 수거) · **FI1**(재생 타이머 선급) |

같은 논리로 **7기체 전부의 각 축 머리 노드**(= flat 인덱스 0·10·20)가 후보다.

### 처방 (리드 판단 — 배선 착수 **전에** 별도 커밋으로)

**하네스의 투자 주입을 `skillInvest` 에서 `activeTune0/1` 로 바꿔라.**

근거: E7 이 이미 그 자리를 만들어 뒀다. 액티브 쿨다운의 실제 소비 지점은
`src/sim/actives.ts:182` 의 `activeCooldownTicks(def, investedInTree(invest, def) + tune)` **한 줄**
뿐이고, `tests/activeSkills.test.ts:307-308` 이 *"투자 + 조율 합산이 유일한 입력"* 을 이미 못 박았다.
**`tune` 만 올리면 스킬은 한 칸도 안 켜지고 액티브 축만 움직인다** — 이것이 정확히 이 하네스가
원래 재려던 것이다.

⚠️ 착수 전에 **위력 경로(`activePowerCenti`)도 같은 합을 읽는지 확인하라.** 쿨다운만 확인됐다.
읽지 않는다면 하네스를 두 축으로 나눠야 한다.

---

## ① 배선이 확실히 깨뜨리는 것 — 우선순위 순

| # | 테스트:줄 | 잠그는 것 | 무엇이 깨뜨리는가 | 처방 |
|---|---|---|---|---|
| 1 | `activeSkillPowerScope.test.ts:131,139` | 위 ⓪ | 머리 노드 배선 | ⓪ 처방 |
| 2 | **`activeSkills.test.ts:209,307`** | sim 실효 쿨다운이 `activeCooldownTicks(def, 축합계)` 와 **`toBe` 동등** | 스킬이 CDR 항을 하나만 더해도 즉사 | **새 항을 그 함수의 인자 안으로 접어 넣어라**(`activeTune` 이 하는 방식). 그러면 계약이 산다 |
| 3 | `activeSkills.test.ts:122-123` | `activePowerCenti` **엄격 단조↑** · `activeCooldownTicks` 단조↓ (42종 전수) | 스킬이 위력에 **상한·체감**을 도입하면 평탄 구간에서 실패 | 상한은 **소비 지점**에 두고 순수 함수는 단조 유지 |
| 4 | **`commissionCarry.test.ts:160`** | 세 분류 배열 길이 합 **== 72**(정수 리터럴) | `WorldState` 필드 증가 | 숫자 갱신 + **주석에 근거**(이 게이트의 목적이 "분류를 실제로 판단했다"는 물증이다) |
| 5 | `commissionCarry.test.ts:108-112` | `WORLD_CARRY` 가 독립 전사본 `EXPECTED_WORLD_CARRY`(`:58-87`)와 `toEqual` | CARRY 에 키 추가 | 전사본도 함께 수정 |
| 6 | **`activeSkills.test.ts:317` · `skillRebuildMigration.test.ts:34`** | `SAVE_VERSION === 11` 리터럴 | 스킬 상태를 세이브에 실으면 | 값 갱신 + 마이그레이션 테스트 |
| 7 | **`activeSkillRunConfig.test.ts:70,106`** | `POWERUPS.length === 26` · 미장착 런에서 뽑히는 인덱스 항상 `< 24` | **스킬 강화를 3택 파워업 풀로 내보내려는 안과 정면 충돌** | append-only + 두 숫자 동시 개정 |
| 8 | `shipContent.test.ts:135-137,144` | 노드 **정확히 30** · `ship.skillInvest.length === 30` · `config.skillInvest.length === 30` | 노드 수 변경 | 30 유지(설계가 이미 30) |

---

## ② 조용히 항진이 되는 것 — 더 위험하다

### 2-1. 0c 계약 (`activeSkillWiring.test.ts:166-168`) — 테스트측 단언은 **여기 한 자리뿐**

```ts
expect(control.activeBuff0).toBe(0);
expect(fired.activeBuff0).toBeGreaterThan(0);
```

| 배선 형태 | 결과 |
|---|---|
| 스킬이 **런 시작·상시로** `activeBuff0` 를 세움 | `:167` 실패 — **안전한 실패**(즉시 빨강) |
| **공통 코드가 발동 시점에** 버프를 세움 (예: `stepActives` 가 `coeff.ticks` 를 대신 세움) | **항진화 — 핸들러를 통째로 비워도 초록.** 배선 전수 테스트 ②가 무의미해진다 |
| 스킬이 지속을 **늘리기만** 함 (핸들러가 여전히 세움) | 정상 |

**→ "모든 buff 액티브 지속 +N틱" 같은 공통 부속효과를 `stepActives`(`src/sim/actives.ts:171-183`)
안으로 끌어올리지 마라.** 지속 보정은 반드시 **핸들러가 호출하는 `setBuffTicks` 인자 쪽**에서.
부수: 이 단언은 슬롯 1(`activeBuff0`)만 본다 — **슬롯 2 의 0c 계약은 테스트로 안 잠겨 있다.**

### 2-2. `commissionCarry.test.ts:182-197` — **참조 공유를 검출 못 할 뿐 아니라 요구한다**

3단 근거: `seedPrev()`(`:167-180`)가 `number`/`boolean` 만 심어 **배열 안을 안 채운다** →
`toBe`(= `Object.is`)가 배열에 대해 **참조 동일성** 비교 → `copyKeys`(`commissionCarry.ts:302-304`)가
참조 대입이라 통과.

귀결:
- **원소별 복사(`slice()`)로 구현하면 이 테스트가 오히려 실패한다.** "안전하게 복사"가 처벌된다.
- **8칸 중 4칸만 이월하는 부분 결함은 원리적으로 검출 불가.** all-or-nothing 만 잡힌다.
- 기존 규율은 참조 대입이 맞다(`:57-58` — `weapon`·`loot` 도 그렇고 근거는 "이전 월드는 전환
  직후 버려진다"). **다만 `prev` 를 전환 후에도 들고 있는 경로(하네스·리플레이 검증)가 생기면
  조용한 별칭 누수가 된다.**
- **→ 부분 이월을 잡는 단언을 신설해야 한다**(배열 원소에 구별 값을 심고 `toEqual`).

### 2-3. `powerupMagnitude.test.ts` 는 **`POWERUPS` 배열 한정**이다

`:38,53,69` 세 `it.each` 가 전부 `POWERUPS.map(...)` 이고, `freshWorld()`(`:31-33`)는
`skillInvest`·`activeSlots`·기체 타입을 **아무것도 안 싣는다**. 측정도 `def.apply(w)` **1회 전후 비**뿐.

**→ 스킬의 수치 부속 효과는 이 검사에 한 줄도 안 걸린다.** 210스킬 중 하나가 "피해 +40%" 를 줘도
초록이다. 헌장의 *"순수 수치 스탯은 부속 효과로만, 본체로는 금지"* 에 대응하는 **기계 검증이
현재 존재하지 않는다** — 필요하면 새 게이트를 세워야 하고, 없다면 그 규율은 리뷰로만 지켜진다.

### 2-4. 죽은 아트 검출기가 **없다**

인계가 "`skillIcons` — 죽은 아트 금지"라고 적었으나 실측상 그런 단언은 없다. 가장 가까운
`tests/uiAssetPresence.test.ts:72-75` 도 **등재 목록 ↔ 디스크** 양방향일 뿐 "자산은 있는데
아무도 안 쓴다"를 못 잡는다. 실제로 `SKILL_ICON_NAMES` 62종은 지금 아무도 호출하지 않는데
(`src/ui/pixi/uiTextures.ts:323` 주석이 자인) 어떤 테스트도 빨개지지 않는다.

---

## ③ 안 깨지는 것 — 명시적으로 기록한다 (나중에 다시 묻지 않도록)

- **`weapons.test.ts:316-326` 은 감쇠 사슬과 무관하다.** 통설("브루저 장갑 두 경로 동형성이
  사슬에 슬롯이 끼면 깨진다")은 **틀렸다** — 이 테스트는 `stepWorld` 를 아예 부르지 않고
  `d − Math.round((d*bp)/10000)` 을 인라인 재현해 `armorReducedDamage` 와 비교하는 **순수 산술
  동형성**이다. "두 경로"란 world.ts 인라인 산술 vs 헬퍼다.
- **`hashWorld` 꼬리에 폴드가 붙는 것 자체를 잠그는 단언은 없다.** 조사한 11파일 전부 상대
  비교뿐이고 골든 16진 상수·스냅샷이 0건이다. ⚠️ 그래서 **"전부 0이면 무폴드"의 조건부성을
  검증하는 것은 `npx pnpm test:sim`(골든 픽스처)뿐이다** — 무조건부 폴드로 만들면 기본 스위트는
  전부 통과하고 sim 레인만 터진다.
- `activeSkillWiring.test.ts` 의 레지스트리·핸들러 대조·id 고유·6종 계약·해시 발산 — 전부 무관.
- `activeSkillGuardian.test.ts` 전부 · `replayConfigAliasing.test.ts` 전부 ·
  `shipSignatureRegistry.test.ts` · `save.test.ts` 의 Profile 왕복 — 무관.
- `m3Content.test.ts` 는 **스킬 노드 콘텐츠를 전혀 요구하지 않는다.** `sampleSkillInvest()` 를
  결정론 런의 자극 입력으로만 쓰고 판정은 같은 seed 2회 비교(`:512-514,531-533`)라, 스킬 로직이
  바뀌어도 **결정론만 지키면** 안 빨개진다.

---

## ④ 배선 시 함께 넣어야 하는 것 — 노드 30개의 요구사항 전수

**데이터·문자열** (`tests/shipContent.test.ts`)
1. `node.name` 비어 있으면 실패(`:73`) · `node.desc` 비어 있으면 실패(`:74`)
2. 이름·설명에 **컬러 이모지 0**(`:75-76`) — Pixi 두부 방지
3. ⚠️ **이름이 i18n 키 형태면 실패**(`:84`) · 설명이 `ship.` 으로 시작하면 실패(`:85`).
   연구소가 `node.name` 을 `t()` 없이 그리기 때문이다 → **i18n 파일에 넣을 것이 없다.
   `data/ships/*.ts` 노드마다 표시용 완성 한글 `name`·`desc` 를 직접 채워라.**
4. **기체 안 이름 유일**(`:90-96`)
5. 개수 정확히 30

**아이콘** (`tests/skillIcons.test.ts`)
6. 모든 노드가 `/^skill_axis_[a-z]+\.png$/` 를 만족(`:41`) · 기체당 정확히 3종(`:49`) ·
   **축의 순수 함수**(축이 같으면 기체가 달라도 같은 이름, `:53-64`)
7. 스트라이커 flat 배치 고정: `nodes[0]`=offense · `nodes[10]`=defense · `nodes[20]`=utility(`:25-27`)
   — **축 순서를 사실상 잠근다**
8. **노드별 아이콘은 없다.** `node.axis` 만 정확하면 된다.

**요구하지 않는 것**: i18n 문구(오히려 금지) · 아이콘 파일 실재 · `stat`/`perPoint`/`tier`/
`capstone` 필드(ADR-0049 로 삭제, `shipContent.test.ts:8-12`).

### 아이콘 3종 (`skill_axis_{offense,defense,utility}`) — 넣을 때 필요한 것

지금 **부재를 잡는 테스트가 0개**다(파일시스템을 안 만진다). 넣으려면 셋 다 해야 한다:
1. `assets/skill_axis_{offense,defense,utility}.png` — 규격 단언은 없고 이웃 관례는 **64×64**
2. `UI_ASSET_NAMES` 등재(`src/ui/pixi/uiTextures.ts:191`) — 등재하는 순간
   `tests/uiAssetPresence.test.ts:67-69` 가 실물 존재를 강제한다
3. `SKILL_ICON_NAMES` 62종 정리 판단(`uiTextures.ts:323-325` 가 "축 아이콘 3종이 생길 때 같이
   정리하라"고 지시)

⚠️ **등재 없이 PNG만 넣으면 `loadUiTextures` 가 안 부르므로 화면은 그대로 placeholder** —
이 리포가 여러 번 밟은 "조용한 null" 함정이다.

---

## ⑤ 조사가 못 본 것 (정직하게 — 다음 사람이 이어라)

- `activePowerCenti` 가 `invest + tune` 합을 읽는지 **미확인**(쿨다운만 확인). ⓪ 처방의 전제다.
- `DEFAULT_CONFIG` 픽스처의 900틱 동안 플레이어가 실제로 피격되는지 / 30틱 이전에 피격·파열이
  나는지 — 시뮬을 안 돌려 ⓪ 의 "조건부"를 확정으로 승격하지 못했다.
- `tests/shipSkillLayout.test.ts`(210종·id 유니크·축 정합·code 번호) 와 `tests/shipTypes.test.ts`
  (wire 계약) — **배선 시 가장 먼저 빨개질 후보인데** 제목·grep 히트만 봤다.
- `src/sim/activeTypes.ts` 의 `powerCentiOf`/`scaleCenti` 실제 소비 지점 — "17종"은 주석 서술 근거.
- `tests/denoFixture.test.ts` 등 골든 픽스처 — 임무 범위 밖이라 안 열었다.
- `shipSignatureWiring.test.ts` 의 §⑥ 은신 게이트·§⑦ aux 별칭 봉인 — 제목만.
