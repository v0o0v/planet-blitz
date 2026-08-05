# 일일 보상 구현 계획

- 상태: **Critic 2차 반영 완료, 착수함**(합의 이력 참조)
- 입력 스펙: `.omc/specs/deep-interview-daily-reward-gaps.md` (모호도 20%, AC 26개)
- 선행 결정: `docs/adr/0048-daily-reward-outside-settlement-bounded-by-cap.md` (결정표 20갈래) · `CONTEXT.md`(신규 5항목)
- 합의 모드: RALPLAN-DR **deliberate** (마이그레이션 + 위조 방어를 포함하므로)

> 이 계획은 정책을 **재결정하지 않는다.** ADR-0048 이 정한 20갈래는 입력이며, 계획의 일은
> 그것을 커밋 가능한 단위와 의존 순서로 바꾸는 것이다.

---

## RALPLAN-DR

### Principles

1. **순수 함수부터, 서버 다음, 화면 마지막** — 산식은 서버·클라·EF 가 공유하므로 정본이 하나여야 하고, 순수 함수는 서버 없이 잠글 수 있어 가장 싸다.
2. **스키마는 한 번에, 지급 분기는 점진적으로** — 원장·컬럼 형태는 6축이 동일하므로 마이그레이션을 쪼갤 이유가 없다. 쪼개면 두 번 만진다.
3. **최대 위험은 배송 원자성이지만, 그것은 슬라이스 순서로 증명되지 않는다** — 실패 모드 셋(다기기 통짜 폐기·mark 실패 후 분해·용량 만석)이 하네스 e2e 로 재현되지 않으므로, 순서를 바꿔 앞으로 당기는 것은 위험을 노출하는 것이 아니라 노출했다고 믿게 만든다. **순수 함수 7케이스로 잠근다**(§C5 — 초안이 "3케이스"라 적은 것은 낡았다. 다기기 통짜 폐기를 덮는 ⑦이 추가되면서 케이스가 자랐고, 이 절이 그 숫자를 인용하고 있었다).
4. **모의는 실서버를 가리지 않는다** — 하네스 모의가 config 보다 먼저 적용돼 실서버를 조용히 가린 전례가 있다. 모의는 실경로가 동작한 **뒤에** 붙인다.
5. **전역 잠금 전순서는 성립하지 않는다** — 실측 결과 리포에 통일된 방향이 없다(`catalyst_inventory→profiles` vs `profiles→core_modules`). 그래서 **축별 기존 관례를 따르고, 한 트랜잭션에 인벤토리가 1개만 등장하도록 구조적으로 강제**한다. 계약 테스트가 그 구조를 단언한다.
6. **실 DB 를 요구하는 단언은 vitest 에 쓸 수 없다** — 이 리포에 `createClient` 를 쓰는 테스트가 **0건**이고 계약 테스트 5종은 전부 SQL 텍스트 파싱이다. 멱등·캡 산입·절삭처럼 왕복이 필요한 것은 **`prove-*.ps1`(원격 psql + `BEGIN…ROLLBACK`)이 유일한 수단**이다.

### Decision Drivers (top 3)

1. **배송 경로가 리포에 없다** — 의뢰 기능이 정확히 이 자리에서 멈췄다(`fetchCommissionGrantsOnline` 미호출). 같은 함정을 반복하면 "매일 주는데 안 오는" 결함이 매일 재생산된다.
2. **상한 유계가 유일한 안전장치다** — 정산 요약 밖 지급이므로 다른 방어선이 없다. 그것이 실제로 무는지 실증하지 못하면 기능을 켤 수 없다.
3. **잠금 순서 위반은 조용하다** — 리포 배너가 "무엇으로도 안 잡힌다"고 명시한 유일한 결함 종류이고, 이 RPC 가 잠글 테이블이 5개라 가장 노출된다.

### Viable Options — 구현 순서의 모양

#### Option A: 6축 동시 관통
계층 순서는 Option B 와 **같다**(마이그레이션 → 산식 → EF → net → 화면). 다른 것은 **첫 관통에 몇 축을 넣는가** 뿐이다 — A 는 각 계층에서 6축을 다 만든다.
- **Pros** 슬라이스 경계를 관리할 필요가 없고 중간에 꺼 둘 것이 없다.
- **Cons** 화면을 보기까지 6~7 커밋이다(축 개수가 각 계층을 부풀린다). 이 리포는 *"실화면이 잡은 3건이 전부 테스트 초록"* 이었던 전례가 반복되므로 늦은 화면 피드백이 산식까지 되돌린다. 그리고 진짜 미지 다섯이 마지막에 몰려 드러난다.
- *(초안은 이 대안을 "계층 우선 vs 수직 슬라이스"로 세워 계층 미학만 따른다고 기각했으나, 두 옵션의 계층 순서는 동일하다 — 축 범위가 실제 차이였다. 허수아비였으므로 다시 썼다.)*

#### Option B: 수직 슬라이스 (권장)
스키마는 6축 전부를 한 번에 만들고, **지급 분기는 재화 1축만** 끝까지 관통시킨다(마이그레이션 → 산식 → EF → net → 모달 → 실화면 확인). 그 슬라이스가 초록이 된 뒤 남은 5축을 분기에 채운다.
- **Pros** 배송·수령 원자성·모달 진입이 **3~4 커밋 안에** 실화면으로 증명된다. 마이그레이션은 한 번만 만진다(스키마가 축과 무관하다). 재화는 서버 정본이 이미 있어(`grant_currency_for`) 배송함 없이 되므로 가장 짧은 관통이다.
- **Cons** "장비 배송함"이 첫 슬라이스에 없으므로 배송함 멱등은 두 번째 슬라이스에서 처음 시험된다 — 가장 위험한 조각이 첫 관통에 안 들어간다.

#### Option C: 화면 우선 (모의 기반)
하네스 모의로 화면부터 만들고 서버를 나중에.
- **Pros** 화면 피드백이 가장 빠르고, "구려 보인다" 류 재작업이 가장 싸다.
- **Cons** 모의가 실서버를 가린 전례가 있어(§Principle 4) 모의 초록이 실경로 초록의 증거가 되지 못한다. 상한 유계·잠금 순서·멱등이 전부 마지막으로 밀린다 — Driver 2·3 을 정면으로 어긴다.

### 선택: Option B — 첫 슬라이스는 **재화 축**, 배송함 스키마는 슬라이스 1 에 동반

초안은 "가장 위험한 조각을 앞으로"라는 이유로 첫 슬라이스를 **장비 축**으로 바꿨다. Architect
검토가 그것을 기각했고 근거가 맞다:

**배송함의 실제 실패 모드 셋이 슬라이스 1 완료 판정으로 재현되지 않는다** — ①다기기 통짜 선택
폐기(`src/net/profileSync.ts:121-134`) ②`mark` 실패 후 분해 ③인벤·창고 만석. 1인·1기기·빈
인벤토리 하네스에서 30일을 치트로 밀어도 셋 다 잠들어 있다. 즉 "가장 위험한 조각을 첫 관통에
넣었다"는 것은 **위험을 노출한 것이 아니라 노출했다고 믿게 만든 것**이다 — 이 계획이
§Expanded Test Plan 에서 경계한 "죽은 계측기"의 설계 판이다.

게다가 장비 축 슬라이스는 **배포 불가**다(§E). 그래서:

- **첫 슬라이스 = 재화 축.** 곁들이 크레딧이 곧 주 보상이 되므로 슬라이스 1 이 그 자체로 일관된
  제품이고, 경로가 라이브 검증된 `grant_currency_for` 다. 진짜 미지(권한 경계·예고 왕복·캡
  산입·모달·연속일 봉인)가 3~4 커밋 안에 전부 드러난다.
- **배송함 스키마는 슬라이스 1 마이그레이션에 그대로 둔다** — Principle 2("스키마는 한 번에")를
  어기지 않는다. 지급 분기만 슬라이스 2 다.
- **배송함 위험은 순수 함수 + vitest 3케이스로 잠근다**(§C5·§위험표) — 하네스 30일 밀기보다 싸고,
  세 실패 모드를 실제로 건드리는 유일한 방법이다.

기각 근거: Option A 는 Driver 없이 계층 미학만 따르고, Option C 는 Driver 2·3 을 어긴다.

### Pre-mortem — 이 계획이 실패하는 3가지 방식

#### 1. ABBA 교착으로 프로덕션 RPC 두 개가 정면으로 멈춘다

**초안의 완화책이 불충분했다. 실측으로 기각하고 교체한다.**

초안은 `claim_daily_reward` 가 인벤토리 4종 + `profiles` 를 잠근다고 보고 **전순서 선언**을
완화책으로 삼았다. 기존 `for update` 순서를 전수 수집한 결과 그 완화책은 성립하지 않는다 —
**리포에 통일된 방향이 없다:**

| 함수 | 순서 | 근거 |
|---|---|---|
| `grant_catalyst`·`buy_catalyst`·`salvage_catalyst` | `catalyst_inventory → profiles` | `20260731000000_catalyst_shop.sql:37-40` (선언된 규약) |
| `salvage_core_module` | `core_modules → profiles` | `20260726000000_currency_server_authority.sql:599` → `:631` |
| `apply_module_purchase` | `profiles` 먼저 | 같은 파일 `:536` |
| `salvage_card`(폐지 계열) | `defense_cards → profiles` | `20260718160000_m6_defense_cards.sql:542` → `:564` |
| `apply_card_purchase`(폐지 계열) | `profiles → defense_cards` | `20260718170000_m6_card_economy_rpc.sql:80` → 이후 insert |

어떤 전순서를 택해도 기존 함수 중 일부와는 반대가 된다. 배너가 적었듯 위반은
*"단위 테스트·1바퀴 플레이·육안 무엇으로도 안 잡힌다."*

**교체된 차단책 — 여러 테이블을 잠그지 않는다.** 이 위험은 잘못된 전제에서 나왔다. 하루치는
**주 보상 1개 + 곁들이 크레딧**이므로 한 번의 수령이 만지는 인벤토리는 **최대 1개**다.
5개를 동시에 잠글 이유가 애초에 없다.

- `claim_daily_reward` 는 `daily_reward_claims` → **낙찰된 축의 인벤토리 1개** → `profiles`
  만 잠근다. 축이 6개라도 **한 호출에 등장하는 인벤토리는 하나**다.
- 그 하나의 순서는 **그 축의 기존 규약을 그대로 따른다** — 촉매면 `catalyst_inventory → profiles`,
  코어 모듈이면 `core_modules → profiles`. 새 순서를 발명하지 않으므로 **새 교착 쌍이 생기지 않는다.**
- 축별 지급을 별개 RPC(또는 같은 RPC 안의 배타 분기)로 두고, **두 인벤토리가 한 트랜잭션에
  등장하는 경로를 구조적으로 금지**한다. 계약 테스트가 그것을 단언한다(본문에 인벤토리 테이블
  이름이 2개 이상 `for update` 로 등장하면 실패).
- ⚠️ **코어 모듈 축은 방향을 고를 필요가 없다.** 초안은 *"코어 모듈 축은 `profiles` 를 먼저
  잠근다"* 로 적었는데, 그것은 **이 RPC 가 기존 `core_modules` 행을 잠근다는 잘못된 전제**에서
  나왔다. 일일 보상의 코어 모듈 분기는 **신규 insert 전용**이다 — 없는 모듈을 주는 것이지 있는
  모듈을 소모·환급하는 것이 아니므로 **기존 행을 `for update` 로 잠그지 않는다.** 잠글 행이
  없으면 방향이 없고, 방향이 없으면 어느 기존 함수와도 반대가 될 수 없다.
  - 각주 — **코어 모듈 축은 내부적으로 두 방향이다.** `salvage_core_module` 은
    `core_modules → profiles`(`20260726000000_currency_server_authority.sql:599` → `:631`),
    `apply_module_purchase` 는 `profiles` 먼저(같은 파일 `:536`). 즉 "그 축의 관례"라는 것이
    **그 축 안에서도 하나가 아니다.** 어느 쪽을 따라도 나머지 하나와 반대가 되므로, 잠그지
    않는 것이 유일하게 안전한 선택이다.
  - 축마다 그 축의 관례를 따른다는 원칙은 **잠글 기존 행이 있는 축**(촉매)에만 적용된다.
- 배너가 경고한 한계도 승계한다: `insert ... on conflict do update` 로 잠기는 행은 `for update`
  정적 단언의 시야 밖이므로, 가산 대상 행은 `profiles` 를 잠그기 **전에** 확보한다
  (`20260731000000_catalyst_shop.sql:41-44`).

#### 2. 장비가 복제되거나 영영 오지 않는다
배송함은 두 실패를 동시에 막아야 한다. 클라가 세이브에 반영한 **뒤** `mark_applied` 를 부르므로,
그 사이에 죽으면 다음 부팅이 같은 행을 다시 반영한다 → **복제**. 반대로 반영 전에 mark 하면
→ **유실**. 순서를 어느 쪽으로 놓아도 한쪽이 열린다.

**차단** — 순서로 풀지 않고 **반영 자체를 멱등으로** 만든다. `item_id` 를 배송함 행에서
결정론적으로 파생(`daily:{date_seed}` 같은 안정 키)하고, 세이브 반영은 그 `item_id` 가 이미
있으면 no-op 이다. `items` 의 `unique (profile_id, item_id)` 제약이 서버측에서도 같은 것을
보장한다. 그러면 반영→mark 순서가 안전해지고(중복 반영이 무해), mark 실패는 다음 부팅의
무해한 재시도가 된다. **테스트로 잠근다**: 반영 직후 mark 전에 중단시키고 재부팅해 아이템이
정확히 1개인지 단언.

#### 3. 어떤 경로로 들어온 유저는 그날 못 받는다
**경로는 여럿으로 보였으나 `openBaseMap()` 단일 지점으로 수렴한다** — 부팅 직행·런 종료 후
복귀·타이틀에서 진입·다른 화면에서 뒤로가 전부 그 함수 하나를 거친다(§C6 실측: 호출부 18곳).
초안이 이 절에서 "경로가 여럿"을 위험으로 서술한 것은 **과대평가**였고, 본문 C6 가 그것을
뒤집는다. **남는 위험은 둘뿐이다** — ①재진입 2경로(언어 전환 `rerenderCurrentScreen` ·
하네스 `harnessRefreshScreen`)에서 모달이 **재발**하는 것 ②`openBaseMap` 은 동기인데 수령은
서버 왕복이라 **응답이 도착할 때 이미 다른 화면**일 수 있는 비동기 창. 처방은 아래 그대로
유효하고, 겨누는 곳만 "경로 누락"에서 "재발·비동기 창"으로 좁아진다.

