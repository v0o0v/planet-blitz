# 액티브 스킬 장비 어픽스 레인 — 구현 계획 (2026-07-31)

- 설계 정본: `docs/adr/0043-active-skill-gear-affixes.md`
- 선행 정본: `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md`
  (이 레인이 그 **AC-13 을 개정**한다) · `.omc/plans/active-skills-lane-contract.md`
- 상태: 계획 초안 (그릴링 합의 완료, 구현 미착수)

---

## 0. 이 레인이 하는 일 한 문장

**액티브 스킬의 위력·쿨다운을 장비 어픽스 4종으로 강화할 수 있게 하고, 기존 유니크 3종에
"발동 시" 부수효과를 얹는다.**

## 1. 합의된 결정 (그릴링 결과)

| # | 결정 | 근거 |
|---|---|---|
| D1 | 어픽스 **4종** — 위력 2(prefix) · 쿨감 2(suffix) | 14/14 대칭 유지, 기존 다티어 관례(sharp/brutal/deadly) |
| D2 | 일반 어픽스 풀에 넣는다(magic/rare/unique 전부) | 유니크 전용이면 "액티브 빌드 = 특정 유니크 1점"으로 환원 |
| D3 | 액티브 미장착이면 **죽은 옵션** — 그대로 둔다 | 빌드 선택의 일부. 조건부 롤은 `rollItem` 순수성을 깬다 |
| D4 | 파생 함수 **시그니처에 필수 인자 추가** | 호출부 4곳 누락을 tsc 가 컴파일 에러로 만든다 |
| D5 | 산식에 **구조적 클램프**(쿨감·위력 양축) | EF 가 공격자 로드아웃을 검증 안 함(ADR-0028) — 유일한 방어선 |
| D6 | 조건부 해시 폴드, 게이트 = **값 ≠ 0** | "장비가 가진 값 = 지문" 규칙이 미래 변경에 견고 |
| D7 | 기존 유니크 **3종 의미 확장**(위상 장갑·반응 장갑·위상 전환막) | 신규 비트 0칸 소비 — 자유 비트 24~30 온전 보존 |
| D8 | 검증 **4축 전부** + 축별 뮤테이션 기록 | ②가 없으면 지문 비교가 항진 |
| D9 | 골든 **재녹화**, 침공 밴드 **재측정은 다음 레인** | 레인 부피 관리. 밴드 이동은 기록만 |
| D10 | 밸런스 수치(min/max·클램프 값)는 **defer** | 이 저장소 관례. 단 **클램프 존재 자체는 지금** |

## 2. 실측 좌표 (배선 접점)

| 접점 | 위치 | 형태 |
|---|---|---|
| `StatKey` 2개 append | `src/items/types.ts` (suffix 블록 뒤) | `activeCdPct` · `activePowerPct` |
| 어픽스 4종 | `data/affixes.ts` `PREFIXES`/`SUFFIXES` | 이름은 **한글 리터럴**(어픽스 관례 — `t()` 아님) |
| 중립 로드아웃 | `src/items/loadout.ts:78-80` 옆 | 둘 다 0 |
| 합계 초기화 | `src/items/loadout.ts:168-170` 옆 | 원소 3종과 같은 자리 |
| 합계 적용 + **클램프** | `src/items/loadout.ts:314-316` 뒤 | 여기서 클램프한다(단일 지점) |
| `LoadoutConfig` 필드 | `src/sim/world.ts:599-603` 뒤 append | 정수 2칸 |
| 해시 꼬리 폴드 | `src/sim/replay.ts:365-367` 뒤 | **조건부** — 둘 다 0 이면 한 폴드도 안 함 |
| 쿨다운 파생 | `data/ships/actives/index.ts:108` | `(def, invested, cdBonusPct)` |
| 위력 파생 | `data/ships/actives/index.ts:120` | `(def, invested, powerBonusPct)` |
| 호출부 ①sim 권위 | `src/sim/actives.ts:179` | `state.config.loadout?.activeCdPct ?? 0` |
| 호출부 ②위력 | `src/sim/activeTypes.ts:60` `powerCentiOf` | 42종 핸들러가 전부 이걸 경유 — 단일 지점 |
| 호출부 ③HUD | `src/ui/hud.ts:139` `cdMax` | 여기가 틀리면 게이지가 거짓말 |
| 호출부 ④연구소 | `src/items/activeSkills.ts:49-50` | 슬롯 뷰 표시값 |
| 유니크 비트(재사용) | `src/sim/uniques.ts` | `UQ_PHASE_ARMOR=4` · `UQ_REACTIVE_ARMOR=9` · `UQ_PHASE_MEMBRANE=10` |
| 유니크 발동 훅 | `src/sim/actives.ts` 발동 성공 직후 | 쿨다운 세팅과 같은 자리에서 `uniqueMask` 검사 |

**건드리지 않는 것**: `src/items/rollDefenseUnit.ts`(자체 어픽스 풀) ·
`GuardianBuild`(`Item` 통째 박제라 자동 승계) · `data/ships/*.ts`(`skillInvest` 삼중 계약) ·
자유 `uniqueMask` 비트 24~30.

