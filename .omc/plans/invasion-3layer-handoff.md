# 침공 3레이어 대개편 — 세션 인계 (M7a·M7b 완료 → M7c 착수 지점)

- 작성: 2026-07-21 (M7a·M7b 구현 세션 마감)
- 브랜치: `claude-wt/invasion-3layer-redesign-390d74`
- 기획서: `.omc/plans/invasion-3layer-redesign.md` / 레인 분해: `.omc/plans/invasion-3layer-impl-lanes.md` / 정찰: `.omc/research/invasion-3layer-recon.md`

## 1. 완료 상태

| 마일스톤 | 상태 | 커밋 |
|---|---|---|
| M7a 침공 코어 | ✅ 완료 | `494422e`(웨이브 0~1) → `6ddb2c0`(완료) |
| M7b 방어체 경제 | ✅ 완료 | `8790c0a` → `5b9071f`(마감) |
| M7c 콘텐츠 완충 | ⬜ 미착수 | — |
| M8 기체 챔피언화 | ⬜ 미착수 | — |

**검증 기준선(세션 종료 시점)**: tsc 0 · eslint --max-warnings 0 · `vitest` **87파일 1631테스트 통과** · `vite build` 성공 · Deno 교차검증 6시나리오 Node↔Deno bit-identical · `deno check`/`bundle` 양 EF 통과 · PvE 회귀 0 · 침공 e2e 바이트 동일 재현 유지.

착수 시점 베이스라인은 74파일 822테스트였다.

## 2. 무엇이 들어왔나

### 구조
- **`src/sim/invasion/`** — 3레이어 sim 전체. `constants`/`types`/`normalize`(정수 도메인·total function·`layersEqual` 정규형 전체 깊은 비교)/`scroll`/`phase`/`step`/`formation`/`facility`/`hazardCycle`/`wallIndex`/`coreRoom`/`guardianBridge`/`guardian`/`affix`
- **`data/invasion/`** — `formations`(편대 3)/`facilities`(설비 6)/`mapTemplates`(3)/`props`(기물 3)/`defenseBosses`(보스 1)/`garrison`(기본 수비대)/`catalog`
- **`data/defenseUnits.ts`** + `src/items/rollDefenseUnit.ts` — 방어체 어픽스 엔진, 강화 3축
- **`data/coreModules.ts`** + `src/sim/moduleEffects.ts` + `src/ui/pixi/modulesView.ts` — 코어 모듈(구 방어 카드)
- **`src/ui/pixi/defenseCommand.ts`** — 방어 사령부 Pixi 신규(탭 5장)

### 삭제된 레거시
`src/sim/defense.ts`(포탑 6종·DefenseLayout·배치 포인트) · `src/ui/defenseCommand.ts`(15×9 격자 편집기 1580줄) · `defensePreviewOverlay.ts` · 카드 경로 전량(`cardsView` 양판·`net/cards`·`cardsGateway`·`defenseCards`·`rollCard`·`supabase/functions/cards`)

### 채택된 수치 (기획서 §10 미결 해소)
웨이브 슬롯 6 / L2 소켓 12·10·8(직선·굴곡·병목) / 기물 소켓 6 / 수호 2 / 보스 1 / 코어 모듈 슬롯 2 / 틱 예산 5400+5400+7200 = 18000(레이어별 soft, 총합만 hard) / 코어 HP 8000 / 전멸 가속 정수 centi-percent clamp[100,200] / 레이어 클리어 회복 최대HP 20% + 폭탄 +1

## 3. ⚠️ 배포 runbook (미실행 — 다음 세션 1순위)

**사용자 배포 승인 완료**(2026-07-21, 시점도 위임). 아래는 배포 게이트가 실측으로 확정한 절차다.

### 왜 `supabase db push` 를 쓰면 안 되나
원격 migration version 스탬프가 로컬 파일명과 **다르다**(예: 로컬 `20260718160000_m6_defense_cards` ↔ 원격 `20260718115959 m6_defense_cards`). 지금까지 MCP `apply_migration` 으로 적용해 와서 어긋났다. `db push` 는 이미 적용된 22개를 미적용으로 오판해 재실행한다 — `m4_phase_e_npc_seed`·`m4_phase_e_placement` 재실행은 데이터 리셋 위험이다.

**MCP `apply_migration` 으로 신규 5개만 개별 적용**하거나, `supabase migration repair` 로 history 를 먼저 정렬할 것.