**차단** — 진입 경로에 붙이지 않는다. 리포 교훈이 이미 정본이다: *"레이어 표시는 진입 경로가
아니라 화면 이름 단일 권위."* 기지 화면이 **표시 상태로 들어가는 단일 지점**에 훅을 걸고, 그
지점을 순수 함수(`shouldOpenDailyReward(lastSeenSeed, nowSeed)`)로 뽑아 테스트가 경로와
무관하게 잠근다. 경로별 처방을 쓰면 실패해 재신고를 받은 전례가 있다.

### Expanded Test Plan

| 층 | 무엇을 잠그나 |
|---|---|
| **unit** | 램프 직선성(연속일 n→n+1 증분이 상수) · 예산 천장 = 상한 유계 · 후보 거리 정렬 · 후보 0개 → 재화 폴백 · 동점 tie-break 결정론(같은 `(date_seed,userSeed)` → 항상 같은 낙찰) · 연속일 전이(1→30→1, 끊김→1, 같은 날 재호출→불변) · `date_seed` 경계 · `shouldOpenDailyReward` 순수 판정 · 가치 환산표 전 축 유한·양수 |
| **integration** | ⚠️ **vitest 로는 불가능하다** — 이 리포에 `createClient` 를 쓰는 테스트가 **0건**이고 계약 테스트 5종은 전부 SQL 텍스트 파싱이다. DB 왕복이 필요한 단언(RPC 멱등 · 캡 산입 · 절삭 · source 필터 · 신규 계정 하한)은 **전부 `prove-daily-reward-cap.ps1`(§C12ⓑ)로 이관**했고 각각 ASCII 통과 토큰을 갖는다. 이 칸을 vitest 항목으로 채우면 **실행되지 않는 빈 층**이 된다. 배송함 반영 멱등만은 순수 함수라 unit 에 남는다 |
| **e2e (하네스)** | 30일차까지 치트로 밀어 모달·칩·연속일·예고 육안 확인 · 기지 진입 경로 4종 전부에서 모달이 그날 1회만 · 모달 닫고 칩으로 재열람 · 칩·크레딧 칩·광물 칩·제목 겹침 없음(실화면) |
| **observability** | 4지표 **전부 데이터 소스와 조회 SQL 을 갖는다**(초안은 2개가 태생적 죽은 계측기였다): ①`daily_reward_claims` 일별 행 수 ②**`applied_at IS NULL` 이 24시간 넘게 남은 행 수**(배송 실패의 유일한 신호. ⚠️ **용량 만석은 별도 컬럼으로 구분**한다 — 클라 로컬 상태로 두면 만석 유저가 이 지표를 상시 경보로 만든다) ③**상한 절삭 발생률** — `daily_reward_claims` 에 `clamped boolean not null default false` 를 **추가한다**(초안 스키마에 담을 컬럼이 없었다) ④`profiles.flagged` 는 전역 카운터라 이 기능의 이상을 분리해 읽을 수 없으므로 **`source='daily_reward'` 인 `currency_grants` 행 수**로 대체 |

`applied_at IS NULL` 잔존 행 수가 **죽은 계측기가 되지 않도록** 하네스에서 의도적으로 1건을
만들어 그 지표가 실제로 1을 읽는 것을 확인한다 — 항상 0을 읽는 계측기를 방치한 전례가 있다.

**관측 4지표의 조회 SQL.** 위험표가 *"조회 SQL 이 계획에 적혀 있고"* 를 통과 조건으로 걸어
놓고 정작 SQL 이 한 줄도 없었다 — 판정 조건이 자기 자신을 만족하지 못하는 상태였다. 아래가
정본이며 §C3 의 신설 컬럼(`clamped`·`hold_reason`)을 전제한다.

```sql
-- ① 일별 수령 행 수 — 기능이 살아 있는가(0 이면 배선이 끊긴 것이다)
select date_seed, count(*) as claims
  from public.daily_reward_claims
 where created_at > now() - interval '14 days'
 group by date_seed order by date_seed desc;

-- ② 24시간 넘게 미반영으로 남은 배송함 행 — 배송 실패의 유일한 신호.
--    hold_reason IS NULL 조건이 핵심이다: 만석(hold)을 세면 만석 유저가 이 지표를 상시
--    경보로 만들어 진짜 실패가 묻힌다(그래서 hold 를 클라 로컬 상태로 두지 않고 서버 컬럼에 적는다).
select count(*) as stuck
  from public.daily_reward_claims
 where applied_at is null
   and hold_reason is null
   and created_at < now() - interval '24 hours';

-- ②' 만석 보류 — 경보가 아니라 용량 UI 압력의 지표다(별도로 읽는다)
select hold_reason, count(*) from public.daily_reward_claims
 where applied_at is null and hold_reason is not null group by hold_reason;

-- ③ 상한 절삭 발생률 — 상한이 실제로 무는 비율. 0 이면 상한이 사문화된 것이고,
--    1 에 가까우면 램프가 아무에게도 안 보이는 것이다(둘 다 밸런스 신호).
select date_seed,
       count(*) filter (where clamped) :: numeric / nullif(count(*), 0) as clamp_rate
  from public.daily_reward_claims
 where created_at > now() - interval '14 days'
 group by date_seed order by date_seed desc;

-- ④ 이 기능이 실제로 재화를 지급했는가 — profiles.flagged 는 전역 카운터라
--    이 기능의 이상을 분리해 읽을 수 없어 source 필터 카운트로 대체한다.
--    ⚠️ currency_grants 는 7일 GC 이므로 이 지표의 관측 창은 최대 7일이다.
select count(*) as rows, sum(credits) as credits
  from public.currency_grants
 where source = 'daily_reward' and created_at > now() - interval '7 days';
```

---

## 상한 앵커 재선정 (2026-08-05, ADR-0048 정정)

ADR 초판의 *"`pve_runs` 의 **검증된** 최고 클리어 단계"* 는 **틀린 서술이었다.** `pve_runs` 에
stage 컬럼이 없고(`20260718000000_m4_pve_runs.sql:31-42`), stage 는 클라가 채운
`summary jsonb` 안에 있으며(`20260726000200_pve_settlement.sql:254`·`:265`),
`verified_status` 는 `'verified'` 를 **무조건 리터럴로 찍고**(`:302`), PvE 재검증 자체가
철거됐다(`20260726000300`, ADR-0026).

**확정된 대체 앵커: `profiles` 의 생애 누적 지급액(신설).**
- `currency_grants` 를 직접 합산할 수 없다 — **7일 GC** 다(`20260726000200_pve_settlement.sql:11`).
- 그래서 `profiles` 에 단조 누적 컬럼을 신설하고 **`currency_grants` AFTER INSERT 트리거**가 가산한다.
- **누적 가산을 `grant_currency_for` 본문에 넣지 않는다** — 발령이 같은 상황을 AFTER 트리거로
  해결한 선례를 따른다(`20260803000000_commission_ledger.sql:14-16`). ⚠️ 단 **per-call 캡 등록은
  본문을 건드릴 수밖에 없다**(§C3) — 캡은 `case p_source` 안에 살아 트리거로 붙일 수 없는
  자리다. 가산과 캡은 다른 문제이고, 이 줄이 막는 것은 **가산** 쪽이다.
- **트리거 본문을 서브트랜잭션으로 감싼다** — 감싸지 않으면 예외가 정산 트랜잭션을 롤백해
  *"전 플레이어가 자원을 못 받고 화면은 조용하다"*(같은 파일 `:18-20`).
- 상한 산식의 **정본은 SQL 한 곳**이고 EF 는 RPC 반환값을 소비만 한다(§C4).

**⚠️ 자기참조 되먹임을 반드시 차단한다.** 트리거에 source 필터가 없으면 **일일 보상이 지급한
크레딧이 자기 상한을 밀어 올린다** — 곁들이 크레딧은 매일 나가고 재화 축이 낙찰되면 주 보상까지
크레딧이라 되먹임 계수가 1 에 근접한다. 그러면 플레이 0 인 계정도 접속만으로 상한이 단조
상승해, ADR 의 유일한 정당화(*"위조해도 정직한 플레이로 이미 닿는 범위 안"*)가 무너지고 30일 봇
접속이 **상한 자체를 키우는** 경로가 열린다 — §왜 30일차 최고점에도 상한이 이기는가가 막으려던
공격면이 다른 문으로 돌아온다.

- 트리거는 `when (new.source <> 'daily_reward')` 로 제한한다.
- **C3 계약 테스트가 그 필터의 존재를 단언한다** — 필터가 조용히 빠지는 것이 이 결함의 재발 경로다.

### 백필 — 기존 유저가 신규 봇과 같은 자리에서 시작하는 문제

컬럼을 `default 0` 으로 신설하고 AFTER 트리거가 **앞으로의 지급만** 가산하면, 마이그레이션
직후에는 300시간 플레이한 베테랑도 `lifetime_granted = 0` 이다 — 신규 봇과 **정확히 같은
천장(FLOOR)** 에서 시작한다. 그리고 과거 이력으로 되살릴 수도 없다: `currency_grants` 는
**7일 GC** 라(`supabase/migrations/20260726000200_pve_settlement.sql:11`) 그 이전 지급 기록이
이미 소멸했다. 즉 이것은 "나중에 채우면 되는 것"이 아니라 **마이그레이션 시점에 못 채우면
영영 못 채우는 것**이다.

**확정된 백필 소스: `profiles` 의 현재 잔액과 7일 창 `currency_grants` 합의 최대값.**

```sql
-- add column 직후, 마이그레이션 안에서 1회.
-- MINERAL_TO_CREDIT constant numeric := 8;  -- BALANCE — data/dailyRewardSelection.ts:105 미러
update public.profiles p
   set lifetime_granted = greatest(
         coalesce(p.credits, 0) + coalesce(p.minerals, 0) * MINERAL_TO_CREDIT,
         coalesce((select sum(g.credits + g.minerals * MINERAL_TO_CREDIT)
                     from public.currency_grants g where g.profile_id = p.id), 0)
       )
 where p.lifetime_granted = 0;   -- 재실행 안전 가드
```

**근거 — 현재 잔액은 생애 누적의 엄밀한 하한이다.** `credits`/`minerals` 는 클라 UPDATE 가
`guard_profiles_client_write` 로 봉인되고(`20260731000000_catalyst_shop.sql:109-128`) INSERT 는
`guard_profiles_client_insert` 가 0 으로 강제한다(`:137-150`). 그래서 이 두 컬럼의 **유입은
서버 지급뿐이고 유출은 소비뿐**이다 → `현재 잔액 ≤ 생애 누적`이 항등적으로 성립한다. 하한이므로
백필이 상한 유계를 **넓히지 않는다** — 이것이 이 소스를 고른 유일한 이유다.

**기각: `profiles.save` 의 기체 레벨 합.** Critic 이 대안으로 제시했고 진행도를 더 잘 반영한다.
그러나 `profiles.save` 는 클라 쓰기 미러다. **위조 가능한 입력을 앵커에 단 1회라도 주입하면
ADR 의 *"상한은 서버 권위 상태에서만 파생한다"* 가 문자 그대로 깨진다** — 그 문장은 "평소에는"
이 붙은 적이 없고, 한 번의 주입이 만든 값은 단조 컬럼에 영구히 남는다. 잔액 하한은 그 문장을
한 뼘도 넓히지 않으면서 같은 목적(베테랑을 봇과 구분)을 달성한다.

**자인하는 대가: 많이 쓴 유저가 과소평가된다.** 평생 100만을 받아 99만을 쓴 유저는 잔액이
1만이라 백필값도 1만이다. 7일 창 `currency_grants` 합과의 `greatest` 가 이것을 **일부만**
보정한다(최근 일주일 활동은 소비와 무관하게 잡히므로). 활발한 유저일수록 보정이 크고, 오래
쉬다 돌아온 유저일수록 과소평가가 남는다. 이 잔차는 **첫 런 한 번으로 자연 해소된다** —
정산이 `currency_grants` 에 행을 남기면 트리거가 즉시 가산하므로.

**`MINERAL_TO_CREDIT = 8` — 미해결로 남아 있던 환율 Open Question 의 해소.** `currency_grants` 는
`credits numeric`·`minerals numeric` **두 컬럼**인데 앵커는 단일 `numeric` 스칼라다. 그래서
환율이 "나중에 정할 것"이 아니라 **상한 산식 정본과 백필 산식에 직접 들어가는 상수**다.

⚠️ **미러의 정본은 `data/dailyReward.ts` 가 아니라 `data/dailyRewardSelection.ts` 다**
(`:105`, `// BALANCE`). 거기가 **공통 가치 환산표가 사는 자리**이고, 광물이 크레딧보다 희소하다는
축을 정한 것도 그 표다 — 앵커가 환율을 따로 갖는 것이 아니라 **환산표의 값을 그대로 쓴다.**
SQL 은 같은 값을 리터럴로 갖고(백필 1곳 + 앵커 트리거 1곳, **둘 다** 8) 계약 테스트가 대조한다
(§C3 의 SQL↔TS 상수 대조 항목).

(초안 지시가 `1` 이었으나 C2 워커가 환산표를 세우며 `8` 로 확정했고 마이그레이션이 그것을 따랐다.
값이 갈리면 백필이 광물 보유 유저를 8분의 1로 과소평가한다 — 계약 대조가 그 드리프트를 잡는다.)

**실증 토큰**: `[OK] BACKFILL_LOWER_BOUND` — 백필된 기존 행에서
`lifetime_granted >= credits + minerals * 8` 이 참(§C12ⓑ).

**⚠️ 하한 성질과 재실행.** `where lifetime_granted = 0` 가드가 없으면 마이그레이션 재적용이
**이미 자란 값을 잔액 수준으로 되돌린다**(단조 컬럼의 단조성 위반). 재실행 안전은 이 레인의
마이그레이션 규약이므로 가드는 선택이 아니다.

### 신규 계정 하한(FLOOR) — 값이 계약이다

`lifetime_granted = 0` 인 신규 유저는 예산 천장이 0 근처라 30일을 채워도 받을 것이 없다 — ADR 의
"접속만으로 성립"과 정면 충돌한다. 옛 앵커(stage)에는 이 문제가 없었다(1단계만 깨도 값이 생긴다).
**앵커 전환이 만든 부작용이므로 이 레인이 닫는다.**

**`FLOOR = DAILY_BUDGET_DAY_1` 이 계약이다** — 1일차 예산과 **같은 값**이며, 별도 리터럴을
만들지 않고 **파생으로 묶는다**(`DAILY_BUDGET_FLOOR = DAILY_BUDGET_DAY_1`). 이유는 셋이다:

