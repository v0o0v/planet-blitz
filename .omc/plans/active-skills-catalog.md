# 액티브 스킬 42종 저작 카탈로그 (E 레인 · AC-20)

- 작성: 2026-07-31
- 정본 근거: `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md` ·
  `.omc/plans/active-skills-2026-07-31.md` "저작 규칙 (E 레인, AC-20)" ·
  `src/sim/world.ts:1717-1740`(`aux0/aux1` 인코딩 표) · `src/sim/shipSignature.ts`(상수·순수 함수) ·
  `data/ships/{striker,bruiser,arccaster,phantom,hatchling,mallow,bubble}.ts`(계열 slug·affinity)
- 이 문서는 **저작 카탈로그**다. 코드가 아니며, E 레인이 `data/ships/actives/<slug>.ts` 를 쓸 때의 입력이다.

## 목적

기체 7종 × 6종 = **42종의 액티브 스킬을 서로 겹치지 않게 확정**한다. ADR-0041 이 정한 저작 규칙
— "각 기체의 6종은 그 기체의 **시그니처 패시브를 능동적으로 건드려야 한다**" — 를 만족시키는 방식을
`aux0`/`aux1` 읽기·쓰기 수준까지 못 박아, 42종이 "수치만 다른 산탄"으로 수렴하는 것을 구조적으로 막는다.

## ⚠️ placeholder 규약 (반드시 읽어라)

**이 문서의 모든 수치는 밸런스가 아니라 가시성용 과장 placeholder 다.** ADR-0041 "보류" 절이
쿨다운·계수를 출시 전 일괄 밸런스 패스로 미뤘고, 그럼에도 완료 게이트 ①(하네스 화면에서 42종 전부
발동 확인)이 성립하려면 **눈으로 확실히 보이는 값**이 필요하기 때문이다. 따라서:

| `kind` | placeholder 대역 | 이유 |
|---|---|---|
| `strike` | 탄 **12~24발** | 한 프레임 스크린샷에서 탄막이 즉시 식별된다 |
| `dash` | 변위 **600~900 u** | 플레이어 반경·화면 폭 대비 확실한 순간이동으로 보인다 |
| `buff` | **180~300 틱**(3~5초) | HUD 잔여 게이지가 육안으로 감소하는 것이 관측된다 |
| 쿨다운 | 전 종 **120 틱** 고정 | 하네스에서 42종을 연달아 밟기 위한 값. 밸런스 대상 |

**E 레인은 각 `data/ships/actives/<slug>.ts` 헤더에 "이 파일의 수치는 하네스 육안 확인용 과장
placeholder 이며 밸런스 패스 대상"이라는 문장을 반드시 넣는다** (계획서 Follow-up 1 의 grep 게이트가
이 문구를 검사한다).

## 구조 규칙

- 기체당 6종 = **3계열 × 2티어**. 저티어(`lo`) 게이트 = 그 계열 base 누적 **8**,
  고티어(`hi`) 게이트 = 그 기체의 **`capstoneGate`** — 해츨링만 **44**, 나머지 6기체는 **40**.
  (고티어를 40 고정이 아니라 `capstoneGate` 추종으로 두는 것이 ADR-0041 "캡스톤과 같은 문턱"과 정합.)
- `kind` 는 **`'strike' | 'dash' | 'buff'` 3결이 전부**다. 기체마다 6종에 3결이 **각 2회씩** 들어간다
  (최소 1회 요건보다 강한 대칭 배치 — 계열이 아니라 티어 축으로 갈리지 않게 하기 위함).
- `observable` 은 `kind` 가 1:1 로 결정한다: `strike → projectileCount` · `dash → displacement` ·
  `buff → buffTicks`. 이 대응은 AC-20 ②(관측량 델타 전수)의 축이다.
- 발동 방향은 전 종 공통 — **이동 입력 방향, 정지 중엔 조준각**(대시와 같은 규칙, ADR-0041).

## 금지 사항 요약 (Non-Goal — 어기면 저작 반려)

1. **설치물·소환·지속 생성물 금지** — 드론·터렛·지뢰·잔류 장판 등 액티브가 만들어 남기는 엔티티는 없다.
2. **룰 변경급 금지** — 시간 감속·오염 정화·모드 규칙 개입 없음.
3. **공용 자원·충전 횟수·HP 대가 금지** — 비용은 **쿨다운뿐**이다.
4. **`aux0/aux1` 을 쿨다운·버프 잔여 틱 저장에 쓰지 않는다** — 그 4개 정수는 `WorldState` 신설분이고,
   `aux` 두 칸은 시그니처 런타임 상태가 이미 점유했다.
5. **스트라이커는 `aux` 를 건드리지 않는다** — `signatureBit: -1`(`data/ships/striker.ts:40`)이므로
   건드릴 상태가 없다. 시그니처 델타 테스트의 **제외 목록(정확히 6종)** 이 이 6종이다.

### 해츨링 저작에 대한 주의 (금지 ①과의 경계)

해츨링 6종은 `aux0`(마지막 출격 시점 `state.kills` 스냅샷)을 앞당기거나 되돌린다. **액티브 자신은
아무것도 소환하지 않는다** — 병아리 출격은 시그니처 패시브가 원래 하던 일이고, 액티브는 그 **타이밍만
옮긴다**. 액티브의 관측량은 어디까지나 자기 `observable`(탄수·변위·버프 틱)이다. 이 경계를 지켜야
금지 ①에 걸리지 않는다.

## id · i18n · 아이콘 규약

- **id**: `as_<shipSlug>_<계열slug>_<lo|hi>` — 예 `as_bruiser_bulwark_lo` 형식. 계열 slug 는
  `data/ships/<slug>.ts` 의 `buildShipTree(SLUG, '<계열slug>', ...)` 첫 인자를 그대로 쓴다.
  스트라이커만 레거시 트리라 `firepower`/`survival`/`mobility` 다.
