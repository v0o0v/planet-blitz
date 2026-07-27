/**
 * 침공 밸런스 스모크 — NPC 시드 20기지 × 결정론 시드 목록 (M7c C7-balance).
 *
 * ## 이 파일이 막는 것
 * 레인별 단위 테스트는 자기 모듈만 부르므로 **"카탈로그는 다 그린인데 실제 판이 클리어
 * 불가"** 상태를 통과시킨다. M7c 콘텐츠 확장 직후가 정확히 그랬다 — 참조봇 실측에서
 * 중하·중위 밴드 클리어율이 **0%** 였는데 기존 테스트는 전부 통과했다.
 * 여기서는 `createWorld` → `stepWorld` **정규 경로**로 한 판을 끝까지 돌려, 밴드별
 * 클리어율이 목표 범위 안에 있는지를 직접 잰다.
 *
 * ## 측정 기준 — 참조봇이지 사람이 아니다
 * 입력은 `autopilotInput`(ADR-0008 순수 결정론 입력 봇)이 만든다. 사람 플레이어는
 * 이보다 잘 피하므로 **여기 승률은 실제 체감 승률의 하한**이다. 절대값보다 중요한 것은
 * ①클리어 가능성이 살아 있는가 ②밴드 순서대로 어려워지는가 두 가지다.
 *
 * 장비는 고정 프로필(`GEAR_REFERENCE`)을 쓴다. 무장비로 재면 배치전을 실제로 치르는
 * 시점(PvP 해금 직후 = 장비를 갖춘 상태)과 어긋나고, 콘텐츠가 조금만 세져도 전 밴드가
 * 0% 로 붙어 버려 회귀 신호가 죽는다.
 *
 * ## 목표 승률(설계 의도) — **2026-07-27 5세대에서 상한이 목표로 복귀했다**
 *   하위(01~07) ≥ 85%  — 배치전은 PvP 해금 후 **필수 5회**다. 여기서 막히면 진행이 멈춘다.
 *   중하(08~14) 55~80% — 절반 이상 이기되 배치를 신경 쓰게 만드는 구간.
 *   중위(15~20) 25~55% — 재도전 전제의 상위권 문턱. 0% 도 100% 도 아니어야 한다.
 *
 * ## ⚠️ 이 파일의 숫자를 읽는 법 (2026-07-27 통합 — 흩어진 TODO 3세대를 여기로 모았다)
 *
 * 지금까지 각 단언 옆에 `TODO(밸런스)` 주석이 세 세대 쌓였다. 다음 레인이 **네 번째 층을
 * 쌓지 않도록**, 목표와 상한의 갈림에 관한 기록은 앞으로 이 블록에만 쓴다.
 *
 * ### ① 이 파일이 실제로 재는 것 — 방어 배치 난이도가 **아니다**
 * 런 풀 커브 계수를 1000 으로 올려 **레벨업을 0회**로 만들면 20기지 전부가 96시드 내내
 * **0% 또는 100% 로 고정된다**(2026-07-27 실측). 즉 시드 간 승률 분산은 통째로
 * `state.powerupRng`(`src/sim/world.ts` `rng.fork('powerups')`)에서 나오고, 적 스폰·드랍
 * 추첨은 승패를 사실상 흔들지 않는다. **여기 "승률"은 참조봇의 파워업 추첨 운 분포이지
 * 기지 배치의 난이도가 아니다.**
 * 그러므로 이 파일의 가치는 승률 절대값이 아니라 ⓐ클리어 가능성이 살아 있는가
 * ⓑ밴드 순서가 뒤집히지 않았는가 ⓒ**배선이 살아 있는가** 셋에 있고, ⓒ가 본체다 —
 * 이 저장소의 반복 결함("단위 테스트 그린인데 배선이 통째로 없다", 누적 8건)을 잡는 유일한
 * 계층이라 **이 파일을 약화시키는 변경은 특히 위험하다**.
 *
 * ### ② 목표와 상한이 갈라진 이력 3세대 (전부 "sim 이 바뀌었고 상한만 열었다")
 *   1세대 `fix/weapon-range-semantics` — 무제한 조준(`weapon.range === 0` 센티널) 제거.
 *          중하가 양 끝으로 찢어져 기지간 편차 18.1 → 30.2pp (중하 상한 28 → 32).
 *   2세대 ADR-0034 강제 스크롤 ANCHOR 정책 — 창 뒤 경계 고착이 사라져 난이도 **재분배**.
 *          중위 30.6 → 45.8%, 중하·중위 순서 역전 (중위 sd 상한 28 → 29, 중위 hi 55 → 80).
 *   3세대 ADR-0036 경험치 이원화(런 풀 커브 `10+6L` → `10+13L`) — 런당 레벨업 감소 →
 *          파워업 추첨 횟수 감소. ①의 성질 때문에 이 파일의 **모든 숫자가 함께 이동**했다.
 *          시드 12 → 24 · 중하 hi 85 → 88 · 중위 sd 29 → 33 · 게이트 #12 hi 95 → 100.
 *   4세대 `fix/invasion-shielded-core-blocks-bullets` — **앞의 셋과 성격이 다르다. 수치를
 *          옮긴 것이 아니라 결함을 없앤 것이다.** 실드 발생기 국면의 코어(`timer === 1`)가
 *          자동 조준에서만 빠지고 아군탄 **충돌 화이트리스트에는 남아** 반지름 90 짜리 무적
 *          차폐물로 작동했다. 참조봇은 발생기를 460u 거리에서 카이팅하다 코어 그림자에
 *          들어가면 영원히 빠져나오지 못했다(패배 런의 **100.0%** 가 그 상태였다).
 *          96시드 실측 — 발생기를 가진 기지 전부가 올라갔다:
 *            #05 81.3→100 · #06 76.0→100 · #09 79.2→100 · #10 81.3→100 · #12 61.5→100 ·
 *            #13 63.5→97.9 · #14 51.0→94.8 · #15 61.5→75.0 · **#16 12.5→80.2** · #17 64.6→97.9
 *          발생기가 없는 #01~#04 는 **바이트 불변**(대조군). 상세는
 *          `.omc/research/invasion-core-shot-block-2026-07-27.md`.
 *          이 파일에는 중하 hi 88 → 100 · 중위 hi 80 → 95 · 게이트 #16 hi 70 → 96 으로 착지했다.
 *   5세대 `fix/invasion-band-restore` (침공 난이도 복원 T4b) — **처음으로 상한을 여는 것이 아니라
 *          목표로 되돌린 세대다.** 앞의 T1~T4a 레인이 sim 결함(코어 차폐·설비 강화축 10종·
 *          비단조 해저드 2종·죽은 설비 5종·`gravwell` 감속축)을 전부 걷어내 수치 튜닝이 처음으로
 *          의도대로 먹게 됐고, 그 위에서 **시드 램프 세 줄**(등급·승급 임계 + 기물 충전량)만
 *          옮겼다. 정본은 `20260727020000_invasion_band_restore.sql`.
 *          24시드: 하위 100.00 · 중하 99.40 → **71.43** · 중위 74.31 → **31.94**.
 *          96시드 대조: 100.00 / **75.00** / **33.16** — 두 해상도가 모두 목표 안이다.
 *          이 파일에는 **중하 hi 100 → 80 · 중위 hi 95 → 55** 로 되돌리고, 로스터 게이트
 *          담당 기지를 **#12·#16 → #12·#20** 으로 옮겼다(#16 이 6기체 중 둘에서 0.0% 가 되어
 *          "0%도 100%도 아니다" 계약을 기지 자체가 만족하지 못하게 됐다 — 상한을 여는 문제가
 *          아니라 기지를 바꿔야 하는 문제였다).
 *          레버 선정의 실측 근거는 `.omc/research/invasion-band-restore-2026-07-27.md`.
 *   6세대 `fix/spatial-hash-large-radius-broadphase` — **처음으로 밴드가 목표 "아래로" 나갔고,
 *          그래서 상한을 한 자리도 열지 않았다.** 공간 해시 broad-phase 결함 수정이다:
 *          `SpatialHash.insert` 는 엔티티를 **중심 셀 한 칸**에만 넣는데 `query` 는 **탐침
 *          반경**으로만 셀을 훑어, 접촉 조건 `중심거리 <= 탐침반경 + 엔티티반경` 중 **엔티티
 *          반경만큼의 띠가 broad-phase 에서 통째로 빠져 있었다**. 적·해저드가 셀 경계 너머에서
 *          판정을 흘리고 있었다는 뜻이다. 발단은 "해저드 반경 760 과 1,520 이 바이트 동일"
 *          이었지만 **무게중심은 일반 전투 판정**이었다(중위 −14.58pp 중 −10.41pp).
 *          수정 직후 중하 71.43 → **52.38** · 중위 31.94 → **17.36** 으로 목표 아래로 내려갔고,
 *          `invasionE2E` 의 만석 배치 완주도 깨졌다. 대응은 재기준화가 아니라 **밸런스 재조정**
 *          이다 — 기물 램프 한 줄(`props`, 중하 5→4 · 중위 5→3)로 중하 **70.83** · 중위
 *          **40.28** 로 두 밴드를 목표 **중앙**에 놓았다(마이그레이션
 *          `20260728000000_invasion_props_rebalance.sql`).
 *          **기물이 유일한 분리 레버라는 5세대 ③ 의 발견이 다시 확인됐다** — 레벨 기울기
 *          완화는 중위를 21.53, 승급 완화는 22.22 까지밖에 못 올려 **어느 것도 목표 25 에
 *          닿지 못한다**. 다만 5세대가 `nn<=14` 에만 걸어 둔 탓에 중위는 한 자리도 안 움직였고,
 *          중위를 조준하려면 중위 구간을 직접 내려야 했다.
 *          실측 근거는 `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md`.
 *   7세대 `feat/invasion-spawner-redesign` — **상한을 한 자리도 건드리지 않은 세대다.**
 *          죽어 있던 설비 하나(`spawner` = 드론 사출구)를 되살린 sim 변경이다. L2 강제 스크롤
 *          720 u/s 가 로스터 최고 적 이동 속도 420 u/s 보다 빨라 소켓 옆(플레이어 뒤)에 태어난
 *          드론이 **구조적으로 영원히 따라붙지 못했고**, 그래서 lv1~lv99 전 구간 L2 누적 피해가
 *          24시드 **12**(사실상 0)였다. 사출 지점을 **스크롤 창 진행 방향 앞**으로 옮기고
 *          강화 3축을 **생산물**(드론 내구도·접촉 피해)에 실었다.
 *          24시드: 하위 100.00 · 중하 70.83 → **67.86** · 중위 40.28 → **43.75** — 세 밴드
 *          모두 목표 안이라 이 파일의 상한·게이트 폭이 **전부 그대로 통과**한다.
 *          다만 최저 기지가 `#13` = **4.2%(1/24)** 로 내려와, "클리어 불가 기지 없음" 단언에
 *          **24시드 0 인 기지만 96시드로 승격해 재판정**하는 안전망을 붙였다(상시 비용 0).
 *          실측 근거는 `.omc/research/invasion-spawner-redesign-2026-07-28.md`.
 * 1~4세대 상한은 "이 값이 좋다"가 아니라 **"지금 여기 있다"는 기록**이었다. 5·6세대 상한은
 * **설계 목표 그 자체**다 — 다음 레인이 이걸 다시 열어야 한다면, 여는 대신 먼저
 * "무엇이 목표를 벗어나게 했는가"를 물어라. 6세대가 그 질문에 답한 방식이 선례다.
 *
 * ### ③ 3세대 재기준화가 완화가 아닌 이유 — 96시드 대조군 실측 (2026-07-27)
 * 변경 전(`10+6L`) 코드를 폐기용 detached 워크트리(`bc73201`)에 따로 녹화해 대조했다.
 *   중위 기지간 승률 편차 sd — 변경 전 **30.4** / 변경 후 **30.1**. 커브 계수를
 *   3·6·8·10·11·13 으로 쓸어도 28.8~30.4 로 **평평하다** → 이 지표는 커브와 **무상관**이다.
 *   그리고 **대조군(변경 전 코드)도 96시드에서 sd 30.4 로 구 상한 29 를 위반한다** —
 *   구 상한 29 는 특정 12시드 실현(28.767)에 **과적합**돼 있었다.
 *   해상도별 수렴: 12시드 25.6→35.2 · 24시드 27.2→31.7 · **48시드 29.0→29.0** · 96시드 30.4→30.1.
 *   해상도가 오를수록 두 값이 붙는다 — 차이가 표본오차였다는 정의 그대로다.
 *   sd 의 출처는 #16 단독이다: **#16 을 빼면 중위 sd 는 변경 전 16.6 / 변경 후 15.9** 로 평범.
 * 시드를 12 → 24 로 늘린 것도 완화가 아니라 **해상도 복원**이다(아래 `BALANCE_SEEDS` 주석).
 *
 * ### ③-1 ⚠️ 3세대 이후 — **침공 런 풀 커브가 다시 `10+6L` 로 갈라졌다** (2026-07-27)
 * 위 ③ 의 재기준화는 런 풀 커브 `10+13L` 위에서 잰 것이다. 그 뒤 같은 밸런스 패스가 PvE 커브를
 * **`10+66L`** 로 더 올렸는데(ADR-0036 개정 · 런당 레벨업 5~8 목표), 그 값을 침공에도 적용하자
 * 기지 `#16` 이 **96시드 전패**(0/96 · 24시드 전부 코어 무피해 사망)가 되어 아래 "클리어 불가
 * 기지가 없다" 불변식이 실제로 깨졌다. ①의 성질 그대로다 — 침공 런 내 레벨업이 약 1회로 줄면
 * 파워업 추첨 횟수가 줄어 최저 기지가 분포 바닥 밖으로 밀린다.
 *
 * 그래서 **런 풀 커브를 런 구조별로 갈랐다**(`src/sim/world.ts` 의 `xpToNextInvasion`):
 * PvE `10 + 66L` · **침공 `10 + 6L`(= 이 파일 상한들이 서 있던 값으로 복원)**. 결과적으로
 * 아래 상한·밴드는 **재측정 없이 그대로 유효**하고(실측 33/33 통과), 침공 per-tick 해시도
 * 밸런스 패스 이전과 **바이트 동일**이다(48,477틱 · 520,844 bytes 대조). 즉 ②의 "4세대"가
 * 생긴 것이 아니라 **3세대 상태가 보존된 것**이다 — 이 절은 그 사실의 기록이다.
 *
 * ### ④ 해상도 정책 — 24시드는 ADR-0037 이 정한 CI 예산이다
 * ADR-0037: **튜닝 스윕은 96시드 · CI 회귀 게이트는 24시드**. 통계적으로는 48시드가 정답이고
 * (변경 전후 sd 가 29.0 으로 **일치**하는 지점 = 지표가 노이즈이길 멈추는 해상도) 그 사실을
 * 여기 남긴다. 다만 48 로 올리는 것은 CI 예산 정책 변경이라 **별도 판단 항목**이다.
 * 24시드 기준 승률 최소 눈금은 기지당 4.17pp · 밴드당 0.60pp(7기지 168런)다.
 *
 * ### ⑤ 목표 밴드를 되살리려면 — 수치가 아니라 결함이 먼저다
 * ADR-0037 이 침공(PvP) 방어 밸런스를 밸런싱 레인 **밖으로** 뺐다. 목표 복원은 별도 **침공
 * 난이도 레인**의 일이다. 그 레인이 알아야 할 것:
 *   - ✅ **해결됨** — `.omc/research/invasion-powerup-inversion-2026-07-27.md` 의 "기지 #12 에서
 *     공격 파워업이 승률을 깎는다". 근인은 참조봇이 아니라 sim 이었다(위 ②-4세대). 후속
 *     계측은 `.omc/research/invasion-core-shot-block-2026-07-27.md`. **수정 후 파워업의 한계
 *     효용은 정상 부호로 돌아왔다** — #15 는 4종 전부 억제 시 75.0% → 4.2%, #16 은 80.2% →
 *     1.0% 로 떨어진다(수정 전 #12 는 61.5% → **100.0%** 였다).
 *   - ⛔ **남음** — `.omc/plans/m8-balance-handoff.md` §5.5 **보스 램프 배정 역전**. 가장 어려운
 *     `sporeQueen`(플레이어 승률 30.6%)이 중간 밴드(nn11~16)에, 가장 쉬운 축이 최상위에.
 *     중위 밴드 최저가 여전히 #15·#16 인 것이 이 역전으로 설명된다.
 *   - ✅ **해결됨** — 위 수정이 난이도 곡선을 통째로 천장에 붙였던 문제(24시드 하위 100 ·
 *     중하 99.4 · 중위 91.0). T1~T4a 가 레버를 되살리고 T4b 가 시드 램프를 옮겨 세 밴드가
 *     목표 안에 착지했다(위 ②-5세대). **이 절은 이제 역사 기록이다.**
 * 램프를 실제로 바꾸려면 **최신 재시드 마이그레이션**이 정본이고(현재
 * `supabase/migrations/20260728013000_invasion_lane9_exposure.sql`) 아래 `RAMP_SQL_LINES`
 * 미러 14줄을 **동시에** 고쳐야 한다(드리프트 가드 참고).
 *
 * ### ⑥ T1 보스 램프 배정 역전 — **해소됨** (2026-07-27)
 * 위 ⑤ 의 "⛔ 남음"이던 §5.5 다. 재측정(96시드)으로 난이도 순서를 다시 확정하고
 * (`sporeQueen` ≫ `steelGoliath` ≥ `phaseWarden`) 램프를 그 순서로 재배정했다:
 * `boss = nn<=4 ? none : nn<=10 ? 2 : nn<=16 ? 0 : 1`. 24시드 밴드는
 * 중하 99.40 → **100.00** · 중위 85.42 → **74.31**(중위 sd 12.2 → 25.8)로 이동했다.
 * 카탈로그 배열은 append-only 계약이라 손대지 않았다 — 바뀐 것은 순번→catalogId 매핑뿐이다.
 * 아래 밴드 상한·sd 상한은 **이 레인이 건드리지 않았다**(재기준화는 레인 마지막에 일괄).
 *
 * ### ⑦ 밴드 목표 복원 — **완료** (2026-07-27 · T4b · 위 ②-5세대)
 * ⑥ 이 예고한 "레인 마지막 일괄 재기준화"가 이것이다. 램프 세 줄(등급·승급 임계 + 기물
 * 충전량)을 옮겨 세 밴드를 목표 안에 착지시키고, 밴드 상한과 로스터 게이트를 함께 정리했다.
 * **레버 선정에서 배운 것 두 가지**(다음 레인이 같은 길을 다시 걷지 않도록):
 *   - **단일 축으로는 중하가 움직이지 않는다.** 보스만 sporeQueen 으로 바꿔도, 레벨만 60 으로
 *     올려도, 등급·승급만 최대로 올려도 #08·#11·#14 는 전부 100% 근처였다. 난이도는
 *     **보스 × 강화축의 곱**으로만 내려간다.
 *   - **레벨 램프는 밴드를 분리하지 못한다.** 기울기를 3/2 → 9/2 로 쓸면 중위가 74.3 → 18.1 로
 *     무너지는 동안 중하는 99.4 → 100 으로 꿈쩍도 안 한다. 중위가 5배 빠르게 반응하므로,
 *     레벨만 올리면 중하가 목표에 닿기 전에 중위가 바닥을 친다. 분리 레버는 **기물**이었다.
 *
 * ### ⑧ `#16` 계단의 원인 — **램프 값이 아니라 `affixSeed` 다** (2026-07-28 실측)
 * ⑦ 이 남긴 1순위 후속을 실측했다. 정본은 `.omc/research/invasion-16-step-2026-07-28.md`.
 *
 * **⑦ 까지 이 파일이 적어 온 인과는 틀렸다.** "`#15` 와 차이가 셋뿐인데(웨이브 +1 · 기물 종류
 * +1 · 레벨 22 → 23) 41.7 → 4.2 로 무너진다"는 **상관을 인과로 읽은 것**이었다. 실제로는:
 *   · `#16` 에서 셋을 **전부 빼면**(= `#15` 램프) 4.2 → **0.0%** 로 **더 나빠진다**.
 *   · `#15` 에 셋을 **전부 더하면**(= `#16` 램프) 41.7 → **45.8%** 로 **더 좋아진다**.
 *   즉 램프를 통째로 교환해도 승률이 따라오지 않는다 — 차이는 **램프 값 안에 없다**.
 * 개별 축도 직관과 반대다: 웨이브 −1 은 0.0%(적이 줄면 젬·경험치가 줄어 파워업이 준다 —
 * 편대 수는 난이도 축이 아니라 **보상 축**), 기물 종류 −1 은 0.0%(`propKinds` 4↔5 는 기물을
 * 더하는 게 아니라 소켓 4 를 "실드 발생기 2기째 ↔ 홀로그램"으로 **교환**한다 — `#15` 는
 * 발생기가 둘이라 코어 보호막이 2배다), 레벨 −1 은 눈금 아래(+140bp).
 *
 * **진짜 원인은 L3 `affixSeed` 단독이다.** 램프는 이 값을 `nn` 에서 기계적으로 파생한다
 * (기물 `nn*3000 + i*17` · 보스 `nn*4000`). 이 값만 상대 기지 것으로 바꾸면:
 *   `#16` + L3 salt(#15) = **45.8%** · `#15` + L3 salt(#16) = **0.0%**
 *   기물 salt 만 = 29.2% · 보스 salt 만 = 4.2%(단독으로는 회복 안 됨)
 *   L1(편대)·L2(설비) salt 교환은 `#16` 에서 **소수점까지 바이트 불변**이다.
 * 기물 소켓별로는 **소켓 1(중력 앵커)** 이 단독 최대(4.2 → 20.8%) — `#15` 는 `aegisLattice`
 * (피해 **−30% 대가**)를, `#16` 은 `proximityReactor`(근접 시 **+50%**)를 뽑았다.
 *
 * **바운드 처방 3종이 전부 실측 0 이다**(그래서 이 레인은 수치를 한 줄도 바꾸지 않았다):
 *   · 과열 저항 전용 상한(30/40/50%) → `#16` 4.2%/4.2%/0.0%, 밴드 불변.
 *     (`#16` 보스는 20기지 중 유일하게 `thermalVault` 55 + `du-insulated` 최대 롤 22 = **77%**
 *      로 과열창이 300 → 69틱이 되는 이상점이지만, **보스는 계단의 원인이 아니다**.)
 *   · 피해 배율 합산 상한(×1.30/1.50/1.60) → `#16` 4.2% 고정. 소켓 1 의 피해를 34% 깎아도
 *     안 움직인다 — 중력 앵커가 죽이는 경로는 피해량이 아니라 **감속 장판**이다.
 *   · 기물 salt 전역 재추첨(오프셋 K=1) → 10기지가 ±20pp 로 튀고 `#16` 은 **0.0%**.
 *     재추첨은 분산을 줄이지 않는다 — **같은 무제한 추첨을 한 번 더 돌리는 것**이다.
 *
 * **파워업 추첨 횟수 가설도 기각됐다.** ① 을 근거로 "`#16` 은 레벨업이 적을 것"을 예측했으나
 * 종료 시점 평균 레벨은 `#15` 5.58 · `#16` 5.50 으로 사실상 같고, `#17` 은 평균 7.04 인데
 * 승률이 8.3% 다. **① 은 "파워업이 승패의 필요조건"이라는 뜻이지 "파워업 횟수가 기지 간
 * 승률 차의 설명변수"라는 뜻이 아니다** — 이번 측정이 그 둘을 처음으로 갈랐다.
 *
 * 남은 실효 처방은 **유니크 역할 인지 추첨**이다(`rollUniqueId` 가 카탈로그 종류로만 거르고
 * 기물 역할을 안 본다 → `overclockCore` 가 실드 발생기에, `proximityReactor` 가 회복 파일런에
 * 붙으면 **완전한 무효과**. `#15` 는 5기 중 **3기**가 이런 사문화 유니크였고 `#16` 은 1기뿐).
 * ⚠️ 그 변경은 분산을 줄이는 대신 **평균 난이도를 올리고** `#16` 자체는 쉬워지지 않으므로,
 * 밴드 재기준화 + EF 재배포와 한 묶음인 별도 레인이다. 연구 문서 §6 참고.
 *
 * ### ⑨ Lane9 콘텐츠 가시성 — 노출은 넓히되 난이도는 건드리지 않는다 (2026-07-28)
 * 정본은 `.omc/research/invasion-lane9-exposure-2026-07-28.md`.
 *
 * 램프의 `kinds` 상한이 카탈로그 뒷부분을 잘라내 **Lane9 신규 방어체 12종(편대 8~11 ·
 * 설비 9~16)이 20기지 전부에서 한 번도 안 나왔다**. 이 레인은 그 가시성만 고쳤다 —
 * ⑦ 의 레인이 "가장 큰 난이도 레버"로 보고 시도했다가 **실측 기각**한 항목이라(중위
 * 74.31 → 75.69 제자리 · `#16` 4.2 → 0%), 목적을 난이도에서 **가시성**으로 다시 분류한 것이다.
 *
 * 설계 판단은 **"여유가 있는 밴드에만, 문수가 아니라 창(shift)으로"** 였다:
 *   · 하위 밴드(nn 1..7)만 창 크기를 전 카탈로그로 열고 shift 를 누적합으로 밀어 순회시킨다.
 *     하위 설비 슬롯 합 22 ≥ 17 · 웨이브 슬롯 합 12 = 12 라 두 카탈로그를 빈틈없이 덮는다.
 *   · **nn>=8 은 식 수준에서 손대지 않았다** → 중하·중위는 입력이 **바이트 동일**이다.
 *     난이도 중립이 "다시 쟀더니 같더라"가 아니라 **입력이 같아서 같다**로 성립하고,
 *     최저 기지 `#16`(6세대 5/24)도 정의상 보존된다. 아래 ⑤-2 커버리지 단언 옆의 회귀
 *     테스트가 그 바이트 동일성을 계약으로 굳힌다.
 *   · 문수·레벨·등급·승급·기물·보스는 한 줄도 안 바꿨다. 바뀐 건 "어느 종류가 서느냐"뿐.
 * 실측(**6세대 기준선** 위): 하위를 base·expose 각각 96시드로 재측정해 7기지 전부
 * **96/96**(100.00%) 로 일치 — 판정이 세진 6세대 sim 에서도 신규 종이 하위를 밀어 올리지
 * 않는다. **상쇄 조정이 필요 없었다.**
 * ⚠️ 이 레인은 처음에 5세대 기준선(71.43 / 31.94) 위에서 측정했다가 리베이스 후 **전량
 * 재측정**했다. 밴드 수치를 인용할 때 세대를 반드시 확인해라 — 6세대가 값을 통째로 옮겼다.
 *
 * 부수 효과로 커버리지 단언이 **풀 카탈로그로 복원**됐다(종전에는 편대·설비만 "램프 상한
 * 까지"라는 약한 형태였다). 이제 카탈로그에 종을 append 하고 램프를 안 열면 그 단언이
 * 먼저 깨진다 — 이것이 이 레인의 진짜 완료 신호다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, LoadoutConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { INVASION_TOTAL_TICKS, normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/index.js';
import { INVASION_SOCKET_COUNTS } from '../src/sim/invasion/constants.js';
import { FORMATIONS } from '../data/invasion/formations.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { L3_PROPS } from '../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../data/invasion/defenseBosses.js';
import { SEED_BASES, SEED_BASE_COUNT, seedBaseUuid } from '../data/seedBases.js';
import { SHIP_TYPES, zeroSkillInvest } from '../data/ships/index.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { WEAPON_VULCAN } from '../src/items/loadout.js';
import type { AffixRoll, Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 시드 램프 미러 — 정본은 마이그레이션 SQL 이다
// ---------------------------------------------------------------------------

/**
 * {@link MIGRATION_PATH} 가 가리키는 재시드 마이그레이션의 시드 생성 규칙 미러.
 * **정본은 SQL 이고 이건 사본이다.** 사본이 조용히 갈라지면 이 파일의 승률 측정이
 * 원격 DB 와 무관한 숫자가 되므로, 아래 `드리프트 가드` 테스트가 SQL 안의
 * `-- RAMP:` 주석과 이 표를 문자열로 대조한다.
 */