- 플레이 0 계정의 예산이 `min(램프, FLOOR) = DAY_1` 로 **연속일과 무관하게 고정**된다. 30일 봇
  접속이 최고점을 열지 못하고, 램프가 그 계정에는 **보이지 않는 장치**가 된다.
- `DAY_1` 은 설계상 **런 1회 지급 규모 언저리**이므로 ADR 의 유일한 정당화
  (*"위조해도 정직한 플레이로 이미 닿는 범위 안"*)가 **FLOOR 경로까지** 덮는다. 하한이
  상한 유계의 예외가 아니라 그 안에 들어간다.
- 별도 상수로 두면 밸런스 튜닝에서 `DAY_1` 만 조정되고 하한이 뒤처져 **조용히 갈린다.**

**⚠️ FLOOR 를 `DAILY_BUDGET_DAY_1` 위로 올리는 순간 유계가 깨진다.** 플레이 0 계정이 램프
중간 이상을 무료로 받게 되고 30일 봇 접속이 다시 이득이 된다. 이것은 밸런스 재량이 아니라
**상한 유계 논증의 전제**이므로, DAY_1 을 올리는 것은 무방하지만 하한을 떼어 독립시키지 마라.

**기각한 두 대안**(Critic 제시):
- *시간 감쇠*(FLOOR 가 계정 나이에 따라 줄어듦) — 기각. **감쇠율이 두 번째 손잡이가 된다.**
  ADR 은 "손잡이 하나" 원칙을 개수 축과 램프 축에서 **두 번 지불**했는데, 하한에서 그것을
  되돌리면 지불한 값이 사라진다.
- *계정 생성일 기반 유예창*(가입 N일 안에만 FLOOR 적용) — 유계는 가장 강하지만 손잡이가
  2개(창 길이 + 하한값)다. 그리고 **백필(위 절)이 닫히면 불필요해진다** — 백필 뒤에는
  `lifetime_granted = 0` 인 계정이 **진짜 신규 계정뿐**이라 FLOOR 가 이미 그들에게만 걸린다.
  유예창이 추가로 막는 것이 없다.

**관문 교체: `[OK] FLOOR_NONZERO` → `[OK] FLOOR_BOUNDED`.** 하한만 단언하면 FLOOR 가 아무리
커도 통과한다 — 유계가 깨지는 방향을 못 잡는 관문이다. **양단으로 단언한다**:
`0 < 예산(lifetime=0) <= DAILY_BUDGET_DAY_1`.

**unit 단언 — 램프 사망 검출.** `lifetime_granted` 가 **백필된 기존 유저 규모**일 때 연속일
1→30 예산이 **상수가 아님**을 단언한다. ⚠️ Critic 은 *"FLOOR 절삭 상태에서 상수가 아님"* 을
요구했는데 **그것은 백필이 없다는 전제였다.** 백필이 들어가면 `lifetime = 0` 에서 예산이
연속일과 무관하게 상수인 것이 **설계상 옳다**(위 FLOOR 계약의 첫 항목이 정확히 그것을 노린다).
그래서 램프가 살아 있는지는 **FLOOR 가 물지 않는 구간에서만** 물을 수 있다.

## Requirements Summary

ADR-0048 이 정한 정책(접속만으로 성립 · 주 보상 1개 + 곁들이 크레딧 · 6축 풀 · 진행 견인 ·
상한 유계 · 캡 산입 · 1일치 예고 확정 · 미수령 소멸 · 30일 직선 램프 · 전멸 리셋 · UTC 경계 ·
모달 + 헤더 칩 · 수령 = 진입 시점)을 구현한다. 수치는 placeholder + `// BALANCE`.

## Implementation Steps

### 슬라이스 1 — 재화 축 관통 (그 자체로 배포 가능한 최소 제품)

**C1. 순수 산식 — 램프·예산·상한·연속일** · `data/dailyReward.ts`
- 연속일 → **공통 가치 예산**(직선), 가치 환산표(6축), **`lifetime_granted` → 예산 천장**(신규 계정 하한 `FLOOR` 포함). ⚠️ `pve_runs` 최고 클리어 단계를 쓰지 않는다 — 클라 주장이다.
- **`nextStreak(prevSeed, nowSeed, prevStreak)` 가 이 파일의 산출물이다** — AC-7·AC-8·AC-9 가
  전부 이 한 함수에 산다. 초안이 *"AC-7·AC-8 이 구현 단계에 없다"* 고 자기 진단한 자리가
  여기이며, 진단이 옳았다.
  - **시그니처가 곧 AC-7 의 구조적 잠금이다.** 이 함수는 **직전 seed 하나**만 받는다 —
    원장을 받지 않으므로 *"수령 원장을 스캔하지 않는다"* 를 어길 **수단이 없다.** 규율을
    주석으로 부탁하는 것이 아니라 타입이 막는다.
  - **AC-8("하루 놓치면 1")의 유일한 실패 모드는 0 으로 리셋하는 것**이므로, 그 실패는
    TS 쪽에서는 이 함수의 단위 테스트가, SQL 쪽에서는 §C3 의 계약 단언이 각각 막는다.
- **`FLOOR = DAILY_BUDGET_DAY_1` 파생 계약**(§신규 계정 하한). 별도 리터럴을 만들지 않는다.
- ⚠️ **`MINERAL_TO_CREDIT` 는 이 파일이 아니라 `data/dailyRewardSelection.ts:105` 에 산다**(값 **8**, `// BALANCE`). 앵커 환율과 가치 환산표가 **같은 값이어야 하므로** 환산표 쪽을 정본으로 둔다. SQL 리터럴 2곳과 계약 테스트가 대조한다.
- `Math.random`·`Date.now` 금지(EF 공유 순수 함수 — `src/items/roll.ts` 헤더 규율 승계).
- 상수는 `// BALANCE — 출시 전 일괄 튜닝` 주석과 함께 배너에 정본 선언. **`DAILY_CEILING_RATE`
  주석에는 *"이 계수를 정하는 것은 천장이 언제부터 사문화되는가를 함께 정하는 것"* 을 한 줄로
  남긴다**(§Open Questions 의 눈금 문제).
- 테스트: `tests/dailyRewardRamp.test.ts` — 램프 직선성 · `[0, DAY_1]` 양단 FLOOR 단언 ·
  **백필 규모 `lifetime_granted` 에서 연속일 1→30 예산이 상수가 아님**(램프 사망 검출) ·
  연속일 전이 4종(이어짐 · 끊김→1 · 30→1 · 같은 날 재호출 불변).
- 검증: `npx vitest run tests/dailyRewardRamp.test.ts`

**C2. 순수 산식 — 진행 견인 후보 생산기** · `data/dailyRewardSelection.ts`
- 축별 후보 생산기(**재화 축부터** — 슬라이스 1 이 재화 관통이다. 나머지 5축은 슬라이스 2), 거리 점수, 예산 내 최소 거리 낙찰, 0개 폴백, `(date_seed, userSeed)` tie-break, 반복 걸음 순번.
- 테스트에 **AC-16 잠금** 포함 — 축간 가치 환산이 **순서 일관·단조**임을 단언한다("전 축 유한·양수"는 하한일 뿐이다).
- 테스트: `tests/dailyRewardSelection.test.ts`

**C3. 마이그레이션 — 원장·컬럼·트리거·RPC** · `supabase/migrations/20260805000000_daily_reward.sql`
- `daily_reward_claims`: `(profile_id, date_seed)` PK, `payload jsonb`(예고 = 종류·등급·계급), `item_payload jsonb null`, `applied_at timestamptz null`, `created_at`. RLS `select_own` 만(insert/update/delete 정책 없음). **TTL·GC 대상 아님**(주석에 근거 명시 — 지우면 미반영 행이 사라져 물건이 영구 유실).
  - **`result_payload jsonb not null` — 그날 실제 지급된 것**(축·수량·item id). AC-5 는
    *"굴린 결과를 그 행에 함께 적어 재시도가 다시 굴리지 않는다"* 를 요구하는데 **초안 스키마에
    그것을 담을 자리가 없었다** — `payload` 는 예고이고 `item_payload` 는 장비 축 전용이라,
    재화·촉매 축의 굴림 결과는 어디에도 안 적혔다. 그러면 재시도가 매번 다시 굴린다.
  - ⚠️ **`payload` 는 다음날 예고 전용임을 컬럼 주석으로 못박는다.** 둘이 섞이면 예고 소비
    로직(§C4)이 **자기 결과를 예고로 읽어** 오늘 받은 것을 내일 또 예고한다 — 조용히 틀리고
    테스트로는 같은 모양이라 안 잡힌다.
  - **`clamped boolean not null default false`** — 관측 지표 ③의 데이터 소스. `resolveDailyBudget`
    의 `clamped` 를 그대로 적는다.
  - **`hold_reason text null`** — `'capacity_full'` 등. `applied_at IS NULL` 잔존 행 중
    **만석을 경보에서 분리**한다(관측 ②). C5 의 *"만석은 별도 상태로 구분"* 을
    **`mark_daily_reward_hold(p_date_seed bigint, p_reason text)` 로 서버 컬럼에 기록**으로
    구체화한다 — 클라 로컬 상태로 두면 그 유저의 행이 서버에서는 그냥 미반영으로 보여
    **만석 유저가 지표 ②를 상시 경보로 만든다.**
  - **부분 인덱스**: `create index if not exists daily_reward_claims_pending_idx on public.daily_reward_claims (profile_id) where applied_at is null;` — 관측 ②와 부팅 재시도 조회가
    **풀스캔이 되지 않게** 한다. 이 원장은 TTL 대상이 아니라 **영구히 자라므로**, 인덱스가
    없으면 비용이 시간에 비례해 늘고 어느 시점부터 조용히 느려진다.
- `profiles` 컬럼 3개: `daily_last_claim_seed bigint not null default 0`, `daily_streak int not null default 0`, `lifetime_granted numeric not null default 0`(상한 앵커).
  - ⚠️ **미수령 센티넬은 `-1` 이 아니라 `0` 이다.** 초안은 `-1` 이었고 Critic 이 *"신규 3컬럼
    중 `-1` 기본값은 `guard_profiles_client_insert` 의 `:= 0` 열거에 안 들어가니 계약
    정규식을 넓혀야 한다"* 고 지적했다. **정규식을 넓히는 대신 센티넬을 바꿔 해소했다** —
    `data/dailyReward.ts` 의 `DAILY_SEED_NEVER = 0` 이 그 결정이다.
    - 근거: 컬럼 하나만 `:= -1` 로 두면 **그 컬럼이 계약의 시야 밖으로 빠진다** — 계약 테스트는
      `new\.(\w+)\s*:=\s*0\s*;` 로 세므로 봉인이 있다고 세면서 **실제로는 그 컬럼을 세지
      않는** 상태가 된다. 세는 것과 지키는 것이 어긋나는 순간 그 계약은 다음 편집에서 조용히
      깨진다. 셋을 전부 `0` 으로 두면 기존 정규식이 그대로 6개를 세어 `3 → 6` 이 참이 된다.
    - `0` 센티넬의 안전성: `nextStreak` 은 `prevSeed === nowSeed - 1` 만 보므로 `prevSeed = 0`
      은 **어떤 현실적 `nowSeed` 에도 "끊김"** 으로 판정돼 1 이 된다. 유일한 겹침은 `nowSeed = 1`
      (1970-01-02)이고, 그것은 서버 시계가 epoch 에 있다는 뜻이다.
- **백필 1회** — `add column` 직후, 같은 마이그레이션 안. 소스·근거·재실행 가드는 §백필 절이
  정본이다. `where lifetime_granted = 0` 가드가 **단조성을 지킨다.**
- ⚠️ **봉인 트리거는 최신 정의에서 복사한다** — `20260731000000_catalyst_shop.sql:109-128` 이 현행이고 봉인이 **9개**다(flagged·is_npc·lineage 4종·credits·minerals·catalyst_residue). 초안이 적었던 "3~4개"는 **가장 오래된 정의**를 본 것이고, 낡은 본문 복제가 프로덕션을 100% 깨뜨린 전례와 동형이다(`20260802000000:4-15`). `20260726000000`(8개)을 베끼면 `catalyst_residue` 봉인이 사라져 **잔재 무한 구매**가 열린다.
  - `guard_profiles_client_write()` — 9 → **12** (신규 3컬럼 추가)
  - `guard_profiles_client_insert()` — `20260731000000:137-150` 이 현행, 3 → **6**. **이것이 빠지면 클라가 자기 프로필을 `daily_streak: 30` 으로 INSERT 할 수 있다**(RLS 는 소유권만 검사: `20260717000000:95`).
- **`currency_grants` AFTER INSERT 트리거** → `profiles.lifetime_granted` 가산(`credits + minerals * 8`). **서브트랜잭션으로 감싼다**(`20260803000000_commission_ledger.sql:18-20`). 가산 방식이 AFTER 트리거인 것은 그대로다 — 아래 개정은 **캡 등록**이지 누적 가산이 아니다.
- ⚠️ **`grant_currency_for` 를 예외적으로 재정의한다 — 계획의 *"본문을 고치지 않는다"* 를 의도적으로 어긴다**(사용자 확정, 2026-08-05).
  - **왜 어겨야 했나.** 이 함수의 `case p_source` 에 `daily_reward` 가 없으면 `else` 로 떨어져 **`CAP_DEFAULT`(1000/1000)** per-call 상한을 받는다. 그런데 30일차 공통 가치 예산은 **20,000** 규모다(PvE 런 1회 상한 5,000의 4배). 재화 축이 낙찰되면 지급이 **조용히 1000 으로 절삭**되고 — 그 함수의 `case` 주석이 **직접 경고하는 함정**이다 — 슬라이스 1 의 제품 전체가 재화 축이므로 **램프가 그 자리에서 죽는다.** 초록인 채로 죽는다는 것이 핵심이다: 계약 테스트도 순수 함수 테스트도 EF 바깥의 절삭을 못 본다.
  - **왜 이 재정의가 금지 규율이 겨눈 위험이 아닌가.** 그 규율이 막으려는 것은 **낡은 본문의 복제**다 — `20260802000000:4-15` 가 프로덕션을 100% 깨뜨린 것은 드롭된 컬럼을 참조하는 구본문이었다(ERROR 42703). 이 개정은 현행 정의(`20260803000000_commission_ledger.sql:197-373`)를 **손으로 옮겨 적지 않고 파일에서 잘라 붙여** 한 바이트도 바꾸지 않고, **상수 2개 선언과 `case` 한 갈래만** 더한다. **봉인 트리거 2개를 같은 방식으로 개정하는 것과 정확히 같은 규율**이며, 그 둘은 이 계획이 이미 안전하다고 판정한 것이다.
  - **드리프트 방어**(이것이 없으면 위 논증은 1회용이다): 계약 테스트가 재정의된 본문의 **캡 상수 전집합과 값**을 원본에서 뽑아 대조하고, `grant_currency` 의 **클라 allowlist(`pve_run`·`salvage`·`story`)가 손대지 않은 채** 남아 있음을 단언한다 — **클라는 여전히 `daily_reward` 로 못 들어온다**(수령이 EF 전용이라 그럴 필요도 없다). 상수가 하나라도 사라지거나 값이 갈리면 빨개진다.
  - 신설 상수: **`CAP_DAILY_REWARD_CREDITS = 25000` · `CAP_DAILY_REWARD_MINERALS = 25000`**. `DAILY_BUDGET_DAY_30`(20,000)을 담되 `CAP_HOURLY_*`(50,000) 아래에 둔다 — 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 하는 `CAP_COMMISSION_*` 의 기준을 그대로 따른다.
  - **트리거 함수는 `security definer` + `set search_path = ''` 다.** 이 리포의 선례가 전부
    그렇고(`guard_profiles_client_write`·`guard_profiles_client_insert` 등), 여기서는 특히
    필수다 — 트리거가 `profiles` 를 UPDATE 하는데 그 테이블에는 클라 봉인 트리거가 걸려
    있어, definer 가 아니면 `is_service_role()` 이 거짓이 되어 **자기 UPDATE 가 봉인에
    되돌려진다**(가산이 조용히 0이 된다). `search_path = ''` 는 스키마 하이재킹 차단으로,
    모든 참조를 `public.` 로 정규화하는 것과 한 몸이다.
