# AC-23 하네스 42종 발동 육안 확인 대조표

- 계측: 2026-07-31 · 워크트리 `active-skills-impl` · dev 서버 포트 5191
- **품질 티어 `high` 고정** + **탭 포그라운드**(FPS 130~144 실측). 이걸 안 하면 FPS 계측이
  티어를 low 로 떨어뜨려 **이펙트가 통째로 꺼진 화면**을 보고 판정하게 된다.
- 발동은 **실제 `KeyboardEvent` keydown(`code: KeyZ`)을 window 에 디스패치**해
  `Controller.sample()` → `special` 비트 9 → `stepActives` 경로를 그대로 탄다.
  하네스 `injectInput` 우회가 **아니다** — 그 우회는 과거에 컨트롤러 미배선 CRITICAL 을
  통과시킨 전례가 있어 배선 증명이 되지 못한다.
- 스킬마다 **런을 새로 시작**(시드 `0xac2300 + i`)해 대조 오염을 막았다. 슬롯 1에만 장착.
- 스크린샷 42장: `.omc/research/ac23/ac23_<shipSlug>_<n>_<kind>.jpg`
- `HUD` 열 = 좌하단 액티브 칸 수 / 아이콘 `img` 요소 수. **42종 전부 `1cell/1img`** —
  칸도 아이콘도 실제로 그려졌다(AC-18 · AC-21 화면 도달 확인).