## 3. 레인 분할

파일 소유가 배타가 되도록 나눈다. A→B 는 순차(B 가 A 의 필드를 읽는다), C·D 는 B 이후 병렬.

| 레인 | 소유 | 내용 |
|---|---|---|
| **A · 어픽스 축** | `src/items/types.ts` · `data/affixes.ts` · `src/items/loadout.ts` · `src/sim/world.ts`(LoadoutConfig 필드만) | StatKey 2 · 어픽스 4종 · 합산 + 클램프 · 중립값 |
| **B · 파생·해시** | `data/ships/actives/index.ts` · `src/sim/{actives,activeTypes,replay}.ts` · `src/ui/hud.ts` · `src/items/activeSkills.ts` | 시그니처 변경 + 호출부 4곳 · 조건부 폴드 |
| **C · 유니크 3종** | `src/sim/uniques.ts` · `src/sim/actives.ts`(발동 훅만 — B 와 충돌하므로 **B 머지 후 착수**) | 3종 부수효과 |
| **D · 검증** | `tests/activeGearAffix.test.ts`(신설) · 골든 재녹화 | 4축 + 뮤테이션 기록 |

> ⚠️ B·C 가 `src/sim/actives.ts` 를 공유한다. 병렬로 돌리지 말 것 — 이 저장소의 병렬 레인
> 규율은 "공유 등록 지점을 선행 커밋으로 비운다" 인데 여기는 비울 수 있는 형태가 아니다.

## 4. 검증 계약

| 축 | 파일 | 무엇을 잡는가 | 뮤테이션 |
|---|---|---|---|
| ① 3지점 쿨다운 일치 | `tests/activeGearAffix.test.ts` | HUD·연구소가 sim 과 갈리는 것 | 한 호출부에서만 보너스 인자를 0 으로 → **실패해야** |
| ② 재발동 틱 수 실측 델타 | 같은 파일 | 보너스가 **실제로** 줄이는지 | 클램프를 항상-0 으로 → **실패해야** |
| ③ 어픽스 0 런 골든 바이트 불변 | `shipHashBaseline` 등 기존 골든 | 조건부 폴드가 진짜 조건부인지 | 폴드 가드를 항상 true 로 → **실패해야** |
| ④ 유니크 3종 오발동 방지 | `tests/activeGearAffix.test.ts` | 대시·피격으로 터지는지 | 발동 게이트 제거 → **실패해야** |

**②를 지문 비교로 대체하지 말 것.** 값이 실린 것만으로 지문이 바뀌므로 효과가 0 이어도
"달라졌다"가 나온다 — ADR-0041 레인의 M-②b 가 잡은 항진과 같은 기제다.

추가 필수 게이트:
- `tsc` 를 vitest 와 **별도로** 돌린다(vitest 는 esbuild transpile-only — 타입 누락을 못 잡는다).
- 클램프 경계 테스트: 어픽스를 과도하게 쌓아도 상한을 넘지 않는지.

## 5. 감수하는 비용 (명시)

1. **골든 재녹화** — 어픽스 풀 24→28 로 `rollItem` 결과가 이동하고, `src/bench/standardBuild.ts`
   가 그걸 쓴다. 영향: `shipHashBaseline` · `progressionPath` · `emergentRunLength` ·
   `planetPopularity` · `integration` · `drops` · `berdan` · `standardBuild`.
   RNG 소비 횟수는 불변이라 스트림은 안 밀린다(`int` 은 span 무관 1회).
2. **침공 24시드 밴드 이동** — 현 100.00 / 70.83 / 40.28 이 움직인다. **이번 레인에서는
   이동 후 값을 측정해 기록만 하고, 램프 재조정은 다음 레인.** 목표 대역을 벗어난 채
   남을 수 있음을 감수한다.
3. **유니크 3종을 낀 기존 리플레이 파기** — 비트 의미 확장의 대가. (1)의 재녹화에 포함.
4. **`verify-invasion` EF 재배포 필수** — 보너스가 0 이 아닌 런은 지문이 달라진다.
   클라만 배포하면 그 런들이 전부 거부된다. 절차 정본은
   `.omc/skills/planet-blitz-supabase-deploy-workflow.md`.

## 6. 실행 순서

1. A 레인 (어픽스 축) → 커밋
2. B 레인 (파생 시그니처 + 호출부 4곳 + 조건부 폴드) → `tsc` + vitest → 커밋
3. C 레인 (유니크 3종) → 커밋
4. D 레인 — 검증 4축 작성 → **뮤테이션 4건 실행·기록** → 커밋
5. 골든 재녹화 + 침공 밴드 실측(기록만) → 커밋
6. ADR-0043 채택 확정 · ADR-0041 AC-13 에 개정 참조 한 줄 추가
7. PR → 머지 → `verify-invasion` EF 재배포 → 배포 후 침공 제출 1회 실측

## 7. 미결 (밸런스 패스로 이월)

- 어픽스 4종의 min/max
- 쿨감·위력 클램프 수치
- 유니크 3종 부수효과의 구체 효과·강도 (구현 착수 시 확정)