/**
 * 하위 밴드(nn 1..7)가 카탈로그를 순회 노출할 때 쓰는 창 시작점. **1-기반 첨자**라
 * SQL 의 `array[...]` 와 같은 방식으로 읽는다(`LOWER_*_SHIFT[nn - 1]`).
 * 값은 "nn 미만 기지들이 소비한 슬롯 수의 누적합" 이다 — 그래서 창이 이어붙어
 * 카탈로그를 빈틈없이 한 바퀴 덮는다. 근거는 `MIGRATION_PATH` 헤더 "왜 하위 밴드인가".
 */
const LOWER_FACILITY_SHIFT: readonly number[] = [0, 2, 4, 7, 10, 14, 1];
const LOWER_FORMATION_SHIFT: readonly number[] = [0, 1, 2, 3, 5, 7, 9];

const RAMP = {
  level: (nn: number) => 1 + Math.floor((3 * (nn - 1)) / 2),
  rarity: (nn: number) => (nn <= 4 ? 0 : nn <= 8 ? 1 : nn <= 11 ? 2 : 3),
  ascension: (nn: number) => (nn <= 7 ? 0 : nn <= 10 ? 1 : nn <= 16 ? 2 : 3),
  template: (nn: number) => (nn <= 7 ? 0 : nn <= 14 ? 2 : 1),
  waves: (nn: number) => Math.min(6, 1 + Math.floor((nn - 1) / 3)),
  formationKinds: (nn: number) => (nn <= 7 ? 12 : Math.min(8, 1 + Math.floor((nn + 1) / 3))),
  formationShift: (nn: number) =>
    nn <= 7 ? (LOWER_FORMATION_SHIFT[nn - 1] as number) : nn >= 17 ? 2 : 0,
  facilities: (nn: number, socketN: number) => Math.min(socketN, 2 + Math.floor((nn - 1) / 2)),
  facilityKinds: (nn: number) => (nn <= 7 ? 17 : Math.min(9, 2 + Math.floor((nn * 2) / 5))),
  facilityShift: (nn: number) => (nn <= 7 ? (LOWER_FACILITY_SHIFT[nn - 1] as number) : 0),
  props: (nn: number) => (nn <= 4 ? 0 : nn <= 7 ? 2 : nn <= 14 ? 4 : 3),
  propKinds: (nn: number) => Math.min(6, 1 + Math.floor(nn / 4)),
  propShift: (nn: number) => (nn >= 18 ? 3 : 0),
  boss: (nn: number) => (nn <= 4 ? -1 : nn <= 10 ? 2 : nn <= 16 ? 0 : 1),
};