- **i18n 키**: `activeSkill.<id>.name` / `activeSkill.<id>.desc` — 총 84키(42 × 2), ko/en 각각.
  데이터에 한글 리터럴을 넣지 않고 **`t()` 경유**로 표시한다(ADR-0041).
- **아이콘**: `active_<shipSlug>_<n>.png`, `n` = 그 기체 절 표의 행 순서(1..6). 42장 개별.

---

## 1. 스트라이커 (`striker`) — 시그니처 없음 · 교과서형 6종

- `id: 0` · `signatureBit: -1`(`NO_SIGNATURE_BIT`) · `capstoneGate: 40`
- 계열: `firepower`(offense) · `survival`(defense) · `mobility`(utility) — 레거시 3트리
- 저작 축: **"무색함이 정체성"**. 정직한 광선 · 대시 강화 · 짧은 무적. 신규 플레이어의 학습 기준선이고,
  나머지 36종이 무엇을 비틀고 있는지 재는 대조군이다. **`aux0/aux1` 을 읽지도 쓰지도 않는다.**

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_striker_firepower_lo` | firepower / offense | lo(8) | `strike` | `projectileCount` | 발동 방향으로 곧은 광선탄을 부채꼴로 뿜는다 | **없음**(시그니처 부재) | 탄 12발 · 확산 30° · 쿨다운 120틱 | `active_striker_1.png` | 직사 제압 | 발동 방향으로 광선탄 12발을 부채꼴로 발사한다. | Straight Volley | Fires 12 beam bolts in a fan toward the input direction. |
| 2 | `as_striker_firepower_hi` | firepower / offense | hi(40) | `strike` | `projectileCount` | 기체를 축으로 전 방향 일제 사격 | **없음** | 탄 24발 · 확산 360° · 쿨다운 120틱 | `active_striker_2.png` | 전탄 일제사 | 사방으로 광선탄 24발을 동시에 발사한다. | Full Salvo | Releases 24 beam bolts in every direction at once. |
| 3 | `as_striker_survival_lo` | survival / defense | lo(8) | `buff` | `buffTicks` | 짧은 무적 | **없음** | 180틱 무적 · 쿨다운 120틱 | `active_striker_3.png` | 방호 전개 | 180틱 동안 모든 피해를 무시한다. | Guard Field | Ignores all damage for 180 ticks. |
| 4 | `as_striker_survival_hi` | survival / defense | hi(40) | `buff` | `buffTicks` | 긴 무적 + 종료 시 잔여 회복 | **없음** | 300틱 무적 · 쿨다운 120틱 | `active_striker_4.png` | 불굴 방벽 | 300틱 동안 무적이 되고, 끝날 때 선체를 일부 회복한다. | Bulwark Protocol | Invulnerable for 300 ticks; repairs some hull when it ends. |
| 5 | `as_striker_mobility_lo` | mobility / utility | lo(8) | `dash` | `displacement` | 강화 대시 | **없음** | 변위 600u · 쿨다운 120틱 | `active_striker_5.png` | 강습 추진 | 발동 방향으로 600 거리를 즉시 돌파한다. | Assault Thrust | Instantly surges 600 units along the input direction. |
| 6 | `as_striker_mobility_hi` | mobility / utility | hi(40) | `dash` | `displacement` | 2단 도약 대시 | **없음** | 변위 900u(450 × 2단) · 쿨다운 120틱 | `active_striker_6.png` | 이중 도약 | 두 번 연속으로 도약해 900 거리를 이동한다. | Double Vault | Vaults twice for a total of 900 units. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 2. 브루저 (`bruiser`) — 장갑 스택 충전/소모

- `id: 1` · `signatureBit: 18`(`SIG_BRUISER_ARMOR`) · `capstoneGate: 40`
- 계열: `blade`(offense) · `morph`(utility) · `fortify`(defense)
- `aux0` = 장갑 스택(0..`ARMOR_MAX_STACKS`=8) · `aux1` = 마지막 피격 이후 경과 틱
  (`ARMOR_DECAY_TICKS`=180 마다 1스택 소멸)
- 저작 축: **스택을 즉시 충전하거나 통째로 태워 쓴다.** 평소에는 맞아야만 쌓이는 자원을 능동적으로
  만들고, 반대로 방어 자원을 화력으로 환산하는 선택을 준다.

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_bruiser_blade_lo` | blade / offense | lo(8) | `strike` | `projectileCount` | 장갑을 파편으로 태워 흩뿌린다 | `aux0` 을 읽어 탄수 = 8 + `aux0` × 2 로 정하고 **`aux0 = 0`** 으로 소모 | 탄 8~24발(스택 의존) · 쿨다운 120틱 | `active_bruiser_1.png` | 장갑 파쇄 | 쌓인 장갑 스택을 전부 태워 스택 수만큼 파편을 날린다. | Plate Shatter | Burns every armor stack, hurling shrapnel in proportion. |
| 2 | `as_bruiser_blade_hi` | blade / offense | hi(40) | `strike` | `projectileCount` | 먼저 장갑을 가득 채우고 그 전량을 참격으로 전환 | **`aux0 = clampArmorStacks(8)`** 로 즉시 충전한 뒤 같은 틱에 **`aux0 = 0`** 으로 소모 | 탄 24발 · 쿨다운 120틱 | `active_bruiser_2.png` | 전탄 참격 | 장갑을 최대치까지 채운 즉시 전량을 참격 24발로 쏟아낸다. | Overplate Cleave | Tops armor to maximum, then spends it all on 24 cleaving shots. |
| 3 | `as_bruiser_morph_lo` | morph / utility | lo(8) | `dash` | `displacement` | 충각 돌진, 부딪히며 장갑이 붙는다 | **`aux0 = clampArmorStacks(aux0 + 3)`**, **`aux1 = 0`**(감쇠 타이머 리셋) | 변위 600u · 스택 +3 · 쿨다운 120틱 | `active_bruiser_3.png` | 충각 돌진 | 600 거리를 밀고 나가며 장갑 스택 3개를 얻는다. | Ram Charge | Plows 600 units forward and gains 3 armor stacks. |
| 4 | `as_bruiser_morph_hi` | morph / utility | hi(40) | `dash` | `displacement` | 장거리 관통 돌진, 도착 시 장갑 만재 | **`aux0 = 8`**, **`aux1 = 0`** | 변위 900u · 스택 8 확정 · 쿨다운 120틱 | `active_bruiser_4.png` | 관통 충각 | 900 거리를 관통 돌진하고 장갑 스택을 최대치로 채운다. | Breaker Charge | Rams 900 units through and fills armor to maximum. |
| 5 | `as_bruiser_fortify_lo` | fortify / defense | lo(8) | `buff` | `buffTicks` | 장갑 만재 + 지속 동안 감쇠 정지 | **`aux0 = 8`**, 버프 지속 매 틱 **`aux1 = 0`** 으로 고정(감쇠 차단) | 180틱 · 쿨다운 120틱 | `active_bruiser_5.png` | 고정 장갑 | 180틱 동안 장갑 스택이 최대치로 고정되어 줄지 않는다. | Locked Plating | Armor stays pinned at maximum for 180 ticks. |
| 6 | `as_bruiser_fortify_hi` | fortify / defense | hi(40) | `buff` | `buffTicks` | 장갑 고정 후 종료 시 전량 폭발 | 지속 중 **`aux0 = 8` · `aux1 = 0`** 유지, 종료 틱에 **`aux0 = 0`** 으로 폭발 전환 | 300틱 · 종료 폭발 반경 220 · 쿨다운 120틱 | `active_bruiser_6.png` | 파열 장갑 | 300틱 동안 장갑을 고정하고, 끝나는 순간 전량을 폭발로 터뜨린다. | Rupture Plating | Pins armor for 300 ticks, then detonates all of it. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 3. 아크캐스터 (`arccaster`) — 과충전 정지 시간 조작