- RPC **`claim_daily_reward_for(p_recipient uuid, ...)` — service_role 전용 하나만 만든다.**
  `revoke all ... from public, anon, authenticated`. **revoke 가 빠지면 authenticated 가 PUBLIC 을
  통해 도달해 위임 구조 전체가 무효**(`commission_ledger.sql:374-378`).
  - ⚠️ **authenticated 래퍼를 만들지 않는다.** 초안은 `grant_currency` 2단 구조를 베꼈으나, 그쪽은
    클라가 직접 부르는 경로가 실재해서 래퍼가 필요했다. 여기는 **수령이 EF 전용**이다 — EF 가
    미러를 읽어 후보를 만들고 `rollItem` 을 돌려야 하므로 클라가 부를 수 있는 형태가 아니다.
    래퍼를 만들면 쓰지도 않는 **순공격면**이 된다.
  - 이 결정이 세 모순을 동시에 닫는다: ①배포 게이트의 근거가 *"EF 미배포"* 가 아니라
    **"authenticated 진입점 부재"** 가 되어 참이 된다 ②AC-25 는 "상한이 문다"가 아니라
    **"authenticated 가 도달하지 못한다"** 를 겨눈다(§C12ⓐ 가 실증) ③슬라이스 1 완료 판정이
    EF 배포를 요구해도 유저 노출은 **클라 진입 훅(C6)이 슬라이스 2 까지 상수로 꺼져 있는 것**이
    막는다.
- ⚠️ **`date_seed` 를 파라미터로 받지 않는다.** 본문이 `floor(extract(epoch from now())/86400)` 로
  서버가 계산한다. 받으면 복합 PK 가 서로 다른 seed 를 안 막아 **하루에 여러 번 수령**이 열린다.
  계약 테스트가 *"본문에 `p_date_seed` 파라미터가 없다"* 를 단언한다.
- `mark_daily_reward_applied(p_date_seed bigint)` — authenticated, `auth.uid()` 고정. 이쪽은 클라가
  부르는 것이 맞다(반영 완료를 알리는 것이므로). seed 를 받아도 **이미 존재하는 행만** 갱신하므로
  위조 이득이 없다.
- **상한 산식의 정본은 이 파일이다** — `lifetime_granted` → 등급·요구 레벨·지시 계급 천장. EF 는 반환값만 소비한다.
- 잠금 순서: 한 호출에 인벤토리는 **최대 1개**. **곁들이 크레딧 grant 의 호출 위치가 축별 계약이다** — 촉매 축은 인벤토리 잠금 **뒤**(`catalyst_inventory → profiles` 보존). ⚠️ **코어 모듈 축에는 이 계약이 없다** — 신규 insert 전용이라 잠글 기존 행이 없기 때문이다(§Pre-mortem 1 각주). grant 를 촉매 축에서 먼저 부르면 `buy_catalyst` 와 정확히 반대가 되어 진짜 ABBA 가 열린다.
- 재실행 안전: `create table if not exists` · `drop policy if exists` → `create` · `create or replace function` · `alter table ... add column if not exists` · 백필의 `where lifetime_granted = 0`.
- **`settle_pve_run` 본문을 건드리지 않는다.**
- 적용 스크립트: `scripts/apply-daily-reward-migration.ps1`
- **롤백 스크립트: `scripts/rollback-daily-reward-migration.ps1`**(§마이그레이션 롤백 참조 — 계획에 절차가 아예 없었다).
- 테스트: `tests/dailyRewardContract.test.ts` — `tests/catalystShopContract.test.ts:54` 에 **정의된** `effectiveFunctionBody()` 헬퍼를 **재사용**(마지막 정의를 해석한다. `:169`·`:194` 는 호출부다). 단언:
  - 상한 산식 · RLS 정책 부재 · 복합 PK · 봉인 12/6 · service_role revoke 3종 · `for update` 등장 순서.
  - **호출되는 함수 본문까지 훑어** 인벤토리 2개가 한 트랜잭션에 안 나오는지(초안은 `on conflict` 사각지대만 승계하고 **함수 호출 사각지대를 놓쳤다** — `grant_currency_for` 의 `for update` 는 다른 함수 본문에 있다: `commission_ledger.sql:308`). ⚠️ 슬라이스 2 에서 촉매 축이 붙으면 **`grant_catalyst` 도 이 훑기 범위에 넣는다**(§C7).
  - **AC-7 잠금** — *`claim_daily_reward_for` 본문이 `daily_reward_claims` 를 집계·스캔하지 않는다*: 본문에 `count(` 와 `group by` 가 **부재**함을 단언. 연속일이 원장 파생으로 조용히 되돌아가는 것이 이 AC 의 유일한 회귀 경로다.
  - **AC-8 잠금** — *본문에 `daily_streak` 을 **0** 으로 리셋하는 대입이 없다*. "하루 놓치면 1"의 실패 모드는 사실상 이것 하나뿐이라(절반도 유지도 구현하려면 일부러 짜야 한다) 이 한 줄이 AC-8 을 덮는다.
  - **SQL↔TS 상수 대조** — 주기 `30`(`DAILY_STREAK_CYCLE`) · 끊김 리셋값 `1` · 미수령 센티넬 `0`(`DAILY_SEED_NEVER` = 컬럼 default) · **`MINERAL_TO_CREDIT = 8`**(`data/dailyRewardSelection.ts:105` ↔ SQL 리터럴 **2곳**: 백필 · 앵커 트리거) · `DAILY_CEILING_RATE` · `DAILY_BUDGET_DAY_1`(= FLOOR) · **`CAP_DAILY_REWARD_CREDITS = 25000` · `CAP_DAILY_REWARD_MINERALS = 25000`**(SQL 단독 — TS 짝이 없으므로 `DAILY_BUDGET_DAY_30` 보다 **크다**는 부등식으로 잠근다). 산식이 두 언어에 살고 **정본은 SQL** 이므로, 대조가 없으면 한쪽만 튜닝돼 클라 표시와 실지급이 갈린다.
  - **재정의된 `grant_currency_for` 의 드리프트 방어** — 캡 상수 **전집합과 값**을 원본(`20260803000000:197-373`)에서 뽑아 대조 + `grant_currency` allowlist 가 `pve_run`·`salvage`·`story` 셋 그대로임을 단언(`daily_reward` 가 **거기 들어가면 안 된다**).
- **같은 커밋에서** `tests/catalystShopContract.test.ts:176`(9) · `:198`(3) 의 숫자를 12 · 6 으로 갱신하고, `:177-189`(write 9종)·`:199`(insert 3종) 의 **집합 단언에도 신규 3컬럼을 넣는다**(숫자만 고치면 집합이 어긋나 실패한다). 신규 3컬럼이 전부 `:= 0` 이므로 `:197` 의 정규식 `new\.(\w+)\s*:=\s*0\s*;` 은 **그대로 둔다** — 넓힐 필요가 없다.

**C4. Edge Function** · `supabase/functions/daily-reward/`
- 서버 시각으로 `shopDateSeedFromMs(Date.now())` 계산(클라 입력 불신 — `modules/index.ts:107` 선례).
- **상한은 RPC 반환값을 받아 쓴다. 산식을 복제하지 않는다**(정본은 C3 의 SQL). 복제하면 `prove-*.ps1` 이 EF 의 TypeScript 로직을 영영 실증할 수 없어 완료 관문 ②가 죽은 관문이 된다.
- 미러(`profiles.save`·`ships`)를 service_role 로 읽어 후보 생산. 선례: `verify-invasion/index.ts:307-308` 이 `profiles` 컬럼을 RLS 우회로 읽는다. ⚠️ **`items` 테이블은 읽지 않는다** — 클라가 그 테이블에 한 줄도 쓰지 않으므로(`src/**` 에 `.from('items')` 0건) 비어 있다. 아이템은 `profiles.save` 안에 있다.
- **예고를 소비한다** — 어제 행의 `payload` 를 읽어 종류·등급·계급을 **고정**하고 값만 서버 시드로 굴린다. 이 단계가 없으면 예고가 약속이 아니게 되어 ADR 의 압력 설계 전체가 무용지물이다(ADR: *"적힌 것은 바뀌지 않는다"*). **"직전 예고 없음 → 지금 파생"** 분기 필수(하루 놓치면 그 행이 소멸한다).
- `rollItem(서버 시드, ...)` 으로 값 굴림 → `claim_daily_reward_for` 로 원장 기록 + **다음날** 예고 확정, 연속일 갱신.
- 배포: **신규 EF 이므로 `deno.json` 신설**(`unstable: ["sloppy-imports"]` + `bundle` 태스크) + `deno task bundle` → `dist.index.js` 를 `index.ts` 로 치환. `verify-commission/deno.json` 의 `//deploy` 주석이 *"sloppy-imports 를 CLI 배포 번들러가 못 따라가고 `--entrypoint` 플래그도 없다"* 고 명시한다. 절차 정본은 `.omc/skills/` 의 supabase 배포 워크플로 문서.

**C5. net 계층** · `src/net/dailyReward.ts` + `src/net/index.ts` 래퍼
- 기존 규약 승계: 미설정·오프라인·오류면 `null`, **절대 throw 안 함**.
- 배송함 반영: `item_id` 를 `daily:{date_seed}` 로 결정론적 파생(`rollItem` 의 `it-${seed}`·약탈품의 `-loot-` 와 충돌 없음: `src/items/roll.ts:109`).
- ⚠️ **`items` 테이블의 `unique (profile_id, item_id)` 를 안전망으로 계상하지 않는다** — 클라가 그 테이블에 쓰지 않으므로 그 제약은 이 경로에 걸리지 않는다. 멱등은 **순수 함수가 단독으로** 보장해야 한다.
- **순수 함수 `hasDailyItem(profile, itemId)` 를 뽑아 4곳 전수를 본다** — `inventory`(`src/save/profile.ts:140`) · `stash`(`:141`) · `ships[].equipped`(`:105`) · `guardians[].build.equipped`(`:227`). `inventory` 만 보면 **플레이어가 장착하거나 창고로 옮긴 순간 다음 부팅이 같은 아이템을 또 심는다**.
- **용량 만석 분기** — `INVENTORY_CAP = 48`(`profile.ts:57`) · `stashCapacity()`(`:78-81`). 둘 다 꽉 차면 반영을 보류하고 `applied_at` 을 찍지 않는다. 이 경우 관측 지표가 상시 경보가 되므로 **만석은 별도 상태로 구분**한다 — 구체적으로 **`mark_daily_reward_hold(p_date_seed, 'capacity_full')` 로 서버의 `hold_reason` 컬럼에 적는다**(§C3). ⚠️ 이것을 클라 로컬 상태로 두면 서버에서는 그냥 미반영으로 보여 **만석 유저가 관측 ②를 상시 경보로 만든다** — 지표가 죽는 것이 아니라 **거짓 경보로 가득 차 진짜 실패가 묻힌다.**
- **순서: 반영 → 서버 프로필 push → 재-pull 하여 아이템 존재 확인 → `mark_daily_reward_applied`.** push 전에 mark 하면 `chooseProfile` 의 통짜 선택이 그 아이템을 버릴 수 있고(`profileSync.ts:121-125` 의 `progressScore` = `shipLevels * 1000 + skillPoints + inventory.length + stash.length` — **기체 레벨 1 = 1000점이라 아이템 48개 차이도 진다**) 행은 이미 mark 돼 재시도되지 않아 **영구 유실**이다. ⚠️ push 성공만으로는 부족하다 — 서버에 `progressScore` 가 더 높은 프로필이 있으면 **push 는 성공하는데 내 아이템은 채택되지 않는다.** 그래서 mark 의 전제는 "push 가 200 을 받았다"가 아니라 **"재-pull 한 프로필에 그 `item_id` 가 있다"** 다.
- 부팅 경로에서 `applied_at IS NULL` 행 재시도(§C3 의 부분 인덱스가 이 조회를 태운다).
- 테스트: `tests/dailyRewardNet.test.ts` — ①장착 후 재부팅 ②창고 이동 후 재부팅 ③인벤·창고 만석 ④mark 실패 후 재시도 ⑤push 실패 시 mark 안 함 ⑥오프라인 no-op **⑦다기기 통짜 폐기** — 서버에 `progressScore` 가 더 높은 프로필이 있는 상태에서 반영 → push → **재-pull 확인** → mark 의 순서가 지켜지고, **재-pull 에서 아이템이 없으면 mark 하지 않는다**(다음 부팅이 재시도한다).