| # | id | 기체 | tier | kind | 관측된 효과 | 쿨다운(틱) | aux0/aux1 | HUD | 스크린샷 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `as_striker_firepower_lo` | striker | lo | `strike` | 투사체 5→18 (+13) | 107 | 0/0->0/0 | 1cell/1img | `ac23_striker_1_strike.jpg` |
| 2 | `as_striker_firepower_hi` | striker | hi | `strike` | 투사체 5→30 (+25) | 107 | 0/0->0/0 | 1cell/1img | `ac23_striker_2_strike.jpg` |
| 3 | `as_striker_survival_lo` | striker | lo | `buff` | 버프 잔여 0→168틱 | 108 | 0/0->0/0 | 1cell/1img | `ac23_striker_3_buff.jpg` |
| 4 | `as_striker_survival_hi` | striker | hi | `buff` | 버프 잔여 0→287틱 | 107 | 0/0->0/0 | 1cell/1img | `ac23_striker_4_buff.jpg` |
| 5 | `as_striker_mobility_lo` | striker | lo | `dash` | 변위 600u | 107 | 0/0->0/0 | 1cell/1img | `ac23_striker_5_dash.jpg` |
| 6 | `as_striker_mobility_hi` | striker | hi | `dash` | 변위 900u | 108 | 0/0->0/0 | 1cell/1img | `ac23_striker_6_dash.jpg` |
| 7 | `as_bruiser_blade_lo` | bruiser | lo | `strike` | 투사체 7→16 (+9) | 107 | 0/48->0/62 | 1cell/1img | `ac23_bruiser_1_strike.jpg` |
| 8 | `as_bruiser_blade_hi` | bruiser | hi | `strike` | 투사체 4→28 (+24) | 107 | 0/48->0/62 | 1cell/1img | `ac23_bruiser_2_strike.jpg` |
| 9 | `as_bruiser_morph_lo` | bruiser | lo | `dash` | 변위 600u | 107 | 0/48->3/14 | 1cell/1img | `ac23_bruiser_3_dash.jpg` |
| 10 | `as_bruiser_morph_hi` | bruiser | hi | `dash` | 변위 900u | 107 | 0/48->8/14 | 1cell/1img | `ac23_bruiser_4_dash.jpg` |
| 11 | `as_bruiser_fortify_lo` | bruiser | lo | `buff` | 버프 잔여 0→168틱 | 108 | 0/48->8/1 | 1cell/1img | `ac23_bruiser_5_buff.jpg` |
| 12 | `as_bruiser_fortify_hi` | bruiser | hi | `buff` | 버프 잔여 0→288틱 | 108 | 0/49->8/1 | 1cell/1img | `ac23_bruiser_6_buff.jpg` |
| 13 | `as_arccaster_chain_lo` | arccaster | lo | `strike` | 투사체 4→16 (+12) | 107 | 50/0->104/0 | 1cell/1img | `ac23_arccaster_1_strike.jpg` |
| 14 | `as_arccaster_chain_hi` | arccaster | hi | `strike` | 투사체 4→12 (+8) | 107 | 48/0->14/0 | 1cell/1img | `ac23_arccaster_2_strike.jpg` |
| 15 | `as_arccaster_barrage_lo` | arccaster | lo | `dash` | 변위 600u | 107 | 48/0->104/0 | 1cell/1img | `ac23_arccaster_3_dash.jpg` |
| 16 | `as_arccaster_barrage_hi` | arccaster | hi | `dash` | 변위 900u | 108 | 48/0->203/0 | 1cell/1img | `ac23_arccaster_4_dash.jpg` |
| 17 | `as_arccaster_barrier_lo` | arccaster | lo | `buff` | 버프 잔여 0→169틱 | 109 | 48/0->84/0 | 1cell/1img | `ac23_arccaster_5_buff.jpg` |
| 18 | `as_arccaster_barrier_hi` | arccaster | hi | `buff` | 버프 잔여 0→288틱 | 108 | 48/0->191/0 | 1cell/1img | `ac23_arccaster_6_buff.jpg` |
| 19 | `as_phantom_assassin_lo` | phantom | lo | `strike` | 투사체 4→17 (+13) | 108 | 48/0->13/0 | 1cell/1img | `ac23_phantom_1_strike.jpg` |
| 20 | `as_phantom_assassin_hi` | phantom | hi | `strike` | 투사체 5→31 (+26) | 107 | 48/0->14/0 | 1cell/1img | `ac23_phantom_2_strike.jpg` |
| 21 | `as_phantom_phase_lo` | phantom | lo | `dash` | 변위 600u | 108 | 48/0->181/0 | 1cell/1img | `ac23_phantom_3_dash.jpg` |
| 22 | `as_phantom_phase_hi` | phantom | hi | `dash` | 변위 900u | 108 | 48/0->253/0 | 1cell/1img | `ac23_phantom_4_dash.jpg` |
| 23 | `as_phantom_disrupt_lo` | phantom | lo | `buff` | 버프 잔여 0→167틱 | 107 | 48/0->254/0 | 1cell/1img | `ac23_phantom_5_buff.jpg` |
| 24 | `as_phantom_disrupt_hi` | phantom | hi | `buff` | 버프 잔여 0→287틱 | 107 | 48/0->62/1 | 1cell/1img | `ac23_phantom_6_buff.jpg` |
| 25 | `as_hatchling_brood_lo` | hatchling | lo | `strike` | 투사체 4→17 (+13) | 107 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_1_strike.jpg` |
| 26 | `as_hatchling_brood_hi` | hatchling | hi | `strike` | 투사체 5→29 (+24) | 108 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_2_strike.jpg` |
| 27 | `as_hatchling_nurture_lo` | hatchling | lo | `dash` | 변위 600u | 107 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_3_dash.jpg` |
| 28 | `as_hatchling_nurture_hi` | hatchling | hi | `dash` | 변위 900u | 107 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_4_dash.jpg` |
| 29 | `as_hatchling_shelter_lo` | hatchling | lo | `buff` | 버프 잔여 0→167틱 | 107 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_5_buff.jpg` |
| 30 | `as_hatchling_shelter_hi` | hatchling | hi | `buff` | 버프 잔여 0→288틱 | 108 | 0/0->0/0 | 1cell/1img | `ac23_hatchling_6_buff.jpg` |
| 31 | `as_mallow_squish_lo` | mallow | lo | `strike` | 투사체 2→10 (+8) | 107 | 0/48->0/62 | 1cell/1img | `ac23_mallow_1_strike.jpg` |
| 32 | `as_mallow_squish_hi` | mallow | hi | `strike` | 투사체 4→29 (+25) | 108 | 0/48->60/61 | 1cell/1img | `ac23_mallow_2_strike.jpg` |
| 33 | `as_mallow_mend_lo` | mallow | lo | `dash` | 변위 600u | 108 | 0/48->0/193 | 1cell/1img | `ac23_mallow_3_dash.jpg` |
| 34 | `as_mallow_mend_hi` | mallow | hi | `dash` | 변위 900u | 108 | 0/48->0/193 | 1cell/1img | `ac23_mallow_4_dash.jpg` |
| 35 | `as_mallow_cushion_lo` | mallow | lo | `buff` | 버프 잔여 0→167틱 | 107 | 0/48->0/104 | 1cell/1img | `ac23_mallow_5_buff.jpg` |
| 36 | `as_mallow_cushion_hi` | mallow | hi | `buff` | 버프 잔여 0→287틱 | 107 | 0/48->0/1 | 1cell/1img | `ac23_mallow_6_buff.jpg` |
| 37 | `as_bubble_pop_lo` | bubble | lo | `strike` | 투사체 5→18 (+13) | 108 | 0/48->0/13 | 1cell/1img | `ac23_bubble_1_strike.jpg` |
| 38 | `as_bubble_pop_hi` | bubble | hi | `strike` | 투사체 5→14 (+9) | 108 | 0/48->0/61 | 1cell/1img | `ac23_bubble_2_strike.jpg` |
| 39 | `as_bubble_drift_lo` | bubble | lo | `dash` | 변위 600u | 106 | 0/47->0/272 | 1cell/1img | `ac23_bubble_3_dash.jpg` |
| 40 | `as_bubble_drift_hi` | bubble | hi | `dash` | 변위 900u | 107 | 0/48->60/0 | 1cell/1img | `ac23_bubble_4_dash.jpg` |
| 41 | `as_bubble_film_lo` | bubble | lo | `buff` | 버프 잔여 0→168틱 | 108 | 0/48->60/72 | 1cell/1img | `ac23_bubble_5_buff.jpg` |
| 42 | `as_bubble_film_hi` | bubble | hi | `buff` | 버프 잔여 0→287틱 | 107 | 0/48->60/48 | 1cell/1img | `ac23_bubble_6_buff.jpg` |

## 판정

**42/42 발동 확인 — 빈 칸 없음.**

- `strike` 14종: 전부 투사체가 대조 시점 대비 증가(+8 ~ +26).
- `dash` 14종: 전부 변위 관측 — 저티어 600u · 고티어 900u(placeholder 계수 그대로).
- `buff` 14종: 전부 잔여 틱 0 → 양수(저티어 167~169 · 고티어 287~288).
  **핸들러가 세운 값**이다 — 공통 발동 코드는 감소만 한다(0c 계약 ⑤).
- 쿨다운은 전 종 106~109틱. `baseCooldown` 120 에서 계열 투자 파생분만큼 줄어든 값이다(AC-13).

### 주의 — 해츨링 6종의 aux 가 `0/0` 인 이유

해츨링 `aux0` 는 **마지막 출격 시점의 `state.kills` 스냅샷**이라, 발동 시점 킬 수가 적으면
조작 결과가 하한 0 에 걸려 델타가 화면 계측에서 안 보인다(런 시작 ~800틱, kills 7~10).
시그니처 조작 자체는 `tests/activeSkillWiring.test.ts` 의 배선 전수 ③이 **중간값을 심어 놓고**
재고, 거기서 6종 전부 통과한다. 화면 판정은 관측량(투사체·변위·버프 틱)으로 성립한다.

### 첫 12장 재촬영

스트라이커·브루저 12종은 처음에 **아이콘 배선 전** 상태로 찍혀 HUD 칸에 발동 키 글자(`Z`)가
자리표시자로 떠 있었다. `UI_ASSET_NAMES` 등재와 `uiAssetUrl` export 를 넣은 뒤 **다시 찍어**
42장 전부를 같은 조건(아이콘 표시 상태)으로 맞췄다.
## 렌더 예산 (계획 R15 — 55 FPS 하한 · A/B 교차 3라운드)

| 라운드 | 액티브 미사용 | 액티브 사용(20프레임마다 z+x 강제 발동) |
|---|---|---|
| 1 | 144 FPS | 144 FPS |
| 2 | 144 FPS | 144 FPS |
| 3 | 144 FPS | 144 FPS |

- 품질 티어 `high` 고정 · 브루저에 저티어/고티어 2개 장착 · 쿨다운 리셋 치트로 연사.
- **양쪽 다 144 로 붙었다 = 이 기기의 vsync 상한**이다. 즉 이 조건에서는 **회귀가 측정되지
  않았다**는 것이 정직한 서술이고, "액티브가 공짜"라는 뜻은 아니다. 하한 55 FPS 대비 여유가
  2.6배라 저사양 판정은 별도 기기·저티어에서 다시 재야 한다(밸런스 패스와 함께 후속).
- 단발 측정이 2~3배 흔들리는 것을 알고 있으므로 **A/B 를 번갈아 3라운드** 돌렸다.