- `id: 2` · `signatureBit: 19`(`SIG_ARC_OVERCHARGE`) · `capstoneGate: 40`
- 계열: `chain`(offense) · `barrage`(utility) · `barrier`(defense)
- `aux0` = 연속 정지 틱(상한 `OVERCHARGE_TICK_CAP`=600) · `aux1` = 미사용(0)
  (`OVERCHARGE_STILL_TICKS`=90 에서 진입, `OVERCHARGE_MAX_BP`=4000 은 190틱에서 도달)
- 저작 축: **"정지해야 강해진다"는 제약을 능동적으로 사고판다.** 정지 틱을 주입해 즉시 과충전에
  올리거나, 반대로 쌓인 정지 틱을 한 번에 방전한다. **이동 중에도 과충전을 유지하는 것**이 이 기체
  액티브의 핵심 판타지다.

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_arccaster_chain_lo` | chain / offense | lo(8) | `strike` | `projectileCount` | 즉시 과충전에 올린 뒤 연쇄 전격 | **`aux0 = OVERCHARGE_STILL_TICKS`(90)** 주입(정지 없이 과충전 진입) | 탄 12발 · 쿨다운 120틱 | `active_arccaster_1.png` | 강제 충전 | 정지하지 않고도 즉시 과충전에 진입하며 전격 12발을 흘린다. | Forced Charge | Enters overcharge without standing still and looses 12 arcs. |
| 2 | `as_arccaster_chain_hi` | chain / offense | hi(40) | `strike` | `projectileCount` | 쌓인 정지 틱을 통째로 방전 | `aux0` 을 읽어 탄수 = 8 + ⌊`aux0`/40⌋ 로 정하고 **`aux0 = 0`** 으로 방전 | 탄 8~23발(정지 틱 의존) · 쿨다운 120틱 | `active_arccaster_2.png` | 전량 방전 | 모아둔 과충전을 한 번에 방전해 충전량만큼 전격을 쏟는다. | Full Discharge | Dumps the whole overcharge as arcs scaled to what was stored. |
| 3 | `as_arccaster_barrage_lo` | barrage / utility | lo(8) | `dash` | `displacement` | 과충전을 깨지 않고 순간이동 | 이동에도 불구하고 **`aux0` 을 보존**(정지 카운터 미리셋) | 변위 600u · 쿨다운 120틱 | `active_arccaster_3.png` | 위상 점멸 | 과충전을 잃지 않은 채 600 거리를 점멸 이동한다. | Phase Blink | Blinks 600 units without losing overcharge. |
| 4 | `as_arccaster_barrage_hi` | barrage / utility | hi(40) | `dash` | `displacement` | 장거리 도약 후 상한 과충전으로 착지 | 착지 틱에 **`aux0 = OVERCHARGE_STILL_TICKS + 100`(190)** — 증폭 상한 도달치 | 변위 900u · 쿨다운 120틱 | `active_arccaster_4.png` | 상한 도약 | 900 거리를 도약하고 착지와 동시에 과충전이 상한에 닿는다. | Apex Leap | Leaps 900 units and lands at maximum overcharge. |
| 5 | `as_arccaster_barrier_lo` | barrier / defense | lo(8) | `buff` | `buffTicks` | 지속 동안 이동 중에도 충전이 쌓인다 | 지속 매 틱 **`aux0 = min(aux0 + 2, 600)`** | 180틱 · 틱당 +2 · 쿨다운 120틱 | `active_arccaster_5.png` | 유동 충전 | 180틱 동안 움직이면서도 과충전이 계속 쌓인다. | Kinetic Charge | Overcharge keeps building while moving for 180 ticks. |
| 6 | `as_arccaster_barrier_hi` | barrier / defense | hi(40) | `buff` | `buffTicks` | 지속 동안 과충전 상한 고정 | 지속 매 틱 **`aux0 = 190`** 로 고정(상한 bp 유지) | 300틱 · 쿨다운 120틱 | `active_arccaster_6.png` | 고정 과충전 | 300틱 동안 과충전이 상한에 고정되어 무엇을 해도 풀리지 않는다. | Locked Overcharge | Overcharge is pinned at maximum for 300 ticks. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 4. 팬텀 (`phantom`) — 은신 조건 생성/해제

- `id: 3` · `signatureBit: 20`(`SIG_PHANTOM_CLOAK`) · `capstoneGate: 40`
- 계열: `assassin`(offense) · `phase`(utility) · `disrupt`(defense)
- `aux0` = 연속 무피격 틱(0..`CLOAK_TICK_CAP`) · `aux1` = 은신 해제 첫 타 대기 플래그(0/1)
  (`CLOAK_UNHIT_TICKS`=240 진입 · `CLOAK_HOLD_TICKS`=120 유지 · `CLOAK_BREAK_BP`=25000)
- 저작 축: **은신 사이클을 손으로 돌린다.** 240틱을 기다리는 대신 주입하고, 해제 첫 타 배율을
  원하는 순간에 터뜨린다. 은신 창(120틱)이 구조적으로 유계라는 시그니처 설계를 깨지 않는 선에서
  진입 시점만 옮긴다.

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_phantom_assassin_lo` | assassin / offense | lo(8) | `strike` | `projectileCount` | 은신을 강제로 끊어 해제 첫 타를 지금 쓴다 | **`aux1 = 1`**(해제 첫 타 대기 세움) 후 **`aux0 = 0`**(사이클 리셋) | 탄 12발 · 쿨다운 120틱 | `active_phantom_1.png` | 그림자 파열 | 은신을 즉시 끊어 해제 첫 타 배율이 실린 단검 12발을 던진다. | Shadow Break | Snaps cloak early, throwing 12 daggers carrying the break bonus. |
| 2 | `as_phantom_assassin_hi` | assassin / offense | hi(40) | `strike` | `projectileCount` | 은신에 즉시 들어갔다 같은 틱에 나온다 | **`aux0 = CLOAK_UNHIT_TICKS`(240)** 주입 → 같은 틱 **`aux1 = 1`** · **`aux0 = 0`** | 탄 24발 · 쿨다운 120틱 | `active_phantom_2.png` | 순간 암살 | 은신에 들어가는 즉시 빠져나오며 24발 전탄에 해제 배율을 싣는다. | Flicker Assassination | Enters and exits cloak instantly, loading all 24 shots with the break bonus. |
| 3 | `as_phantom_phase_lo` | phase / utility | lo(8) | `dash` | `displacement` | 위상 대시, 무피격 누적이 크게 앞당겨진다 | **`aux0 = min(aux0 + 120, CLOAK_TICK_CAP)`** | 변위 600u · 무피격 +120틱 · 쿨다운 120틱 | `active_phantom_3.png` | 위상 활강 | 600 거리를 미끄러지며 은신 진입 조건을 120틱만큼 앞당긴다. | Phase Glide | Slides 600 units and advances the cloak timer by 120 ticks. |
| 4 | `as_phantom_phase_hi` | phase / utility | hi(40) | `dash` | `displacement` | 장거리 위상 이동 후 은신 창으로 직행 | **`aux0 = CLOAK_UNHIT_TICKS`(240)** — 착지와 동시에 은신 창 진입 | 변위 900u · 쿨다운 120틱 | `active_phantom_4.png` | 심연 도약 | 900 거리를 위상 이동하고 착지하는 순간 은신에 들어간다. | Abyss Step | Phases 900 units and enters cloak the moment it lands. |
| 5 | `as_phantom_disrupt_lo` | disrupt / defense | lo(8) | `buff` | `buffTicks` | 지속 동안 피격이 은신 사이클을 끊지 못한다 | 지속 매 틱 **`aux0 = max(aux0, CLOAK_UNHIT_TICKS)`** 로 하한 고정(피격 리셋 무시) | 180틱 · 쿨다운 120틱 | `active_phantom_5.png` | 은신 유지 | 180틱 동안 맞아도 은신 조건이 리셋되지 않는다. | Held Cloak | Hits no longer reset the cloak cycle for 180 ticks. |
| 6 | `as_phantom_disrupt_hi` | disrupt / defense | hi(40) | `buff` | `buffTicks` | 지속 동안 해제 첫 타가 소모되지 않는다 | 지속 매 틱 **`aux1 = 1`** 을 재세움(첫 타 대기 유지) | 300틱 · 쿨다운 120틱 | `active_phantom_6.png` | 무한 초격 | 300틱 동안 해제 첫 타 배율이 소모되지 않고 계속 실린다. | Endless First Strike | The cloak-break bonus never gets consumed for 300 ticks. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 5. 해츨링 (`hatchling`) — 부화 임계 조작