**C6. 모달 + 진입 훅** · `src/ui/pixi/dailyRewardModal.ts`
- **단일 지점이 실제로 존재한다** — `src/main.ts:837` 의 `openBaseMap()` 하나로 **호출부 18곳**(정의 제외)이 전부 모인다(모달 닫기 · 언어 전환 · 타이틀 시작 · 건물 복귀 · 하네스 등). 초안 Pre-mortem 3 의 "경로가 여럿"은 **과대평가**였고 처방은 옳았다.
- 부팅 순서도 안전하다 — `bootWithAuth()`(`:1974`)가 `await pullServerProfileInto(profile)`(`:2009`) **뒤에** `openIntroOrTitle()`(`:2014`) 을 부른다. (초안의 `:2001`·`:2006` 은 각각 주석과 닫는 괄호를 가리키고 있었다 — 결론은 유효하고 줄번호만 틀렸다.)
  - ⚠️ **단서 — pull 을 거치지 않는 조기 반환이 있다.** ①로그인 미설정(`:1975-1978`) ②하네스
    미로그인(`:1997-1998`). 이 둘은 서버 프로필을 안 읽고 화면을 연다. 실해는 없다 —
    **두 경우 모두 수령은 no-op** 이다(세션이 없으면 EF 호출 자체가 `null` 을 반환하고,
    §C5 규약상 throw 하지 않는다). 다만 "부팅은 항상 pull 뒤에 화면을 연다"를 **불변식으로
    가정하면 안 된다**는 것을 여기 남긴다. (세 번째 반환인 비하네스 미로그인 `:1995-1996`
    은 `openTitle(true)` 라 기지에 도달조차 못 하므로 이 축과 무관하다.)
- **순수 판정** `shouldOpenDailyReward(lastSeenSeed, nowSeed)` 를 뽑는다. 재진입 두 경로를 반드시 케이스로 잡는다: `rerenderCurrentScreen()`(`:690`, 언어 전환) · `harnessRefreshScreen()`(정의 `:2503`, `default:` 분기의 `openBaseMap()` 은 `:2522` 라 run/result 화면에서도 base 로 튄다 — 단 `if (world === null)` 가드가 붙어 있어 런 진행 중에는 안 튄다). 순수 판정이 없으면 **모달이 재발한다**.
- ⚠️ **비동기 창** — `openBaseMap` 은 동기이고 수령은 서버 왕복이다. 그 사이 플레이어가 격납고를 누르면 `baseMap.hide()`(`:843`) 뒤에 응답이 도착해 **기지 없는 배경 위에 모달이 앉는다.** 응답 도착 시점에 `currentScreenName === 'base'` 를 재확인한다.
- "받기" 버튼 없음 — 통지. 예고는 종류·등급·계급까지만. 반복 걸음 순번 표시("3장 중 2장째").
- 테스트: `tests/dailyRewardModal.test.ts` + `tests/dailyRewardGate.test.ts`(재진입 2종 + 비동기 창)

**슬라이스 1 완료 판정** — 셋을 나눈다(모의 하네스가 서버 단언을 "실증"하는 것처럼 보이는 경로를 막기 위해):
1. **순수 함수** — vitest 초록(램프·후보·연속일 전이·`shouldOpenDailyReward`·`hasDailyItem`).
2. **서버** — `prove-daily-reward-seal.ps1` + `prove-daily-reward-cap.ps1` 의 **ASCII 토큰 10개 전부** `[OK]`. 여기서만 멱등·캡 산입·절삭·source 필터·하한 양단·백필 하한·**authenticated 의 RPC 도달 거부**가 실증된다.
3. **실화면** — 원격 실서버 **실계정 1개로 수동 1회** 수령(EF 직접 호출). 모달·예고 표시 육안 확인. ⚠️ **하네스 모의로는 이 판정을 대신할 수 없다** — 모의는 `currency_grants` 에 행을 남기지 않는다.
   - ⚠️ **이 판정만 유일하게 되돌릴 수 없는 쓰기를 한다.** `BEGIN…ROLLBACK` 안이 아니고,
     원장 행 1건 + `lifetime_granted` 가산 + `daily_streak` 전진이 실서버에 **영구히** 남는다.
     그래서 규약을 못박는다:
     - **전용 테스트 계정으로만 수행한다.** 실사용자 계정으로 하지 않는다(연속일이 오염되면
       그 유저의 30일 주기가 어긋나고 되돌릴 방법이 없다).
     - 검증 후 `service_role` 로 **해당 `daily_reward_claims` 행을 삭제하고 `lifetime_granted` ·
       `daily_last_claim_seed` · `daily_streak` 을 수령 전 값으로 되돌리는**
       **`scripts/cleanup-daily-reward-probe.ps1` 을 같은 커밋에 둔다.** 나중에 만들면
       "나중"이 오지 않는다 — 정리 절차가 없는 수동 검증은 매 회차마다 잔재를 남긴다.
     - 그 스크립트는 **수령 전 값을 먼저 찍어 두는 단계**를 포함한다(사후에 되돌릴 값을
       알 방법이 없으므로).

**슬라이스 1 배포 게이트** — 슬라이스 1 은 그 자체로 일관되지만(곁들이 크레딧 = 주 보상) 헤더 칩·도움말·나머지 5축이 없다. 차단은 **두 겹**이다: ①`claim_daily_reward_for` 가 service_role 전용이고 **authenticated 진입점이 아예 없다**(래퍼를 안 만들었다) ②**클라 진입 훅(C6)이 슬라이스 2 까지 상수로 꺼져 있다.** EF 는 배포한다 — 그래야 완료 판정 3을 할 수 있고, 배포해도 ①②가 유저 노출을 막는다.

### 슬라이스 2 — 남은 5축 + 화면 완성

**C7. 지급 분기 나머지 5축** — **장비**(배송함 경로 — C5 의 순수 함수가 이미 잠갔다) · 촉매 · 설계도 · 코어 모듈 · 의뢰서. 뒤의 넷은 **자기 서버 테이블로 직행**(배송함 불요). 후보 생산기 5종 추가. **축별 grant 호출 위치 계약**(C3)을 각 분기가 지키는지 계약 테스트로 단언. 의뢰서 축은 **지시 수신소 보관 상한**을 후보 생산기가 먼저 거른다.
- **촉매 축의 지급 수단을 못박는다: 기존 `grant_catalyst` 를 중첩 호출한다.** `claim_daily_reward_for` 가 `catalyst_inventory` 를 직접 잠그고 쓰지 않는다 — 촉매 적립 캡(`20260801000000_catalyst_grant_cap.sql`)이 그 함수 안에 살고, 직접 쓰면 **캡을 우회하는 두 번째 경로**가 생겨 ADR-0048 의 *"재화·촉매는 기존 누적 캡 원장을 통과한다"* 가 깨진다.
- ⚠️ **그 결과 계약 테스트의 "호출 함수 본문까지 훑는" 범위에 `grant_catalyst` 가 들어간다**(§C3). 촉매 축의 `for update`(`catalyst_inventory → profiles`)는 이 RPC 본문이 아니라 **`grant_catalyst` 본문에 있으므로**, 훑기 범위에 넣지 않으면 잠금 순서 단언이 **아무것도 안 보고 통과한다** — `grant_currency_for` 에서 이미 한 번 놓쳤던 사각지대와 동형이다.
- **코어 모듈 축은 신규 insert 전용**이므로 기존 행을 `for update` 로 잠그지 않는다(§Pre-mortem 1 각주 — 그 축은 리포 안에서도 방향이 둘이라 고를 수 없다).

**C8. 헤더 연속일 칩** · `src/ui/pixi/baseMap.ts` — 칩 3개 + 제목 겹침 **실화면 실측**. `TILE_W`·행 배치·세로 예산 불변. 테스트: `tests/baseMapDailyRewardChip.test.ts`

**C9. i18n + 도움말** · `src/i18n/catalog.ts` — KO/EN 짝. KO 문구는 `KO` 선언부 주석의 용어 정본표를 먼저 읽고 쓴다. 도움말이 **"하루 놓치면 1일차 리셋"** 과 **"받을 수 있는 것의 상한이 지금까지 서버가 지급한 총량에 묶인다"** 를 말한다. ⚠️ 초안은 *"자기 최고 클리어 단계에 묶인다"* 라고 적었는데 앵커가 바뀌었으므로 **플레이어에게 거짓을 말하는 문구**였다 — 스펙 AC-22 가 같은 문구를 AC 로 들고 있었으므로 **양쪽을 함께 교정했다**(스펙 §ui-copy AC-22).

**C10. 자산** — 사운드 **CC0 실음원**(절차 합성 금지). 개봉 연출 아트: 원본 해상도와 표시 배율을 실측(과확대가 "구려 보인다"의 절반이었던 전례).

**C11. 하네스** · `src/harness/dailyRewardMock.ts` + 치트 패널 — 연속일 임의 세팅 · 하루 넘기기 · 미반영 배송함 행 1건 생성(관측 지표 실증용). **모의가 config 보다 먼저 적용돼 실서버를 가리지 않도록** 우선순위 확인.

**C12. 실증 스크립트 — 2개로 쪼갠다**

⚠️ **초안의 "미러를 위조해 상한이 무는지 실증"은 앵커를 바꾼 순간 항진 테스트가 됐다.** 미러
(`profiles.save`·`ships`·`items`)는 이제 **후보 선정에만** 쓰이고 상한은 `lifetime_granted` 에서
나오므로, 미러를 위조해도 상한이 안 움직이는 것이 **설계상 당연**하다 — 무엇을 구현하든 통과한다.
Driver 2 가 "실증하지 못하면 켤 수 없다"고 선언한 그 실증이 소멸했으므로 다시 정의한다.

**ⓐ `scripts/prove-daily-reward-seal.ps1`** — 앵커가 봉인돼 있는가 + **RPC 가 도달 거부하는가**
- `prove-catalyst-residue-seal.ps1` 형식. `authenticated` 로 `update profiles set lifetime_granted = 10^9` · `daily_streak = 30` 을 시도해 **봉인 트리거가 되돌리는지** 실증.
- `guard_profiles_client_insert` 도 함께 — 새 행을 `daily_streak: 30` 으로 INSERT 시도.
- **`[OK] RPC_DENIED_AUTHENTICATED`** — `authenticated` 로 `claim_daily_reward_for` 를 호출하면 **permission denied** 가 난다.
  - ⚠️ **이것이 재정의된 AC-25 의 유일한 실증이다.** 기존 `SEAL_*` 3종은 전부 `profiles`
    **컬럼** 봉인이라 *"authenticated 가 RPC 에 도달하지 못한다"* 를 **하나도 실증하지
    않는다.** 래퍼를 만들지 않기로 한 결정(§C3)이 배포 게이트의 근거 전체를 떠받치는데,
    그 결정이 실제로 SQL 에 반영됐는지를 재는 관문이 없었다 — `revoke` 한 줄이 다음
    마이그레이션에서 조용히 빠져도 아무 관문이 안 울렸을 것이다.
- 통과 토큰 4개: `[OK] SEAL_LIFETIME_HELD` · `[OK] SEAL_STREAK_HELD` · `[OK] SEAL_INSERT_ZEROED` · `[OK] RPC_DENIED_AUTHENTICATED`

**ⓑ `scripts/prove-daily-reward-cap.ps1`** — 상한이 실제로 무는가 + integration 층
- ⚠️ **초안은 실행 불가능한 절차를 명세하고 있었다.** *"`authenticated` 수령을 실행해"* 라고
  적었는데 같은 계획이 `revoke all ... from authenticated` 를 규정한다 — 그 문장대로 짜면
  **permission denied 로 즉시 실패**한다(그리고 그 실패는 ⓐ의 `RPC_DENIED_AUTHENTICATED` 가
  재는 **정상 동작**이다). 그래서 이 스크립트의 수령은 전부 **`service_role` 로 실행**한다.
- `postgres` 로 `lifetime_granted` 를 낮게 세팅한 상태에서 **`service_role` 로 수령을 실행해**
  **예산 천장이 그 값에서 파생된 상한으로 절삭되는지**를 반환값의 절삭 플래그(`clamped`)로 단언.
- **§Expanded Test Plan 의 integration 항목을 여기로 이관한다**(vitest 로는 불가능 — Principle 6). 각각 ASCII 통과 토큰을 갖는다:
  - `[OK] IDEMPOTENT_1ROW` — 같은 `date_seed` 2회 호출 → 원장 1행·지급 1회·굴린 결과 동일(`result_payload` 가 두 번째 호출에서도 같다)
  - `[OK] CAP_LEDGER_ROW` — 재화 지급이 `currency_grants` 에 행을 남긴다(캡 산입)
  - `[OK] CAP_CLAMPED` — 상한 초과 요청이 상한까지만 지급. ⚠️ **무엇이 물었는지를 구분해 단언한다** — `CAP_DEFAULT`(1000)가 아니라 **예산 천장**에서 물어야 한다. 구분하지 않으면 캡 등록(§C3)이 통째로 빠져도 이 토큰이 초록으로 뜬다(둘 다 "절삭됐다"이므로)
  - `[OK] ANCHOR_NO_SELF_FEED` — 일일 보상이 만든 `currency_grants` 행이 `lifetime_granted` 를 **올리지 않는다**(source 필터 실증)
  - `[OK] FLOOR_BOUNDED` — `lifetime_granted = 0` 계정의 예산이 **`0 < 예산 <= DAILY_BUDGET_DAY_1`**. ⚠️ 초안의 `FLOOR_NONZERO`(하한만 단언)를 **개명·강화**했다 — 하한만 보면 FLOOR 가 아무리 커도 통과해서 *유계가 깨지는 방향*을 못 잡는다.
  - `[OK] BACKFILL_LOWER_BOUND` — 백필된 기존 행에서 `lifetime_granted >= credits + minerals * 8`(§백필. `MINERAL_TO_CREDIT = 8` 을 조건식에 **값으로 박는다** — 스크립트가 상수를 다시 읽어 오면 상수가 틀려도 양변이 함께 틀려 항진이 된다)
- **토큰 총수 = ⓐ 4 + ⓑ 6 = 10.**
- 전부 `BEGIN…ROLLBACK` 안. 콘솔 출력은 **ASCII 만**(PowerShell 5.1 mojibake 가 성공을 실패로 보이게 한다).

**C13. 마이그레이션 롤백** · `scripts/rollback-daily-reward-migration.ps1`

계획에 **되돌리는 절차가 아예 없었다.** 이 마이그레이션이 바꾸는 것은 다섯이다 —
`profiles` 컬럼 3개 · `daily_reward_claims` 테이블 · `currency_grants` AFTER 트리거 ·
**봉인 함수 2개의 `create or replace`** · **`grant_currency_for` 의 `create or replace`**(§C3 개정).

앞의 셋은 `drop` 으로 되돌아간다. 문제는 뒤의 둘이다:

⚠️ **`create or replace` 된 함수는 "되돌리기"가 곧 "이전 정의를 다시 적기"다.** 그리고
**이전 정의를 손으로 옮겨 적는 것이 정확히 `20260802000000:4-15` 가 프로덕션을 100% 깨뜨린
형상이다** — 낡거나 어긋난 본문 복제. 롤백 스크립트가 그 사고의 재판이 되면, 사고를 수습하려고
돌린 스크립트가 사고를 일으킨다.

