# 침공 3레이어 → M8 기체 챔피언화 — 세션 인계 (M7c·M8 완료 → 배포 마감 + 플레이테스트 착수 지점)

- 작성: 2026-07-21 (M7c·M8·로스터 7종 구현 세션 마감)
- 개정: 2026-07-21 (원격 배포 실행 완료 — §0 을 실행 기록으로, §4 를 배포 후 상태로 갱신)
- 개정: 2026-07-21 (EF 2회차 재배포 — 1회차 v17 이 M8 배선 미포함이었음을 정정. verify-invasion v18 · verify-pve-sample v3)
- 브랜치: `claude-wt/hopeful-ishizaka-038840` (베이스 `b3aa857` = PR #81 머지 커밋)
- 설계서: `.omc/plans/m8-champion-design.md`(M8 정본) / `.omc/plans/invasion-3layer-redesign.md`(기획) / `.omc/plans/invasion-3layer-impl-lanes.md`(레인 분해) / `.omc/research/invasion-3layer-recon.md`(정찰)

---

## 0. ✅ 원격 배포 — **실행 완료 (2026-07-21)**

마이그레이션 6종 적용 완료 · `cards` 삭제 완료 · **EF 2종이 M8 시그니처 배선까지 반영된 v18 / v3 으로 재배포 완료**. 이 절은 이제 "할 일"이 아니라 **실행 기록 + 다음에도 그대로 쓸 배포 경로**다. 남은 것은 ③ 하네스 플레이테스트다(사용자가 직접 수행 예정).

### ① EF 재배포 + `cards` 삭제 — ✅ **완료 (2회차로 마감)**

> ⚠️ **1회차(v17)는 M8 시그니처 배선을 담지 못했다.** 번들 소스가 `7ae64b6` 이었는데 M8 배선 5커밋(`2604e3b` 말로우 · `984ea03` 버블 · `741c937` 해츨링 · `698339c` 팬텀 · `ee5caf2` aux 별칭 봉인)이 **그 뒤에** 들어왔다. `git diff --stat 7ae64b6..4ba3ac8 -- src/sim/` 실측 **627줄 변경**(`world.ts` +452 · 신규 `cloak.ts` · `patterns/index.ts` · `boss.ts` · `replay.ts` · `shipSignature.ts`). 아래 2회차가 그 창을 실제로 닫았다.
> **교훈: 번들 소스 커밋을 반드시 기록하고, 배포 직후 그 커밋이 `origin/main` 최신인지 대조하라.** "재배포 완료"라는 문장만으로는 무엇이 올라갔는지 알 수 없고, 이 저장소의 반복 결함("배선이 통째로 없는데 그린")이 배포 축에서 재현된 사례다.

| 대상 | 1회차 | **2회차 (M8 반영)** | 비고 |
|---|---|---|---|
| `verify-invasion` | v16 → v17 (소스 `7ae64b6`) | **v17 → v18 ACTIVE** (소스 `4ba3ac8`) | `verify_jwt = true` 유지 |
| `verify-pve-sample` | 재배포 안 함 (v2 = 2026-07-18 번들) | **v2 → v3 ACTIVE** (소스 `4ba3ac8`) | `src/sim` 번들 — 1회차 누락분(§4 #13) 해소 |
| `cards` | **삭제 완료** | — | 목록에서 소멸 · `POST /functions/v1/cards` → 404 |
| `modules` | v1 ACTIVE | v1 ACTIVE (**대상 아님**) | `src/items/types` 를 **type-only import**(`import type { Rarity }`) 라 번들에 런타임 코드 무포함 + 자체 소스 무변경 |

> `verify-run` 은 **원격에 존재하지 않는다**(`list_edge_functions` 실측). `deno.json` 주석대로 로컬 확인 전용이고 `bundle` 태스크도 없다. 초기 표기 "EF 3종"은 틀렸다 — **실제 배포 대상은 2종**이다.

**업로드 번들 실측 (2회차, 소스 `4ba3ac8`. `git diff HEAD origin/main -- src/ data/ supabase/` 공백 = 소스 동일 확인)**

| 함수 | 크기 | sha256 |
|---|---|---|
| `verify-invasion` | 174,396 B (170.19KB) | `a16802e4adb745dda1c642aaa79515856e46660c936003bb35c823b730d3216e` |
| `verify-pve-sample` | 165,427 B (161.43KB) | `b19370cb1096b67bea17e178b36e94bd403e88f851b07db0b109b1a65d858cb1` |

1회차 172,056 B ↔ 2회차 174,396 B 의 차이가 곧 M8 배선분이다.

**2회차 부팅 스모크 (anon JWT — 익명 로그인 불요, `auth.users` 오염 0)**

- `verify-invasion` v18 — `{"invasionId":"not-a-uuid"}` POST → **400 `{"status":"rejected","reason":"malformed-invasion-id",...}`**
- `verify-pve-sample` v3 — `{"limit":0}` POST → **401 `{"error":"unauthorized"}`** (= `index.ts:85` 의 자체 응답. service_role 게이트에 도달했다는 뜻)

둘 다 게이트웨이 오류가 아니라 **함수 자신의 구조화된 응답**이므로 모듈 그래프 전체가 로드됐다.

### ② 마이그레이션 원격 적용 — ✅ **완료 (7/7)**

2026-07-21 적용됨. 원격 마이그레이션 히스토리는 이제 29건이고 리포 파일 29개와 1:1 대응한다(**version 스탬프는 대응하지 않는다 — 아래 경고**).

**적용 순서와 결과** — 선행 5종은 그 이전에 적용돼 있었다.

| # | 리포 파일 | 원격 version | 결과 |
|---|---|---|---|
| 1 | `20260721000000_m7a_invasion_3layer` | `20260720191311` | ✅ 적용 완료 |
| 2 | `20260721010000_m7a_seed_bases_3layer` | `20260720191408` | ✅ 적용 완료 |
| 3 | `20260722000000_m7b_defense_units` | `20260720191553` | ✅ 적용 완료 |
| 4 | `20260722010000_m7b_core_modules` | `20260720191910` | ✅ 적용 완료 |
| 5 | `20260722020000_m7b_blueprint_drops` | `20260720192019` | ✅ 적용 완료 |
| 6 | `20260723000000_m7c_seed_rebalance` | `20260721042605` | ✅ 적용 완료 (2026-07-21) |
| 7 | `20260724000000_m7c_module_slot_preserve` | `20260721081753` | ✅ 적용 완료 (2026-07-21, 플레이테스트 PR#87 산출) |

**⑦ 코어 모듈 슬롯 "빈 슬롯 보존" 복구 (2026-07-21)** — 하네스 플레이테스트(PR#87)가 찾은 서버 결함이다. `guard_defenses_equipped_modules` 가 검증 **전에** `array(select x from unnest(...) x where x is not null)` 로 배열을 재작성해 **빈 슬롯을 밀집화**하고 있었다(before update 트리거라 그 결과가 그대로 저장). 클라가 `[null, M]` 을 보내면 `[M]` 으로 저장되고 재조회 시 `[M, null]` 로 읽혀 **모듈이 슬롯1 로 이동**한다 — `src/net/modules.ts normalizeEquippedModules` 와 `apply_invasion_result` 가 지키던 "슬롯 i ↔ 표시 i" 규약이 서버에서 한 번도 지켜지지 않았다. `apply_module_fusion`(`x <> all(...)`)·`salvage_core_module`(`x <> p_module_id`)의 장착 해제 블록도 같은 밀집화를 했다(null 은 비교 결과가 null 이라 필터에서 탈락).

- **적용 전 원격 실측으로 결함 3건 전부 확인**했다(`pg_get_functiondef` 패턴 매칭) — 리포 SQL 만 보고 적용하지 않았다.
- **DDL 전용**(`create or replace function` 3개 + `comment on column`). DML 0건이라 기존 행 무변경. `defenses` 21행이 전부 빈 배열이라 밀집화된 기존 데이터 자체가 없었다(백필 불요).
- **적용 후 거동 검증**: 롤백되는 `DO` 블록 안에서 `equipped_module_ids = array[null, null]` 을 저장하고 길이를 읽어 `len=2` 확인(구 트리거면 `0`). 구조(함수 정의 문자열)만 보지 않고 **실제 저장 경로로** 확인한 것이다.
- `get_advisors(security)` **신규 ERROR 0건**(전부 기존 WARN). `defenses` 21행 · `core_modules` 0 · `invasions` 0 무변경.
- 클라 쪽 계약 대조 테스트 = `tests/coreModuleSlotContract.test.ts`(17케이스 — 슬롯 수 상수 3중 미러 포함).

> **`supabase db push` 를 쓰면 안 된다.** 원격 migration version 스탬프가 로컬 파일명과 다르다(위 표가 그 실측이다). 지금까지 MCP `apply_migration` 으로 적용해 와서 어긋났고, `db push` 는 이미 적용된 28개를 미적용으로 오판해 재실행한다 — `m4_phase_e_npc_seed`·`m4_phase_e_placement` 재실행은 데이터 리셋 위험이다.

### ②-1 배포 후 검증 — 실측 결과

**DB**

- `defenses` **21행 전부** `layout ? 'l1'` = true.
- NPC **20행 전부** `l2.templateId` 존재.
- 웨이브 레벨 램프 **1..29**(재조정 전 1..58) — M7c 재시드가 실제로 반영됐다.
- `invasions` = 0 · `invasion_snapshots` = 0 유지(시드 재조정이 라이브 침공 데이터를 건드리지 않았다).
- `get_advisors` **신규 경고 0건** — DDL 없는 데이터 UPDATE 라 예상대로다.

**EF 부팅 스모크 (1회차 = `verify-invasion` v17. 2회차 v18·v3 스모크는 §0-① 참조)**

- anon(publishable) 키는 프로젝트가 서명한 JWT 라 `Authorization: Bearer <anon>` + `apikey` 헤더면 `verify_jwt=true` 게이트웨이를 통과한다. **익명 로그인 불요 → `auth.users` 오염 0.**
- `{"invasionId":"not-a-uuid"}` POST → **400 + `{"status":"rejected","reason":"malformed-invasion-id",...}`**. 게이트웨이 오류가 아니라 **함수 자신의 구조화된 응답**이므로 핸들러가 실제로 실행됐다.
- `execution_time_ms` 545, 부팅 스택 없음.
- `deno bundle` 산출물은 단일 자립 파일이라 **부팅 성공 = 76개 모듈 그래프 전체 로드 성공**이다. 이 프로젝트가 겪었던 "EF 가 삭제된 모듈을 import(tsconfig 밖이라 tsc 미검출) → 배포 즉시 사망"(§5) 부류의 위험은 이것으로 닫혔다.

### ②-2 배포 경로 (다음에도 이대로) — 이 절의 핵심 가치

**MCP `deploy_edge_function` 은 구조적으로 불가하다. 재시도 금지.**
이 도구는 `files[].content` 를 인라인 문자열로 받으므로 LLM 이 번들 전체를 토큰으로 재생성해야 하는데, 파일을 파이프로 넘길 경로가 없고 172KB 번들은 출력 토큰 한도에서 잘린다. **독립 시도 3건이 동일 결론에 도달했고 합계 30만 토큰을 소모했다.** `modules`(8,021바이트)가 통과한 것은 번들이 작았기 때문이지 도구가 되기 때문이 아니라, 선례가 못 된다.

**CLI + PAT 가 유일한 경로다.**

> ⚠️ 이 환경의 `supabase` CLI 는 **peruse 계정**으로 로그인돼 있고 토큰은 Windows 자격 증명 관리자에 있다.
> **`supabase login` 을 쓰면 안 된다** — CLI 액세스 토큰은 계정당 1개라 peruse 로그인을 덮어쓴다(글로벌 메모리의 "계정 종속 외부 MCP/CLI 격리" 규칙).
> **환경변수를 User/Machine scope 로 영구 심어도 안 된다** — 모든 창에서 peruse 를 가린다.

해법은 `$PROFILE`(`C:\Users\v0o0v\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`, **UTF-8 BOM 필수** — PowerShell 5.1 은 BOM 없으면 한글을 ANSI 로 읽어 깨진다)에 설치한 **`spb` 래퍼 함수**다. DPAPI 로 암호화된 `~\.supabase-pb.token` 을 읽어 **그 명령이 실행되는 동안에만** `SUPABASE_ACCESS_TOKEN` 을 주입하고 `finally` 로 원복한다.

- `supabase ...` = **peruse** 계정
- `spb ...` = **planet-blitz** 계정

두 계정이 한 셸에서 영구 공존한다.

**빌드는 반드시 detached 클린 워크트리에서** — `git worktree add --detach <tmp> HEAD`. 더티 워킹트리에서 번들하면 HEAD 에 없는 코드가 EF 번들에 섞인다(§7 교훈).

배포 명령:

```powershell
spb functions deploy verify-invasion --project-ref qxgbxwyccbxokdgwxcuw --use-api --workdir "<스테이징 경로>"
```

```powershell
spb functions delete cards --project-ref qxgbxwyccbxokdgwxcuw
```

- 스테이징 디렉터리에는 `supabase/config.toml`(= `project_id` + **배포할 함수마다** `[functions.<slug>] verify_jwt = true`)을 두고, 각 함수의 번들을 `supabase/functions/<slug>/index.ts` 로 배치한다. 한 스테이징에 여러 함수를 두고 `deploy` 를 슬러그별로 반복하면 된다(2회차가 그렇게 했다).
- **`spb` 는 `$PROFILE` 함수라 비대화형 셸에서 자동 로드되지 않는다.** Claude 가 PowerShell 로 직접 실행할 때는 먼저 dot-source 하라: `. "C:\Users\v0o0v\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"` — 그러면 **사용자 손 없이 Claude 가 배포까지 끝낼 수 있다**(2회차 실증).
- **`--no-verify-jwt` 금지.**
- **업로드 대상은 번들을 `index.ts` 엔트리포인트로** 올리는 것이다. 함수 디렉터리 **밖**의 상대 의존(`../../../src/sim/**`)이 있어 소스 `.ts` 를 그대로 올리면 런타임에 죽는다. `dist.index.js` 는 `.gitignore` 대상이라 워킹트리에만 있다 — 없으면 `deno task bundle`(이 환경에 deno 2.8.0 있음).
- 클라 배포는 **EF 재배포 뒤에** 한다. 클라를 먼저 내보내면 비스트라이커 파일럿이 전원 거부된다.

### ③ 하네스 플레이테스트 — **아직 한 번도 실시하지 않았다** (유일한 잔여 항목)

M7a 이후 배포가 끝났으므로 이제 실제로 조작 가능하다. `harness` 스킬로 띄우고 눈으로 확인:

방어 사령부 5탭 전환 / L1 슬롯 선택 시 프리뷰 반영 / L2 템플릿 교체 시 회랑 변화 / 팝업 목록 휠 스크롤 / 시험 침공 후 **정산 미발생** / 코어 모듈 화면 / **침공 완주 1회** / 챔피언 선택 화면에서 7종 전환 → 격납고 쇼케이스·인게임 스프라이트가 실제로 바뀌는지.

프리뷰 축소 배율(패널 안 1920×1080 fit)이 실화면에서 너무 작으면 코어 주변 크롭을 조정한다.

> **이 플레이테스트가 배포 검증의 나머지 절반이다.** 배포 스모크는 조기 반환 경로만 탔으므로 **유효 `invasionId` 정상 경로**(DB 조회 · RLS · service_role · 시뮬 재실행)와 **EF↔마이그레이션 스키마 정합**, **18000틱 재실행 CPU 예산**은 아직 한 번도 실행되지 않았다. "침공 완주 1회"가 이 셋을 동시에 여는 유일한 게이트다. §4 #7·#7-a·#7-b.

**사용자가 직접 수행할 예정이다.**

---

## 1. 완료 상태

| 마일스톤 | 상태 | 커밋 |
|---|---|---|
| M7a 침공 코어 | ✅ 완료 (이전 세션) | `494422e` → `6ddb2c0` |
| M7b 방어체 경제 | ✅ 완료 (이전 세션) | `8790c0a` → `5b9071f` |
| M7a·M7b 원격 배포 | ✅ 마이그레이션 5종 적용 | `63b43bc` |
| M7c 원격 배포 + EF 마감 | ✅ **완료 (2026-07-21)** — 마이그레이션 6/6 · `cards` 삭제 · EF 2종 **v18 / v3**(M8 배선 포함). §0 | 1회차 `7ae64b6` → **2회차 `4ba3ac8`**(번들 소스) |
| M7c 콘텐츠 완충 | ✅ 완료 | `8b98715` |
| M8 설계 정본 | ✅ 완료 | `b4a30f1` |
| M8 기체 챔피언화 | ✅ 완료 (**sim 배선 6/6** — 스트라이커는 §11 대로 의도적 미보유) | `285b41d` → `4ba3ac8` (PR #83) |
| 로스터 5종 → 7종 | ✅ 완료 | `dd93cce` |
| 기체 아트 12장 | ✅ 완료 | `dd93cce`(인게임 6) · `7ae64b6`(쇼케이스 6) |

**검증 기준선(세션 종료 시점, 리드 직접 실측)**
tsc 0 · eslint `--max-warnings 0` · **vitest 97파일 2070테스트 전부 통과**(착수 시 87파일 1631) · `vite build` 성공 · `verify-invasion`·`modules` 양쪽 `deno task check` 통과 · **`git diff -- data/skills.ts` 공백** · 스트라이커 골든 33건 통과 · PvE 회귀 0(`determinism`·`berdan`·`fullRun`·`m3Content`·`denoFixture`·`chunkDeterminism` fixture 해시 불변).

테스트 수 궤적: 1631(착수) → 1781(M7c) → 2057(M8) → **2070**(로스터 7종). 테스트 **파일** 97개는 리포에서 직접 확인했다.

---

## 2. 무엇이 들어왔나

### 2-1. M7c 콘텐츠 완충 (`8b98715`)

M7a 임시 카탈로그를 풀 카탈로그로 확장했다. **전부 배열 끝 append** — 기존 `catalogId` 는 한 칸도 이동하지 않았다(해시 계약).

| 카탈로그 | 전 → 후 | 실측 근거 |
|---|---|---|
| 편대 | 3 → **8** | `data/invasion/formations.ts` (`formation-*` id 8개) |
| 설비 | 6 → **9** | `data/invasion/facilities.ts` (`fac.rapid`…`fac.shock`) |
| 기물 | 3 → **6** | `data/invasion/props.ts` |
| 보스 | 1 → **3** | `data/invasion/defenseBosses.ts` |

- **신규 적 종류 추가 0.** `ENEMY_BY_TYPE.length === 22` 유지(테스트가 못박음). 기존 22종으로 8편대의 역할 분화가 전부 표현됐다 — 탱커=고대 파괴자, 저격=수호 포대, 기뢰=stationary 균열·토템, 치유원=복원 드로이드·냉각 정비병. 적을 늘리면 스프라이트 매핑·조준 술어·EF 재실행까지 계약 표면이 넓어지므로 **역할이 실제로 빌 때만** 늘린다.
- 진입 패턴 3종 append(`ENTRY_GLIDE`/`SNIPE`/`DRIFT`, `PATTERN_COUNT` 3→6). 기존 0~2 거동 무변경.
- **기획서 §5 '전자전 편대'(파워업 봉인)는 미구현.** 플레이어 파워업 억제 훅이 필요해 범위를 벗어난다. 이름만 붙이고 효과가 없는 상태를 피하려 8번째 id 를 `formation-support-escort`(치유원 동반)로 뒀다. **전자전은 `catalogId` 8 로 나중에 append.**

#### 압축 프레스 (이동 벽) — M7a 에서 이월된 항목, 해소

터널링 방지 전제 "벽 최소 폭 120u > 최대 대시 스텝 59u" 는 벽이 움직이면 무너진다(유효 스텝 = 플레이어 스텝 + 벽 스텝). 신설한 것:

- **터널링 = 상대 프레임 스윕.** `sweepAabbEntry`(`src/sim/invasion/movingWall.ts:254`)가 `prev−prevWallPos → cur−curWallPos` 슬랩 클립을 한다. 입력 선분이 곧 (플레이어 변위 − 벽 변위)라 **두께와 무관하게 관통 0**. 정적 폭 비교는 심층 방어로만 남겼다.
- **끼임 = sticky side + 되밀기 없음.** 밀어낼 자리가 막히면 좌표를 확정하고 고정 피해만 준다(무적 프레임 존중). 밀 방향은 "마지막으로 판 밖에 있던 쪽"을 끝까지 유지한다 — "진행 방향으로 민다"와 "최소 침투로 민다"는 **둘 다 플레이어를 판 반대편으로 뱉었다**.
- 좌표는 `base + 정수 삼각파(tick, period, phase, travel)` — 틱의 순수 함수, 단일 나눗셈.
- **신규 EntityKind 를 만들지 않고 기존 `wall` kind 재사용**(`enemyType = MOVING_WALL_TAG`) → `KIND_CODE` 해시 계약 무변경으로 이동 차단·탄 차단·LOS 가림이 기존 경로로 붙는다.
- 프레스 이동 직후 `wallIndex.refresh()`. 인덱스는 침공에서만 존재하므로 PvE 무영향.
- `PRESS_FACILITY_CATALOG_ID = 6`.

#### 그 밖

유니크 방어체 고유 효과 · i18n · **미결 #6(편대·설비의 행성별 분배) 확정** — 하드코딩 표가 아니라 **카탈로그 배열 파생 규칙**이라 신규 항목이 추가돼도 자동 파생된다. sim 은 카탈로그를 모른 채 `{seed, tableIndex}` 불투명 코드만 방출하는 경계를 유지한다. 시드 기지 20기지를 풀 카탈로그 어휘로 재구성(구조·UUID·밴드 분포 7/7/6 무변경 → 회귀 0).

### 2-2. M8 기체 챔피언화 (`285b41d`, 설계 `b4a30f1`)

기체를 "하나의 배" 에서 "고유 트리·시그니처를 갖는 챔피언" 으로 일반화했다.
**고유** = 트리 + 시그니처 패시브 + 스탯 보정 + 외형 / **공통** = 장비 8슬롯 · 조작 · 판정점.

**최우선 제약을 지켰다 — `data/skills.ts` 수정 0줄** (`git diff -- data/skills.ts` 공백, 직접 확인). 이 파일의 노드 인덱스는 **삼중 해시 계약**이다:

| 경로 | 근거 |
|---|---|
| 직접 폴드 | `src/sim/replay.ts:372-376` — `skillInvest` 를 길이 프리픽스 + 원소별 u32 로 접음 |
| 파생 스탯 | `src/items/loadout.ts` → `cfg.loadout` → `replay.ts` |
| **sim 내부 RNG 슬라이스** | `src/sim/powerups.ts:295-303` 이 같은 인덱스를 sim 안에서 슬라이스해 **powerupRng 가중 추첨**에 먹인다 |

세 번째 때문에 **해시 폴드를 완벽히 보존해도 레벨업 틱부터 RNG 스트림이 갈린다.** 그래서 리터럴을 옮겨 적지 않고 `data/ships/striker.ts` 가 기존 export 를 참조로만 조립한다.

#### W0 — 스트라이커 골든을 리팩터 **전에** 녹화했다

`scripts/recordStrikerBaseline.ts` + `tests/fixtures/striker-prem8.json`(393KB) + `tests/shipHashBaseline.test.ts`(33 케이스). 6빌드 × 2행성 × 3000틱 = **12런의 per-tick 해시 전량** + 각 런의 `drawPowerupChoices` 반환 인덱스 배열.

**음성 대조로 유효성을 확인했다** — `WEIGHT_TREE_BASE` 를 4→5 로 한 글자 바꾸자 12런 전부가 정확한 발산 틱과 함께 실패했다(예: 틱 125 에서 `0x1af387c9 ≠ 0x23b3fa6c`). 녹화 없이 시작했다면 이후의 "해시 불변" 은 측정이 아니라 주장이었다.

#### 스트라이커 불변 다섯 겹

1. `data/skills.ts` 무수정
2. 전 신규 경로의 조기 탈출 — `signatureBit < 0` → OR 없음 / `baseBp` 전 축 0 → 조기 반환 / `shipType === 0` → 폴드 없음
3. `WorldConfig.shipType` 을 optional 로
4. 타입 0 벡터 길이 **63 고정**
5. 파워업 태그를 트리 **이름** 에서 **affinity** 로 교체 — 매핑이 `SKILL_TREES.indexOf` 순서와 1:1 이라 가중값 바이트 동일

`hashWorld` 꼬리 폴드는 **`invasion3` 블록 바깥**(`src/sim/replay.ts:444-454`, `SHIP_HASH_VERSION = 1` 은 `:50`)에 `shipType !== 0` 조건부로 뒀다. 블록 안에 넣으면 **PvE 비스트라이커 런이 타입을 전혀 봉인하지 못한다.**

#### 시그니처 = `uniqueMask` 미사용 비트 재활용 (신규 필드·신규 폴드 0)

비트 점유 현황(`src/sim/shipSignature.ts:11-17`): 0~14 유니크 15종 · 15~17 캡스톤 3종 · **18~23 시그니처 6종** · 24~30 미사용 7비트 · 31 영구 금지(`1<<31` 이 음수).

효과 산술은 **정수 basis-point 단일 나눗셈**(`Math.round(x*bp/10000)`) — f64 누적 없음. 클라와 EF 재검증이 비트 단위로 같아야 하기 때문이다.

#### `Profile.skillInvest` 삭제 — 미러를 남기지 않았다

계정 단위였던 투자 벡터를 **기체 단위**로 내렸다(ADR-0019 정합, 퇴역 = 세대 리셋 유지). 호환 미러로 남기면 "연구소는 미러에 쓰는데 런은 기체 벡터를 읽는" 무배선 결함이 그대로 재현되므로 삭제했다. `SAVE_VERSION` **3 → 4**(`src/items/types.ts:24` 확인), `migrateV3toV4` 로 승계(v3 semantics 가 계정 단위였으므로 **모든 기체가 계정 벡터를 물려받는다**).

**DB 마이그레이션은 불요로 확정** — `supabase/migrations/**`·`src/net/**` 전량에 `skillInvest` 0건. 서버가 `profiles.save` jsonb **안쪽**을 읽는 경로는 `save->>'credits'`·`save->>'minerals'` 둘뿐. `profiles.save_version` 은 CHECK 제약·서버 분기가 전무해 4 를 그대로 받는다. 스키마 변경이 jsonb 안에 갇힌다.

#### `buildRunConfig` 단일 함수 추출 (`src/run/runConfig.ts`)

`main.ts` 의 런 config **3중복 조립**이 "저장은 되는데 런에 안 닿는" 결함의 구조적 원인이었다. 단일 함수(`buildRunConfig(profile, opts)`)로 추출하고 호출부가 전부 이것을 쓰게 했다(`main.ts` 에서 `buildRunConfig` 참조 5건 확인).

#### EF 교차검증 — 라이브 파손 지점을 닫았다

`scripts/deno-verify/scenarios.ts` 에 **비스트라이커 시나리오 ⑦**(해츨링, `:375`) 추가. 기존 6종이 전부 스트라이커 전제라, EF/Deno 가 기체 타입을 모르면 클라 단위 테스트가 전부 그린인 채 **비스트라이커 런만 서버 재실행에서 갈린다**. 시나리오가 세 축을 동시에 자극한다: 조건부 꼬리 폴드 / 시그니처 비트 → `signatureOn` 분기 / 타입별로 길이가 다른 `skillInvest`(해츨링 78). `fixtures.json` 은 **append 만** — 삭제된 줄은 `"scenarioCount": 6` 한 줄뿐이고 기존 6종 해시는 불변.

#### UI

`src/ui/pixi/championSelect.ts` 신규(로스터 + 트리 미리보기 + 퇴역 확정 모달) · `shipLabels.ts` · 격납고 쇼케이스 타입별 분기(폴백은 기존 텍스처) · 연구소 양판 타입별 트리 대응.

### 2-3. 로스터 7종 (`dd93cce`) — 사용자 지시 반영

사용자 지시(2026-07-21): 4번 기체(`bion`)의 곤충·생체 컨셉 반려 — "벌레말고 다른 컨셉으로 하나 하자. 너무 징그럽다. 귀여운 걸로 하나 해줘." → 후보 검수 후 "0 5 7 로 하자 두개 더 추가하자".

`SHIP_TYPES`(`data/ships/index.ts:55-63`) 실측:

| id | slug | 역할 | 트리 (off/util/def) | 비트 | baseBp (dmg/rate/hp/move) | sim 배선 |
|---|---|---|---|---|---|---|
| 0 | `striker` | 만능 기준점 | firepower·mobility·survival(현행) | −1 | 0 / 0 / 0 / 0 | — (시그니처 없음) |
| 1 | `bruiser` | 맞으며 전진 | blade·morph·fortify | 18 | +800 / −600 / +2500 / −500 | ✅ `world.ts:1093,2259` |
| 2 | `arccaster` | 정지 포격 | chain·barrage·barrier | 19 | +1200 / −1000 / −1000 / −1200 | ✅ `world.ts:1102,1230` |
| 3 | `phantom` | 은신 암살 | assassin·phase·disrupt | 20 | +1500 / 0 / −2000 / +800 | ⬜ 스텁 |
| 4 | `hatchling` | 동료 소환 | brood·nurture·shelter | 21 | −500 / +500 / +1000 / 0 | ⬜ 스텁 |
| 5 | `mallow` | 완충 재생 | squish·mend·cushion | 22 | −800 / −200 / +1800 / +600 | ⬜ 스텁 |
| 6 | `bubble` | 거품 방막 | pop·drift·film | 23 | +300 / +700 / −1400 / +200 | ⬜ 스텁 |

- **개명은 거동 중립.** `bion` → `hatchling` 은 slug·트리 slug·노드 **이름**만 바꿨고 스탯·`perPoint`·`maxPoints`·티어 배치는 한 글자도 안 바꿨다(벡터 길이 78 · 노드 25/트리 · `capstoneGate` 44 유지). `SIG_BION_SPORE` → `SIG_HATCHLING_BROOD` 이지만 **비트 값 21 은 불변**(`uniqueMask` 는 wire 계약). 직접 증거: `scripts/deno-verify/fixtures.json` 이 시나리오 **이름 1줄만** 바뀌고 전 해시·체크포인트·롤이 바이트 동일했다.
- 5·6 은 **중간 삽입 없는 append**. `nodesPerTree=20` · `capstoneGate=40`(기존 3종과 동일 골격). **신규 StatKey 0**(기존 16종 안).
- 신규 순수 함수: `cushionDeferredDamage`/`cushionImmediateDamage`/`cushionRecovered`, `filmReady`/`filmAbsorbed`/`filmRemainingDamage`. **즉시분+지연분 = 원피해**, **흡수+통과 = 원피해** 를 스윕으로 못박았다(각각 따로 반올림하면 1이 샌다).
- 21쌍 전부 L1 분포거리 > 0.35(실측 최소 0.423) — 7종이 실제로 서로 다른 빌드 방향.
- 반려 어휘 회귀 테스트: KO 14종(벌레·곤충·군체·역병·변이·포자·유충·촉수 등) / EN 정규식(`bug|insect|larva|swarm|plague|blight|spore|mutate|parasite|infest`) 부재를 **`SHIP_TYPES` 파생**으로 강제. 적 진영 문구(`anomaly.swarm`·`def3.boss.sporeQueen`)는 대상 밖 — 반려된 것은 플레이어 기체다.
- 신규 테스트 4건 전부 **뮤테이션으로 실패 확인**(통과만 보고 넘기지 않았다).

### 2-4. 아트 (`dd93cce`, `7ae64b6`)

`assets/` 실측 — 인게임 `ship_<slug>.png` 6장(64×64, 기수 **+X**, `shipFacing` 무오프셋 규약 정합) + 쇼케이스 `ship_showcase_<slug>.png` 6장(128×128). 스트라이커는 기존 `player.png` / `ship_showcase_fighter.png` 무수정.

- **계열 캡스톤 아이콘 신규 0장.** 설계 초안은 12장을 예상했으나 `buildShipTree`(`data/ships/authoring.ts:59,67`)가 `SkillNode.tree` 에 **affinity 의 레거시 트리명**(`firepower`/`survival`/`mobility`)을 넣으므로 `skillIconName`(`uiTextures.ts:224`)이 항상 기존 3장으로 해석된다. `SKILL_ICON_NAMES` 등재 누락 위험이 애초에 발생하지 않았다.
- `import.meta.glob` 로 잡히므로 매니페스트 등재 불요. `vite build` 산출 JS 를 파싱해 신규 6장이 data URI 로 인라인됐음을 실제로 확인했다(4KB 미만이라 `dist/assets/` 에 파일이 안 보이는 것이 정상).
- pixellab-forge 리포 동기화 PR **#25·#26 머지 완료**(캐시 ↔ 리포 538 일치).

### 2-5. 배포 반영 (`63b43bc`)

- **마이그레이션 5종 원격 적용 완료** — `20260720191311 m7a_invasion_3layer` ~ `20260720192019 m7b_blueprint_drops`(MCP `list_migrations` 로 재확인). `defenses` 21행 전부 `l1`/`l2`/`l3` 보유. `get_advisors(security)` **ERROR 0건**, 신규 테이블 5종 전부 RLS 정책 보유.
- `modules` EF **v1 ACTIVE**(`verify_jwt=false`).
- 각 `.sql` 헤더의 "원격 적용 금지 — 리포 커밋만" 주석 제거(사용자 승인으로 해제).
- `supabase/README.md` 10곳 갱신 — `TURRET_SPECS`·`defenseLayoutCost`·`DefenseLayout`·15×9 격자 서술을 3레이어 구조로 교체. `dist.index.js` 서술을 "배포 직전 `deno task bundle` 재생성 필수"로 교정.

---

## 3. 결정이 필요한 것

1. **팬텀·해츨링·말로우·버블 시그니처 배선 시점.** 지금 4종은 "baseBp + 트리 분포가 다른 기체"다. 배선 난이도 순서 제안: 팬텀(조준 술어 — `world.ts` 최대 경합) < 해츨링(소환 RNG 함정) < 말로우·버블(시간축 상태 — 지연 피해 큐 / 주기 재생성 막). **배선 순서와 M8.5 편입 여부를 결정해야 한다.**
2. **스트라이커 시그니처(M8.5).** 기획서는 스트라이커에게 "연속 처치 시 발사 속도 스택"을 주기로 했으나 해시 불변 게이트와 충돌한다. 설계서 §11 채택안 A 대로 **리팩터가 안정된 뒤 `SHIP_HASH_VERSION` bump + fixture 재생성을 의도적·단독으로** 수행하기로 보류돼 있다. 착수 시점 미정.
3. **전자전 편대(`catalogId` 8).** 플레이어 파워업 억제 훅 신설이 선행 조건.
4. **L2 경로 분기(상하 갈림길)** — 기획 §10-8 확장 예약. 도입 시점 미정.
5. **신규 기체 밸런스.** `baseBp` 6종 전부 **제안값**이다. 확정된 것은 축과 부호뿐. 밸런스 패스를 언제 돌릴지.
6. **`defense_blueprints` 보관 상한**(`defense_units` 는 60). 수량 카운터라 행 폭증 위험은 낮으나 정책 결정이 남아 있다.

---

## 4. 남은 부채·위험

> **2026-07-21 배포로 해소된 항목:** #1(`verify-invasion` 재배포 + `cards` 삭제) · #5(`m7c_seed_rebalance` 원격 적용). 아래 표에 ✅ 로 남겨 둔다 — 삭제하지 않는 이유는 다음에 같은 일을 할 때 경로(§0-②-2)를 되짚기 위해서다.

| # | 항목 | 상태 |
|---|---|---|
| 1 | ~~**`verify-invasion` 재배포 + `cards` 삭제**~~ | ✅ **해소** (2026-07-21). v16→v17 ACTIVE · `cards` 삭제 완료. 경로는 §0-②-2 |
| 2 | **하네스 플레이테스트 미실시** | ⚠️ **잔여 — 최우선.** 배포가 끝나 이제 실제 조작이 가능하다. **사용자가 직접 수행할 예정.** §0-③ |
| 3 | **시그니처 sim 배선 스텁 4종** | 팬텀·해츨링·말로우·버블. 상수·순수 함수만 있고 `world.ts` 분기 없음 — 설계 §3 "브루저·아크캐스터 우선 배선" 원칙에 따른 **의도된 미완** |
| 4 | **Deno 시나리오 비스트라이커 1건뿐** | ⑦(해츨링)만. **typeId 5·6 EF 커버리지 없음** — 출시 전 추가 권장 |
| 5 | ~~`20260723000000_m7c_seed_rebalance.sql`~~ | ✅ **해소** — 원격 적용 완료(version `20260721042605`, 2026-07-21). §0-② |
| 6 | **신규 기체 밸런스 미검증** | `baseBp` 는 제안값 |
| 7 | **EF 재실행 CPU 예산 실측 미완** | ⚠️ **잔여.** `SOFT_RERUN_BUDGET_MS` 8000 → 20000. 18000틱 3레이어 재실행이 Supabase Edge Runtime 한도를 넘는지 **여전히 미측정**이다 — 배포 스모크의 `execution_time_ms` 545 는 **조기 반환(`malformed-invasion-id`) 경로 값이라 정보량 0**이다. 넘으면 L3 엔티티 상한·컬링 반경을 먼저 조이고, 최악의 경우 "전 구간 재실행" → "샘플 구간 재실행" 아키텍처 변경 |
| 7-a | **유효 `invasionId` 정상 경로 미검증** | ⚠️ **잔여.** 배포 검증은 조기 반환 경로만 탔다. **DB 조회 · RLS · service_role 권한 · 시뮬 실행**은 한 번도 실행되지 않았다 — 하네스로 침공을 1회 완주해야 처음 통과한다 |
| 7-b | **EF ↔ 마이그레이션 스키마 정합 미검증** | ⚠️ **잔여.** v17 번들이 기대하는 컬럼·RPC 시그니처가 원격 스키마(28건 적용본)와 실제로 맞는지는 정상 경로를 태워야 확인된다. #7-a 와 같은 게이트에서 함께 닫힌다 |
| 8 | **모듈 장착 상태로 침공을 끝까지 완주하는 e2e 없음** | 구간 관측 + 3000틱 해시 대조까지만. `tests/invasionE2E.test.ts` 의 승리 시드는 모듈 미장착 기준 |
| 9 | **수호 중복 선택 판별**이 `(snapshot.hp, performanceCP)` 조합 | 배치에 원본 `GuardianRecord.id` 가 실리지 않는 스키마 제약. 완전히 같은 스펙의 수호가 둘이면 한쪽만 쓰인다 |
| 10 | `grant_blueprints` 가 authenticated 클라 호출 | 현행 장비 드랍과 동급 트러스트 모델이라 의도적. 강화한다면 장비 드랍과 **함께** 서버 권위로 올려야 한다 |
| 11 | `GRID_COLS` grep 잔존 5건 | `refinery.ts`(=6)·`resultOverlay.ts`(=8) 의 무관한 지역 UI 상수. 구 15×9 방어 격자와 무관해 개명하지 않았다 |
| 12 | **CrazyGames 제출 보류** | 상태 그대로 |
| 13 | ~~**`verify-pve-sample` 구 번들 잔존**~~ | ✅ **해소** (2026-07-21 2회차). v2 → **v3**, 소스 `4ba3ac8`. 같은 회차에 `verify-invasion` 도 v17 → **v18** 로 갱신해 M8 배선이 원격에 도달했다. §0-① |

**미확인으로 남긴 것**
- `supabase/functions/verify-run` 은 리포에 디렉터리가 있으나 **원격 EF 목록에 없다**(원격 = `verify-invasion`·`verify-pve-sample`·`modules` 3종). ✅ **의도적 미배포로 확정** — `deno.json` 이 `"Supabase 프로젝트 미생성 — 배포 전 로컬 확인 전용"` 이라 명시하고 `tasks` 에 **`bundle` 이 아예 없다**(`serve`·`check` 뿐). 배포 대상이 아니므로 M8 재배포에서 제외한 것이 옳다.
- ~~`dist.index.js` 실크기~~ → ✅ **확정: 172,056바이트**(sha256 `04D1D45…86169AC`, 커밋 `7ae64b6` 클린 detached 워크트리 산출물). §0-①.

---

## 5. 이 프로젝트에서 반복 발생한 결함 유형

> **"단위 테스트는 전부 그린인데 배선이 통째로 없다."**
> M7a·M7b 세션에서만 8건 나왔고, **이번 세션에도 같은 유형이 재발했다.** 각 레인의 단위 테스트가 자기 소유 모듈을 직접 호출하므로, 모듈끼리 이어붙이는 코드가 아예 없어도 전부 통과한다.

### 이전 세션 사례 (참고)
- 해시 봉인 미작동 — L1 계약명 `invasionRuntime` ↔ L2 구현명 `invasion3` 불일치로 항상 `present=0`. **해시 테스트도 같은 팬텀 이름을 써서 결함을 함께 통과시키고 있었다.**
- 스텝 훅 미등록 — 3레이어 런이 예외 없이 5분간 빈 맵을 스크롤.
- 레이어 전이가 스크롤 오프셋을 리셋하지 않아 콘텐츠가 7만 유닛 밖에 스폰.
- 코어 모듈 스폰 효과가 T0 스캔인데 3레이어는 레이어 진입에서 스폰 — 코어 HP 증폭·신기루 코어가 전부 무효.
- `isPlayerTargetable` 누락 — 신규 방어체가 "맞기는 하나 조준되지 않는" 상태.
- EF 가 삭제된 `defense.ts` 를 import — **tsconfig 밖이라 tsc 가 못 잡는다.**

### 이번 세션에 나온 것 — 게이트가 잡았다
- **스프라이트 슬롯 테스트가 `def.id` 를 손으로 넣고 있었다.** 그래서 "`Ship.typeId` 는 저장되는데 `WorldConfig.shipType` 에 도달 못 함"(설계 §10-2)을 원리상 못 잡는다. **정규 경로**(`Profile{typeId:N}` → `buildRunConfig` → `createWorld` → `stepWorld` 후 **그 런의 `config.shipType`** 으로 텍스처를 태움)로 다시 짰다.
- **sim 상수 ↔ 레지스트리 필드가 갈려도 양쪽 단위 테스트는 그린인 지점.** `shipSignatureRegistry` 테스트가 6쌍을 대조하도록 신설.
- **스텁 전제가 소멸한 테스트 / 무의미해진 퇴역 테스트.** 배선이 실데이터로 바뀌자 옛 전제를 고정하던 테스트가 결함을 감싸고 있던 것이 드러났다.
- **EF/Deno 가 기체 타입을 모르는 상태**(설계 §10-8). 클라 2000여 테스트가 전부 그린인 채 **서버 재실행만 갈리는** 유일한 라이브 파손 지점이었다 — Deno 시나리오 ⑦ 로 봉인.

### 대응 규칙
1. 레인 작업 후 반드시 **정규 경로**(`createWorld`→`stepWorld`, 실제 게이트웨이 호출, `vite build`, `deno check`/`bundle`)로 도는 통합 테스트로 확인한다. `tsc` 는 `supabase/functions/**` 와 런타임 import 경로를 안 본다.
2. 테스트가 sim/데이터를 **직접 조립하면 안 된다** — 실제 앱이 쓰는 함수를 타야 한다.
3. 신규 테스트는 **뮤테이션으로 실패를 확인**한다. 통과만 보고 넘기지 않는다.
4. 계약이 두 곳에 적히면(상수 ↔ 레지스트리, 클라 ↔ EF) **양쪽을 대조하는 테스트**를 반드시 만든다.
5. 목록·게이트는 하드코딩 대신 **레지스트리 파생**으로 짠다(`SHIP_TYPES` 파생 i18n·아이콘·어휘 테스트, `SIGNATURE_BITS` 순회). 항목이 늘 때 게이트가 자동으로 따라온다.

---

## 6. 아키텍처 불변식 요약 (건드리기 전에 읽을 것)

- **`data/skills.ts` 는 수정하지 않는다.** 삼중 해시 계약(§2-2).
- **`SHIP_TYPES` 는 append-only.** 배열 인덱스 = `ShipTypeDef.id` = 세이브·리플레이 wire 값. 재번호·재정렬 금지.
- **시그니처 비트 18~23 은 재번호 금지**, 24~30 만 신규 가용, 31 영구 금지.
- **카탈로그 배열(편대·설비·기물·보스)은 append-only.** `catalogId` = 배열 인덱스.
- **`ENEMY_BY_TYPE.length === 22`.** 늘리려면 스프라이트 매핑·조준 술어·EF 재실행까지 계약 표면이 함께 넓어진다.
- **`hashWorld` 신규 폴드는 `invasion3` 블록 최후미 append**, M8 꼬리 폴드는 그 **블록 바깥** 뒤.
- **모든 sim 산술은 정수 basis-point + 단일 나눗셈.** f64 누적·`Math.pow` 금지.
- **UI 는 전부 Pixi**(ADR-0014). 목록 행 클릭은 행 Container 에, 휠은 클립 Container+hitArea 에, 패널 여백은 `panelContent()` 상자로, 상위→하위 진입은 `suspend()`/`resume()`, 리스너를 재빌드되는 build 함수 안에 두지 말 것.

---

## 7. 이번 세션의 오케스트레이션 교훈 (반드시 기록)

1. **워크플로 안에서 도는 레인에 `SendMessage` 를 보내지 마라.** "활성 태스크 없음 → 트랜스크립트에서 재개"로 처리되어 **워크플로 밖에 두 번째 인스턴스가 복제**된다. 같은 파일을 두 주체가 동시에 써서 **테스트가 통째로 롤백되는 사고**가 났다(재작성으로 복구). 지시는 **워크플로 스크립트 프롬프트에** 넣어야 한다.
2. **백그라운드 작업이 도는 중 사용자 인터럽트를 걸면 그 에이전트도 함께 끊긴다.** W2 게이트가 그렇게 죽어 워크플로가 중지됐고 `resumeFromRunId` 로 복구했다.
3. **더티 워킹트리에서 `deno bundle` 하면 HEAD 에 없는 코드가 EF 번들에 섞인다.** 반드시 `git archive HEAD` 나 detached worktree 에서 번들할 것. (§0-① 의 번들 크기 3중 불일치가 이 위험의 잔상일 수 있다.)
4. **레인 소유 파일 목록은 실제로 겹치지 않아야 한다.** L1 에게 L3 소유 파일(`profile.ts`)을 건드리게 만든 지시가 충돌을 낳았다. 소유권을 문서에 적는 것으로 끝내지 말고, 지시문의 파일 목록끼리 교집합을 실제로 계산하라.
5. **리뷰어류 에이전트는 결과 전달 방식에 주의**(글로벌 메모리 기록분) — team 컨텍스트에서 spawn 하면 `SendMessage` 보고 없이 final text 로 끝내 결과가 유실될 수 있다. plain `Agent` 로 spawn 하거나 보고 방식을 프롬프트에 명시할 것.