- `id: 4` · `signatureBit: 21`(`SIG_HATCHLING_BROOD`) · **`capstoneGate: 44`**(유일하게 다르다)
- 계열: `brood`(offense) · `nurture`(utility) · `shelter`(defense)
- `aux0` = 마지막 출격 시점 `state.kills` 스냅샷 · `aux1` = 미사용(0)
  (출격 판정은 `state.kills − aux0 ≥ hatchThreshold(state.kills)`. `HATCH_BASE_KILLS`=12 ·
  `HATCH_STEP_KILLS`=4 · `HATCH_MAX_KILLS`=40)
- 저작 축: **스냅샷을 과거로 밀거나 현재로 당겨 부화 시점을 사고판다.** `aux0` 을 낮추면 다음 부화가
  앞당겨지고, `state.kills` 로 올리면 부화를 미루는 대신 지금 화력을 얻는다.
  ⚠️ **액티브 자신은 아무것도 소환하지 않는다**(위 "해츨링 저작에 대한 주의" 참조).

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_hatchling_brood_lo` | brood / offense | lo(8) | `strike` | `projectileCount` | 알탄을 흩뿌리며 다음 부화를 앞당긴다 | **`aux0 = max(0, aux0 − HATCH_MAX_KILLS)`**(40 만큼 스냅샷을 과거로) | 탄 12발 · 쿨다운 120틱 | `active_hatchling_1.png` | 알 흩뿌리기 | 알탄 12발을 흩뿌리고 다음 부화를 크게 앞당긴다. | Egg Scatter | Scatters 12 egg shots and pulls the next hatch much closer. |
| 2 | `as_hatchling_brood_hi` | brood / offense | hi(44) | `strike` | `projectileCount` | 다음 부화를 팔아 지금의 대형 탄막으로 바꾼다 | **`aux0 = state.kills`**(스냅샷 최신화 = 부화 진행도 소각) | 탄 24발 · 쿨다운 120틱 | `active_hatchling_2.png` | 부화 소각 | 쌓인 부화 진행도를 전부 태워 알탄 24발을 한 번에 터뜨린다. | Clutch Burn | Burns all hatch progress to erupt 24 egg shots at once. |
| 3 | `as_hatchling_nurture_lo` | nurture / utility | lo(8) | `dash` | `displacement` | 굴러 이동하며 부화가 조금 앞당겨진다 | **`aux0 = max(0, aux0 − HATCH_STEP_KILLS)`**(4) | 변위 600u · 쿨다운 120틱 | `active_hatchling_3.png` | 알 구르기 | 600 거리를 굴러 이동하고 부화를 조금 앞당긴다. | Egg Roll | Rolls 600 units and nudges the hatch timer forward. |
| 4 | `as_hatchling_nurture_hi` | nurture / utility | hi(44) | `dash` | `displacement` | 장거리 도약, 부화가 크게 앞당겨진다 | **`aux0 = max(0, aux0 − HATCH_BASE_KILLS)`**(12) | 변위 900u · 쿨다운 120틱 | `active_hatchling_4.png` | 둥지 도약 | 900 거리를 도약하고 부화를 12처치 분만큼 앞당긴다. | Nest Leap | Leaps 900 units and advances the hatch by 12 kills' worth. |
| 5 | `as_hatchling_shelter_lo` | shelter / defense | lo(8) | `buff` | `buffTicks` | 지속 동안 부화가 꾸준히 앞당겨진다 | 지속 30틱마다 **`aux0 = max(0, aux0 − 1)`** | 180틱 · 쿨다운 120틱 | `active_hatchling_5.png` | 온기 품기 | 180틱 동안 부화가 계속 조금씩 앞당겨진다. | Warm Brooding | The hatch timer keeps creeping forward for 180 ticks. |
| 6 | `as_hatchling_shelter_hi` | shelter / defense | hi(44) | `buff` | `buffTicks` | 지속 동안 부화 임계가 상시 충족 상태 | 지속 매 틱 **`aux0 = 0`** 고정 | 300틱 · 쿨다운 120틱 | `active_hatchling_6.png` | 둥지 개방 | 300틱 동안 부화 임계가 항상 충족된 상태로 유지된다. | Open Nest | The hatch threshold stays satisfied for 300 ticks. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 6. 마시멜로 (`mallow`) — 지연 피해 즉시 정산/이월

- `id: 5` · `signatureBit: 22`(`SIG_MALLOW_CUSHION`) · `capstoneGate: 40`
- 계열: `squish`(offense) · `mend`(utility) · `cushion`(defense)
- `aux0` = 적립된 지연 피해(비음 정수) · `aux1` = 연속 무피격 틱(상한 `CUSHION_TICK_CAP`=600)
  (`CUSHION_DEFER_BP`=3500 적립 · `CUSHION_RECOVER_TICKS`=180 에서 정산 · `CUSHION_RECOVER_BP`=6000)
- 저작 축: **미룬 아픔을 언제 갚을지 고른다.** 적립된 지연분을 탄약으로 환산해 지금 쏘거나,
  무피격 카운터를 주입해 정산·회복을 앞당기거나, 반대로 부채를 키워 화력을 당겨쓴다.

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_mallow_squish_lo` | squish / offense | lo(8) | `strike` | `projectileCount` | 미룬 피해를 되돌려 쏜다 | `aux0` 을 읽어 탄수 = 8 + ⌊`aux0`/10⌋ 로 정하고 **`aux0 = 0`**(부채 청산) | 탄 8~24발(적립분 의존) · 쿨다운 120틱 | `active_mallow_1.png` | 되돌린 아픔 | 미뤄둔 피해를 전부 탄으로 바꿔 되돌려준다. | Returned Ache | Converts all deferred damage into shots and gives it back. |
| 2 | `as_mallow_squish_hi` | squish / offense | hi(40) | `strike` | `projectileCount` | 부채를 키워 지금의 대형 탄막을 산다 | **`aux0 = aux0 × 2 + 60`**(이월 증액) 하고 그에 비례한 대형 산탄 | 탄 24발 · 쿨다운 120틱 | `active_mallow_2.png` | 이월 폭발 | 미룬 피해를 두 배로 늘리는 대가로 24발을 한 번에 터뜨린다. | Deferred Detonation | Doubles the deferred debt to erupt 24 shots right now. |
| 3 | `as_mallow_mend_lo` | mend / utility | lo(8) | `dash` | `displacement` | 튕겨 이동한 뒤 착지 즉시 정산·회복 | **`aux1 = CUSHION_RECOVER_TICKS`(180)** 주입(정산 임계 즉시 충족) | 변위 600u · 쿨다운 120틱 | `active_mallow_3.png` | 반동 튕김 | 600 거리를 튕겨 이동하고 착지하는 순간 지연 피해를 정산한다. | Bounce Recoil | Bounces 600 units and settles deferred damage on landing. |
| 4 | `as_mallow_mend_hi` | mend / utility | hi(40) | `dash` | `displacement` | 장거리 반동 + 부채 절반 삭감 후 정산 | **`aux0 = ⌊aux0 / 2⌋`** 후 **`aux1 = CUSHION_RECOVER_TICKS`** | 변위 900u · 쿨다운 120틱 | `active_mallow_4.png` | 탄력 도약 | 900 거리를 도약하며 미룬 피해를 절반으로 줄이고 정산한다. | Elastic Vault | Vaults 900 units, halving the deferred pool before settling it. |
| 5 | `as_mallow_cushion_lo` | cushion / defense | lo(8) | `buff` | `buffTicks` | 지속 동안 무피격 카운터가 3배로 흐른다 | 지속 매 틱 **`aux1 = min(aux1 + 3, 600)`**(피격 리셋을 상쇄) | 180틱 · 쿨다운 120틱 | `active_mallow_5.png` | 빠른 회복 | 180틱 동안 회복 임계가 세 배 빠르게 채워진다. | Rapid Mend | The recovery timer fills three times faster for 180 ticks. |
| 6 | `as_mallow_cushion_hi` | cushion / defense | hi(40) | `buff` | `buffTicks` | 지속 동안 모든 피해를 이월하고 종료 시 한 번에 정산 | 지속 중 신규 피해 전액을 **`aux0`** 로 이월(즉시분 0), 종료 틱에 **`aux1 = CUSHION_RECOVER_TICKS`** | 300틱 · 쿨다운 120틱 | `active_mallow_6.png` | 전량 유예 | 300틱 동안 모든 피해를 미뤄두고, 끝나는 순간 한 번에 정산한다. | Total Deferral | Defers all damage for 300 ticks, then settles it in one go. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 7. 버블 (`bubble`) — 막 버스트/재충전