**그래서 롤백 스크립트는 이전 정의를 저작하지 않는다.** 현행 정의가 살아 있는 파일에서
**본문을 잘라 그대로 실행**한다:
- `guard_profiles_client_write` → `supabase/migrations/20260731000000_catalyst_shop.sql:109-128`
- `guard_profiles_client_insert` → 같은 파일 `:137-150`
- **`grant_currency_for`** → `supabase/migrations/20260803000000_commission_ledger.sql:197-373`
  (**개정 때 잘라 붙인 바로 그 구간**이다 — 개정과 롤백이 같은 원본을 가리키므로 둘이 갈릴
  수 없다. 이것이 "손으로 옮겨 적지 않는다" 규율의 실제 이득이다)

즉 스크립트는 그 파일들을 **읽어서** 해당 구간을 psql 에 먹인다(복사본을 스크립트 안에 두지
않는다). 원본이 바뀌면 롤백도 함께 바뀌는 것이 옳다 — 이 세 함수의 정본은 언제나 "가장 최근에
그것을 정의한 마이그레이션"이기 때문이다.

⚠️ **`grant_currency_for` 롤백에는 순서 제약이 있다** — `daily_reward` 캡이 사라지면 그 source
지급이 `CAP_DEFAULT`(1000)로 절삭되므로, **일일 보상 EF 를 먼저 끄고** 롤백한다. 순서를 뒤집으면
롤백과 다음 수령 사이의 지급이 조용히 잘린다.

**백필은 롤백 대상이 아니다** — 컬럼을 `drop` 하면 값도 함께 사라진다. 다만 **재적용 시
백필이 다시 돌아 잔액 기준으로 재계산된다**는 것을 스크립트 헤더에 경고로 적는다(롤백 →
재적용 사이에 벌어진 지급은 7일 창 안에 있으면 `currency_grants` 쪽 `greatest` 가 일부 건진다).

## Risks and Mitigations

각 행은 **누가 언제 무엇을 보고 통과를 판정하는지**까지 적는다. "확인한다"로 끝나는 완화책은 완화책이 아니다.

| 위험 | 완화 — 판정 주체·시점·통과 조건 |
|---|---|
| ABBA 교착(Pre-mortem 1) | **전순서 선언은 기각됐다**(§Pre-mortem 1). 완화는 *한 트랜잭션에 인벤토리 1개* 구조 강제 + 축별 기존 관례 준수. **판정**: C3 계약 테스트가 호출 함수 본문까지 훑어 인벤토리 테이블이 2개 이상 `for update` 로 안 나오는지 + `grant_currency_for(` 등장 위치가 축별 기대값(촉매=인벤토리 뒤 / 코어 모듈=앞)과 일치하는지를 **문자 위치 비교**로 단언 |
| 장비 복제·유실(Pre-mortem 2) | **`unique(profile_id,item_id)` 는 안전망이 아니다**(클라가 `items` 에 안 쓴다 — §C5). 완화는 순수 함수 `hasDailyItem` 이 4곳 전수를 보는 것 단독. **판정**: `tests/dailyRewardNet.test.ts` 케이스 ①~⑦ 전부 초록 |
| 다기기 통짜 폐기로 영구 유실 | 반영 → push → **재-pull 하여 아이템 존재 확인** → mark. **판정**: 테스트 ⑦(서버에 `progressScore` 더 높은 프로필을 심고 왕복, 재-pull 에 아이템이 없으면 mark 안 함) 초록 |
| 모달 재발·비동기 창(Pre-mortem 3) | 순수 판정 `shouldOpenDailyReward` + `openBaseMap` 단일 훅(호출부 18곳이 수렴) + 응답 도착 시 `currentScreenName === 'base'` 재확인. **판정**: `tests/dailyRewardGate.test.ts` 가 재진입 2경로 + 비동기 창 케이스 초록 |
| 상한이 안 무는데 초록 | **초안의 "미러 위조 실증"은 항진이 됐다**(§C12). **판정**: `prove-daily-reward-cap.ps1` 의 `[OK] CAP_CLAMPED` |
| **authenticated 진입점이 조용히 부활** | 배포 게이트의 근거가 *"래퍼를 안 만들었다"* 인데, `revoke` 한 줄이 다음 마이그레이션에서 빠지면 아무 관문도 안 울렸다. **판정**: `[OK] RPC_DENIED_AUTHENTICATED`(ⓐ) — `SEAL_*` 3종은 컬럼 봉인이라 이것을 하나도 실증하지 않는다 |
| 앵커 자기참조 되먹임 | 트리거 `when (new.source <> 'daily_reward')`. **판정**: 계약 테스트가 필터 존재를 단언 + `[OK] ANCHOR_NO_SELF_FEED` |
| 신규 계정 상한 0 | 예산 산식에 `FLOOR = DAILY_BUDGET_DAY_1` 하한(파생 — 별도 리터럴 금지). **판정**: unit 양단 단언 + `[OK] FLOOR_BOUNDED`(`0 < 예산 <= DAY_1`. 하한만 재던 `FLOOR_NONZERO` 는 FLOOR 가 아무리 커도 통과해 **유계가 깨지는 방향을 못 잡았다**) |
| **기존 유저가 신규 봇과 같은 천장에서 시작** | `add column` 직후 **백필 1회**(잔액 하한 ∨ 7일 창 합). `currency_grants` 7일 GC 라 **이 시점을 놓치면 영영 못 채운다.** **판정**: `[OK] BACKFILL_LOWER_BOUND` |
| **램프가 죽었는데 초록** | 백필 뒤에는 `lifetime=0` 에서 예산이 상수인 것이 **설계상 옳으므로**, 그 지점의 단언으로는 램프 사망을 못 잡는다. **판정**: unit — **백필 규모 `lifetime_granted`** 에서 연속일 1→30 예산이 상수가 **아님** |
| **`grant_currency_for` 재정의가 낡은 본문 복제를 재발시킴** | 이 계획이 스스로 금지한 것을 **의도적으로 어긴 유일한 자리**다(§C3, 사용자 확정). 완화는 ①현행 정의(`20260803000000:197-373`)를 **파일에서 잘라 붙여** 한 바이트도 안 바꾸고 상수 2개 + case 1갈래만 추가 ②봉인 트리거 2개와 **같은 규율**. **판정**: 계약 테스트가 재정의 본문의 **캡 상수 전집합과 값**을 원본에서 뽑아 대조 + **`grant_currency` allowlist 가 `pve_run`·`salvage`·`story` 셋 그대로**임을 단언(클라가 `daily_reward` 로 못 들어온다) |
| **재화 축 지급이 1000 으로 조용히 절삭됨** | 미등록 source 는 `CAP_DEFAULT`(1000/1000)에 걸리는데 30일차 예산은 20,000 이다 — **초록인 채로 램프가 죽는다**(EF 바깥의 절삭이라 단위·계약 테스트가 못 본다). 완화는 `CAP_DAILY_REWARD_*(25000)` 등록. **판정**: `[OK] CAP_CLAMPED` 가 **`CAP_DEFAULT` 가 아니라 예산 천장**에서 물었음을 구분해 단언 + 상수 대조 부등식(`CAP_DAILY_REWARD_* > DAILY_BUDGET_DAY_30`) |
| 봉인 트리거 수정이 기존 봉인을 깨뜨림 | **최신 정의(`20260731000000:109-128`)에서 복사**하고 추가만. ⚠️ 계약 테스트는 숫자만이 아니라 **필드 집합 전체**를 단언한다(`tests/catalystShopContract.test.ts:177-189`) — 신규 3컬럼을 집합에도 넣어야 한다. **판정**: `catalystShopContract` + `dailyRewardContract` 둘 다 초록 + `[OK] SEAL_*` 3종 |
| 전 재화 경로에 트리거 추가로 정산 지연 | AFTER 트리거가 **모든** 재화 지급에서 발동해 `profiles` UPDATE + before-update 트리거를 매번 깨운다. **판정**: 슬라이스 1 에서 `settle_pve_run` 왕복 시간을 트리거 전/후로 **각 20회 측정해 p95 증가가 20ms 미만** |
| 죽은 계측기 | 관측 4지표 **전부** 실증한다 — 하네스로 미반영 행 1건·절삭 1건·source 필터 1건·만석 1건을 만들어 각 지표가 1을 읽는 것 확인. **판정**: 4지표 조회 SQL 이 §Expanded Test Plan 에 **적혀 있고**(이 조건은 이제 만족된다 — 초안은 SQL 을 한 줄도 안 적어 두고 이 판정을 걸어 놓았다) 각각 0이 아닌 값을 반환 |
| 만석이 경보를 가득 채움 | `hold_reason` 을 **서버 컬럼**에 적고 관측 ②가 `hold_reason is null` 로 거른다. 클라 로컬 상태면 서버에서는 그냥 미반영으로 보인다. **판정**: 하네스로 만석 1건을 만들어 ②가 **0**, ②'가 **1** 을 읽는다(둘 다 확인해야 분리가 실증된다) |
| PowerShell mojibake | 실증 스크립트 콘솔 출력 ASCII 전용. **판정**: 통과 토큰이 전부 `[A-Z_]` 형식 |

## Verification Steps

1. **편집 중** — 고친 것의 짝만: `npx vitest run tests/dailyRewardRamp.test.ts` (약 7초)
2. **커밋 전** — `pnpm test:changed` (약 34초, 기준점 `origin/main`)
3. **자산·데이터를 건드린 커밋** — `--changed` 는 임포트 그래프만 보므로 자산 존재 검사(`*AssetPresence.test.ts`)를 **직접 지정**해서 함께 돌린다
4. **PR 전** — `pnpm verify` (약 2분 30초). **파이프에 물리지 않는다** — exit code 가 `tail` 것이 되어 거짓 그린
5. **sim 레인** — `src/sim/**`·밸런스 수치·`src/bench/**` 를 건드리지 않으므로 `pnpm test:sim` **불요**. C1/C2 가 `data/` 에만 사는지 확인하고, `src/sim/**` 로 새면 그때 판단
6. **원격** — `apply-daily-reward-migration.ps1` → **`prove-daily-reward-seal.ps1`**(초안에 빠져 있었다 — 봉인·RPC 도달 거부를 재는 유일한 스크립트인데 절차에 없었으므로 돌지 않았을 것이다) → `prove-daily-reward-cap.ps1` → EF 배포. 되돌릴 일이 생기면 `rollback-daily-reward-migration.ps1`(§C13)
7. **실화면** — 하네스로 30일차까지, 진입 경로 4종, 칩 겹침 **+ 원격 실서버 실계정 1회 수동 수령(EF 직접 호출)**. ⚠️ **하네스 모의로 대체 불가** — 모의는 `currency_grants` 에 행을 남기지 않아 캡 산입·앵커 가산이 실경로에서 도는지를 하나도 재지 못한다. 수령 후 `cleanup-daily-reward-probe.ps1` 로 정리(완료 판정 3)

## 커밋·브랜치

`feat/daily-reward` 브랜치 → 슬라이스별 커밋 → `gh pr create` → 머지. commit 전 매번 secret 검사(`.env`·`local.properties`·`*.keystore`·`*.apk`·`*.jks`·`*.pem`).

---

## ADR — 구현 구조 결정

**Decision.** 일일 보상을 **재화 축 수직 관통(슬라이스 1) → 나머지 5축(슬라이스 2)** 으로 구현한다.
배송함 스키마는 슬라이스 1 마이그레이션에 동반하되 장비 지급 분기는 슬라이스 2 로 미룬다. 상한
앵커는 **`profiles.lifetime_granted`(신설) + `currency_grants` AFTER INSERT 트리거**이고, 상한
산식의 정본은 **SQL 한 곳**이며 EF 는 반환값만 소비한다. 수령 RPC 는 **service_role 전용 단일
함수이며 authenticated 래퍼를 두지 않는다** — 수령이 EF 전용이라 클라 진입점이 필요 없고,
만들면 쓰지도 않는 **순공격면**이 된다. (초안의 이 문단은 *"래퍼 2단"* 이라 적어 본문 §C3 와
정면으로 모순됐다. C3 가 나중에 결정된 쪽이고 배포 게이트·AC-25 가 그 위에 서 있으므로,
모순의 해소 방향은 C3 다.) 신설 컬럼에는 **마이그레이션 안에서 1회 백필**이 따른다 —
`currency_grants` 가 7일 GC 라 그 시점을 놓치면 과거를 영영 복원할 수 없다. 그리고
**`grant_currency_for` 를 예외적으로 재정의해 `daily_reward` per-call 캡을 등록한다** —
이 계획의 *"본문을 고치지 않는다"* 를 의도적으로 어기는 유일한 자리이며, 원본 구간을 **잘라
붙이는** 방식이라 금지 규율이 겨눈 위험(낡은 본문 복제)에 해당하지 않는다.

**Drivers.** ①배송 경로가 리포에 없다(의뢰 기능이 같은 자리에서 멈췄다) ②상한 유계가 유일한
안전장치다 ③잠금 순서 위반은 어떤 검증으로도 안 잡힌다.