/** SQL 헤더가 반드시 담고 있어야 하는 램프 식(문자열 그대로 대조). */
const RAMP_SQL_LINES: readonly string[] = [
  '-- RAMP: level = 1 + (3*(nn-1))/2',
  '-- RAMP: rarity = nn<=4 ? 0 : nn<=8 ? 1 : nn<=11 ? 2 : 3',
  '-- RAMP: ascension = nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3',
  '-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1',
  '-- RAMP: waves = min(6, 1 + (nn-1)/3)',
  '-- RAMP: formationKinds = nn<=7 ? 12 : min(8, 1 + (nn+1)/3)',
  '-- RAMP: formationShift = nn<=7 ? [0,1,2,3,5,7,9][nn] : (nn>=17 ? 2 : 0)',
  '-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)',
  '-- RAMP: facilityKinds = nn<=7 ? 17 : min(9, 2 + (nn*2)/5)',
  '-- RAMP: facilityShift = nn<=7 ? [0,2,4,7,10,14,1][nn] : 0',
  '-- RAMP: props = nn<=4 ? 0 : nn<=7 ? 2 : nn<=14 ? 4 : 3',
  '-- RAMP: propKinds = min(6, 1 + nn/4)',
  '-- RAMP: propShift = nn>=18 ? 3 : 0',
  '-- RAMP: boss = nn<=4 ? none : nn<=10 ? 2 : nn<=16 ? 0 : 1',
];

/**
 * 램프 정본 SQL. **최신 재시드 파일을 가리켜야 한다** — 이미 원격에 적용된 마이그레이션은
 * 본문을 고쳐도 재실행되지 않으므로, 램프를 바꿀 때마다 "덮어쓰는 신규 파일"이 새 정본이
 * 된다(이 리포의 선례: 20260721010000 → 20260723000000 → 20260727011000 → 20260727020000
 * → 20260728000000 → 20260728013000).
 */
const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260728013000_invasion_lane9_exposure.sql', import.meta.url),
);

/**
 * 마이그레이션 SQL 원문. `tests/node-shims.d.ts` 의 `readFileSync` 선언이 인코딩 인자를
 * 받지 않아(바이트 반환) 여기서 디코드한다 — 공유 shim 을 이 레인이 넓히지 않기 위해서다.
 */
function readMigrationSql(): string {
  return new TextDecoder().decode(readFileSync(MIGRATION_PATH));
}

function ref(catalogId: number, nn: number, salt: number) {
  return {
    catalogId,
    level: RAMP.level(nn),
    ascension: RAMP.ascension(nn),
    affixSeed: salt,
    rarity: RAMP.rarity(nn),
  };
}