- `id: 6` · `signatureBit: 23`(`SIG_BUBBLE_FILM`) · `capstoneGate: 40`
- 계열: `pop`(offense) · `drift`(utility) · `film`(defense)
- `aux0` = 남은 막 내구(0..`FILM_ABSORB_FLAT`=60) · `aux1` = 마지막 파열 이후 경과 틱
  (`FILM_PERIOD_TICKS`=420 마다 재생 · `FILM_BURST_RADIUS`=220 · 파열 밀어내기 변위 260)
- 저작 축: **막을 원할 때 터뜨리고 원할 때 다시 세운다.** 파열은 밀어내기라 공격 겸 위기탈출이고,
  `aux1` 주입은 7초 주기를 건너뛰는 재충전이다. 남은 내구를 탄약으로 환산하는 선택도 준다.

| # | `id` | 계열(slug/affinity) | tier | `kind` | `observable` | 효과 1줄 | `aux` 조작 | placeholder 계수 | 아이콘 | i18n ko 이름 | i18n ko 설명 | i18n en name | i18n en desc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_bubble_pop_lo` | pop / offense | lo(8) | `strike` | `projectileCount` | 막을 강제로 터뜨려 주변을 밀어낸다 | **`aux0 = 0`** · **`aux1 = 0`**(파열 처리 + 재생 타이머 리셋) | 탄 12발 · 파열 반경 220 · 쿨다운 120틱 | `active_bubble_1.png` | 강제 파열 | 막을 즉시 터뜨려 거품탄 12발과 함께 주변을 밀어낸다. | Forced Pop | Bursts the film at once, spraying 12 bubbles and shoving foes back. |
| 2 | `as_bubble_pop_hi` | pop / offense | hi(40) | `strike` | `projectileCount` | 남은 막 내구를 통째로 탄약으로 환산 | `aux0` 을 읽어 탄수 = 8 + ⌊`aux0`/4⌋ 로 정하고 **`aux0 = 0`** | 탄 8~23발(내구 의존) · 쿨다운 120틱 | `active_bubble_2.png` | 막 환산 | 남은 막을 전부 거품탄으로 바꿔 쏟아낸다. | Film Conversion | Turns every remaining point of film into bubble shots. |
| 3 | `as_bubble_drift_lo` | drift / utility | lo(8) | `dash` | `displacement` | 부양 이동, 막 재생이 절반만큼 앞당겨진다 | **`aux1 = min(aux1 + 210, FILM_PERIOD_TICKS)`**(주기의 절반) | 변위 600u · 쿨다운 120틱 | `active_bubble_3.png` | 부양 활공 | 600 거리를 떠서 이동하고 막 재생을 절반만큼 앞당긴다. | Buoyant Glide | Floats 600 units and cuts half the film recharge wait. |
| 4 | `as_bubble_drift_hi` | drift / utility | hi(40) | `dash` | `displacement` | 장거리 부양, 착지 즉시 막 재생 | **`aux1 = FILM_PERIOD_TICKS`(420)** — `filmReady` 즉시 참 | 변위 900u · 쿨다운 120틱 | `active_bubble_4.png` | 기류 도약 | 900 거리를 떠서 이동하고 착지하는 순간 막이 다시 선다. | Updraft Leap | Rides 900 units and the film re-forms the instant it lands. |
| 5 | `as_bubble_film_lo` | film / defense | lo(8) | `buff` | `buffTicks` | 막을 즉시 만재하고 재생을 가속한다 | **`aux0 = FILM_ABSORB_FLAT`(60)**, 지속 매 틱 **`aux1 = min(aux1 + 2, 420)`** | 180틱 · 쿨다운 120틱 | `active_bubble_5.png` | 막 재충전 | 막을 즉시 가득 채우고 180틱 동안 재생이 두 배로 빨라진다. | Film Recharge | Refills the film instantly and doubles recharge for 180 ticks. |
| 6 | `as_bubble_film_hi` | film / defense | hi(40) | `buff` | `buffTicks` | 지속 동안 막이 매 틱 재생, 종료 시 파열 | 지속 매 틱 **`aux0 = FILM_ABSORB_FLAT`**, 종료 틱에 **`aux0 = 0` · `aux1 = 0`**(파열) | 300틱 · 종료 파열 반경 220 · 쿨다운 120틱 | `active_bubble_6.png` | 불멸 막 | 300틱 동안 막이 매 틱 다시 차오르고, 끝날 때 크게 터진다. | Everlasting Film | The film refills every tick for 300 ticks, then bursts hard. |