**Alternatives considered.**
- *계층 우선(bottom-up)* — 기각. 드라이버 없이 계층 미학만 따르고 화면 피드백이 6~7 커밋 뒤다.
- *화면 우선(모의 기반)* — 기각. 모의가 실서버를 가린 전례가 있어 모의 초록이 실경로 초록의 증거가 못 되고, 드라이버 2·3 을 마지막으로 밀어낸다.
- *장비 축 첫 슬라이스* — **초안이 골랐다가 기각.** 배송함의 실제 실패 모드 셋이 그 슬라이스의 완료 판정으로 재현되지 않아 "위험을 노출했다"가 착각이었고, 그 슬라이스는 배포 불가였다.
- *상한 산식을 EF 에만* — 기각. `prove-*.ps1` 이 TypeScript 로직을 실증할 수 없어 완료 관문 ②가 죽은 관문이 된다.
- *`pve_runs` stage 를 앵커로* — **사실 오류로 기각.** 클라 주장이며 `verified_status` 는 리터럴이다.
- *`currency_grants` 직접 합산* — 기각. 7일 GC 라 "휴가 다녀오면 상한이 떨어진다"가 되어 30일 램프와 충돌한다.
- *`grant_currency_for` 본문에 누적 가산* — 기각. 복제가 프로덕션을 100% 깨뜨린 계열이라 AFTER 트리거로 붙인다(발령 선례).
- *`items` 유니크 제약을 멱등 안전망으로* — 기각. 클라가 그 테이블에 쓰지 않아 제약이 이 경로에 걸리지 않는다.
- *`grant_currency` 식 authenticated 래퍼 2단* — **기각.** 그쪽은 클라가 직접 부르는 경로가 **실재해서** 래퍼가 필요했다. 여기는 클라 직접 호출 경로가 실재하지 않으므로(EF 가 미러를 읽고 `rollItem` 을 돌려야 한다) 래퍼는 기능을 하나도 더하지 않고 **순공격면**만 만든다.
- *백필 소스로 `profiles.save` 의 기체 레벨 합* — **기각.** 진행도를 더 잘 반영하지만 클라 쓰기 미러다. **위조 가능 입력을 앵커에 1회라도 주입하면** ADR 의 *"상한은 서버 권위 상태에서만 파생"* 이 문자 그대로 깨지고, 그 값은 단조 컬럼에 영구히 남는다. 잔액 하한이 그 문장을 넓히지 않고 같은 목적을 달성한다.
- *`daily_reward` 가 `CAP_DEFAULT`(1000/1000)를 그대로 받는다* — **기각. 재화 축 램프가 죽는다.** 30일차 예산 20,000 이 1000 으로 절삭되고, 슬라이스 1 의 제품 전체가 재화 축이라 그 죽음이 곧 슬라이스 1 의 죽음이다. 게다가 **초록인 채로** 죽는다.
- *보상 규모를 1000 안으로 낮춘다* — **기각.** 30일차 최고점이 **런 1회의 1/5** 이 되어 연속 접속의 압력이 사라진다. ADR-0048 이 램프에 건 설계 의도(*"매일 조금씩 오르는 직선의 최고점"*)가 값의 규모에서 성립하지 않게 된다 — 손잡이를 지키려고 손잡이가 미는 것을 없애는 셈이다.
- *FLOOR 시간 감쇠 · 계정 생성일 유예창* — 기각. 전자는 감쇠율이 **두 번째 손잡이**가 되어 "손잡이 하나"를 되돌리고, 후자는 유계가 가장 강하나 손잡이 2개이며 **백필이 닫히면 불필요**해진다(백필 뒤 `lifetime_granted = 0` 은 진짜 신규 계정뿐이다).

**Why chosen.** 슬라이스 1 이 그 자체로 일관된 제품이면서(곁들이 크레딧 = 주 보상) 진짜 미지
다섯(권한 경계·예고 왕복·캡 산입·연속일 봉인·모달 진입)을 3~4 커밋에 드러낸다. 경로가 라이브
검증된 `grant_currency_for` 라 관통의 불확실성이 가장 낮다. 배송함 위험은 슬라이스 순서가 아니라
**순수 함수 7케이스**(§C5)로 옮겨 실제로 재현 가능한 형태로 잠근다.

**Consequences.**
- `guard_profiles_client_write` 봉인이 9 → 12, `guard_profiles_client_insert` 가 3 → 6 이 되고 `tests/catalystShopContract.test.ts:176`·`:198` 의 숫자와 `:177-189`·`:199` 의 **집합**을 같은 커밋에서 갱신해야 한다. 신규 3컬럼을 전부 `:= 0` 센티넬로 둔 덕에 `:197` 의 **정규식은 안 건드린다**.
- 상한이 **진행도의 대리 지표**(누적 지급액)라 정밀하지 않다. 환산 산식을 새로 짜고 밸런스로 넘긴다.
  - ⚠️ **구체적으로 무엇이 새는가: `catalyst_grants` 는 앵커에 안 센다.** ADR 은 서버가 검증하는 원장으로 `currency_grants` 와 `catalyst_grants` **둘**을 들었는데, 이 계획은 **`currency_grants` 트리거 하나만** 만든다. 그래서 **촉매 위주로 플레이한 유저의 앵커가 실제 진행도보다 낮게 잡힌다** — 정직하게 많이 플레이했는데 천장이 안 열린다. 대리 지표의 부정확이 추상적인 말이 아니라 이 한 축에 구체적으로 몰려 있다.
  - 두 번째 트리거를 붙이지 않은 이유는 **환율 문제가 한 겹 더 생기기 때문**이다 — 촉매를 크레딧으로 환산하는 계수는 `MINERAL_TO_CREDIT` 과 달리 등급별로 갈리고, 그것은 §C2 가치 환산표(밸런스 대상)와 같은 축이라 **상한 산식 정본이 미확정 밸런스 상수에 묶인다.** 확장은 밸런스 레인으로 넘긴다.
  - 백필도 같은 이유로 **재화만** 본다(잔액 하한 + 7일 창 합). 촉매 보유량은 세지 않는다.
- 계약 테스트가 **호출되는 함수 본문까지** 훑어야 한다 — 정적 단언의 범위가 한 겹 넓어진다. 슬라이스 2 에서 `grant_catalyst` 가 그 범위에 들어온다.
- **`grant_currency_for` 가 이 마이그레이션에서 재정의된다.** per-call 캡 상수 2개(`CAP_DAILY_REWARD_*` = 25,000)와 `case` 한 갈래가 는다. 파급 셋: ①계약 테스트가 **그 함수의 캡 상수 전집합**을 감시 대상으로 갖는다 ②롤백이 함수 하나를 더 복원해야 하고 **EF 를 먼저 끄는 순서 제약**이 붙는다(§C13) ③`grant_currency`(클라 진입점)의 allowlist 는 **손대지 않으므로** 클라의 도달 가능 source 는 그대로 셋이다.
- **EF 를 배포하되 유저 노출은 두 겹으로 차단된다** — ①`claim_daily_reward_for` 에 **authenticated 진입점이 아예 없다**(래퍼를 안 만들었다) ②**클라 진입 훅(C6)이 슬라이스 2 까지 상수로 꺼져 있다.** (초안은 *"슬라이스 1 은 EF 미배포로 차단되므로"* 라 적었는데, 같은 계획의 완료 판정 3 이 **EF 직접 호출을 요구**하므로 미배포일 수 없었다 — 서술이 갈려 있었다.) 머지와 활성화는 여전히 분리된다.
- ADR-0048 이 "위조해도 정직한 범위 안"이라는 자기 근거를 **처음으로 실제로** 만족한다(초판은 만족하지 못한 채 서 있었다).
- **`DAILY_CEILING_RATE` 는 "천장이 언제부터 사문화되는가"를 정하는 계수이고, `MINERAL_TO_CREDIT = 8`
  이 그 사문화 구간을 넓혔다.** 0.02 에서는 `lifetime_granted` 100만이면 천장이
  `DAILY_BUDGET_DAY_30`(20,000)에 닿는다 — PvE per-call 상한 5,000/5,000 에 광물이 8배로
  세어지므로 런 1회 최대 45,000, 즉 **런 23회 규모**다(환율 1이던 초안 계산의 "런 100회"가
  4배 이상 짧아졌다). 그 위로는 천장이 **아무것도 안 문다.** 극단으로 밀면 일일 캡
  300,000/300,000 을 매일 채우는 계정이 30일에 앵커 81,000,000 · 천장 **1,620,000** 으로
  30일차 예산의 **81배**에 앉는다. 즉 이 계수에서 상한 유계는 *초반 계정·신규 봇 방어용*
  장치이고 **중견 이상에게는 램프가 실질 정본**이다. 그것이 의도인지는 **밸런스 레인의 판단**
  이며, 출시 직전 일괄 튜닝에서 이 계수를 정할 때 **그 성질을 명시적으로 고르라**는 뜻으로
  여기 기록한다(산술 전개는 §Open Questions).

**Follow-ups.**
- `pve_runs.summary->>'stage'` 가 클라 주장이라는 사실은 **이 레인 밖의 별개 판단**이다 — 침략 단계 개방 상한·요구 레벨 게이트 등 stage 를 신뢰하는 다른 축이 같은 문제를 갖는지 큐에 남긴다. 이 레인이 견인할 이유가 없다.
- 의뢰 확정 지급물 배송 공백(task_839d4581).

---

## Open Questions

**해소된 것 2건**(Critic 1차 때 미해결로 남겨 뒀던 셋 중):

- **`lifetime_granted` 를 numeric 단일 스칼라로 둘 때의 환율** → **해소.**
  **`MINERAL_TO_CREDIT = 8`**, 정본은 `data/dailyRewardSelection.ts:105`(`// BALANCE`).
  `currency_grants` 가 `credits`·`minerals` 두 컬럼이고 앵커가 단일 스칼라이므로 환율은
  "나중에 정할 것"이 아니라 **상한 산식 정본과 백필 산식에 직접 들어가는 상수**다 — 미룰 자리가
  없다는 것이 이 질문의 첫 답이었다.
  - **두 번째 답이 값을 정했다: 앵커 환율과 가치 환산표 환율은 같아야 한다.** 앵커가 세는
    단위와 보상 가치를 재는 단위가 갈리면 *"지금까지 받은 만큼에서 파생된 천장"* 이라는 문장이
    **두 개의 서로 다른 "만큼"** 을 뜻하게 된다 — 천장은 광물을 1로 세는데 그 천장이 거르는
    후보는 광물을 8로 센다면, 상한이 무는 지점이 축마다 달라져 유계 논증이 축별로 갈린다.
    그래서 두 값을 같게 두고 **계약 테스트가 대조한다**(§C3).
  - 그래서 값의 근거도 앵커가 아니라 환산표에 있다 — **광물이 크레딧보다 희소하다**는 축.
- **롤백 절차** → **해소.** §C13. 핵심은 절차가 있느냐가 아니라 **봉인 함수의 이전 정의를 손으로
  옮겨 적지 않는 것**이었다 — 그 행위가 정확히 프로덕션을 100% 깨뜨린 사고의 형상이다.

**남는 것 1건 + 밸런스 관측 1건:**

- **`daily_reward_claims` 의 영구 보존 범위.** TTL 금지는 확정이지만(미반영 행이 사라지면 물건
  영구 유실) **반영이 끝난 행까지 영구히 둘 필요는 없다.** 그런데 `payload`(예고)는 다음날이
  읽고 `result_payload` 는 멱등 재시도가 읽으므로 "언제부터 안전한가"가 자명하지 않다.
  부분 인덱스(§C3)가 조회 비용은 막지만 저장 비용은 계속 자란다. **이 레인에서 결정하지 않는다** —
  결정하려면 실제 성장률을 봐야 하고, 그 데이터는 배포 후에만 생긴다.

- **밸런스 관측 — 상한 유계의 눈금.** 봇이 `grant_currency` 를 일일 캡까지 매일 밀어 앵커를
  키우는 경로를 산술로 확인했다. **보안 구멍은 아니었다:**
  - 일일 캡 300,000/300,000(`20260726000200_pve_settlement.sql:113-114`), `MINERAL_TO_CREDIT = 8`
    → 봇의 앵커 최대 증가율 `300,000 + 300,000 × 8 = ` **2,700,000/일**, 30일 **81,000,000**,
    `DAILY_CEILING_RATE = 0.02` 에서 천장 **1,620,000**. `DAILY_BUDGET_DAY_30`(20,000)를
    **81배**로 넘는다. (환율이 1이던 초안 계산은 360,000 이었다 — 광물을 8로 세면 이 자리의
    수치가 4.5배가 된다.)
  - 그러나 **정직한 헤비 플레이어도 같은 캡에 먼저 닿는다.** PvE per-call 상한 5,000/5,000, 런
    1회 par 95초(ADR-0048 §결과)이므로 30분 파밍 ≈ 20런 ≈ 크레딧 100,000 + 광물 100,000,
    2시간이면 크레딧·광물 각 400,000 으로 **일일 캡(300,000/300,000)을 이미 넘는다.** 즉 봇의
    상계와 정직한 헤비 유저의 상계가 **같은 값**이다.
  - 즉 일일 캡은 애초에 *"최상위 정직 유저의 파밍 속도"* 에 맞춰 세워진 값이고(ADR-0026 3중
    캡의 자기 규정), 앵커가 그 캡에 유계된다는 것은 **봇이 최상위 정직 유저를 넘어설 수
    없다**는 뜻이다. ADR-0048 §왜 "상한으로 유계"인가의 논증이 **이 경로에서도 성립한다.**
    (⚠️ `grant_currency` 는 allowlist 로 `pve_run`·`salvage`·`story` 만 등급 상한을 주지만,
    그 셋은 전부 `authenticated` 에 grant 돼 있어 **클라가 부를 수 있다** —
    `20260726000200_pve_settlement.sql:249`. 그래서 "봇이 캡까지 민다"는 가정 자체는 현실적이다.
    성립하는 것은 그 가정 **위에서도** 논증이 버틴다는 점이다.)
  - **실제로 남는 것은 보안이 아니라 눈금 문제이고, 환율 8 이 그것을 키웠다** — 위
    §Consequences 의 `DAILY_CEILING_RATE` 항목. 봇조차 천장 1,620,000 에 닿는다는 것은
    **`DAILY_BUDGET_DAY_30`(20,000) 규모에서 상한이 그 위 전부에게 아무것도 안 문다**는
    뜻이다. 이 계수를 정하는 것이 곧 *"천장이 언제부터 사문화되는가"* 를 정하는 것이며,
    **밸런스 레인이 명시적으로 골라야 한다.** 그래서 위험표 행이 아니라 관측 항목이다.

---

## 전파 체크리스트

Critic 이 지적한 **세 번째 반복 실패**는 판단이 아니라 절차였다 — *"본문 결정을 문서 나머지에
전파하다 중간에 멈춘 것."* 앵커 정정 때 5곳에서 멈췄고, 래퍼 제거 때 §ADR 절에서 멈췄고,
FLOOR 관문 때 위험표에서 멈췄다. 같은 실패가 세 번 났으면 그것은 주의력 문제가 아니다.

**그래서 기계적 대조표를 둔다. 결정을 바꾸면 아래 7곳을 이 순서로 확인한다.**

| # | 자리 | 무엇이 어긋나기 쉬운가 |
|---|---|---|
| 1 | **본문 결정**(§상한 앵커 · §Implementation Steps 의 해당 C 항목) | 결정 자체 |
| 2 | **§ADR 절**(Decision · Alternatives · Consequences) | Decision 한 문장이 본문과 정면 모순 나기 가장 쉬운 자리(래퍼 2단이 여기서 났다) |
| 3 | **§Verification Steps** | 새 스크립트·새 순서가 절차에 안 들어감(`prove-daily-reward-seal.ps1` 이 여기서 빠져 있었다) |
| 4 | **위험표** | 기각된 완화책·죽은 판정식이 남음(`FLOOR_NONZERO` 가 여기서 남았다) |
| 5 | **§Expanded Test Plan** | 층별 항목과 관문 토큰의 개수·이름 |
| 6 | **스펙**(`.omc/specs/deep-interview-daily-reward-gaps.md` — Constraints · Ontology · AC) | **Constraint 는 AC 보다 상위 계약**이라 여기 남은 낡은 서술이 가장 무겁다 |
| 7 | **ADR**(`docs/adr/0048-*.md` — 결정표 · 결과) | 기각된 관문을 ADR 이 정본으로 들고 있기 쉽다 |