### 적용 순서 (파일명 순서 그대로, 내용 무수정)
1. `20260721000000_m7a_invasion_3layer.sql` → name `m7a_invasion_3layer`
2. `20260721010000_m7a_seed_bases_3layer.sql` → name `m7a_seed_bases_3layer`
3. `20260722000000_m7b_defense_units.sql` → name `m7b_defense_units`
4. `20260722010000_m7b_core_modules.sql` → name `m7b_core_modules`
5. `20260722020000_m7b_blueprint_drops.sql` → name `m7b_blueprint_drops`

> **마이그레이션은 3종이 아니라 5종이다.** M7a 2종도 원격 미적용이다. M7b 3종만 적용하면 `defenses.layout` 이 M6 형식(`core`/`turrets`/`obstacles`)으로 남아 3레이어 sim 과 어긋나 침공 경로 전체가 깨진다.
>
> SQL 파일 헤더의 "**원격 적용 금지 — 리포 커밋만**" 주석은 작성 시점 지시이며 사용자 승인으로 해제됐다. 적용 후 그 주석을 지울 것.

### Edge Function 배포 3건
함수 디렉터리 **밖**의 상대 의존(`../../../src/sim/**`)이 있어 **번들 `dist.index.js` 를 `index.ts` 엔트리포인트로 업로드**한다. 소스 `.ts` 를 올리면 런타임에 죽는다. (`.gitignore` 대상이라 워킹트리에만 있다 — 없으면 `deno task bundle` 로 재생성. 이 환경에 deno 2.8.0 있음)

| 대상 | 조치 | 이유 |
|---|---|---|
| `verify-invasion` | 재배포 (`verify_jwt: true` 유지) | 원격 v16 은 M6 시절 번들 — 3레이어·어픽스 재실행 불가 |
| `modules` | 신규 배포 | 원격에 없음. `verify_jwt` 는 `index.ts` 인증 방식 확인 후 결정(구 `cards` 는 false였다) |
| `cards` | **삭제** — `supabase functions delete cards` | 원격에 v2 ACTIVE. 마이그레이션이 `apply_card_*`·`defense_cards` 를 drop 하므로 적용 즉시 항상 500. **MCP 에 삭제 도구가 없어 CLI 수동 실행 필요** |

### 배포 전 실측 확인된 것 (재조사 불요)
- 원격 `invasions=0`, `invasion_snapshots=0` → **무효화할 침공 기록 없음.** 해시 변경으로 인한 재실행 거부 시나리오 자체가 성립하지 않는다.
- drop 대상(`defense_cards`/`apply_card_*`)을 참조하는 **실행 코드 0건**(EF 번들 grep 포함). 잔존은 주석과 이미 적용된 구 마이그레이션 파일뿐.
- 적용 순서 의존이 전부 후방 참조라 파일명 순서로 안전.
- `defenses` 21행 중 20행은 고정 UUID NPC(재시드 대상). 나머지 1행은 실유저인데 **ladder 행이 없어**(`placed=null, rank=null`) 새 `begin_invasion` 게이트에 걸려 침공 대상이 될 수 없고, 클라 저장 경로가 항상 `normalizeInvasionLayers()` 를 쓰므로 다음 저장 시 자가 치유된다.

### 배포 후 검증
`list_migrations`(5건 등재) · `list_edge_functions`(verify-invasion 버전 상승, modules ACTIVE) · `get_advisors`(security/performance — 신규 테이블 RLS 경고 확인) · `select layout ? 'l1', count(*) from public.defenses group by 1`(3레이어 재시드 확인)

## 4. M7c 착수 전 결정이 필요한 것

1. **미결 #6 (편대·설비의 행성별 분배)** — M7b-acquisition 이 현행 4행성 × M7a 카탈로그로 1차 배분을 넣었다. M7c 풀 카탈로그(편대 8·설비 9·기물 6·보스 3)로 늘 때 확장 규칙을 확정해야 한다.
2. **압축 프레스(이동 벽)** — M7a 에서 M7c 로 이월. 터널링 방지 전제 "벽 최소 폭 120u > 최대 대시 스텝 59u" 를 깨므로 끼임·터널링 처리 신설이 필요하다.
3. **L2 경로 분기(상하 갈림길)** — 기획 §10-8 확장 예약. 도입 시점 미정.
4. **밸런스** — 채운 배치 8시드 중 4승(1·5·7·42). 클리어 가능성은 확보됐으나 난이도 분산이 크다. M7c 밸런스 패스 대상.

## 5. 남은 부채·위험