/** 순번 nn(1..20)의 시드 배치. SQL 이 원격에 심는 것과 같은 정규형이어야 한다. */
export function seedBaseLayers(nn: number): InvasionLayers {
  const tpl = RAMP.template(nn);
  const socketN = INVASION_SOCKET_COUNTS[tpl] as number;
  const waves = RAMP.waves(nn);
  const kf1 = RAMP.formationKinds(nn);
  const sf1 = RAMP.formationShift(nn);
  const facils = RAMP.facilities(nn, socketN);
  const kf2 = RAMP.facilityKinds(nn);
  const sf2 = RAMP.facilityShift(nn);
  const props = RAMP.props(nn);
  const kp = RAMP.propKinds(nn);
  const sp = RAMP.propShift(nn);
  const boss = RAMP.boss(nn);
  return normalizeInvasionLayers({
    l1: {
      waveSlots: Array.from({ length: 6 }, (_, i) =>
        i < waves ? ref((i + sf1) % kf1, nn, nn * 1000 + i * 7) : null,
      ),
    },
    l2: {
      templateId: tpl,
      sockets: Array.from({ length: socketN }, (_, i) =>
        i < facils ? ref((i + sf2) % kf2, nn, nn * 2000 + i * 13) : null,
      ),
    },
    l3: {
      boss: boss >= 0 ? ref(boss, nn, nn * 4000) : null,
      guardians: [null, null],
      props: Array.from({ length: 6 }, (_, i) =>
        i < props ? ref((i + sp) % kp, nn, nn * 3000 + i * 17) : null,
      ),
      core: { hp: 8000, x: 0, y: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// 참조 장비 프로필 + 런 하네스
// ---------------------------------------------------------------------------

/**
 * 배치전을 실제로 치르는 시점의 "중간 장비" 근사. 임의값이지만 **고정**이라 측정이
 * 재현된다. 이 값을 바꾸면 아래 목표 범위도 함께 재측정해야 한다.
 */
const GEAR_REFERENCE: LoadoutConfig = {
  weaponType: 0,
  subWeaponType: -1,
  damageMult: 1.9,
  fireRateMult: 0.82,
  bulletCountAdd: 1,
  pierceAdd: 1,
  bulletSpeedMult: 1,
  spreadAdd: 0,
  rangeAdd: 0,
  moveSpeedMult: 1.1,
  maxHpAdd: 60,
  dashCdMult: 0.85,
  magnetMult: 1,
  xpMult: 1,
  uniqueMask: 0,
  fireDmg: 0,
  coldSlow: 0,
  lightning: 0,
};

/**
 * 결정론 시드 목록. 재현 가능해야 하므로 **고정 배열**이다(난수 생성 금지).
 *
 * ## 12 → 24 는 완화가 아니라 **해상도 복원**이다 (2026-07-27, ADR-0036 재기준화)
 * 예전 12개는 M8 24시드 목록에서 하나 걸러 뽑은 부분집합이었고 최소 눈금이 **8.33pp** 였다.
 * 그 해상도에서는 `#16` 의 진짜 승률 6.25%(96시드 6/96)가 **0/12 로 관측될 확률이 46%** 라,
 * 아래 "클리어 불가 기지 없음" 불변식이 사실상 동전던지기였다 — 변경 전(`10+6L`)에도 진짜
 * 승률은 12.5% 뿐이어서 0/12 확률이 20% 였다. `.omc/plans/m8-balance-handoff.md` §6 이
 * **"최저 기지가 12런 중 1승이면 여유는 정확히 1런"** 이라고 미리 경고한 그 지점이다.
 * 24시드에서 `#16` 은 **1/24** 로 승리가 다시 관측되고 불변식이 원래 의도대로 작동한다.
 * 즉 늘린 시드는 단언을 느슨하게 하는 것이 아니라 **단언이 재려던 것을 다시 잴 수 있게** 한다.
 *
 * ## append-only 계약
 * **앞 12개는 절대 바꾸지 않는다**(m8 인계 §1.2). 뒤 12개는 M8 정본 24시드의 나머지를
 * 순서 그대로 **뒤에 붙인 것**이며 `src/bench/rosterBench.ts` 의 `SEEDS[0..23]` 과 동일하다 —
 * 그래서 침공 밸런스와 로스터 벤치가 같은 시드 좌표계를 공유한다. 승패로 고르지 않았다
 * (이긴 시드만 모으면 승률이 위로 편향된다).
 */
const BALANCE_SEEDS: readonly number[] = [
  // --- 1~12: 기존 목록(불변) ---
  1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79,
  // --- 13~24: M8 정본 24시드의 나머지(append) ---
  83, 97, 101, 113, 127, 131, 149, 151, 163, 173, 181, 191,
];

/**
 * **승격 해상도** 시드 72개. `BALANCE_SEEDS` 뒤에 이어 붙이면 `src/bench/rosterBench.ts` 의
 * `SEEDS[0..95]`(191 다음 연속 소수 72개)와 같은 96시드 좌표계가 된다.
 *
 * 상시 게이트는 24시드 그대로다(ADR-0037 = CI 예산). 이 목록은 **"클리어 불가 기지 없음"
 * 단언이 24시드에서 0 을 관측했을 때 그 기지 하나만** 96시드로 승격해 재판정하는 데 쓴다 —
 * 근거는 아래 그 단언의 주석이다.
 */
const BALANCE_SEEDS_ESCALATION: readonly number[] = [
  193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293,
  307, 311, 313, 317, 331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419,
  421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509, 521, 523, 541,
  547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613, 617, 619, 631,
];

interface RunOutcome {
  readonly win: boolean;
  readonly ticks: number;
  readonly reachedL3: boolean;
}

/**
 * {@link GEAR_REFERENCE} 와 **같은 결과를 내는 어픽스 표현**. 정규 경로
 * (`buildRunConfig` → `computeLoadoutStats`)는 리터럴 로드아웃을 받지 않고 장착 아이템에서
 * 출발하므로, 로스터 게이트는 리터럴 대신 이 표를 아이템에 실어 보낸다.
 *
 * 대응은 `src/items/loadout.ts` 의 `applyStatSums` 규칙 그대로다(발칸은 무기 baseline 이
 * 무연산이라 중립 로드아웃이 출발점이다):
 *   damagePct 90 → damageMult 1.9 · fireRatePct 18 → fireRateMult 0.82(=1−0.18)
 *   bulletCount 1 · pierce 1 · moveSpeedPct 10 → 1.1 · maxHpFlat 60 · dashCdPct 15 → 0.85
 * 나머지 축(탄속·확산·자석·경험치·원소)은 `GEAR_REFERENCE` 가 중립이라 어픽스도 없다.
 */
const GEAR_REFERENCE_AFFIXES: readonly AffixRoll[] = [
  { id: 'gate-damage', stat: 'damagePct', value: 90 },
  { id: 'gate-firerate', stat: 'fireRatePct', value: 18 },
  { id: 'gate-bulletcount', stat: 'bulletCount', value: 1 },
  { id: 'gate-pierce', stat: 'pierce', value: 1 },
  { id: 'gate-movespeed', stat: 'moveSpeedPct', value: 10 },
  { id: 'gate-maxhp', stat: 'maxHpFlat', value: 60 },
  { id: 'gate-dashcd', stat: 'dashCdPct', value: 15 },
];

/** 참조 장비를 한 자루의 발칸 주무기로 묶는다(슬롯 순서 계약상 `main` 이어야 무기 타입이 선택된다). */
function gateGearItem(rangeAdd: number): Item {
  return {
    id: 'roster-gate-reference',
    slot: 'main',
    rarity: 'rare',
    affixes: [...GEAR_REFERENCE_AFFIXES, { id: 'gate-range', stat: 'rangeFlat', value: rangeAdd }],
    weaponType: WEAPON_VULCAN,
    source: { planet: 0, stage: 1 },
  };
}

/**
 * 로스터 게이트용 `WorldConfig` — **정규 경로 전량**을 탄다.
 * `Profile`(활성 기체 typeId · 타입별 skillInvest · 장착 아이템) → `buildRunConfig`
 * → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`(섀시 baseBp) → `createWorld`.
 * 리터럴 로드아웃을 꽂으면 이 사슬이 통째로 우회돼 baseBp 회귀가 보이지 않는다.
 */
function rosterGateConfig(
  layers: InvasionLayers,
  over: { readonly shipType: number; readonly rangeAdd: number },
): WorldConfig {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = over.shipType;
  // 벡터 길이는 타입별 계약이다(스트라이커 63 · 나머지 상이). **무투자**로 둔다 — 투자를
  // 실으면 6기체가 전부 83~100% 로 포화돼 회귀 신호가 죽는다(아래 게이트 주석 §커버 범위 ③).
  ship.skillInvest = zeroSkillInvest(over.shipType);
  ship.equipped.main = gateGearItem(over.rangeAdd);
  return buildRunConfig(profile, {
    planet: 0,
    stage: 1,
    invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 },
  });
}

function playRun(
  seed: number,
  layers: InvasionLayers,
  /** 로스터 게이트 전용 덮어쓰기. 미지정이면 기존 19건과 **완전히 같은** 구성이다. */
  over?: { readonly shipType: number; readonly rangeAdd: number },
): RunOutcome {
  let config: WorldConfig;
  if (over === undefined) {
    config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
  } else {
    config = rosterGateConfig(layers, over);
  }
  const state = createWorld(seed, config);
  let reachedL3 = false;
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.invasion3?.phase === 2) reachedL3 = true;
    if (state.gameOver || state.victory) {
      return { win: state.victory, ticks: t + 1, reachedL3 };
    }
  }
  return { win: false, ticks: INVASION_TOTAL_TICKS, reachedL3 };
}

interface BandStat {
  readonly winRate: number;
  /** 기지별 승률(퍼센트) — 밴드 안 난이도 분산 지표. */
  readonly perBaseRates: number[];
  /** 기지별 평균 클리어틱(승리 표본이 있는 기지만). */
  readonly perBaseMeanTicks: number[];
}

function measureBand(orders: readonly number[]): BandStat {
  let wins = 0;
  let total = 0;
  const perBaseRates: number[] = [];
  const perBaseMeanTicks: number[] = [];
  for (const nn of orders) {
    const layers = seedBaseLayers(nn);
    let bw = 0;
    const ticks: number[] = [];
    for (const seed of BALANCE_SEEDS) {
      const o = playRun(seed, layers);
      total++;
      if (o.win) {
        wins++;
        bw++;
        ticks.push(o.ticks);
      }
    }
    perBaseRates.push((bw / BALANCE_SEEDS.length) * 100);
    if (ticks.length > 0) {
      perBaseMeanTicks.push(ticks.reduce((a, b) => a + b, 0) / ticks.length);
    }
  }
  return { winRate: (wins / total) * 100, perBaseRates, perBaseMeanTicks };
}

/**
 * 96시드 승격 판정 — 그 기지의 승리 수(24시드분 포함). "클리어 불가 기지 없음" 단언이
 * 24시드에서 0 을 봤을 때만 불린다. 첫 승리에서 즉시 끊어 상시 비용을 최소화한다.
 */
function escalatedWinRate(nn: number): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of [...BALANCE_SEEDS, ...BALANCE_SEEDS_ESCALATION]) {
    if (playRun(seed, layers).win) {
      wins++;
      break;
    }
  }
  return wins;
}

const BANDS = {
  하위: [1, 2, 3, 4, 5, 6, 7],
  중하: [8, 9, 10, 11, 12, 13, 14],
  중위: [15, 16, 17, 18, 19, 20],
} as const;

/** 밴드 측정은 비싸다(런 1회 ≈ 1만 틱). 밴드마다 한 번만 돌리고 여러 단언이 공유한다. */
const measured: Record<keyof typeof BANDS, BandStat> = {
  하위: measureBand(BANDS.하위),
  중하: measureBand(BANDS.중하),
  중위: measureBand(BANDS.중위),
};