**kind 분포**: `strike` 2 · `dash` 2 · `buff` 2

---

## 전체 `kind` 분포 검증

| 기체 | `strike` | `dash` | `buff` | 합 |
|---|---|---|---|---|
| striker | 2 | 2 | 2 | 6 |
| bruiser | 2 | 2 | 2 | 6 |
| arccaster | 2 | 2 | 2 | 6 |
| phantom | 2 | 2 | 2 | 6 |
| hatchling | 2 | 2 | 2 | 6 |
| mallow | 2 | 2 | 2 | 6 |
| bubble | 2 | 2 | 2 | 6 |
| **합계** | **14** | **14** | **14** | **42** |

3결이 기체마다 각 2회씩 들어가므로 "기체당 3결 최소 1회" 요건은 자동 충족된다.

## 42종 id 검증 목록 (전부 고유)

```
as_striker_firepower_lo
as_striker_firepower_hi
as_striker_survival_lo
as_striker_survival_hi
as_striker_mobility_lo
as_striker_mobility_hi
as_bruiser_blade_lo
as_bruiser_blade_hi
as_bruiser_morph_lo
as_bruiser_morph_hi
as_bruiser_fortify_lo
as_bruiser_fortify_hi
as_arccaster_chain_lo
as_arccaster_chain_hi
as_arccaster_barrage_lo
as_arccaster_barrage_hi
as_arccaster_barrier_lo
as_arccaster_barrier_hi
as_phantom_assassin_lo
as_phantom_assassin_hi
as_phantom_phase_lo
as_phantom_phase_hi
as_phantom_disrupt_lo
as_phantom_disrupt_hi
as_hatchling_brood_lo
as_hatchling_brood_hi
as_hatchling_nurture_lo
as_hatchling_nurture_hi
as_hatchling_shelter_lo
as_hatchling_shelter_hi
as_mallow_squish_lo
as_mallow_squish_hi
as_mallow_mend_lo
as_mallow_mend_hi
as_mallow_cushion_lo
as_mallow_cushion_hi
as_bubble_pop_lo
as_bubble_pop_hi
as_bubble_drift_lo
as_bubble_drift_hi
as_bubble_film_lo
as_bubble_film_hi
```