- **플레이테스트 미실시.** 방어 사령부 5탭·코어 모듈 화면의 실제 조작은 **마이그레이션+EF 배포 후에만** 가능하다(배포 전에는 게이트웨이가 오프라인 no-op 이라 화면이 빈 상태로 뜬다). 하네스 `goto('defense')` 로 ①탭 5장 전환 ②L1 슬롯 선택 시 프리뷰 반영 ③L2 템플릿 교체 시 회랑 변화 ④팝업 목록 휠 스크롤 ⑤시험 침공 후 정산 미발생 을 눈으로 확인할 것. 프리뷰 축소 배율(패널 안 1920×1080 fit)이 실화면에서 너무 작으면 코어 주변 크롭 조정 필요.
- **모듈 장착 상태로 침공을 끝까지 완주하는 e2e 없음** — 구간 관측 + 3000틱 해시 대조까지만. `tests/invasionE2E.test.ts` 의 승리 시드는 모듈 미장착 기준이라 모듈을 실으면 같은 시드가 승리하지 않을 수 있다. 밸런스 확정 후 별도 승리 시드로 추가할 것.
- **EF 재실행 CPU 예산** — `SOFT_RERUN_BUDGET_MS` 를 8000 → 20000 으로 올렸다. 18000틱 3레이어 재실행이 Supabase Edge Runtime 한도를 넘는지는 **실배포 실측이 남아 있다**. 넘으면 L3 엔티티 상한·컬링 반경을 먼저 조이고, 최악의 경우 "전 구간 재실행" → "샘플 구간 재실행" 아키텍처 변경이 필요하다.
- **`GRID_COLS` grep 잔존 5건** — `src/ui/pixi/refinery.ts`(=6)·`resultOverlay.ts`(=8) 의 **무관한 지역 UI 상수**다. 구 15×9 방어 격자와 관계없어 개명하지 않았다.
- **`supabase/README.md` 214·336·775행**에 `TURRET_SPECS`/`defenseLayoutCost`/`src/sim/defense.ts` 언급 잔존(문서 정리 대상). `20260717010000_m4_phase_d.sql:51` 주석도 마찬가지지만 이미 원격 적용분이라 수정 금지.
- **`defense_blueprints` 보관 상한 없음**(`defense_units` 는 60). 수량 카운터라 행 폭증 위험은 낮으나 정책 결정이 남아 있다.
- **`grant_blueprints` 가 authenticated 클라 호출**이다. 현행 장비 드랍과 동급 트러스트 모델이라 의도적이지만, 강화한다면 장비 드랍과 **함께** 서버 권위로 올려야 한다(설계도만 따로 올리면 규율이 갈린다).
- **수호 중복 선택 판별**을 `(snapshot.hp, performanceCP)` 조합으로 한다(배치에 원본 `GuardianRecord.id` 가 실리지 않는 스키마 제약). 완전히 같은 스펙의 수호가 둘이면 한쪽만 쓰인다.
- **CrazyGames 제출 보류** 상태 그대로.

## 6. 이 프로젝트에서 반복 발생한 결함 유형 (다음 세션이 반드시 알아야 할 것)

**"단위 테스트는 전부 그린인데 배선이 통째로 없다"** — 이 세션에서만 **8건** 나왔다. 각 레인의 단위 테스트가 자기 소유 모듈을 직접 호출하므로, 모듈끼리 이어붙이는 코드가 아예 없어도 전부 통과한다.

실제 사례:
- 해시 봉인 미작동 — L1 계약명 `invasionRuntime` ↔ L2 구현명 `invasion3` 불일치로 항상 `present=0`. **해시 테스트도 같은 팬텀 이름을 써서 결함을 함께 통과시키고 있었다.**
- 스텝 훅 미등록 — 3레이어 런이 예외 없이 5분간 빈 맵을 스크롤.
- 레이어 전이가 스크롤 오프셋을 리셋하지 않아 콘텐츠가 7만 유닛 밖에 스폰.
- 코어 모듈 스폰 효과가 T0 스캔인데 3레이어는 레이어 진입에서 스폰 — 코어 HP 증폭·신기루 코어가 전부 무효.
- `isPlayerTargetable` 누락 — 신규 방어체가 "맞기는 하나 조준되지 않는" 상태.
- EF 가 삭제된 `defense.ts` 를 import — **tsconfig 밖이라 tsc 가 못 잡는다.** 배포하면 verify-invasion 이 통째로 죽었다.

**대응**: 레인 작업 후 반드시 **정규 경로(`createWorld`→`stepWorld`, 실제 게이트웨이 호출, `vite build`, `deno check`/`bundle`)로 도는 통합 테스트**로 확인할 것. `tsc` 는 `supabase/functions/**` 와 런타임 import 경로를 안 본다.