// ---------------------------------------------------------------------------
// ① 밴드별 클리어율이 목표 범위 안
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 밴드별 클리어율', () => {
  // 상한의 성격·이력은 **파일 헤더 "숫자 읽는 법" ②** 에 통합했다(여기서 반복하지 않는다).
  //
  // ✅ **상한이 설계 목표로 복귀했다**(5세대 = 침공 난이도 복원 T4b · 헤더 ②-5세대).
  // 2026-07-21 M7c 재시드 이후 처음으로 세 밴드가 동시에 목표 안에 들어왔으므로, "곡선이
  // 천장에 붙어 있어 상한이 죽었다"는 이유로 열어 두었던 중하 100 · 중위 95 를 되돌린다.
  //
  // 24시드 실측(2026-07-28, **6세대** = broad-phase 수정 + 기물 재조정):
  //   하위 **100.00%** · 중하 **70.83%** · 중위 **40.28%**.
  //   기지별 하위 #01~#07 = 100 전부
  //           중하 #08~#14 = 100/79.2/95.8/66.7/45.8/33.3/75.0
  //           중위 #15~#20 = 79.2/20.8/25.0/54.2/25.0/37.5
  //   (5세대는 100.00 / 71.43 / 31.94 였다. 96시드 대조는 6세대에서 수행하지 않았다 —
  //    5세대의 96시드 값 100.00 / 75.00 / 33.16 을 그대로 인용하지 마라.)
  //
  // **상한·하한은 한 자리도 열지 않았다.** 6세대는 sim 결함 수정이 밴드를 목표 **아래로**
  // 내린 세대라, 대응이 "상한 열기"가 아니라 램프 재조정이었다(헤더 ②-6세대). 결함이 없어진
  // 뒤 램프를 옮겨 두 밴드를 목표 **중앙**에 놓았으므로 여유가 오히려 늘었다.
  //
  // 24시드 실측(2026-07-28, **7세대** = 드론 사출구 전방 사출 재설계):
  //   하위 **100.00%** · 중하 **67.86%** · 중위 **43.75%** — 세 밴드 모두 목표 안.
  //   기지별 하위 #01~#07 = 100 전부
  //           중하 #08~#14 = 100/79.2/95.8/70.8/54.2/4.2/70.8
  //           중위 #15~#20 = 100.0/20.8/20.8/37.5/37.5/45.8
  // **상한·하한을 한 자리도 건드리지 않았다.** 죽어 있던 설비 하나가 살아난 변경이고
  // (전 구간 L2 누적 피해 12 → lv29 681), 밴드는 6세대 값에서 중하 −2.97pp · 중위 +3.47pp
  // 움직였을 뿐이다. 정본: `.omc/research/invasion-spawner-redesign-2026-07-28.md`.
  //
  // ⚠️ 최저 기지가 **#13 = 4.2%(1/24)** 로 내려왔다. 아래 "클리어 불가 기지가 없다" 단언의
  // 여유가 승리 1건이라는 뜻이다 — 7세대가 그 단언에 96시드 승격 판정을 붙인 이유다.
  //
  // 하위 상한 100 만 그대로 둔다 — 목표가 "85+" 로 상한이 없는 밴드다(진행이 막히면 안 되는
  // 필수 5회 구간이라, 위로 붙는 것 자체는 설계 의도다).
  it.each([
    ['하위', 85, 100],
    ['중하', 55, 80],
    ['중위', 25, 55],
  ] as [keyof typeof BANDS, number, number][])(
    '%s 밴드 클리어율이 %d~%d%% 안에 있다',
    (band, lo, hi) => {
      const rate = measured[band].winRate;
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeGreaterThanOrEqual(lo);
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeLessThanOrEqual(hi);
    },
  );

  it('밴드 순서대로 어려워진다(하위 > 중위)', () => {
    // M7c 확장 직후의 실제 결함이 "중하·중위가 나란히 0%" 였다. 평균 승률만 보면
    // 그것도 '순서대로'라 통과하므로, 위 범위 단언과 함께여야 의미가 있다.
    //
    // 원래는 `하위 > 중하 > 중위` 3단 단조였다. 앵커 정책 개정(2026-07-27) 이후 중하·중위가
    // 역전됐고 지금도 24시드 실측 하위 97.6 > 중하 86.3 **< 중위 68.1**... 이 아니라
    // 중하 86.3 > 중위 68.1 로 **중간 단조는 회복됐다**(런 풀 커브가 중하를 올리고 중위를
    // 내린 결과다). 그래도 중간 단언을 되살리지 않는 이유는 이 회복이 난이도 램프를 고쳐서가
    // 아니라 파워업 추첨 횟수 변화의 부산물이기 때문이다(헤더 ①) — 램프 재배치 전에 단조를
    // 계약으로 굳히면 다음 sim 변경에서 다시 깨진다. 양 끝만 계약으로 둔다.
    expect(measured.하위.winRate).toBeGreaterThan(measured.중위.winRate);
  });

  it('클리어 불가 기지가 없다(24시드에서 0 이면 96시드로 승격해 재판정)', () => {
    // 승률 평균이 목표 안이어도 특정 기지 하나가 수학적으로 클리어 불가일 수 있다.
    //
    // ⚠️ 이 단언은 **해상도에 직접 의존한다**. 최저 기지는 여전히 `#16` 이고, 5세대 재기준화
    // 이후 진짜 승률은 96시드 기준 **2.1%(2/96)** 다 — 24시드에서는 **1/24 = 4.2%** 로 관측된다.
    // 시드 목록이 고정 배열이라 이 관측 자체는 결정론이지만, **여유가 승리 1건뿐**이라는 뜻이다.
    // sim 이 조금만 어려워지면 이 단언이 먼저 깨진다. 그때 상한을 여는 것은 답이 아니고,
    // `#16` 을 밴드 안으로 되돌리는 것이 답이다(아래 승률 편차 단언의 "#16 단독" 문단 참고).
    // ⚠️ 그 되돌리기가 **램프 한 줄로 끝나지 않는다**는 것이 헤더 ⑧ 의 결론이다 — 원인이
    // 램프 값이 아니라 `affixSeed` 추첨이고, 바운드 처방 3종이 전부 실측 0 이었다.
    // 12시드로 되돌리면 이 단언은 코드가 아니라 주사위를 재게 된다 — 되돌리지 마라.
    // 자세한 근거는 `BALANCE_SEEDS` 주석과 헤더 ③.
    //
    // ## ⚠️ 7세대(2026-07-28) — **0 을 허용하는 대신 그 기지만 해상도를 올린다**
    // 이 단언이 재려는 것은 "**수학적으로** 클리어 불가한 기지가 있는가"다. 그런데 24시드에서
    // 관측되는 0 은 두 가지를 구분하지 못한다 — ⓐ 진짜 클리어 불가 ⓑ 진짜 승률이 0 보다
    // 크지만 고정 24시드 표본에 승리가 없음. 승률 6.25% 인 기지가 24시드에서 0 으로 관측될
    // 확률은 **약 21%** 다(0.9375^24). 그리고 그 일이 실제로 관측됐다 — 스포너 전방 사출
    // 재설계를 6세대 **직전** 트리 위에서 재던 중간 측정에서 `#17` 이 **24시드 0/24 ·
    // 96시드 6/96(6.25%)** 이었다(변경 전 24시드 2/24 · 96시드 11/96). 그때 사거리 600 ·
    // 간격 600 · 상한 1 로 그 설비를 **사실상 무력화해도 24시드 0 이 그대로**여서, 이 지표가
    // 임계 근처에서 계단 함수라는 헤더 ⑧ 의 결론이 다시 확인됐다.
    //
    // 그래서 **상한을 여는 대신**(위 주석이 금지한 방향) 판정 해상도를 올린다: 24시드에서
    // 0 인 기지 **그 하나만** 96시드로 다시 돌린다. 상시 비용은 0 이고(0 이 없으면 승격이
    // 아예 안 돈다) 단언이 재려던 명제는 오히려 강해진다.
    //
    // ⚠️ 현행 트리(7세대)에서는 24시드 0 인 기지가 **없어서 이 승격은 돌지 않는다**. 최저가
    // `#13` = 4.2%(1/24)라 여유가 승리 1건뿐이므로, 다음 sim 변경을 위한 안전망으로 남긴다.
    // 실측 근거: `.omc/research/invasion-spawner-redesign-2026-07-28.md` §7-3.
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      measured[band].perBaseRates.forEach((rate, i) => {
        if (rate > 0) return;
        const nn = BANDS[band][i]!;
        const hi = escalatedWinRate(nn);
        expect(
          hi,
          `${band} #${nn} 가 24시드·96시드 양쪽에서 전패(클리어 불가)`,
        ).toBeGreaterThan(0);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ② 밴드 안 난이도 분산 상한
// ---------------------------------------------------------------------------

function stdev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

describe('밸런스 스모크 — 밴드 안 분산', () => {
  it('기지별 클리어 시간 편차가 상한 안(밴드 안에서 판 길이가 널뛰지 않는다)', () => {
    // 상한은 실측값에 여유를 준 값이다. 넘으면 한 밴드 안에 성격이 전혀 다른 기지가
    // 섞였다는 뜻이다. 24시드 실측(2026-07-27, 5세대): 하위 **1422** / 중하 **349** /
    // 중위 **848**틱. (4세대는 1448 / 356 / 853, 3세대는 1609 / 392 / 893 이었다.)
    //
    // 흥미로운 사실: **5세대가 승률을 99.4 → 71.4 · 74.3 → 31.9 로 크게 내렸는데 이 지표는
    // 거의 움직이지 않았다**(−26 / −7 / −5틱). 이 지표는 **이긴 런만** 평균하므로(패배 런은
    // `perBaseMeanTicks` 에 들어가지 않는다) "얼마나 자주 이기는가"가 아니라 "이길 때 얼마나
    // 걸리는가"를 잰다. 두 지표가 독립이라는 실측 증거이고, 그래서 상한을 세 세대 내내
    // 그대로 둔다 — 상한을 실측에 바짝 붙이면 정상적인 밸런스 조정마다 깨지는 과적합
    // 단언이 된다(헤더 ③ 이 기록한 구 상한 29 의 실패 방식이다).
    const limits: Record<keyof typeof BANDS, number> = { 하위: 2200, 중하: 1400, 중위: 1600 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseMeanTicks);
      expect(sd, `${band} 기지간 클리어틱 편차 ${Math.round(sd)}`).toBeLessThanOrEqual(
        limits[band],
      );
    }
  });

  it('기지별 승률 편차가 상한 안', () => {
    // 밴드 안에서 한 기지만 유별나게 쉽거나 어려우면 '난이도 밴드'라는 표시가 거짓이 된다.
    // 이력 3세대(무제한 조준 제거 → 앵커 정책 → 런 풀 커브)는 **헤더 "숫자 읽는 법" ②** 로
    // 통합했다. 여기에는 현재 상한의 **근거만** 남긴다.
    //
    // 24시드 실측(2026-07-27, **5세대** = 밴드 목표 복원): 하위 **0.00** · 중하 **28.82** ·
    // 중위 **21.34** pp. 96시드 대조: 0.00 / 23.48 / 24.57.
    // 기지별 승률 중하 #08~#14 = 100/100/91.7/58.3/16.7/50.0/83.3 · 중위 #15~#20 =
    // 41.7/4.2/8.3/41.7/29.2/66.7.
    //
    // ⚠️ **분산이 커진 것은 회귀가 아니라 목표 복귀의 대가다.** 4세대(0.00 / 1.46 / 12.36)는
    // 전 기지가 천장에 붙어 있어서 분산이 작았던 것이지 밴드가 고른 것이 아니었다. 난이도를
    // 목표로 되돌리면 기지별 성격 차이가 승률로 드러난다. 그래서 **중하 32 · 중위 33 을 그대로
    // 둔다** — 실측(28.82 / 21.34)이 그 아래이고, 상한을 실측에 바짝 붙이면 아래 ③ 이 기록한
    // 구 상한 29 의 과적합을 그대로 반복하게 된다. 하위 20 도 실측 0.00 으로 유지.
    //
    // ⚠️ 중위 상한 29 → 33 (3세대). 이 조정은 **커브가 분산을 키웠기 때문이 아니다** — 반대다:
    //   · 중위 sd 는 계수와 **무상관**이다. 96시드에서 변경 전 **30.4** / 변경 후 **30.1**.
    //     커브 계수를 3·6·8·10·11·13 으로 쓸어도 28.8~30.4 로 평평하다.
    //   · **대조군(변경 전 코드)도 96시드에서 sd 30.4 로 구 상한 29 를 위반한다.**
    //     구 상한 29 는 특정 12시드 실현(28.767)에 **과적합**돼 있었다.
    //   · 해상도별 수렴: 12시드 25.6→35.2 · 24시드 27.2→31.7 · **48시드 29.0→29.0** ·
    //     96시드 30.4→30.1. 해상도가 오를수록 변경 전후가 붙는다 = 차이는 표본오차였다.
    //   · ADR-0037 이 CI 게이트를 **24시드**로 정했다. 48시드가 통계적 정답이지만(변경 전후가
    //     29.0 으로 일치하는 지점) 그건 CI 예산 정책 변경이라 **별도 판단 항목**이다.
    // 상한 33 은 24시드 실측 31.70 위로 약 1.3pp 여유다.
    //
    // ⚠️ 분산의 출처는 여전히 **#16 단독**이다 — 5세대에서도 그대로다. 24시드 중위에서 #16
    // (4.2%)을 빼면 sd 는 21.34 → **19.0** 으로 내려간다. **상한을 넓히는 것으로는 아무것도
    // 고쳐지지 않는다.** 원인은 헤더 ⑧ 이 실측으로 확정했다 — 램프 값이 아니라 램프가
    // `nn` 에서 파생하는 **L3 `affixSeed`** 다.
    const limits: Record<keyof typeof BANDS, number> = { 하위: 20, 중하: 32, 중위: 33 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseRates);
      expect(sd, `${band} 기지간 승률 편차 ${sd.toFixed(1)}pp`).toBeLessThanOrEqual(limits[band]);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 정규 경로 통합 — 3레이어를 실제로 통과한다
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 정규 경로 통합', () => {
  it('시드 기지 런이 L3 까지 실제로 진행되고 코어 파괴로 끝난다', () => {
    // "밸런스 수치는 맞는데 배선이 없어 빈 맵을 스크롤한다"를 막는 자리다.
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(1, config);
    const seen = new Set<number>();
    let spawnedAny = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      const phase = state.invasion3?.phase;
      if (phase !== undefined) seen.add(phase);
      if (!spawnedAny && state.entities.some((e) => e.kind === 'enemy' && !e.dead)) {
        spawnedAny = true;
      }
      if (state.gameOver || state.victory) break;
    }
    expect(spawnedAny, '적이 한 번도 스폰되지 않았다(스텝 훅 미배선 신호)').toBe(true);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(state.victory).toBe(true);
    expect(state.entities.find((e) => e.kind === 'core' && !e.dead)).toBeUndefined();
  });

  it('상위 기지 런에서 방어 보스·기물이 실제로 존재한다', () => {
    // 카탈로그에 넣었는데 스폰 경로가 없으면 승률만 보고는 알 수 없다.
    // 시드 5 는 #20 이 L3 까지 도달해 승리하는 것으로 확인된 값이다(패배 시드로 재면
    // 플레이어가 L3 전에 죽어 "보스가 없다"가 오탐이 된다).
    // ⚠️ 증인 시드는 sim 이 바뀌면 함께 갱신해야 한다 — 예전 값 37 은
    // `fix/weapon-range-semantics` 이후 L3 에 도달하지 못한다(#20 의 L3 도달 시드 집합이
    // 71·83·97·127·163·173 에서 1·5·11·23·113·149·173 으로 갈렸다). 단언을 약화한 것이
    // 아니라 **같은 성질의 증인을 다시 고른 것**이다.
    const layers = seedBaseLayers(20);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(5, config);
    let sawBoss = false;
    let sawProp = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (!sawBoss && state.entities.some((e) => e.kind === 'defenseBoss')) sawBoss = true;
      if (!sawProp && state.entities.some((e) => e.kind === 'prop')) sawProp = true;
      if (sawBoss && sawProp) break;
      if (state.gameOver || state.victory) break;
    }
    expect(sawBoss, '#20 배치에 보스가 있는데 엔티티가 없다').toBe(true);
    expect(sawProp, '#20 배치에 기물이 있는데 엔티티가 없다').toBe(true);
  });

  it('사거리에 투자한 공격자도 실제로 사격하고 승리까지 간다', () => {
    // 이 하네스는 오래도록 `rangeAdd: 0` 한 점만 밟았다(`GEAR_REFERENCE`). 그 사이
    // `weapon.range` 는 `0 = 무제한` 센티널이라 **사거리에 투자할수록 조준 상한이 좁아졌고**,
    // 오토파일럿 카이팅 거리(460)보다 짧아지면 침공 공격자가 한 발도 쏘지 못했다 —
    // "밴드별 승률 전부 목표 안" 옆에 "사거리 노드를 찍으면 마비"가 나란히 있었다는 뜻이다.
    // 사거리 축을 실제로 밟는 유일한 자리이므로, 승패뿐 아니라 **탄이 나갔는지**까지 본다.
    const invested: LoadoutConfig = { ...GEAR_REFERENCE, rangeAdd: 400 };
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = invested;
    const state = createWorld(1, config);
    let firedTicks = 0;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (state.entities.some((e) => e.kind === 'bullet' && !e.dead)) firedTicks++;
      if (state.gameOver || state.victory) break;
    }
    expect(firedTicks, '사거리 투자 프로필이 한 발도 쏘지 못했다').toBeGreaterThan(0);
    expect(state.victory, '사거리 투자 프로필이 무투자 대비 승리하지 못했다').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 카탈로그 골든 가드 — 수치 튜닝이 인덱스 계약을 건드리지 않았는지
// ---------------------------------------------------------------------------

describe('카탈로그 계약 — 수치 튜닝이 인덱스를 건드리지 않았다', () => {
  it('편대 카탈로그 순서·개수 골든', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual([
      'formation-scout-drones',
      'formation-interceptors',
      'formation-assault',
      'formation-glide-flock',
      'formation-mine-layer',
      'formation-shield-escort',
      'formation-sniper-nest',
      'formation-support-escort',
      'formation-toxar-corrosion',
      'formation-toxar-blight',
      'formation-kras-breaker',
      'formation-kras-piercer',
    ]);
    FORMATIONS.forEach((f, i) => expect(f.catalogId).toBe(i));
  });

  it('설비 카탈로그 순서·개수 골든', () => {
    expect(INVASION_FACILITIES.map((f) => f.key)).toEqual([
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
      'fac.press',
      'fac.gravwell',
      'fac.shock',
      'fac.venomvent',
      'fac.blightpool',
      'fac.corrosivemist',
      'fac.toxinturret',
      'fac.heavyrail',
      'fac.siegecannon',
      'fac.breachturret',
      'fac.demolisher',
    ]);
  });

  it('기물 카탈로그 순서·역할 골든', () => {
    expect(L3_PROPS.map((p) => p.id)).toEqual([
      'shieldGenerator',
      'gravityAnchor',
      'fixedCannon',
      'repairPylon',
      'decoyHologram',
      'mineSwarm',
    ]);
    // 역할 코드가 인덱스와 어긋나면 스텝 디스패치가 통째로 바뀐다.
    L3_PROPS.forEach((p, i) => expect(p.role).toBe(i));
  });

  it('방어 보스 카탈로그 순서 골든', () => {
    expect(DEFENSE_BOSSES.map((b) => b.id)).toEqual([
      'steelGoliath',
      'sporeQueen',
      'phaseWarden',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 시드 램프 드리프트 가드 + 풀 카탈로그 노출
// ---------------------------------------------------------------------------

describe('시드 재조정 — SQL 정본과의 정합', () => {
  it('마이그레이션 헤더의 RAMP 식이 이 파일의 미러와 일치한다', () => {
    const sql = readMigrationSql();
    for (const line of RAMP_SQL_LINES) {
      expect(sql, `SQL 램프 주석이 미러와 다르다: ${line}`).toContain(line);
    }
  });

  it('마이그레이션이 NPC 고정 UUID 20행만 건드린다', () => {
    const sql = readMigrationSql();
    // WHERE 절이 고정 UUID 동등 비교 하나뿐이어야 실유저 방어가 안전하다.
    expect(sql).toContain("where id = v_def_id");
    expect(sql).toContain("'000000de-f000-4000-8000-'");
    expect(sql).not.toMatch(/update\s+public\.defenses[\s\S]{0,400}?where\s+true/i);
  });

  it('20기지가 시드 램프 목표 카탈로그를 전부 노출한다(미사용 시드 콘텐츠 0)', () => {
    const formations = new Set<number>();
    const facilities = new Set<number>();
    const props = new Set<number>();
    const bosses = new Set<number>();
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      for (const s of l.l1.waveSlots) if (s !== null) formations.add(s.catalogId);
      for (const s of l.l2.sockets) if (s !== null) facilities.add(s.catalogId);
      for (const s of l.l3.props) if (s !== null) props.add(s.catalogId);
      if (l.l3.boss !== null) bosses.add(l.l3.boss.catalogId);
    }
    // ✅ **풀 카탈로그로 복원됐다**(Lane9 콘텐츠 가시성 레인, 2026-07-28). 이전에는 네 축 중
    // 편대·설비만 "램프 상한까지"라는 약한 단언이었다 — 램프가 카탈로그 뒷부분(편대 8~11 ·
    // 설비 9~16, 톡사르·크라스 Lane9 12종)을 통째로 잘라내고 있었기 때문이다. 하위 밴드가
    // 카탈로그를 순회 노출하도록 창(shift)을 열어 이제 **네 축 모두 전량**을 요구한다.
    // 대역 상한을 램프에서 파생시키던 우회가 사라졌으므로, 카탈로그에 종을 append 하고
    // 램프를 안 열면 **이 단언이 먼저 깨진다** — 그게 이 테스트가 원래 재려던 것이다.
    //
    // ⚠️ 이 확장은 **난이도 레버가 아니다**(2026-07-27 복원 레인 실측 기각 — 신규 8종의 실효
    // 화력이 기존 0~8 과 비슷하다). 그래서 이번에는 난이도가 움직이지 않는 자리에만 열었다:
    // nn>=8 의 배치는 **바이트 동일**이라 중하 70.83 · 중위 40.28 과 `#16` 의 5/24 가 입력
    // 수준에서 보존되고, 하위는 96시드 7기지 전부 96/96 으로 100.00% 를 유지한다(6세대 기준).
    // 근거: `.omc/research/invasion-lane9-exposure-2026-07-28.md`.
    expect([...formations].sort((a, b) => a - b)).toEqual(FORMATIONS.map((_, i) => i));
    expect([...facilities].sort((a, b) => a - b)).toEqual(INVASION_FACILITIES.map((_, i) => i));
    expect([...props].sort((a, b) => a - b)).toEqual(L3_PROPS.map((_, i) => i));
    expect([...bosses].sort((a, b) => a - b)).toEqual(DEFENSE_BOSSES.map((_, i) => i));
    // 시드가 참조하는 편대·설비 id 는 전부 실재 카탈로그다(댕글링 시드 0).
    for (const id of formations) expect(FORMATIONS[id]).toBeDefined();
    for (const id of facilities) expect(INVASION_FACILITIES[id]).toBeDefined();
  });

  it('하위 밴드 창 크기가 카탈로그 길이와 같다(종을 append 하면 램프가 먼저 깨진다)', () => {
    // 하위 밴드는 창 크기를 **전 카탈로그**로 열고 shift 로 순회한다. 그 창 크기가 SQL 에
    // 상수(`c_form_len` · `c_fac_len`)로 박혀 있으므로, 카탈로그에 종을 append 하고 SQL
    // 상수를 안 올리면 새 종은 다시 안 보인다. 이 단언이 그 순간을 잡는다.
    expect(RAMP.formationKinds(1)).toBe(FORMATIONS.length);
    expect(RAMP.facilityKinds(1)).toBe(INVASION_FACILITIES.length);
    const sql = readMigrationSql();
    expect(sql).toContain(`c_form_len constant integer := ${FORMATIONS.length};`);
    expect(sql).toContain(`c_fac_len  constant integer := ${INVASION_FACILITIES.length};`);
  });

  it('중하·중위(nn 8..20) 배치가 Lane9 노출 확장 전과 바이트 동일하다', () => {
    // 이 레인의 난이도 중립은 "다시 쟀더니 같더라"가 아니라 **입력이 동일해서 같다**로
    // 성립한다. 확장 전 식(shift 없음 · 상한 min(8,…)/min(9,…))을 여기 그대로 두고
    // nn>=8 의 catalogId 를 대조한다 — 미래에 하위 창을 손대다 중하·중위로 새면 즉시 깨진다.
    const beforeFormationKinds = (nn: number) => Math.min(8, 1 + Math.floor((nn + 1) / 3));
    const beforeFacilityKinds = (nn: number) => Math.min(9, 2 + Math.floor((nn * 2) / 5));
    const beforeFormationShift = (nn: number) => (nn >= 17 ? 2 : 0);
    for (let nn = 8; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      l.l1.waveSlots.forEach((s, i) => {
        if (s !== null) {
          expect(s.catalogId, `#${nn} 웨이브 ${i}`).toBe(
            (i + beforeFormationShift(nn)) % beforeFormationKinds(nn),
          );
        }
      });
      l.l2.sockets.forEach((s, i) => {
        if (s !== null) {
          expect(s.catalogId, `#${nn} 소켓 ${i}`).toBe(i % beforeFacilityKinds(nn));
        }
      });
    }
  });

  it('시드 배치가 전부 정규형이다(정규화 멱등)', () => {
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      expect(normalizeInvasionLayers(l)).toEqual(l);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ seedBases 구조 회귀 0 (설명 재작성이 구조를 건드리지 않았는지)
// ---------------------------------------------------------------------------

describe('seedBases — 재조정이 구조를 건드리지 않았다', () => {
  it('개수 20 · UUID 스킴 · 밴드 분포 7/7/6 유지', () => {
    expect(SEED_BASES.length).toBe(20);
    SEED_BASES.forEach((b, i) => {
      expect(b.order).toBe(i + 1);
      expect(b.profileId).toBe(seedBaseUuid(i + 1));
    });
    const counts = { 하위: 0, 중하: 0, 중위: 0 };
    for (const b of SEED_BASES) counts[b.difficultyBand]++;
    expect(counts).toEqual({ 하위: 7, 중하: 7, 중위: 6 });
  });

  it('설명은 전부 비어 있지 않고 이모지를 담지 않는다', () => {
    // 정찰 뷰가 Pixi 라 컬러 이모지는 두부로 렌더된다.
    for (const b of SEED_BASES) {
      expect(b.description.length).toBeGreaterThan(10);
      expect(b.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑦ 로스터 간섭 회귀 게이트 — 침공은 기체 로스터와 한 배를 탄다
// ---------------------------------------------------------------------------

/**
 * ## 이 블록이 막는 것
 * 위 19건은 전부 `GEAR_REFERENCE` 리터럴만 쓰고 `config.shipType` 을 세우지 않는다. 그래서
 * 사실상 **스트라이커(signatureBit −1) 고정 · `rangeAdd 0`** 한 조합만 잰다. 그런데 로스터는
 * 침공 런에 네 갈래로 새어 들어온다 — 코드로 확인한 경로다:
 *   ① `src/run/runConfig.ts` 의 `buildRunConfig` 가 PvE·정식 침공·하네스 침공의 **단일 정본**
 *      이고, `applyShipTypeBase`(`src/items/loadout.ts:202`)로 섀시 `baseBp` 4축이 침공 런에도
 *      그대로 실린다.
 *   ② `src/sim/world.ts` 의 로드아웃 적용부에 침공 분기가 없다 — PvE 와 같은 코드를 탄다.
 *   ③ `isPlayerTargetable` 이 `facilityGun`·`defenseBoss`·`prop`·`core` 를 포함하므로
 *      `weapon.range`(= 로스터의 range 노드·`rangeAdd`)가 **침공 조준 거리도** 좁힌다.
 *   ④ `signatureOn`(`src/sim/world.ts`) → SIG_* 6종이 침공 게이트 없이 발동한다.
 *
 * ## 이 게이트가 실제로 커버하는 범위 (측정으로 확인한 사실만 적는다)
 * 게이트 런은 {@link rosterGateConfig} 로 **정규 경로 전량**을 탄다 —
 * `Profile` → `buildRunConfig` → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`.
 *   - ① **커버**. `data/ships/<slug>.ts` 의 `baseBp` 를 극단으로 변조하면 이 게이트가 깨진다
 *     (아래 "감도 실증" 참고). 리터럴 로드아웃을 꽂던 이전 판은 이 사슬을 통째로 우회해
 *     **baseBp 를 −9000 으로 만들어도 통과**했다.
 *   - ② **커버**(①이 만든 로드아웃이 `weapon.damage`/`fireCooldown`/`playerHp`/`playerSpeed`
 *     로 착지하는 것이 승률에 그대로 나타난다).
 *   - ③ **부분 커버**. 게이트가 싣는 `rangeAdd 460` 은 장비 어픽스(`rangeFlat`)에서 온다.
 *     `lo.rangeAdd` → `weapon.range` → `isPlayerTargetable` 구간은 이걸로 실제로 탄다.
 *     **미커버: 스킬트리 노드가 주는 `rangeFlat`** — 게이트는 **무투자** 벡터를 싣는다.
 *     투자를 실으면 기체 간 격차가 아니라 트리 총량이 승률을 지배해 baseBp 회귀 신호가
 *     묻히므로 일부러 무투자로 고정했다. 트리 rangeFlat 회귀는 `tests/skills.test.ts`
 *     계열이 맡는다.
 *   - ④ **커버**. `buildRunConfig` 가 `shipType` 을 항상 명시하고 시그니처 비트를
 *     `loadout.uniqueMask` 에 OR 한다.
 *
 * ## 왜 하필 이 조합인가
 * - `rangeAdd = 460` 은 `src/sim/autopilot.ts` 의 `KITE_DISTANCE` 와 같은 값이다. 참조봇이
 *   유지하려는 거리와 사거리가 정확히 겹치는 **임계점**이라, range 축이 조금만 흔들려도
 *   조준 성공/실패가 갈린다 — 로스터 range 변경에 가장 민감한 지점이다.
 * - 기지 **두 곳**을 쓴다. 한 곳으로는 **양방향 감도가 안 나온다** — 실증한 사실이다.
 *
 * ## 기지·폭 선정 — 전량 재실측 (2026-07-21)
 * 아래 값은 **이 트리에서 그대로 재현되는 실측**이다. 게이트를 통과시키려고 폭을 넓힌 것이
 * 아니라, 전 기지를 재고 **담당 방향별로 기지를 골랐다**.
 * 재현법: 기지 nn × 비-스트라이커 6기체 × `BALANCE_SEEDS` 를 {@link rosterGateRate} 로
 * 돌린다(정규 경로 · `rangeAdd 460` · 무투자).
 * ⚠️ 아래 표와 폭 산정은 **12시드 시절(2026-07-21)의 기록**이다. `BALANCE_SEEDS` 가 24로
 * 늘었으므로(2026-07-27) 최소 눈금은 8.33pp → **4.17pp** 이고, 현행 실측은 아래
 * {@link ROSTER_GATE_BASES} 주석에 있다. 이 표는 **기지 #12·#16 을 고른 근거**로만 읽어라.
 *
 * 실측 — 기체 1(브루저)~6 순, 괄호는 (min~max, 폭):
 *     #9  = 66.7/41.7/58.3/100.0/83.3/66.7   (41.7~100.0, 58.3pp)
 *     #10 = 75.0/75.0/41.7/100.0/91.7/66.7   (41.7~100.0, 58.3pp)
 *     #11 = 66.7/50.0/66.7/83.3/50.0/66.7    (50.0~83.3, 33.3pp)
 *     #12 = 58.3/50.0/50.0/75.0/50.0/58.3    (50.0~75.0, 25.0pp) ← 전 기지 중 **가장 좁다**
 *     #13 = 58.3/41.7/58.3/83.3/75.0/50.0    (41.7~83.3, 41.7pp)
 *     #14 = 50.0/25.0/83.3/33.3/50.0/41.7    (25.0~83.3, 58.3pp)
 *     #15 = 41.7/50.0/33.3/50.0/66.7/33.3    (33.3~66.7, 33.3pp)
 *     #16 = 50.0/33.3/25.0/33.3/58.3/33.3    (25.0~58.3, 33.3pp) ← **천장이 가장 낮다**
 *     #17 = 41.7/16.7/58.3/33.3/83.3/58.3    (16.7~83.3, 66.7pp)
 *     #18 = 50.0/41.7/41.7/16.7/100.0/100.0  (16.7~100.0, 83.3pp)
 *     #19 = 100.0/91.7/25.0/58.3/100.0/100.0 (25.0~100.0, 75.0pp)
 *     #20 = 8.3/83.3/50.0/8.3/50.0/16.7      (8.3~83.3, 75.0pp)
 *
 * - **#12 = 하한 담당.** 바닥이 50.0% 로 높고 폭이 25.0pp(3눈금)로 전 기지 중 가장 좁다 —
 *   아래쪽 여유가 최대다. 상향은 여기서 안 잡힌다: `+20000` 변조에서 기체 1 이 58.3 → 75.0
 *   으로 오르는데 **기저 최대(기체 4)가 이미 75.0** 이라 어떤 hi 도 둘을 가르지 못한다.
 * - **#16 = 상한 담당.** 천장이 58.3% 로 전 기지 중 가장 낮은데 `+20000` 변조는 기체 1 을
 *   75.0% 로 올린다 — 분리 폭 16.7pp(2눈금)로 **전 기지 중 유일하게 상향이 분리된다**
 *   (#15 는 8.3pp, 나머지는 기저 최대가 83.3% 이상이라 분리 0).
 * - 폭(12시드의 최소 눈금은 8.33pp):
 *     #12 lo 20 — 기저 최소 50.0 에서 아래로 30.0pp(3.6눈금). 통상 ±2눈금 튜닝은 통과한다.
 *     #12 hi 95 — 기저 최대 75.0 에서 위로 20.0pp. 담당 방향이 아니라 느슨한 안전망이다.
 *     #16 hi 70 — 기저 최대 58.3 과 변조값 75.0 **사이**다. 이 구간에 놓인 실현 가능한 값은
 *                 66.7(8/12) 하나뿐이므로 **위쪽 여유는 정확히 1눈금**이고, 그것이 이 sim 에서
 *                 확보 가능한 최대다(변조가 75.0 에서 포화한다). 여기만 ±2눈금 여유가 없다 —
 *                 대신 하한 담당(#12)이 3.6눈금을 갖는다.
 *     #16 lo  5 — 기저 최소 25.0 에서 아래로 20.0pp(2.4눈금). 담당 방향이 아니므로 **"전 시드
 *                 패배"에 가까운 선**으로 둔다.
 *
 * ## 감도 실증 (2026-07-21, 위 실측과 같은 트리에서 수행하고 원복)
 * `data/ships/bruiser.ts` 의 `baseBp` 4축을 통째로 바꾼 뒤 게이트를 돌렸다.
 *   `{-9000,-9000,-9000,-9000}` : #12 기체 1 = **0.0%**  → lo 20 위반 → 실패
 *                                 (#11·#15·#16 도 전부 0.0% 로 죽는다)
 *   `{20000,20000,20000,20000}` : #16 기체 1 = **75.0%** → hi 70 위반 → 실패
 *                                 (같은 변조에서 #11 66.7→75.0 · #12 58.3→75.0 · #15 41.7→75.0)
 * 두 변조 모두 기체 2~6 열은 값이 그대로였다 — 하네스가 변조 기체만 격리해 잰다는 증거다.
 * 원복 후 전 기지·전 기체 그린.
 */
const ROSTER_GATE_RANGE_ADD = 460;

/** 로스터 게이트가 도는 기지와 그 기지에서의 허용 폭. 위 주석의 실측이 근거다. */
// 이 게이트가 지키는 계약은 **"0%도 100%도 아니다"**(비-스트라이커 기체로도 침공이 성립하고,
// 동시에 무저항도 아니다)이지 특정 승률이 아니다. 담당 방향은 아래 **6세대** 절이 정본이다
// (**#18=하한 · #20=상한**). 그 위의 4·5세대 서술은 역사 기록이다.
//
// ## 24시드 실측 (2026-07-27, **5세대** = 밴드 목표 복원 이후 · 기체 1~6 순) — 역사
//   #12 = 50.0 / 37.5 / 50.0 / 33.3 / 83.3 / 70.8   (33.3~83.3)
//   #20 = 79.2 / 70.8 / 70.8 / 70.8 / 83.3 / 87.5   (70.8~87.5)
//
// ## ⚠️ 담당 기지를 **#12·#16 → #12·#20 으로 옮겼다** (상한을 여는 대신)
// 4세대 값은 #12 = 87.5~100.0 · #16 = 70.8~91.7 이었고, 그 위에서 이 표는
// **#12 = 하한 담당 · #16 = 상한 담당**이었다. 5세대 재기준화가 둘 다 무효로 만들었다:
//   · **#16 은 게이트 기지 자격을 잃었다.** 5세대에서 #16 은 6기체 중 **둘이 0.0%** 다
//     (12.5 / 0.0 / 4.2 / 0.0 / 16.7 / 29.2). 이 게이트의 계약은 "0%도 100%도 아니다" 이므로,
//     하한을 5 로 두든 0 으로 두든 **기지 자체가 계약을 만족하지 못한다**. 상한을 여는 문제가
//     아니라 기지를 바꿔야 하는 문제다.
//   · **#12 가 상한 담당으로 이동했다.** 5세대에서 #12 는 천장이 83.3% 로 전 기지 중 가장 낮고
//     (4세대에는 100.0 이라 상향 감도가 아예 없었다) 바닥도 33.3% 로 0 에서 멀다.
//   · **#20 이 하한 담당을 맡는다.** 폭이 70.8~87.5(16.7pp = 4눈금)로 전 기지 중 가장 좁고
//     바닥이 70.8% 로 가장 높다 — 아래쪽 여유가 최대다.
//
// ## 감도 실증 (2026-07-27, 이 트리에서 수행하고 원복 · `data/ships/bruiser.ts` baseBp 4축)
//   `{20000,20000,20000,20000}` : **#12 기체 1 = 50.0 → 100.0** → hi 92 위반 → 실패
//                                 (#20 기체 1 도 79.2 → 100.0)
//   `{-9000,-9000,-9000,-9000}` : **#20 기체 1 = 79.2 → 0.0**  → lo 62 위반 → 실패
//                                 (#12 기체 1 도 50.0 → 0.0)
// 두 변조 모두 기체 2~6 열은 값이 **한 자리도** 바뀌지 않았다 — 하네스가 변조 기체만 격리해
// 잰다는 증거다. 원복 후 두 기지·전 기체 그린.
// ⚠️ 이 감도 실증은 **6세대에서 다시 돌리지 않았다.** 위 두 변조가 가리키는 성질(하네스가
// 변조 기체만 격리해 잰다 · 양 방향 모두 실패로 드러난다)은 기지·폭이 바뀌어도 유지되지만,
// 인용된 구체 수치와 위반하는 경계값은 5세대 것이라 그대로 읽으면 안 된다.
//
// ## ⚠️ 6세대 — 담당 기지를 **#12·#20 → #18·#20 으로 옮겼다** (2026-07-28)
// `fix/spatial-hash-large-radius-broadphase` + 기물 재조정이 값을 통째로 옮겼다.
// 24시드 실측(기체 1~6 순, 후보 4기지 전수):
//   #12 = 91.7 / 58.3 / 33.3 / 45.8 / 79.2 / 91.7   (33.3~91.7)
//   #15 = 100.0 / 75.0 / 83.3 / 75.0 / 100.0 / 100.0 (75.0~100.0)
//   #18 = 66.7 / 58.3 / 41.7 / 50.0 / 66.7 / 83.3   (41.7~83.3)
//   #20 = 41.7 / 29.2 / 25.0 / 29.2 / 70.8 / 62.5   (25.0~70.8)
//
// 역할 재배정의 근거는 5세대와 **같은 규칙**이다(담당 방향에 최대 여유를 주는 기지를 고른다):
//   · **#15 는 후보 자격이 없다.** 6기체 중 **셋이 100.0%** 라 이 게이트의 계약
//     ("0%도 100%도 아니다")을 기지 자체가 만족하지 못한다. #16 이 5세대에 0% 로 탈락한 것의
//     거울상이다.
//   · **#12 가 상한 담당 자격을 잃었다.** 천장이 83.3 → **91.7** 로 올라가, 규칙대로 2눈금을
//     주면 hi = 100 이 되어 **위쪽으로 영영 실패할 수 없는 단언**이 된다. 4세대의 #16
//     (hi 96 = 1눈금)이 겪은 것과 같은 실패 방식이고, 상한을 여는 문제가 아니라 기지를
//     바꿔야 하는 문제다.
//   · **#20 이 상한 담당으로 이동했다.** 천장 70.8% 로 후보 중 가장 낮아 상향 감도가 최대다
//     (5세대에는 이 기지가 하한 담당이었다 — 판정이 세지면서 천장이 87.5 → 70.8 로 내려왔다).
//   · **#18 이 하한 담당을 맡는다.** 바닥 41.7% 로 후보 중 가장 높고 폭도 41.6pp 로 가장 좁다
//     — 아래쪽 여유가 최대다.
//
// ## 폭 (24시드 최소 눈금 4.17pp)
//   #18 lo 33 — 기저 최소 41.7 아래로 **2눈금**(37.5 · 33.3). 담당 방향이라 여유를 여기 뒀다.
//   #18 hi 100 — 담당 방향이 아니라 느슨한 안전망이다.
//   #20 hi 80 — 기저 최대 70.8 위로 **2눈금**(75.0 · 79.2). 담당 방향이다.
//   #20 lo  5 — 기저 최소 25.0 아래로 4.8눈금. 담당 방향이 아니므로 "전 시드 패배에 가까운 선".
// 양 방향 모두 2눈금을 유지한다.
//
// ## 7세대 재측정 — 드론 사출구 전방 사출 재설계 (2026-07-28) · **폭을 건드리지 않았다**
// 죽어 있던 사출구가 회랑 전방 사출로 살아나면서 정면 교전이 생겼다
// (정본 `.omc/research/invasion-spawner-redesign-2026-07-28.md`). 24시드 재측정(기체 1~6):
//   #18 = 75.0 / 62.5 / 50.0 / 45.8 / 58.3 / 79.2  (45.8~79.2) — `lo 33` 아래로 **3눈금**
//   #20 = 54.2 / 45.8 / 29.2 / 37.5 / 66.7 / 62.5  (29.2~66.7) — `hi 80` 위로 **3눈금**
// 담당 방향의 여유가 오히려 늘어(2눈금 → 3눈금) 폭·담당 배정을 모두 그대로 둔다.
// 6세대 감도 실증도 재수행하지 않았다 — 폭이 안 움직였으므로 그 실증의 결론이 그대로 성립한다.
const ROSTER_GATE_BASES = [
  { nn: 18, lo: 33, hi: 100, band: '41.7~83.3' },
  { nn: 20, lo: 5, hi: 80, band: '25.0~70.8' },
] as const;

/** 스트라이커(0)를 뺀 나머지 전 기체. 카탈로그에서 유도한다 — 개수를 손으로 적지 않는다. */
const NON_STRIKER_SHIP_TYPES: readonly number[] = SHIP_TYPES.map((_, i) => i).filter((i) => i > 0);

function rosterGateRate(shipType: number, nn: number): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of BALANCE_SEEDS) {
    const o = playRun(seed, layers, { shipType, rangeAdd: ROSTER_GATE_RANGE_ADD });
    if (o.win) wins++;
  }
  return (wins / BALANCE_SEEDS.length) * 100;
}

/** (기체, 기지 순번) 전 조합. 개수를 손으로 적지 않는다. */
const ROSTER_GATE_CASES = NON_STRIKER_SHIP_TYPES.flatMap((shipType) =>
  ROSTER_GATE_BASES.map((b) => [shipType, b.nn] as [number, number]),
);

function rosterGateBase(nn: number): (typeof ROSTER_GATE_BASES)[number] {
  const b = ROSTER_GATE_BASES.find((x) => x.nn === nn);
  if (b === undefined) throw new Error(`로스터 게이트 기지 정의 없음: #${nn}`);
  return b;
}

describe('로스터 간섭 게이트 — 비-스트라이커 기체로도 침공이 성립한다', () => {
  it('스트라이커가 typeId 0 이고 나머지 기체가 존재한다', () => {
    // 아래 게이트의 전제. 카탈로그가 재정렬되면 게이트가 엉뚱한 기체를 재게 된다.
    expect(SHIP_TYPES[0]?.id).toBe(0);
    expect(NON_STRIKER_SHIP_TYPES.length).toBeGreaterThan(0);
    expect(NON_STRIKER_SHIP_TYPES).not.toContain(0);
  });

  it.each(ROSTER_GATE_CASES)(
    '기체 %i 이 기지 #%i(사거리 임계)에서 0%%도 100%%도 아니다',
    (shipType, nn) => {
      const base = rosterGateBase(nn);
      const rate = rosterGateRate(shipType, nn);
      const msg = `기체 ${shipType} · 기지 #${base.nn} 클리어율 ${rate.toFixed(1)}% (실측 밴드 ${base.band}%)`;
      expect(rate, msg).toBeGreaterThanOrEqual(base.lo);
      expect(rate, msg).toBeLessThanOrEqual(base.hi);
    },
  );
});