총 42줄 · 중복 0. 각 id 는 `activeSkill.<id>.name` · `activeSkill.<id>.desc` 두 키를 가지므로
i18n 은 **ko/en 각 84키**다.

## 아이콘 파일 검증 목록 (42장)

`active_striker_1..6.png` · `active_bruiser_1..6.png` · `active_arccaster_1..6.png` ·
`active_phantom_1..6.png` · `active_hatchling_1..6.png` · `active_mallow_1..6.png` ·
`active_bubble_1..6.png` — 각 기체 절 표의 행 번호 = 파일명의 `n`.

---

# 부록 A — 아이콘 생성 프롬프트 42줄 (F 레인, AC-21)

## 기체 정체색 (기존 자산 실측 근거)

`assets/ship_showcase_*.png` 7장을 직접 열어 확인한 지배색이다. 팩은 **기체당 1팩 = 7팩**으로 나눈다
(한 팩의 description 이 특정 색 지배일 때만 그 색이 나온다 — 색 계열 혼재 팩은 과거 3회 실패).

| 기체 | 자산 | 정체색 |
|---|---|---|
| striker | `ship_showcase_fighter.png` | steel teal-cyan + dark navy panels (중립 강철 — "무색함") |
| bruiser | `ship_showcase_bruiser.png` | gunmetal green armor + burnt orange accent |
| arccaster | `ship_showcase_arccaster.png` | electric cyan + white arc glow |
| phantom | `ship_showcase_phantom.png` | deep indigo-violet + faint blue edge light |
| hatchling | `ship_showcase_hatchling.png` | pale mint green shell + soft sage |
| mallow | `ship_showcase_mallow.png` | pastel pink + mint accent |
| bubble | `ship_showcase_bubble.png` | aqua turquoise + glassy white highlight |

공통 접두(각 프롬프트에 팩 단위로 적용): `64x64 pixel art game skill icon, centered emblem on
transparent background, thick readable silhouette, limited palette, crisp 1px outline, no text`

## A-1. striker 팩 — steel teal-cyan with dark navy panels

1. `active_striker_1.png` — Straight beam volley: a fan of five steel-cyan energy bolts spreading forward from a chevron muzzle, dark navy backing plate
2. `active_striker_2.png` — Full salvo: a steel-cyan starburst of radial bolts firing outward in every direction from a small navy core
3. `active_striker_3.png` — Guard field: a hexagonal steel-cyan energy shield plate with a soft navy rim glow
4. `active_striker_4.png` — Bulwark protocol: a layered double hexagon shield in steel-cyan with a repairing spark at its center
5. `active_striker_5.png` — Assault thrust: a steel-cyan arrowhead ship silhouette with sharp navy speed streaks trailing behind
6. `active_striker_6.png` — Double vault: two stacked steel-cyan chevrons leaping upward, twin navy afterimage trails

## A-2. bruiser 팩 — gunmetal green armor with burnt orange accent