**규칙 둘:**
- **토큰 개수를 바꾸면 3곳을 동시에 고친다** — §C12 목록 · 완료 판정 2 · ADR §결과의 관문 ②.
- **정책은 재결정하지 않는다.** 이 표가 고치는 것은 **사실 오류와 내부 모순**뿐이다. 결정표
  20갈래는 사용자가 확정했다.

---

## 합의 이력

| 패스 | 결과 |
|---|---|
| Planner 초안 | 6컴포넌트 · 12커밋 · Pre-mortem 3 · 확장 테스트 4층 |
| Planner 자체 실측 | **Pre-mortem 1 완화책 기각·교체** — 리포에 통일된 잠금 방향이 없음을 확인, "전순서 선언"을 "축별 관례 준수 + 인벤토리 1개"로 |
| Architect | **REVISE** — 심각 5·중 3·경 1. 전부 반영 |
| ADR 정정 | 상한 앵커가 **틀린 서술**이었음을 발견 → `pve_runs` stage 기각, `lifetime_granted` 신설. CONTEXT.md·ADR 함께 교정 |
| Critic | ⚠️ **미완** — API 529 로 2회 실패. 아래 참조 |
| Planner 인용 검증 | 표본 8개 중 7개 정확, 1개 교정(`profile.ts` 아이템 컨테이너 줄번호) |
| **Critic 2차(착수 전)** | **REVISE** — Critical 4 · Major 9 · Minor 8. **반영 완료**(아래 §Critic 2차 반영) |

### Critic 1차 반영 (2026-08-05, 반복 2회차)

Critic 판정 **REVISE** — Critical 4 · Major 9 · Minor 6. 뿌리 진단이 정확했다: **상한 앵커 정정의
파급을 문서 5곳에서 멈췄다.** Critical 4건이 전부 그 한 뿌리에서 나왔고, 전파하니 함께 닫혔다.

| # | 지적 | 반영 |
|---|---|---|
| C1 | 완료 관문 ②가 **항진 테스트**가 됐다 — 앵커를 바꾼 순간 "미러 위조"는 상한과 무관 | prove 스크립트를 ⓐ봉인 실증 / ⓑ상한·멱등 실증 **2개로 분할**, ASCII 토큰 8개 명시 |
| C2 | 앵커가 **자기 자신을 밀어 올린다** — 일일 보상의 크레딧이 `currency_grants` 에 들어가 상한 가산 | 트리거에 `source <> 'daily_reward'` 필터 + 계약 단언 + `[OK] ANCHOR_NO_SELF_FEED` |
| C3 | 완료 판정·배포 게이트·authenticated 래퍼가 **삼각 모순** | **래퍼를 만들지 않는다**(수령은 EF 전용) → 셋이 동시에 닫힘. 완료 판정을 순수/서버/실화면 3층으로 분리 |
| C4 | **integration 층에 실행 수단이 없다** — `createClient` 테스트 0건(실측 확인) | integration 5항목을 `prove-*.ps1` 로 이관, Principle 6 신설 |
| M5 | Principle 3·5 가 본문이 기각한 내용을 선언 | 둘 다 재작성 |
| M6 | 위험표 8행 중 5행 결함(기각된 완화책 2·사실 오류 1·판정식 없음 2) | 표 전면 교체 — 각 행에 **판정 주체·시점·통과 조건** |
| M7 | 앵커 정정이 C1·C2·C9/AC-22·ADR 본문에 미전파 | 넷 다 전파. **도움말 문구가 플레이어에게 거짓을 말하고 있었다** |
| M8 | 다기기 `chooseProfile` 폐기를 어느 층도 안 덮는다 | 테스트 ⑦ 추가 + mark 조건을 **재-pull 확인**으로 강화 |
| M10 | `date_seed` 를 누가 정하는지 미명시 | 파라미터로 받지 않고 서버 계산 + 계약 단언 |
| M11 | 전역 AFTER 트리거의 성능 영향 미평가(Non-Goals 잠식) | ADR §결과에 명시 + p95 실측 20회 |
| M12 | Option A 허수아비 | "6축 동시 관통"으로 개명, 계층 순서가 같음을 명시 |
| M13 | observability 4지표 중 2개가 태생적 죽은 계측기 | `clamped` 컬럼 신설 + `flagged` → source 필터 카운트로 교체 + 4지표 전부 실증 |
| 누락 | **신규 계정 상한 0** — 앵커 교체가 만든 구멍 | 예산 산식에 `FLOOR` 하한 + `[OK] FLOOR_NONZERO` |

**미반영(당시)**: Minor 6건과 Open Questions 3건. **전부 Critic 2차에서 처리했다**(아래).

### Critic 2차 반영 (2026-08-05, 착수 전)

판정 **REVISE** — Critical 4 · Major 9 · Minor 8. 뿌리 진단: **1차 반영이 구조를 바꿔 놓고
그 파급을 다시 문서 전체에 전파하지 않았다.** 같은 실패의 세 번째 반복이라, 개별 수정과 별개로
**절차**를 남겼다(§전파 체크리스트).

| # | 지적 | 반영 |
|---|---|---|
| C-1 | **백필이 없다** — 컬럼을 `default 0` 으로 신설하면 마이그레이션 직후 베테랑이 신규 봇과 같은 천장(FLOOR)에서 시작하고, `currency_grants` 7일 GC 라 과거를 못 되살린다 | §백필 절 신설. 소스 = **잔액 하한 ∨ 7일 창 합**의 `greatest`. `profiles.save` 안은 **기각**(위조 가능 입력 1회 주입이 ADR 문장을 문자 그대로 깬다). `MINERAL_TO_CREDIT` 확정으로 환율 OQ 동시 해소. `[OK] BACKFILL_LOWER_BOUND` |
| C-2 | **`FLOOR` 의 값이 계약이 아니었다** — placeholder 로 두면 유계 강도가 미정 | `FLOOR = DAILY_BUDGET_DAY_1` **파생 계약**(별도 리터럴 금지). 시간 감쇠·유예창 기각 근거 명시. 관문을 **`FLOOR_BOUNDED`(양단)** 로 교체 — 하한만 재던 `FLOOR_NONZERO` 는 유계가 깨지는 방향을 못 잡았다. 램프 사망 검출 단언의 **전제 정정**(백필 후에는 `lifetime=0` 에서 상수인 것이 옳다) |
| C-3 | **§ADR 절의 "래퍼 2단"이 본문 §C3 와 정면 모순** | Decision 문장 교체(**service_role 전용 단일 함수**) + Alternatives 에 기각 근거 추가 |
| C-4 | **`prove-daily-reward-cap.ps1` 이 실행 불가능한 절차를 명세** — `revoke ... from authenticated` 인데 authenticated 수령을 실행하라고 적혀 있어 permission denied 로 즉사 | 수령을 **service_role** 로 교체. ⓐ에 **`RPC_DENIED_AUTHENTICATED`** 신설 — **재정의된 AC-25 의 유일한 실증**(`SEAL_*` 3종은 전부 컬럼 봉인이라 RPC 도달 거부를 하나도 안 잰다). 토큰 8 → **10** |
| M-1 | AC-7·AC-8 의 반영 위치 | `nextStreak` 이 §C1 산출물임을 명시 — **시그니처가 직전 seed 하나만 받는 것 자체가 AC-7 의 구조적 잠금**. §C3 계약 단언 2줄(`count(`·`group by` 부재 / streak 0 리셋 부재) + **SQL↔TS 상수 대조** |
| M-2 | `guard_profiles_client_insert` 6개를 세려면 정규식을 넓혀야 한다 | **다른 방식으로 이미 해소** — 센티넬을 `-1` 이 아니라 **`0`**(`DAILY_SEED_NEVER`). 기존 정규식이 그대로 6개를 센다. 근거 §C3 에 명시(*"하나만 `:= -1` 이면 그 컬럼이 계약의 시야 밖으로 빠진다"*) |
| M-3·M-4 | `daily_reward_claims` 스키마에 AC-5·관측 ②③을 담을 자리가 없다 | 컬럼 3개 신설 — `result_payload`(AC-5. `payload` 는 **예고 전용**임을 주석으로 못박음) · `clamped` · `hold_reason`. `mark_daily_reward_hold` RPC. **부분 인덱스** |
| M-5 | EF 배포 서술이 갈렸다(*"미배포로 차단"* vs 완료 판정 3의 EF 직접 호출) | **"배포하되 ①authenticated 진입점 부재 ②클라 훅 상수 오프 두 겹"** 으로 교체 |
| M-6 | 코어 모듈 잠금 순서 | *"`profiles` 를 먼저 잠근다"* → **잠그지 않는다**(신규 insert 전용). 각주로 그 축이 **내부적으로 두 방향**임을 실측 명시. 함수명 교정(`salvage_core_module`·`apply_module_purchase`) |
| M-7 | 자기 판정 조건 미충족 2건 | 관측 4지표의 **실제 `select` 4개**를 코드블록으로(판정 조건이 자기를 만족하지 못했다) + C5 테스트 **⑦**(다기기 통짜 폐기, `progressScore` 근거) + Principle 3 의 "3케이스" → **7케이스** |
| M-8 | §Verification Steps 에 `prove-daily-reward-seal.ps1` 이 빠져 있다 | 원격 절차에 추가 + 실화면에 **원격 실계정 1회 수동 수령(모의 대체 불가)** |
| M-9 | 실화면 검증이 되돌릴 수 없는 쓰기를 한다 | 완료 판정 3에 **전용 테스트 계정 한정** + `cleanup-daily-reward-probe.ps1` **같은 커밋** |
| 기타 | 롤백 절차 부재 | **§C13 신설.** 핵심은 봉인 함수 이전 정의를 **손으로 옮겨 적지 않는 것**(그것이 프로덕션 100% 파괴의 형상) — `20260731000000:109-128`·`:137-150` 을 **잘라 실행** |
| 기타 | `catalyst_grants` 가 앵커에 안 센다 | §Consequences 에 구체화 — 촉매 위주 유저 과소평가, 환율이 한 겹 더 필요해 밸런스로 이관 |
| 기타 | Pre-mortem 3 이 본문 C6 와 반대 | 첫 문단 교체 — 경로는 `openBaseMap` 단일 지점으로 수렴, 남는 위험은 **재발·비동기 창** |
| 기타 | 줄번호·개수 오류 | `pullServerProfileInto` `:2009` · `openIntroOrTitle` `:2014` · `harnessRefreshScreen` `:2503`(`openBaseMap` 은 `:2522`, `world === null` 가드) · `effectiveFunctionBody` **정의는 `:54`** · `openBaseMap` 호출부 **18곳**. `bootWithAuth` 조기 반환 단서 추가 |
| 기타 | 도움말 문구가 거짓 | §C9 · 스펙 AC-22 를 *"지금까지 서버가 지급한 총량에 묶인다"* 로 |
| **추가(사용자 확정)** | **`grant_currency_for` 를 예외적으로 재정의** — 미등록 source 는 `CAP_DEFAULT`(1000)에 걸려 30일차 예산 20,000 이 **조용히 절삭**되고, 슬라이스 1 이 통째로 재화 축이라 램프가 초록인 채로 죽는다 | §C3 에 근거·위험관리·드리프트 방어. §ADR Decision·Alternatives 2건·Consequences. **위험표 2행 신설.** §C13 롤백에 함수 1개 추가 + **EF 를 먼저 끄는 순서 제약.** 스펙 §Constraints·ADR §결과의 *"캡 상수는 손대지 않는다"* 를 **누적 캡 한정**으로 교정 |
| **추가(값 정정)** | **`MINERAL_TO_CREDIT` 이 1 이 아니라 8** — C2 워커가 환산표를 세우며 확정, 마이그레이션 2곳이 그것을 따랐다 | 백필·토큰·§C1·상수 대조·Open Questions·봇 산술 전부 8 기준으로. **정본은 `data/dailyRewardSelection.ts:105`**(환산표가 사는 자리). 앵커 환율 ≠ 환산표 환율이면 *"받은 만큼에서 파생된 천장"* 이 **두 개의 다른 "만큼"** 을 뜻하게 된다 |
| 기타 | 봇이 캡까지 밀어 앵커를 키우는 경로 | **산술로 확인 — 보안 구멍 아님**(일일 캡이 최상위 정직 유저 파밍 속도에 맞춰진 값이라 봇이 그를 넘지 못한다). 남는 것은 **눈금 문제**라 §Consequences·§Open Questions 에 밸런스 관측으로 |

**AC 26개 전수 대조 결과의 정정.** 1차 때 "3건 어긋남"으로 적었던 것 중 **하나는 오진이었다**:

1. **AC-7** — 유효했다. **반영 완료**(§C1 `nextStreak` + §C3 계약 단언).
2. **AC-8** — 유효했다. **반영 완료**(같은 자리).
3. ~~**스펙 AC-6 의 표현이 낡았다**~~ — **오진이었다.** AC-6 은 *연속일* 컬럼 2개를 말하고
   그 축에서는 정확하다. `lifetime_granted` 는 **연속일 컬럼이 아니라 상한 앵커**라 AC-6 이
   셀 대상이 아니었다. 대신 스펙 §streak-state 에 **AC-6b** 를 신설했다 —
   *"`profiles.lifetime_granted` 가 신설되고 클라 UPDATE·INSERT 가 트리거로 봉인된다."*
   (AC-6 을 넓혀 3개로 고쳤다면 *연속일 저장*이라는 AC 의 주제가 흐려졌을 것이다.)

### 상태: Critic 2차 반영 완료, 착수함

Architect 1회 + Critic 2회를 받고 지적을 전부 반영했다. 2차 반영이 닫은 것은 **구조 결함
(백필 누락 · FLOOR 값 미확정 · 실행 불가능한 실증 절차 · Decision 문장 모순)** 이고, 남긴 것은
**절차**(§전파 체크리스트)다.

**남은 미지 2건을 자인한다:**
- `daily_reward_claims` 영구 보존 범위 — 배포 후 성장률을 봐야 정할 수 있다(§Open Questions).
- `DAILY_CEILING_RATE` 의 눈금 — 밸런스 레인의 명시적 선택 대상이지 이 레인의 결정이 아니다.

착수한다. 구현 중 계획과 실제가 갈리면 **§전파 체크리스트 7곳을 순서대로** 돌린다.