1. `active_bruiser_1.png` — Plate shatter: a cracked gunmetal green armor plate exploding into burnt orange shrapnel shards
2. `active_bruiser_2.png` — Overplate cleave: a heavy gunmetal green cleaver blade with a burnt orange energy edge slashing diagonally
3. `active_bruiser_3.png` — Ram charge: a blunt gunmetal green ramming prow with burnt orange impact sparks at the tip
4. `active_bruiser_4.png` — Breaker charge: a gunmetal green drill-shaped prow punching through a broken burnt orange barrier
5. `active_bruiser_5.png` — Locked plating: a padlocked stack of gunmetal green armor plates with burnt orange rivets
6. `active_bruiser_6.png` — Rupture plating: gunmetal green armor plates blowing apart in a burnt orange shockwave ring

## A-3. arccaster 팩 — electric cyan with white arc glow

1. `active_arccaster_1.png` — Forced charge: a capacitor coil crackling with electric cyan lightning and white arc flashes
2. `active_arccaster_2.png` — Full discharge: a jagged electric cyan lightning burst radiating from a white-hot core
3. `active_arccaster_3.png` — Phase blink: an electric cyan ship silhouette split into two offset afterimages with white spark dots between
4. `active_arccaster_4.png` — Apex leap: an electric cyan arc leaping upward to a white glowing apex marker
5. `active_arccaster_5.png` — Kinetic charge: an electric cyan battery gauge filling while white motion streaks pass across it
6. `active_arccaster_6.png` — Locked overcharge: an electric cyan capacitor gauge pinned at full with a white lock glyph over it

## A-4. phantom 팩 — deep indigo-violet with faint blue edge light

1. `active_phantom_1.png` — Shadow break: a deep indigo dagger bursting out of a shattering violet smoke veil, faint blue edge light
2. `active_phantom_2.png` — Flicker assassination: an indigo-violet blade striking through a ghostly translucent silhouette with blue rim glow
3. `active_phantom_3.png` — Phase glide: an indigo-violet ship silhouette dissolving into drifting violet particles with a blue trail
4. `active_phantom_4.png` — Abyss step: an indigo-violet portal ring with a receding silhouette stepping through, faint blue horizon light
5. `active_phantom_5.png` — Held cloak: a deep violet hooded cloak shape wrapped around a faint blue eye glyph
6. `active_phantom_6.png` — Endless first strike: an indigo-violet dagger surrounded by an infinity loop of faint blue light

## A-5. hatchling 팩 — pale mint green shell with soft sage

1. `active_hatchling_1.png` — Egg scatter: several pale mint green eggs bursting outward from a soft sage nest
2. `active_hatchling_2.png` — Clutch burn: a pale mint green egg cracking open in a large soft sage energy bloom
3. `active_hatchling_3.png` — Egg roll: a pale mint green egg rolling with soft sage motion arcs behind it
4. `active_hatchling_4.png` — Nest leap: a pale mint green egg arcing high over a soft sage twig nest
5. `active_hatchling_5.png` — Warm brooding: a pale mint green egg nestled in soft sage down feathers with gentle warmth waves
6. `active_hatchling_6.png` — Open nest: a soft sage nest wide open with a pale mint green egg glowing and ready to hatch

## A-6. mallow 팩 — pastel pink with mint accent

1. `active_mallow_1.png` — Returned ache: a pastel pink marshmallow blob squeezing out mint-tipped projectile puffs
2. `active_mallow_2.png` — Deferred detonation: a pastel pink blob swelling and bursting into a wide mint-edged puff cloud
3. `active_mallow_3.png` — Bounce recoil: a pastel pink blob squashed against the ground with mint bounce arcs above it
4. `active_mallow_4.png` — Elastic vault: a pastel pink blob stretched into a long springy arc with mint highlight bands
5. `active_mallow_5.png` — Rapid mend: a pastel pink blob with a mint cross-shaped mend glyph and small healing sparkles
6. `active_mallow_6.png` — Total deferral: a pastel pink hourglass filled with soft mint sand about to tip over

## A-7. bubble 팩 — aqua turquoise with glassy white highlight

1. `active_bubble_1.png` — Forced pop: an aqua turquoise bubble bursting outward with glassy white shard highlights and a shove ring
2. `active_bubble_2.png` — Film conversion: an aqua turquoise membrane dissolving into a spray of small glassy white bubbles
3. `active_bubble_3.png` — Buoyant glide: an aqua turquoise bubble floating upward with glassy white drift streaks
4. `active_bubble_4.png` — Updraft leap: an aqua turquoise bubble riding a tall glassy white updraft column
5. `active_bubble_5.png` — Film recharge: an aqua turquoise bubble shell re-forming with a glassy white refill sweep across it
6. `active_bubble_6.png` — Everlasting film: nested aqua turquoise bubble layers with a glassy white infinity highlight at the center

---

# 부록 B — 저작 검증 체크리스트 (E 레인 자체 점검)

1. id 42개 고유 — 위 검증 목록을 `sort | uniq -d` 로 확인(중복 0)
2. 기체마다 `kind` 3결이 각 2회 — 위 분포표
3. `observable` 이 `kind` 로 1:1 결정 — `strike→projectileCount` / `dash→displacement` / `buff→buffTicks`
4. 저티어 게이트 8 · 고티어 게이트 = `capstoneGate`(해츨링만 44)
5. 스트라이커 6종은 `aux` 조작 칸이 전부 "없음" — 시그니처 델타 테스트 **제외 목록 크기 == 6**
6. 나머지 36종은 `aux0` 또는 `aux1` 중 최소 하나를 **쓴다**(읽기만 하는 종은 없다) — 델타 테스트가 강제
7. Non-Goal 위반 0 — 설치물·소환·지속 생성물 없음 / 룰 변경급 없음 / 비용은 쿨다운뿐
8. 각 `data/ships/actives/<slug>.ts` 헤더에 placeholder 명시 문구 존재
