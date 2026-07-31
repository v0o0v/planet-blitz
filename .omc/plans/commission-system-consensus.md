# 의뢰서 시스템 구현 계획 (RALPLAN-DR deliberate)

- 상태: **pending approval** (합의 미도달 — 아래 §합의 이력)
- 개정: **rev7** (Critic 3차 REVISE — CRITICAL 2 · MAJOR 6 · Minor/Missing 반영. rev6 의 인용
  정확도는 100% 였고 무너진 것은 인용이 아니라 **결정이 딛는 구조를 한 홉 더 안 밟은 것**이다 —
  D3 는 pending 을 **만드는 자**를 안 봤고, D5 는 `grant_currency` 를 안 봤고, D4 는 cron 이
  **언제 도는지**를 안 봤다)
- 입력 스펙: `.omc/specs/deep-interview-commission-system.md` (모호도 13%)
- 결정 문서: ADR-0042 · ADR-0043 · ADR-0044 · **ADR-0045**(신규 — 의뢰 확정 지급물 서버 권위)
- 용어 정본: `CONTEXT.md` 의 의뢰서 관련 절
- 모드: deliberate

---

## RALPLAN-DR 요약

### Principles

1. **단일 정본을 늘리지 말고 지킨다.**
2. **열거로 막지 말고 구조로 막는다.** 구조가 불가능한 곳에서는 **이탈을 자인하고 대체 방어를 조달한다** — 자인만 하고 방어를 배정하지 않으면 그것은 정직이 아니라 미조달이다(Critic M-1 의 교훈).
3. **해시 폴드는 append-only, 중립이면 무폴드, 파생값은 접지 않는다.**
4. **서버가 굴리고 서버가 지급한다.** 클라 UI 로 막는 것은 방어가 아니다.
5. **테스트는 실패할 수 있어야 통과가 의미를 갖는다.** 열거를 검증하는 테스트는 그 열거의 범위 밖을 못 본다 — 뮤테이션과 전수 대조를 **병용**한다.
6. **`src/sim` 에 환경 분기를 만들지 않는다.** `src/sim/**` 의 `import.meta.env`/`process.env`/`__DEV__` 사용은 0건이고, Deno 검증 경로가 `src/sim` 을 소스 그대로 import 하므로 계약이다.
7. **답을 검증하는 밀도가 문제를 세는 밀도를 따라가야 한다.** ← rev6 신설. rev5 는 서버 축 문제를 새로 9건 세면서 그 **답**은 코드 대조 없이 썼고, 그중 4건이 무너졌다(§변경 이력 rev6). **이 문서의 모든 사실 주장은 `파일:줄` 을 달거나, 못 달면 "미확인"으로 표시한다.**
8. **인용한 자리에서 한 홉 더 밟는다.** ← rev7 신설. rev6 의 인용은 전부 맞았는데 결정은 틀렸다 — 인용한 것이 **그 구조의 전부가 아니었기** 때문이다. 어떤 RPC·테이블·정책을 쓰기로 했으면 **그것을 만드는 자 · 부르는 자 · 정리하는 자 · 그 타이밍**까지 확인한다.
   - **실제 사례 4건**: ⓐ pending `pve_runs` 행을 **만드는 자**는 `consume_catalysts` 하나뿐이라(`20260727000000_catalyst_ledger.sql:315-320`) 그 경로는 촉매 런에만 존재한다(D9). ⓑ 재화 지급의 **유일한 관문**은 `grant_currency` 이고 미등록 `source` 는 `CAP_DEFAULT_*` 로 떨어진다(D10). ⓒ 이 리포 cron 은 **매시 정각**이라(`20260726000100_invasion_replay_ttl.sql:121-123`) 만료와 회수 사이가 최대 1시간 벌어진다(D8). ⓓ 챕터 보상 **claim 을 소모하는 자**와 **크레딧을 주는 자**가 다른 함수에 산다(D11).
9. **어떤 함수의 "현재 정의"는 마지막 `create or replace` 다.** ← rev7 신설. 이 리포는 같은 RPC 를 여러 마이그레이션이 재정의한다. 파일 하나를 인용하면 **폐기된 본문을 인용할 수 있다.** 인용 전 `grep -rn "create or replace function public.<이름>" supabase/migrations/` 로 **최종 정의 파일**을 확인한다(§부록 A 가 이 규율이 실제로 잡아낸 것을 기록한다).

### Decision Drivers (top 3)

1. **결정론 재현성** — 구간 전환이 서버에서 바이트 단위로 재현돼야 한다.
2. **회귀의 가시성** — 회귀 표면을 줄이는 것보다 **회귀가 실제로 실행되는 검증 절차에 걸리는 곳에 두는 것**이 우선한다.
3. **파생 이중 적용 회피** — `createWorld` 가 로드아웃·촉매를 config 사본에 굽고(`src/sim/world.ts:1018-1061`) 파워업이 같은 사본을 또 바꾼다. 순진한 2번째 월드는 배율이 제곱된다.

### Viable Options

- **Option A (`Object.assign` 제자리 재구축) — 기각.** `createWorld` 가 선택적 런타임을 조건부 스프레드로 싣기 때문에(`world.ts:1192-1204`) `Object.assign` 이 stale 키를 못 지운다. 또 전환 분기를 detour 뒤에 두면 보스 처치가 세운 `victory` 를 최상단 가드(`world.ts:1254`)가 먼저 잡아 도달 불가다.
- **Option B — 별개 옵션이 아니다(재라벨).** rev1 의 기각 근거("클라·서버 경로가 갈린다")를 rev2 에서 철회했고, 실제로 B 는 클라 라이브 루프에도 같은 코드가 필요해 헬퍼로 뽑히는 순간 **A′ 와 동치**가 된다. "기각"이 아니라 **수렴**으로 기록한다.
- **Option C (구간마다 별개 런) — 기각.** ADR-0042 가 이미 기각("하나의 여정" 체감 소멸 + 의뢰 진행 상태를 서버 상태 기계로 관리해야 하고 이탈·재접속이 새 공격면).
- **Option A′ — 채택.** 감지는 sim 안(플래그만), 파괴적 교체는 루프 층 단일 헬퍼가 **새 월드를 반환**하고 호출부가 참조를 교체한다.
- **승계 기본값 — 화이트리스트 채택, 블랙리스트 기각** ← rev5 신설 (Critic M-3).
  - A-2(config)는 **계승 기본(블랙리스트)**, A-5(state)는 **열거 화이트리스트**로 기본값이 정반대다. 이 비대칭은 의도적이다: config 는 빌드 파생이 대부분이라 이월이 기본값으로 옳고, state 는 **모드 런타임·엔티티·스크래치가 대부분이라 이월이 위험**하다(`scrollRuntime` 이 다음 구간으로 새면 유령 스크롤 창).
  - 대안("새 월드에 `prev` 를 통째로 얹고 미승계만 명시 삭제")은 기각한다 — 삭제 목록을 빠뜨리면 **모드 런타임이 그대로 누출**되고, 그것은 Option A 를 기각한 바로 그 결함이다.
  - 대가를 인지한다: Architect 가 잡은 C1(플레이어 `Entity` 누락)·C2(`tick`/`supplyNextIndex`)는 **둘 다 화이트리스트 누락**이었다. 그래서 전수 대조 게이트(A-5)가 이 선택의 필수 짝이다.

---

## Pre-mortem — 6개월 뒤 이 기능이 실패했다면

### sim 축

**① 전환 비결정론으로 정직한 플레이어가 오거부된다.** → 시드는 `prev.rng.fork('commission-seg-' + i).getState()` 로만 파생. `fork` 는 부모를 전진시키지 않고(`src/sim/rng.ts:98-102`) `state.rng` 는 런 중 미소비(유일 사용처가 해시 폴드 `replay.ts:273`). 시드는 wire 미탑재·양측 재도출. 모드 쌍마다 전환 전후 10틱 해시 골든.

**② "2구간부터 뭔가 이상한데 결함인지 밸런스인지 모르겠다."** 해시는 클라·서버가 사이좋게 같은 오답을 내므로 안 갈린다. → 승계 범위를 `WorldState` + 플레이어 `Entity` 로 확장 · `tick` 구간별 0 리셋 · **전수 대조 게이트**(신규 필드가 생기면 컴파일/테스트가 깨진다).

**③ 침공이 깨진다.** → 꼬리 append-only 조건부 폴드 + 무의뢰 바이트 불변 + 침공 골든 18건 + `INVASION_HASH_VERSION` 무변경.

### 서버·경제 축 ← rev5 신설 (Critic M-9)

**④ 의뢰서가 증발한다.** `consume_commission` 이 성공해 원장에서 차감된 직후 클라가 죽거나 네트워크가 끊겨 **런이 시작되지 않는다.** "실패 시 소멸"이 아니라 **소비 없는 소멸**이고, 플레이어는 최종 지시 한 장을 아무것도 못 해보고 잃는다.
→ **방어**(rev6 재설계 — rev5 안은 착취 경로를 열었다):
- `restore_commission(p_run_id)` 은 **service_role 전용**이다. rev5 의 "본인 호출 허용"을 **철회**한다 — 본인이 부를 수 있으면 "런을 돌려보고 지면 복구"가 성립해 의뢰서가 무한 재시도권이 된다.
- pending 을 **4상태**로 쪼갠다: `issued`(발급, 런 시작 신호 없음) / `active`(시작 신호 수신) / `verified` / `rejected`. rev5 는 이 전부를 "pending" 한 덩어리로 다뤄 회수 대상과 TTL 대상을 구분하지 못했다.
- **회수는 cron 만 한다**: `issued` + 유예 초과 → 원장 복구 + 행 종결. 클라는 "시작 실패" 를 **신고할 뿐**(`active` 로 올리지 않는 것으로 충분하다) 복구를 지시하지 못한다.
- **유예 시간은 런 최소 길이보다 짧게** 잡는다.

**⚠️ rev7 정정 (D8 · Critic 3차 CRIT-2) — rev6 의 착취 차단은 성립하지 않았다.**

rev6 은 `issued → active` 전이만 허용하고 **언제까지인지를 정하지 않았다.** 그래서 "신호를 안 보내고 런을 돌린 뒤 **이기면 그때 신호+제출, 지면 방치→cron 복구**"가 그대로 살아 있었다. 유예가 런보다 짧아도 **전이 자체에 시한이 없으면** 유예 초과 뒤에 `active` 로 올려 제출하면 그만이다.

**게다가 이 리포 cron 은 매시 정각 배치다** — `select cron.schedule('planet-blitz-gc-invasion-replays', '0 * * * *', …)`(`20260726000100_invasion_replay_ttl.sql:121-123`). 유예 만료와 실제 회수 사이가 **최대 1시간** 벌어진다. rev6 의 AC "**회수된** `run_id` 로 제출하면 거부"는 **항진**이다 — 회수가 이미 일어난 경우만 검사하므로, 그 1시간 창에서 벌어지는 착취를 원리적으로 못 본다.

→ **결정(D8)** — 셋을 함께 건다:
1. **`mark_commission_active` 는 `created_at + 유예` 이내에만 전이를 허용하고, 그 뒤에는 거부한다**(no-op 이 아니라 명시 거부). 시한을 전이 자체에 박는 것이 핵심이다.
2. **`settle_commission`/EF 는 `status = 'active'` 이며 `started_at` 이 유효한 행만 수락한다.** `issued` 행으로는 — 유예 초과 여부·cron 실행 여부와 **무관하게** — 제출이 거부된다.
3. **cron 은 정리일 뿐 판정 주체가 아니다.** 원장 복구와 행 종결만 하며, 착취 차단은 1·2 가 진다. cron 이 늦게 돌거나 한 번 걸러도 방어가 뚫리지 않는다.

- 위 3 이 있으므로 유예 실값이 런 최소 길이보다 짧을 필요는 **더 이상 방어 요건이 아니다**(UX 요건으로만 남는다 — 정직한 플레이어가 로딩 중 회수당하지 않을 만큼 길게).
- rev6 의 AC 는 §Acceptance Criteria 에서 **둘로 교체**했다.
- `active` 는 TTL 까지 **멱등 재제출 창**을 갖는다(pre-mortem ⑤ 와 수명이 충돌하지 않는다 — 재시도가 필요한 것은 `active` 뿐이고 회수 대상은 `issued` 뿐이다).
- 유예 실값은 상수 모듈. **AC 로 검증한다.**

**⑤ 완주했는데 제출이 실패한다.** 리플레이 업로드가 네트워크로 실패하면 보상이 증발한다.
→ **방어**: 클라가 리플레이를 로컬에 보존하고 재시도한다. pending 행이 살아 있는 동안(TTL 이전) **멱등 재제출**이 가능하다. 재시도 저장소·유예 기간을 Phase C 계약에 명시.

**⑥ 지급된 유니크가 이미 가진 유니크다.** ADR-0039(중복 유니크 장착 차단, `duplicateUniqueSlot`)와의 상호작용이 미정의라, 지급은 되는데 장착이 막히는 "죽은 보상"이 나온다.
→ **rev5 의 답은 거짓이었다**: "플레이어 보유 유니크를 제외하고 굴린다(서버가 원장을 보므로 가능)". **서버는 그 원장을 갖고 있지 않다.** `ships`/`items` 는 클라이언트 rw 미러(`ships_rw_own FOR ALL`, `items_rw_own`)이고 서버 권위 원장은 `credits`/`minerals` 뿐이다(ADR-0028 본문 · ADR-0027). 게다가 이 안은 **역방향 착취**를 연다 — 미러에서 유니크를 지우고 "안 가졌다"고 신고하면 원하는 유니크가 나올 때까지 후보 풀을 좁힐 수 있다. 클라가 쓸 수 있는 미러를 **보상 결정 입력으로 쓰는 것**은 미러 대조보다 나쁘다.

→ **결정(rev6)**: **발령 시점에 굴려 `payload` 에 고정하고, 중복 지급을 허용한다.**
- 근거: ADR-0039 는 *장착* 차단이지 *보유* 차단이 아니다. 원문이 "기존 세이브의 중복 장착 = **유지**(자동 해제 안 함) + 스탯 표에 '중복 — 효과 없음' 표기"(`docs/adr/0039-duplicate-unique-equip-blocked.md:33`), "**막되 빼앗지 않는다**"(`:57`)로 명시한다. 즉 **중복 보유 자체가 이미 정상 상태**이고, 이 계획이 새로 만드는 예외가 아니다.
- 흡수 지점은 격납고 표기다 — ADR-0039 가 이미 요구한 "중복 — 효과 없음" 표기와 `inv.err.duplicateUnique` 힌트(`:31`)가 그대로 이 경우를 덮는다. 신규 UI 가 필요 없다.
- 대가를 인지한다: 이미 가진 유니크를 또 받으면 그 의뢰의 체감 보상이 0 에 가깝다. **밸런스 큐 등재** — 계급별 유니크 풀 크기 대비 중복률.
- 잔여 위험은 서버 권위 아이템 원장이 생기면 해소된다(ADR-0028 선행 요건). 그때 제외 굴리기를 도입할 수 있다. **후속 항.**

**⑦ 확정 유니크가 부풀린 로드아웃으로 수확된다.** ← rev6 신설 (Critic CRIT-2)

검증 EF 는 제출 `config` 를 **그대로** 재실행에 쓰고, 서버 권위로 덮는 것은 침공 블록 하나뿐이다(`supabase/functions/verify-invasion/verifyInvasionCore.ts:411-414` — `{ ...cfg, invasion3: authoritativeInvasion }`. `:390-391` 주석이 "제출 config 의 다른 필드—공격자 로드아웃—는 **보존**"이라고 명시). 같은 파일 `:39-50` 의 잔여 신뢰 주석과 ADR-0028 이 "로드아웃을 부풀린 위조는 내적으로 일관돼 accept 될 수 있다"를 이미 확정했다. **rev5 는 이 사실을 한 번도 적지 않은 채 EF 검증을 의뢰 보상의 충분한 방어로 취급했다.**

침공에서 이 연기가 정당했던 근거는 "오염 범위가 래더뿐"이었다(ADR-0028). **의뢰로 자동 이월되지 않는다** — 의뢰는 확정 유니크 지급 경로다.

→ **방어(한 겹, 부분)**: `consume_commission` 이 **출격 시점 loadout 을 서버에 봉인**하고(`commission_runs.loadout_sealed`), EF 가 제출 config 의 `loadout` 을 봉인값과 대조해 불일치면 `commission-loadout-mismatch` 로 거부한다.
- **닫히는 것**: 런 도중·사후 편집("약하게 출격 → 강한 config 로 제출").
- **닫히지 않는 것**: 출격 **전** 클라 미러 위조. 그러면 봉인값 자체가 위조본이다. **미러 위조는 여전히 뚫린다 — 자인한다.**
- 오거부 위험 0(정직한 런은 항상 일치), 밸런스 상수 미도입 → ADR-0028 이 배제한 "미봉책"(파워 절대 상한 클램프)에 해당하지 않는다.
- 잔여 위험은 서버 권위 아이템·진행 원장이 생기면 **자동 해소**된다 — EF 가 봉인값 대신 원장값을 강제하면 되고 구조는 안 바뀐다. **후속 항. 이 계획은 그 원장을 전면으로는 만들지 않는다**(의뢰 유니크 한 줄기만 D7 이 옮긴다).
- ADR-0044 에 이 경계를 명문화했다(§"이 검증이 증명하는 것과 증명하지 못하는 것", 2026-07-31 정정).
- ⚠️ **rev7 정정 — 이 항목의 "한 겹 방어"는 ADR-0028 이 배제한 미봉책 둘 중 하나에 해당한다.** rev6 은 "봉인 대조는 밸런스 상수를 도입하지 않으므로 배제 사유에 해당하지 않는다"고 썼으나, ADR-0028 은 미봉책을 **둘** 배제한다 — "클라 rw 미러 대조는 무효이고, 로드아웃 파워 절대 상한 클램프는 …"(`docs/adr/0028-attacker-loadout-authority-deferred.md:7`). **봉인값 자체가 클라 미러에서 온 값이므로 봉인 대조는 미러 대조의 시점 한정판**이다. 그 점을 인정하고, 채택 근거를 ⓐ비용 거의 0 ⓑ오거부 0 ⓒ밸런스 상수 미도입 ⓓ원장 도입 시 **대조 대상만 갈아끼우면 되는 자리**를 미리 만든다 넷으로 다시 세운다. **방어력 자체는 주장하지 않는다.** ADR-0044 §한 겹 방어에 같은 정정을 넣었다.

**⑦b 확정 유니크가 의뢰서 없이 클라 미러에 직접 써 넣어진다.** ← rev7 신설 (Critic 3차 CRIT-1)
> ⑦ 과 같은 축(미러 위조)의 더 싼 경로라 번호를 잇는다. ⑦ 은 **런에 끌고 나가는** 위조, ⑦b 는 **소유 자체의** 위조다.

rev6 은 확정 유니크를 `rewards.uniqueId` 로 payload 에 넣고 검증 EF 를 그 방어로 취급했다. 그런데 **지급의 착지점이 클라이언트 rw 미러**다 — `items` 는 `for all` 정책이다(`supabase/migrations/20260717000000_m4_initial_schema.sql:186-191`, `for all` 은 `:188`). 즉 **의뢰서를 한 장도 받지 않고 `items` 에 직접 써 넣으면 그만이고, 그 경로는 EF 를 통과할 필요조차 없다**(아무 관문도 지나지 않는다).

`20260722020000_m7b_blueprint_drops.sql:20-24` 의 "★트러스트 경계" 주석이 이 직접 쓰기를 "서버는 `pve_runs` 샘플링으로 사후 검증"이 짝이라고 정당화했으나, **그 샘플링은 ADR-0026 이 폐기했고 `20260726000300_pve_verification_teardown.sql` 이 실제로 철거했다**(`:117-118` 은 `pve_runs.replay`·`client_result` 컬럼까지 드롭). 짝이 사라진 채 클라 직접 쓰기만 남았다.

**따라서 ADR-0044 가 리플레이 전수 재실행을 정당화한 근거("유니크 1개는 수량 캡으로 안 걸러진다")는 그 자체로는 유니크를 지키지 못한다.**

→ **결정(D7) — ADR-0045 신설.** 의뢰 확정 지급물을 서버 권위 테이블 `commission_grants` 로 발급하고, 검증 EF 가 제출 `config.loadout` 의 의뢰 유니크를 그 테이블과 **대조**한다. 상세는 ADR-0045, 스키마·RPC 는 §Phase B, EF 순서는 §Phase C.
- **강제 지점이 대조라는 것이 요점이다.** 테이블만 만들면 증거만 남고 아무것도 못 막는다.
- **범위 한정**: 일반 아이템·설계도·XP 는 기존 클라 경로 그대로다(§A-8b 지급 경로 표).
- **대가**: 아이템 소유 축이 둘로 갈린다(일반=클라 미러 / 의뢰 확정분=서버 권위). 용어·UI·검증 경로가 갈라진다. **`CONTEXT.md` 의뢰서 절이 이 구분을 아직 담고 있지 않다** — 현재는 "의뢰서의 정본이 서버 원장"까지만 적혀 있고(`CONTEXT.md:209`, `:656`) **지급물의 정본**은 언급이 없다. 용어 정본 갱신이 PE 착수 전 필요하다.
- **반대급부**: 이 테이블은 ADR-0028 이 정의한 전면 서버 원장의 **첫 조각**이고, 원장이 생기면 흡수된다.
- 침공 EF 도 같은 대조를 할지는 **이번 범위 밖**(ADR-0028 소관)이다.

**⑧ 의뢰서 발령 자격 자체가 검증되지 않는다.** ← rev6 신설 (Critic MAJ-1)

의뢰서는 **일반 PvE 런**의 보스 처치에서 발령되는데(스펙 `:65`, `:116`), 일반 PvE 는 리플레이를 내지 않는다(ADR-0026). 따라서 "보스를 잡았다"는 **원리적으로 클라 주장**이다. 실제로 `settle_pve_run(p_summary jsonb)` 는 클라가 만든 요약 jsonb 를 통째로 받고, 개연성 캡에 쓰는 값은 `finalTick`·`stage` 둘뿐이며(`20260727000000_catalyst_ledger.sql:419-424`) **`victory` 는 읽지도 않는다.**
- ← rev7 정정 (Principle 9): rev6 은 `settle_pve_run` 을 `20260726000200_pve_settlement.sql:269` 로 인용했으나 **그 본문은 두 번 재정의돼 폐기됐다.** 현재 정의는 **`20260727010000_planet_popularity.sql:263`** 이고, 개연성 캡 산식은 `grant_currency` 쪽(현재 정의 `20260727000000_catalyst_ledger.sql:339`)에 있다. 사실 관계(클라 jsonb 통짜 · `victory` 미독)는 두 판 모두에서 참이라 **결론은 안 바뀌지만, 인용 좌표는 틀렸다.**

→ **자인**: 의뢰서 발령 자격은 클라 주장이며, 이는 **ADR-0026 이 수용한 PvE 신뢰 모델의 연장**이다. 이 계획이 새로 만드는 구멍이 아니다. 다만 발령되는 것이 확정 유니크로 가는 티켓이므로, 기존 PvE 보상보다 위조 가치가 높다는 점을 기록한다.

→ **방어 2겹**(둘 다 필요하다):
1. **경로 봉인** — 발령은 `settle_pve_run` **안에서만** 수행한다. 독립 RPC 로 노출하지 않는다 — 클라가 정산과 무관하게 발령을 부를 수 있으면 봉인이 무의미하다.

   **⚠️ rev7 정정 (D9 · Critic 3차 MAJ-1) — rev6 의 "촉매 패턴을 그대로 쓴다"를 폐기한다.**

   rev6 은 1회성을 "`settle_pve_run` 의 **pending 1회성 봉인 경로 안에서만**"에 걸었다. **성립하지 않는다.** 그 pending `pve_runs` 행을 **만드는 곳은 `consume_catalysts` 하나뿐**이고(`20260727000000_catalyst_ledger.sql:315-320` — `insert into public.pve_runs (profile_id, verified_status, catalyst_receipt) values (v_me, 'pending', …)`), 그것은 **촉매를 주입한 런에만** 존재한다. 그대로 구현하면 **의뢰서가 촉매 런에서만 나온다** — 스펙(보스 처치 승리에서 발령) 위반이다.

   **더 나아가**(Principle 9): `settle_pve_run` 의 **현재 정의는 `20260727010000_planet_popularity.sql:263`** 이고, 그 본문에는 **pending 조회도 UPSERT-by-runId 도 아예 없다** — 무조건 새 `pve_runs` 행을 INSERT 한다(`:325-337`). rev6 이 인용한 `20260727000000_catalyst_ledger.sql:590-611` 의 UPSERT-by-runId 는 **폐기된 본문**이다. 즉 rev6 의 앵커는 "촉매 런에만 있다"에 더해 **현행 코드에 존재조차 하지 않는다.**

   → **결정(D9)**: 발령 1회성을 `pve_runs` pending 이 아니라 **`settle_pve_run` 이 남기는 정산 이력 행 그 자체**에 건다. 구체적으로:
   - `settle_pve_run` 은 **모든 PvE 런에 대해 정산 이력 행을 정확히 1행 남긴다**(현행 `20260727010000:325-337` 의 무조건 INSERT). 그 INSERT 와 **같은 트랜잭션 안에서** 발령을 수행하고, `commission_inventory` 삽입에 **그 이력 행의 `id`(= `pve_runs.id`)를 발령 근거 키로 실어 unique 제약을 건다.** 같은 정산이 두 번 발령할 수 없고, 정산 없이 발령할 수도 없다.
   - **`p_summary->>'runId'` 에 의존하지 않는다** — 그 값은 촉매 런에만 존재하며 클라가 통제한다.
   - ⚠️ **PB 착수 전 확인이 필요한 것**: 현행 `20260727010000:325-337` 의 INSERT 는 `pve_runs (profile_id, replay, client_result, …)` 로 **이미 드롭된 컬럼**(`20260726000300:117-118`)을 참조한다. 이 계획의 앵커는 그 INSERT 가 실제로 성공한다는 것에 의존하므로, **원격 스키마의 실상태를 대조한 뒤 앵커를 확정한다**(§부록 A).
2. **시도 빈도 상한** — **발령 시도 시간당 상한**을 둔다. 보관 상한만으로는 부족하다: 보관 상한은 **재고**만 캡하므로 소비하면 다시 찬다. "잡았다"를 초당 반복 신고하면 상한 안에서 무한 재충전이 성립한다. 재고 캡과 빈도 캡은 **다른 축**이다.
- 실값은 밸런스 큐. 상한 초과는 조용히 미발령(에러 아님 — 정직한 연속 플레이와 구분 불가하므로 계정 flag 는 걸지 않는다).

---

## 구현 단계

### PR 경계와 의존 그래프 ← rev5 신설 (Critic M-8)

이 계획은 **한 레인이 아니다.** 이 리포 전례(액티브 스킬 42종·침공 3레이어)상 각각이 독립 레인 규모다.

```
P0 예비 추정 ──► PA 전환 코어 ──┬───────────────► PD 주문 4종 ──┐
                                │                 ▲             ├─► PG 통합·계측
PB0 payload 스키마 ─► PB 원장 ──┴─► PC 제출·EF ───┘             │
                                     │                          │
                                     └─► PE UI ─────────────────┘
PF 의뢰 보스 (독립, 언제든)
```

> ← rev6 정정 (Critic Minor): rev5 의 그래프는 `PA ─► PD` 만 그렸는데 표는 `PD 선행 = PA·PC` 였다. **표가 옳다** — PD 는 PC 실측 게이트가 확정한 상수 모듈을 읽는다. 그래프에 `PC ─► PD` 를 그려 정합시켰다.

| PR | 범위 | 지는 AC | 선행 |
|---|---|---|---|
| **P0** | 예비 벤치 + 상수 모듈 골격 | — (산출물만) | — |
| **PA** | 전환 코어(A-1~A-8) | 회귀 4 · 진단력 5 · 구간 전환 전량 · "플레이한 런==정산된 런" | P0 |
| **PB0** | `CommissionPayload` 스키마 확정 | — (계약 문서) | — |
| **PB** | 원장 테이블 **3종**(`commission_inventory`·`commission_runs`·**`commission_grants`**)·RPC **4종**(`grant_commission`·`consume_commission`·`mark_commission_active`·`settle_commission` — rev6 의 5번째 `restore_commission` 은 **cron 인라인으로 내려 RPC 가 아니다**, D13)·cron 2건 | 서버 절 중 원장 항목 전량 | PB0 |
| **PC** | 리플레이 제출 + verify-commission EF (**소유 대조 6단계 포함**) | 서버 절 중 검증 항목 전량 + **EF 실측 차단 게이트** | PA·PB |
| **PD** | 주문 4종 | 게임플레이 절 5건 | PA·PC(상수 확정) |
| **PE** | 지시 수신소 UI | UI 절 3건 | PB·PC |
| **PF** | 의뢰 보스 3종 | 아트·패턴 | 독립 |
| **PG** | 다구간 난이도 계측 + 통합 E2E | E2E 절 전량 | 전부 |

### Phase 0 — 예비 추정 (rev4 의 "차단 단계"에서 **재명명**) ← Critic M-6

- rev4 는 이것을 차단 단계라 불렀으나 **진짜 실측은 여기서 불가능하다.** 이 시점에 배포된 EF 는 `verify-invasion` 뿐이고(`supabase/functions/verify-run/deno.json`: "Supabase 프로젝트 미생성 — 배포 전 로컬 확인 전용"), 침공은 `designedRun = true`(`world.ts:1314`)라 청크 절차 생성·웨이브 유입을 건너뛴다. 즉 여기서 얻는 것은 **침공 워크로드 계수의 외삽**이다.
- **산출물**: 개발기에서 최대 엔티티 밀도 PvE 런의 ms/tick 실측 + `verify-invasion` 왕복으로 얻은 EF/개발기 환경 계수 → **잠정** 구간당 틱 상한과 계급별 구간 수. 그리고 이 값들을 담는 **상수 모듈**.
- **산출물 2 — `.omc/plans/balance-queue.md` 파일 생성** ← rev6 신설 (Critic Minor #3). rev5 는 이 경로를 등재처로 "고정"했으나 **파일이 존재하지 않는다**(확인: `.omc/plans/` 목록에 없음). 존재하지 않는 파일에 등재하라는 지시는 검증 불가능하다. **P0 착수 시 만든다**(지금 만들지 않는다 — 이 계획은 문서이고 산출물은 PR 이 낸다).
  - 초기 내용으로 이 계획이 등재를 지시한 항목을 옮겨 적는다: **R10** `aux0`/`aux1` 승계의 6기체 비대칭(말로우는 승계가 불리) · **R13** `tick` 리셋의 구간 곱셈(보급 2기/구간 · 캡스톤 레이저 · 해츨링 · 오염 위상) · **Phase G** 다구간 난이도 계측 결과 · pre-mortem ⑥ 유니크 중복률 · pre-mortem ⑧ 발령 빈도 상한 실값 · 계급별 발령 확률·보관 상한.
- **진짜 차단 게이트는 Phase C 직후**(아래 §PC 실측 게이트)다.
- Phase D~F 는 상수 모듈을 읽는다 — **하드코딩 금지.** 현재의 2/3/4/5 · 9,000틱은 플레이스홀더다.

### Phase A — 구간 전환 코어 (sim) · 최고위험

**A-1. 의뢰 런 설정을 `runConfig` 단일 정본에 추가**
- `RunConfigOpts` 에 `commission?: CommissionRunConfig`. 조건부 스탬프(미지정 시 필드 미탑재 → 골든 바이트 불변).
- ```
  CommissionRunConfig = {
    commissionId, order, grade,
    segments: SegmentSpec[],        // { planet, stage }
    replayBudgetTicks,
    constraints?: {                  // ← rev5 신설 (Critic Missing #2)
      bannedPowerupLines?: number[], // 성장축 제약. **config 에 실려야** 서버가 대조할 수 있다
      // 장비축은 loadout 에 이미 반영돼 있어 별도 필드가 불필요하다
    },
  }
  ```
- `SegmentSpec` 에 **`mode` 필드를 두지 않는다.** `planetMode` 는 `planetContent(planet).mode` 파생이 단일 정본이다(`src/run/runConfig.ts:186`).
  → **명시적 비목표**: 행성-모드 자유 조합("카르곤을 수축 모드로")은 범위 밖. ADR-0042 의 "구간마다 모드를 갈아탄다"는 실질적으로 "구간마다 행성을 갈아탄다"이며, 이 등가를 ADR 에 명시한다.
- **성장축 제약이 config 에 실리는 이유**: 스펙이 "위반이 원천 불가능한 축만"을 요구하고 서버가 리플레이 `config` 대조로 준수를 증명해야 하는데(ADR-0044), 파워업 풀 필터가 런타임에만 살면 **서버가 못 본다.**

**A-2. 구간 config 는 계승 기본 + 무대 차집합**
- `WorldConfig` 타입 분할은 **원리적으로 불가능**하다 — `playerSpeed`·`playerHp`·`dashCooldownTicks` 는 `DEFAULT_CONFIG` 무대 기본값이면서(`world.ts:709-715`) `createWorld` 가 로드아웃·촉매로 덮고(`:1033-1035`, `:1056-1060`) 파워업이 또 누적한다(`powerups.ts:109,118,132,249,258,267,300`). **같은 필드가 양쪽 소속**이라 분할 파티션이 없다. 코드 주석에 남긴다.
- `nextCfg = { ...prev.config, ...stageOverride(seg) }`. `stageOverride` 는 좁은 리터럴 — `planet`, `stage`, `planetMode`, `arenaWidth/Height`, `maxSegments`, `commission`(segmentIndex 갱신분).
- `createWorld(seed, cfg, { preDerived: true })` 가 `:1018-1061` 굽기를 건너뛴다. **범위 확인 완료** — `catalystMods`(`:1009`)·`planetMult`(`:1013`)는 그 블록 **밖**이라 승계 config 로부터 정상 재도출되고, `weapon`·`magnetRadius` 는 승계가 덮는다.

**A-3. 구간 종료 감지 — 3분기** ← rev5 수정 (Critic **C-1**)

rev4 는 2분기("마지막 구간이면 `victory`")였고, 거기에 "현상금 표적은 도주 시 `segmentDone`" 예외를 덧붙였다. **두 문장을 합치면 마지막 구간의 도주가 `victory` 로 떨어져 실패가 성공으로 판정된다** — 스펙 AC "마지막 구간에서도 표적을 못 잡으면 의뢰 실패로 확정된다"(`.omc/specs/deep-interview-commission-system.md:75`)의 정반대다. ADR-0044 가 위조 가치 최고로 지목한 확정 유니크 지급 경로에서 벌어지는 오판이다.

편집 지점은 `compact()` 보스 사망 분기(`world.ts:3784-3798`) 한 곳이다. PvE 에서 `victory = true` 를 세우는 곳은 `:3782`(코어, 침공 전용)와 `:3788`(보스) 둘뿐이고 레이싱·블록격파·추격도 결국 `'boss'` kind 사망을 통과한다 — **유일성 확인 완료**.

| 분기 | 조건 | 결과 |
|---|---|---|
| ① 중간 구간 종료 | 보스 처치 **또는** 표적 도주, `segmentIndex < segments.length - 1` | `segmentDone = 1` |
| ② 마지막 구간 **완수** | 보스 처치(또는 표적 **처치**), `segmentIndex === length - 1` | `victory = true` |
| ③ 마지막 구간 **실패** | **표적 도주**, `segmentIndex === length - 1` | `gameOver = true` — 의뢰 실패 |

- `bossKilled = true` 와 `rollBossDrop` → `state.loot` 직접 push(`:3793-3797`), 엘리트 loot push(`:3802-3808`)는 그대로 둔다 — 전환이 틱 끝에 일어나므로 바닥 스폰분은 어차피 소멸하고, 승계 목록의 `loot` 가 이월한다.
- `waves.ts:206-258` 의 모드별 세그먼트 게이트는 **재사용하지 않는다.** 그것들은 `if (!seg.boss && segmentIndex < SEGMENTS.length - 1)` 로 감싸인 **한 무대 안의 분수 마일스톤**이라(블록격파 `(i+1)×SECTION_LENGTH`, 오염 `임계 × (i+1)/6`, 추격 `chaseShelterReached(state, i)`) 구간 종료로 쓰면 행성 콘텐츠의 1/7 만 소화한다.

**A-3b. 종료 플래그 우선순위 계약**
- 보스를 죽인 그 틱에 잔존 적·탄이 플레이어를 죽이면 `checkGameOver`(`world.ts:3853-3854`)가 같은 틱에 `gameOver = true` 를 세운다. 루프 층이 `segmentDone` 만 보면 **죽은 런이 다음 구간을 연다.**
- **계약: `gameOver`(및 `victory`)가 `segmentDone` 을 무조건 이긴다.** `advanceCommissionSegment` 첫 줄이 `if (prev.gameOver || prev.victory) return prev`.

**A-4. 전환 실행 — `stepRun` + 새 월드 반환**

```
export function stepRun(state: WorldState, input: InputFrame): WorldState
//   stepWorld → segmentDone && !gameOver && !victory && !프리즈 이면 advanceCommissionSegment → 반환
```

- rev2 의 R6 완화책(dev throw)을 폐기한다 — `src/sim/**` 환경 분기 0건이 계약이고(Principle 6) Deno 에는 `import.meta.env` 가 없어 **정작 EF 에서 사문화**된다.
- **봉인의 실제 메커니즘** — rev3 는 "export 를 좁히면 컴파일러가 전량 돈다"고 썼으나 **거짓이다**: `stepWorld` 소비처는 **113파일 595건**(Critic 실측; rev4 의 114/596 은 집계 기준 차이)이고 그중 `tests/` 88파일, **tsc 범위 밖 5파일**(`scripts/deno-verify/{common,scenarios,verifyInvasion}.ts`, `scripts/record{Striker,Encounter}Baseline.ts`)이 있다 — `tsconfig.json` 의 `include` 에 `scripts` 가 없다.
  - 채택: `stepWorld` 는 계속 export 하되 **`src/sim` 밖에서의 직접 import 를 eslint `no-restricted-imports` 로 금지**하고 `stepRun` 만 프로덕션 진입점으로 둔다. 테스트·기준선 스크립트는 예외 허용하되 **의뢰 config 를 쓰는 테스트는 `stepRun` 강제**를 grep 게이트로 잠근다.
  - **정직한 기록**: 이것은 구조적 봉인이 아니라 린트·grep 방어다(Principle 2 미충족). 88개 테스트 이관 비용 대비 이득이 낮다고 판단해 받아들인 트레이드오프다. **그래서 Verification Steps 에 `pnpm lint` 와 `scripts` 타입검사를 실행 항목으로 배정한다** — 자인만 하고 방어를 배정하지 않으면 미조달이다(Principle 2).
  - **`scripts/**` 를 검사 범위에 넣는다**: `tsconfig.scripts.json` 을 추가하고 `pnpm exec tsc -p tsconfig.scripts.json --noEmit` 를 검증 절차에 넣는다(`deno check` 와 택일이 아니라 **이쪽으로 확정** — Critic Minor #4).
  - 오기 정정: `render/defensePreview.ts:312` 는 `createWorld` 이지 `stepWorld` 가 아니다(`stepInvasionFormation` 만 직접 호출, `:357`).

**A-4b. 월드 참조를 스텝 루프 밖으로 캐시하지 않는다**

`stepRun` 이 새 참조를 반환하므로 루프 밖에서 월드를 잡아두는 호출부는 전환 후 죽은 월드를 읽는다. 수정 대상 2곳:

- `src/main.ts:1594` — 티커 프레임 최상단 `const w = world;` + `:1626` 캐치업 `while`. 그 프레임의 나머지 전부(레벨업 오버레이 `:1725`, 조우 오버레이 `:1751`, HUD `:1776`, `settleIfRunOver`/`endRun(w)`)가 캐시된 `w` 를 쓴다. **전환이 캐치업 루프 안에서 일어나면 버려진 1구간 월드로 정산한다.** → 캐치업 루프 **이후 재조회**.
- `src/harness/core.ts:678-685`(`ff`) · `:707-712`(`step`) — `host.getWorld()` 를 루프 밖에서 잡고 안에서 `stepOnce` 반복. 전환 후 종료 검사와 `autopilotInput(world)` 가 죽은 월드를 읽는다. **Verification Step 5(오토파일럿 완주)가 이 경로다.** → 루프 **안에서 재조회**.
- **게이트** ← rev5 (Critic M-4): 열거는 완화가 아니다. `stepOnce`/`stepRun` 을 포함하는 함수 본문에서 루프 앞의 월드 바인딩(`= host.getWorld()` / `= world;`)을 탐지하는 **grep 게이트**를 추가한다. `stepThrough`(`replay.ts:668`)가 이미 "세 번째 스텝 루프"였다는 사실이 네 번째가 생길 것임을 말해준다.
- **구조적 대안 검토 기록**: `stepRun` 반환형을 branded type 으로 만들어 "직전 스텝의 반환값만 다음 스텝에 넘길 수 있게" 하는 안을 검토했으나, TS 로 "루프 밖 바인딩 금지"를 표현하는 실용적 방법을 찾지 못했다. 자인하고 grep 으로 간다.
- `advance` 는 가드에 걸리면 `prev` 를 그대로 반환한다(항등 가능). 클라의 `entityRenderer.reset()`·스냅샷 리셋은 **`next !== prev` 일 때만** — 무조건 부르면 프리즈된 틱마다 스프라이트 캐시가 날아간다.
- 전환 시 `entityRenderer.reset()` 필요: 새 월드가 `nextEntityId` 를 1 로 되돌리므로 안 부르면 2구간 적이 1구간 스프라이트를 물려받는다(`src/render/entityRenderer.ts:679` 는 엔티티 id 키 캐시, `reset()` 은 현재 `startRun` 에서만 — `src/main.ts:1302`). `prevSnap`/`currSnap` 보간(`main.ts:1323-1324`)도 리셋.
- **호출 순서 계약**: rev2 의 "`stepWorld → hashWorld 기록 → advance` 양쪽 동일"은 틀렸다 — **클라 루프에 `hashWorld` 가 없다**(`stepOnce`, `main.ts:1363-1371` 은 `record → stepWorld → snapshot → observe` 뿐이고 클라 해시는 정산 시점에 `runReplay` 재실행으로 얻는다: `src/net/pveRun.ts:42`, `src/net/invasion.ts:652`). 실질 계약은 하나다: **advance 는 `stepWorld` 직후·다음 `stepWorld` 이전.**
- ⚠️ 이 계약 위반의 증상: 클라·서버 **둘 다 `runReplay`** 를 쓰므로 해시는 절대 안 갈리고, 대신 **실제 플레이한 런과 정산되는 런이 갈린다**(PR#191 계열).
- **마지막 틱 전환 금지**: 마지막 입력 프레임 뒤에 전환이 일어나면 `runReplay` 의 `finalState` 가 한 틱도 안 돈 새 월드가 되고, `verify-run/verifyCore.ts:190-191` 이 읽는 `victory`/`gameOver` 가 둘 다 `false` 라 `outcome-mismatch` 가 난다. A-3b 로 대부분 닫히지만 **중간 구간의 마지막 입력 프레임**을 명시 금지한다.
- `stepThrough`(`replay.ts:668`)는 참조 교체 불가한 세 번째 스텝 루프다(프로덕션 호출부 0건, 테스트 전용). `stepRun` 기반으로 고치거나 의뢰 config 를 타입으로 막는다.

**A-5. 승계 계약 — 범위는 `WorldState` + 플레이어 `Entity`**

**분류 원칙** — **안전망·부활류는 런 단위**(곱해지면 난이도가 붕괴), **페이싱·주기류는 무대 단위**(무대 수에 비례하는 것이 정합).

- **`tick` 은 구간별 0 리셋.** 누적은 `commissionRuntime.totalTicks`.
  - 근거: 승계하면 절대-틱 임계 로직 전 계열이 잠재 결함이 된다. 실제 사례 — `SUPPLY_SPAWN_TICKS = [1800, 6000]`(`world.ts:359`)과 `maybeSpawnSupply`(`:3071-3082`)는 `state.tick < nextTick` 으로만 판정하는데 새 월드는 `supplyNextIndex: 0`(`:1165`)이라, `tick` 이 9,000대면 **2구간 첫 두 틱에 보급선 2기가 몰리고 그 뒤 영원히 0기**다. 결정론적이라 해시가 안 갈리고 밸런스 이상으로만 보인다.
  - **구간 곱셈을 인지·수용한다**: 보급 2기/구간 · 캡스톤 레이저 `tick % LASER_PERIOD`(`world.ts:2476`) 무료 1발/구간 · 해츨링 `tick % period`(`activeHandlers/hatchling.ts:89`) 무료 1단계/구간 · 오염 위상 불연속(`modes/contamination.ts:143,195`, 경미). **분류 원칙상 전부 페이싱·주기류라 무대 단위가 옳다.** `.omc/plans/balance-queue.md` 에 등재한다.
- **`tick` 을 런 길이로 읽는 지점의 `totalTicks` 이관** ← rev6 재작성 (D5 파급 · Critic MAJ-5)
  - **rev4~rev5 의 C4 는 "`finalTick` 정본 이관"이었고, 그 성격이 rev6 에서 바뀐다.** 아래 D5 결정으로 의뢰 런이 `settlePveRunCurrency` 를 타지 않으므로 **`finalTick` 은 의뢰 경로에서 소비처가 0 이 된다.**
  - **코드 대조 결과**(`grep finalTick src/`): 프로덕션에서 `w.tick` 을 `finalTick` 으로 싣는 곳은 **`src/main.ts:1450` 한 곳뿐**이고, 그것은 `settlePveRunCurrency` 인자 안에 있다. 나머지 `finalTick` 은 침공(`src/net/invasion.ts:221,224,657`)과 미호출 `buildPveRunResult`(`src/net/pveRun.ts:30,33,46`)의 것으로, **셋 다 `replay.inputs.length` 에서 온다**(`w.tick` 이 아니다) — 다구간에서도 자동으로 누적 길이가 된다.
  - **rev5 가 함께 고치라고 지목한 두 곳은 `finalTick` 소비처가 아니다**:
    - `src/main.ts:1510` `timeSec: w.tick / 60` — 결과 화면 표시. `finalTick` 과 무관한 별도 경로다. **다구간에서는 마지막 구간 시간만 보이므로 여전히 고쳐야 한다**(표시 결함). 정정: "함께 이관" 이 아니라 **독립 표시 결함**.
    - `src/ui/replaySpectate.ts:170-171` — `state.tick` / `this.total` 을 쓰는 **침공 관전** 진행 바다. 의뢰는 관전 대상이 아니므로(§Phase B RLS) **범위 밖**. rev5 가 근거 없이 끌어왔다. **삭제한다.**
  - **프로필 저장 경로에는 `finalTick` 이 없다** — `settleRun` 인자(`main.ts:1411-1433`)에 런 길이 필드가 아예 없다. rev6 착수 전 가정("프로필 저장 경로는 여전히 탄다")은 **코드로 기각**됐다.
  - **남는 작업**: ① `commissionRuntime.totalTicks` 누적(구간 곱셈 방지의 근거는 아래 `tick` 리셋 항 그대로) ② `main.ts:1510` `timeSec` 을 누적 틱 기준으로 ③ `tick` 을 런 길이로 읽는 지점 전량 grep 게이트(신규 소비처가 생기면 걸리도록).

**플레이어 `Entity` 25필드 전수 분류** (`src/sim/entities.ts:126-175`)

| 분류 | 필드 | 근거 |
|---|---|---|
| **승계 — 런 단위 예산·안전망** | `targetX` | `CAP_SURVIVAL_CRIT` **런당 1회** 치명 무효 소진 표식(`world.ts:3573-3577`). 리셋하면 **N구간 = N회 부활** |
| | `hp` / `maxHp` | 런 승계의 핵심(`entities[0]` — `world.ts:1071-1072`) |
| | `aux0` / `aux1` | 기체 시그니처 런타임(아래 표) |
| **승계 — 쿨다운(무료 재발급 방지)** | `targetY` | 위상 전환막 내부 쿨다운(`world.ts:1731-1733`) |
| | `ownerId` | `UQ_DRONE_BAY` 소환 간격(`world.ts:2716-2729`) |
| | `cooldown` / `dashCooldown` | 무기·대시 쿨다운 |
| **리셋(0 강제) — 순간 전투 상태** | `iframes` | 피격 무적. 문맥이 무대와 함께 사라진다 |
| | `phase` | `UQ_OVERHEAT_DRUM` 연속 명중 스택(`world.ts:2319-2323`, `:3340`, `:3611`). **`combo` 와 같은 결** — 구간 사이 전투가 끊기므로 리셋 |
| | `timer` | 일반 타이머 |
| **새 무대 값 사용** | `x` `y` `vx` `vy` `angle` `radius` `life` `damage` `pierce` `enemyType` `id` `kind` `dead` | 무대 진입 시 재설정 |

**기체별 `aux0`/`aux1` 의미와 승계 영향** (정본 `world.ts:1811-1816`)

| 기체 | `aux0` | `aux1` | 승계의 성격 |
|---|---|---|---|
| 브루저 | 장갑 스택(0..8) | 피격 후 경과 틱 | 이득 |
| 아크캐스터 | 연속 정지 틱 | 미사용 | 이득 |
| 팬텀 | 연속 무피격 틱 | 은신 해제 첫 타 토큰 | 은신 상태로 다음 구간 진입 — 이득(`src/sim/cloak.ts:57`) |
| 해츨링 | **`state.kills` 스냅샷** | 미사용 | **`kills` 와 결합** — 둘 중 하나만 승계하면 출격 주기가 깨진다. 현 계획은 둘 다 승계라 정합하되 **결합을 명시 기록** |
| 말로우 | 적립 지연 피해 | 연속 무피격 틱 | **적립 피해가 무대를 넘어 터진다 — 불리** |
| 버블 | 남은 막 내구 | 파열 후 경과 틱 | 이득 |

→ **승계로 결정.** 시그니처는 런 속성이지 무대 속성이 아니다. 다만 "리셋하면 시그니처 기체가 불리하다"는 근거는 **말로우라는 반례**를 가진다(6기체 중 1). 비대칭을 밸런스 큐에 등재.
- 조건부 폴드 뒤집기 위험 없음: `replay.ts:164` 의 `aux0 !== 0 || aux1 !== 0` 은 이미 엔티티마다·틱마다 토글되고 비-시그니처 기체는 0/0 을 유지한다.

**`WorldState` 승계**: `xp`/`xpTotal`/`level` · `weapon` · `magnetRadius`/`magnetBuffTicks` · `loot` · `resources`/`catalystResourceMilli` · `kills`/`gems` · `maxCombo` · **`tainted`(OR 누적)** · 액티브 4정수 · 사연 카운터 6개 · `commissionRuntime`
- `tainted` 리셋 시 1구간의 치트·하네스 개입이 **전환 한 번으로 세탁**되고 정산 제외의 유일한 게이트(`src/main.ts:1410`, ADR-0008)가 무력화된다.
- `maxCombo` 는 해시 대상(`replay.ts:314`)이자 런 지표라 승계. `sigBit` 는 **승계하지 않는다** — `createWorld` 가 승계 config 로부터 재계산한다(`world.ts:1150`).

**미승계**: `tick` · `entities`(플레이어 제외) · `wave` · 모드 런타임 전부 · `supplyNextIndex` · `grid`/`generatedChunks`/`activeWalls`/`wallIndex` · `combo`/`comboTimer` · `playerSlowTicks` · `powerupChoices`/`pendingLevelUp` · `bossSpawned`/`victory`/`gameOver` · `sigBit`

**검증 — 뮤테이션 + 전수 대조 병용**
- 승계·미승계 배열의 합집합이 `WorldState` 키 전체 및 플레이어 `Entity` 키 전체와 **정확히 일치**함을 exhaustive 매핑으로 단언한다. 뮤테이션은 *있는 것*의 진단력만 증명하고 **목록에 없는 필드는 제거할 것이 없어 원리적으로 못 잡는다** — Architect 의 C1·C2 가 정확히 그 사각지대에서 나왔다.
- **범주 3개 ↔ 배열 2개 불일치 해소** ← rev5 (Critic Minor #2): 배열을 `CARRY` / `RESET_ZERO` / `FRESH` **셋**으로 나눈다. `RESET_ZERO` 는 "0 강제"를 AC 로 단언할 수 있고, `FRESH` 는 "새 무대 값"이라 값 단언이 아니라 **분류 누락만** 검사한다.
- **구현 노트**: `keyof WorldState` 는 optional 키(`scrollRuntime?`)를 포함하고 클래스 타입 프로퍼티(`SeededRng`×7, `SpatialHash<Entity>`, `Map`)는 값 타입이라 유니온 도출을 방해하지 않는다. `exactOptionalPropertyTypes: true` 무관. 형태: `const CARRY = [...] as const` + `type _Miss = Exclude<keyof WorldState, ...>` 양방향, 또는 `Record<keyof WorldState, ...>` 를 `satisfies` 로.
  - 주의: ① `noUnusedLocals: true` 라 검사용 alias 는 export 하거나 소비해야 tsc 통과. ② **`keyof` 는 선언된 키만 본다** — 중첩 런타임 객체 내부는 못 본다. 현재는 전부 미승계라 성립하지만 **한계를 주석으로 못 박는다.**
- 우회 금지 grep 게이트.

**A-6. `hashWorld` 의뢰 꼬리 폴드**
- 위치: `activeSlots` 폴드(`replay.ts:600-604`) **뒤**. append-only. 조건 `config.commission !== undefined` — 이 조건은 **런 내내 불변**이라 조건 자체가 토글되는 액티브 쿨다운 꼬리(`replay.ts:585-594`)보다 한 등급 안전하다. all-or-nothing 고정 폭 유지.
- 접는 값: `segments.length`, `segmentIndex`, `segmentDone`, `order`, `grade`.
- `planet`·`stage` 는 접지 않는다(본문에서 이미 접힌다 — `replay.ts:342`, `:345`). `totalTicks` 도 접지 않는다(스트림 인덱스 i 에서 `totalTicks === i+1` 이라 정보량 0). 파생 폴드 금지 규율(`replay.ts:559-561`).
- ⚠️ **이 폴드는 장식이 아니라 스트림 무결성의 하중 부재다.** `tick` 이 구간마다 0 으로 돌아가므로 같은 행성·같은 단계가 반복되는 조합에서는 **`segmentIndex` 가 유일한 판별자**다.
- **의뢰 술어 단일화**: `config.commission` 을 정본으로 삼고 런타임은 파생.

**A-7. 조우·에코·중반 격전 억제**
- `createWorld` 는 비-침공 런에서 `rollEcho`/`rollEncounter` 를 무조건 굴린다(`world.ts:1109`, `:1125-1127`). 의뢰 런에서 억제.
- **근거**: rev2 의 "굴리고 버리면 RNG 가 전진한다"는 **틀렸다** — 둘 다 `worldRng.fork(...)` 만 쓰고 부모를 소비하지 않는다(`world.ts:1100-1106`, `:1111-1114` 주석이 정본). 진짜 근거는 **런타임 객체가 존재하면 조건부 꼬리 폴드가 켜지고 `stepEcho`/`stepEncounter` 가 상태를 갖는다**는 것이다.
- 중반 격전은 `SEGMENTS` 의 `seg.clash`(`waves.ts:164`) 분기를 억제.
- A-4 의 detour 가드는 **제거**한다 — `encounterRuntime` 이 아예 없으므로 도달 불가 사문 코드다. 프리즈 가드만 남긴다.

**A-8. 최고 클리어 단계 미갱신 배선** ← rev5 신설 (Critic M-2 ①)
- 현재 `src/save/settlement.ts:178` 이 `recordPlanetClear(profile, result.planet, result.stage)` 를 **무조건 실행**한다(가드는 `:177` 의 `if (result.victory && result.planet !== undefined && result.stage !== undefined)`). 스펙 AC "의뢰 런 승리 후 최고 클리어 단계 불변"이 rev4 까지 **어느 Phase 에도 배정되지 않았다.**
  - ← rev6 정정: rev5 는 이 줄을 `:176` 이라고 적었다. `:176` 은 주석 줄이다. 줄 번호 오기도 결함이다 — 구현자가 다른 곳을 고친다.
- `RunResult`/`SettlementOutcome` 에 `commission: boolean` 을 배선하고 `recordPlanetClear` 호출을 게이트한다. `endRun` → `settleRun` 경로 전체가 대상이라 비자명한 작업이다.

**A-8b. 정산 경로 — 단일 정산** ← rev6 재작성 (D5 · Critic MAJ-5. **rev5 의 "이중 정산"을 폐기한다**)

rev5 는 "의뢰 런은 `settlePveRunCurrency` + `settle_commission` 을 **둘 다** 탄다"를 계약으로 못 박았다. **폐기한다.**

- **결정: 의뢰 런은 클라 `settlePveRunCurrency` 경로를 타지 않는다.** EF 가 재실행 `finalState` 에서 자원 축을 뽑아 `settle_commission` 이 **확정 보상과 함께** 지급한다.

**용어 통일 (D12 · Critic 3차 MAJ-6)** — rev6 은 이 항에서 "자원·킬·틱", AC 에서 "일반 전리품 축"으로 갈라 썼다. 이 리포에서 "전리품"은 `loot`/아이템을 뜻하므로 아이템 해석이 가능했고, **그 해석은 D7 이전 구조에서는 구현 불가능**했다(아이템 착지점이 클라 미러였다). **"자원 축(credits/minerals)"으로 통일한다.** 킬·틱은 지급물이 아니라 캡 산정 입력이다.

**지급 경로 표 — 무엇이 어디로 가는가** ← rev7 신설 (D12)

| 지급물 | 일반 PvE | **의뢰 런** | 소유의 정본 |
|---|---|---|---|
| 자원(credits/minerals) | `settlePveRunCurrency` → `settle_pve_run` → `grant_currency('pve_run')` | **`settle_commission` → `grant_currency('commission')`** (D10) | 서버 원장 `profiles.credits/minerals`(ADR-0027) |
| 사연 챕터 보상 크레딧 | `settlePveRunCurrency` 안의 `grantCurrency(…, 'story')`(`src/net/index.ts:195-197`) | **`grantCurrency(…, 'story')` 별도 호출**(D11) | 서버 원장 |
| 일반 아이템(전리품) | `settleRun` 델타 → 클라 `items` 미러 | **동일** | 클라 rw 미러(`20260717000000:186-191`) |
| XP·레벨 | `settleRun` → 클라 `ships` 미러 | **동일** | 클라 rw 미러(`:143`) |
| 설계도 | `grant_blueprints` RPC(클라 호출, `20260722020000:40`) | **동일**(단, 의뢰 전용 설계도가 생기면 D7 대상) | 서버 테이블·클라 주장 |
| 촉매 | 드랍 → 촉매 원장 | **주입 불가**, 드랍은 미확정(PB 착수 시 확정) | 서버 원장 |
| **의뢰 확정 유니크** | — | **`settle_commission` → `commission_grants` 삽입 + `items` 미러 사본**(D7) | **`commission_grants`(서버 권위, ADR-0045)** |

- 표에서 "동일"인 축은 이 계획이 **건드리지 않는다.** D7 이 서버 권위로 가르는 것은 마지막 행 하나뿐이다.
- **미확인**: 의뢰 런에서 `grantBlueprintDrops`·`grantCatalystDrops`·`recordPveRunResult` 를 태울지(§미해결 그대로). 표의 "동일"은 **기본값 제안**이고 PC 계약에서 확정한다.

**D10 — `settle_commission` ↔ `grant_currency` 접점** ← rev7 신설 (Critic 3차 MAJ-2)

rev6 은 `settle_commission` 이 자원을 "지급한다"고만 썼고 **그 지급이 어디를 통과하는지를 보지 않았다.** 한 홉 더 밟은 결과:

- **재화 지급의 유일한 원장 관문은 `grant_currency` 다**(현재 정의 `20260727000000_catalyst_ledger.sql:339`).
- **미등록 `source` 는 `CAP_DEFAULT_*` 로 떨어진다** — `case p_source … else v_call_credits := CAP_DEFAULT_CREDITS; v_call_minerals := CAP_DEFAULT_MINERALS;`(`:429-435`), 값은 **각 1000**(`:357-358` 계열). 즉 `source='commission'` 분기를 안 만들면 **최종 지시의 확정 보상이 조용히 1000 으로 클램프된다.**
- 24h·1h 누적 캡도 함께 문다: `CAP_HOURLY_*` 50000 · `CAP_DAILY_*` 300000(`:359-362` 계열, 적용은 `:459-461`).
- 개연성 캡(`PLAUSIBILITY_*_PER_TICK × finalTick × (1+stage)`, `:419-424`)은 **`p_source = 'pve_run'` 일 때만** 산정된다 — 다른 source 는 `null` 로 두어 `least` 에서 무시된다.
- **GUC 규약**: `resourceMult` 는 `current_setting('app.in_settle', true) = '1'` 일 때만 읽힌다(`:418-420`). 이 플래그는 `settle_pve_run` 이 `set_config('app.in_settle','1',true)` 로 세우던 것이다(`:579`, 해제 `:587`). **트랜잭션-로컬**이라 PostgREST 로 여러 RPC 를 묶을 수 없는 클라는 우회할 수 없다.

→ **결정(D10)**:
1. **`grant_currency` 에 `source='commission'` 분기를 신설**하고 `CAP_COMMISSION_CREDITS`/`CAP_COMMISSION_MINERALS` 상한을 **명시**한다. 실값은 최종 지시 계급의 최대 확정 보상 + 여유이며 **상수 모듈과 SQL 미러를 함께 갱신**한다(이 리포의 미러 동기화 의무 — `20260727000000:43-46` 선례).
2. **확정 보상에는 개연성 캡을 적용하지 않는다.** `p_source = 'pve_run'` 가드가 이미 그렇게 동작하므로 **추가 코드가 필요 없다** — 그 사실을 계약으로 명문화한다. 논리: 개연성 캡은 "리플레이가 없어 결과를 못 믿을 때 물리적 가능 범위로 유계하는" 장치다. 의뢰 런은 **서버 재실행 증거가 있으므로 그 증거가 캡을 대체한다.** 증거가 있는데도 캡으로 깎으면 ADR-0044 의 재실행이 무의미해진다.
3. **`resourceMult` 는 의뢰 경로에 싣지 않는다** — 촉매 주입이 불가하므로 배율이 없다. `app.in_settle` 플래그도 **세우지 않는다**. 이 규약을 계약에 적어 신규 구현자가 "촉매 패턴을 복제"하다 플래그를 세우는 일을 막는다.
4. 1h·24h 누적 캡은 **그대로 문다** — 폭주 방어이지 개연성 판정이 아니므로 재실행 증거가 대체하지 않는다.

**D11 — 사연 챕터 보상이 증발한다** ← rev7 신설 (Critic 3차 MAJ-3)

`settleRun` 은 `applyStoryProgress` 로 해금된 챕터를 **원장에서 1회만 claim** 하고(`src/save/settlement.ts:264` `profile.storyRewardsClaimed.push(claimId)`, 합산 `:265`) 금액을 `storyRewardCredits` 로 **반환만** 한다(`:200`). **실제 지급은 `settlePveRunCurrency` 안에서만** 일어난다(`src/net/index.ts:195-197` — `grantCurrency(input.storyRewardCredits, 0, 'story')`). 호출부는 `src/main.ts:1443-1466` 한 곳이다.

rev6 의 A-8b 는 의뢰 런이 그 함수를 **안 타게** 만들었다. 그런데 `settleRun` 은 그대로 탄다(rev6 이 명시). 결과: **claim 은 소모되고 크레딧은 증발한다.** 사연 카운터 6개가 §A-5 승계 목록에 있어 의뢰 런에서도 전진하므로 **도달 가능한 경로**다.

→ **결정(D11)**: A-8b 의 의뢰 정산 경로에 **"`storyRewardCredits > 0` 이면 `grantCurrency(storyRewardCredits, 0, 'story')` 를 별도 호출한다"** 를 명시한다.
- **이 축은 `settle_commission` 이 지지 않는다** — 사연 보상은 의뢰의 지급물이 아니라 프로필 진행의 지급물이고, `source='story'` 는 이미 자기 캡을 갖는다(`CAP_STORY_CREDITS` 2000, `20260727000000:356`).
- 실패 시 재시도 큐 규율은 기존 `stashPendingSettlement`(`src/net/index.ts:202`)의 story-only 항목 형태를 그대로 쓴다.
- AC 1건 + Integration 테스트 1건을 배정한다.
- **근거 1 — 설계 낭비.** 검증된 리플레이를 손에 쥐고도 클라 주장(`p_summary` 통짜, `20260726000200_pve_settlement.sql:269`) + 개연성 캡(`:154-161`)으로 지급하는 것은, 더 강한 증거를 버리고 약한 증거로 판정하는 것이다. Principle 4("서버가 굴리고 서버가 지급한다")의 직접 귀결.
- **근거 2 — 캡이 N배로 열리는 문제가 동시에 사라진다.** 개연성 캡은 `PLAUSIBILITY_*_PER_TICK × finalTick × (1+stage)` 다(`:160-161`). A-5 가 `finalTick` 을 N구간 누적으로 올리면 **정직한 클램프를 풀려던 조치가 캡 자체를 N배로 여는** 부작용을 낳는다. 클라 경로를 안 타면 이 트레이드오프가 없다.
- **파급**: 클라는 의뢰 런에서 `isNetConfigured()` 분기(`src/main.ts:1444-1470`) 중 **서버 가지에서 `settlePveRunCurrency` 를 호출하지 않는다.** 대신 **사연 보상만 `grantCurrency(…, 'story')` 로 별도 호출한다**(D11). `settleRun`(순수 정산, 아이템·XP·진행)은 그대로 탄다 — 그쪽은 재화를 만지지 않고 델타만 반환하기 때문이다(`settlement.ts:170-173` 주석). `grantBlueprintDrops`·`grantCatalystDrops`·`recordPveRunResult` 의 처리는 **PC 계약에서 확정한다**(미확인 — 이들이 서버 원장에 쓰므로 EF 지급과 이중이 될 수 있는지 착수 전 대조 필요).
- **오프라인 분기**: 의뢰 런은 오프라인 불가(ADR-0044 결과 절)이므로 `else` 가지(`main.ts:1469` 로컬 미러 가산)에 도달하면 **그 자체가 결함**이다. 도달 시 정산을 건너뛰고 로그한다(§Phase C 오프라인 절).

### Phase B0 — `CommissionPayload` 스키마 ← rev5 신설 (Critic Missing #1)

Phase B(테이블 `payload jsonb`) · C(EF 가 덮어쓰는 대상) · D(주문별 규칙) · E(목록 표시)가 **전부 이것을 읽는데 rev4 까지 한 번도 열거되지 않았다.** 착수 즉시 막히는 항목이라 독립 선행 PR 로 뺀다.

```
CommissionPayload = {
  version: number,                    // 스키마 범프용
  commissionId: uuid,
  grade: 1|2|3|4,                     // 정기·우선·특급·최종
  order: 'chain'|'constraint'|'bounty'|'elite',
  segments: { planet: number, stage: number }[],
  constraints?: { bannedPowerupLines?: number[], equipRules?: ... },
  bounty?: { targetKind, escapeRule },  // 현상금 표적 전용
  rewards: {                          // 종이에 적힌 확정 보상
    credits, minerals, items: { rarity, reqLevelCap }[],
    blueprints?, catalysts?, uniqueId?,
  },
  replayBudgetTicks: number,
}
```
- `rewards.uniqueId` 는 `grant_commission` 이 **발령 시점에 굴려 여기 고정**한다. **보유 유니크를 제외하지 않는다** — 중복 지급을 허용한다(pre-mortem ⑥ rev6 결정. rev5 의 "제외하고 뽑는다"는 서버가 갖지 않은 원장을 전제한 거짓이었다).
- `loadoutSealed` — `consume_commission` 이 출격 시점 로드아웃을 봉인한 값. payload 가 아니라 **`commission_runs` 행**에 산다(발령 시점에는 아직 로드아웃이 정해지지 않았다). pre-mortem ⑦.
- 이 스키마가 곧 EF 가 제출 config 를 덮어쓰는 권위 원본이다.

**`equipRules` 의 순환 해소** ← rev6 (Critic Minor)
- rev5 는 `equipRules: ...` 를 미정으로 둔 채 "PB0 착수 전에 닫는다"고 썼다. **PB0 이 곧 그 필드를 정하는 PR 이므로 순환이다.**
- **해소**: PB0 는 `equipRules` 의 **개별 항목을 정하지 않는다.** PB0 가 정하는 것은 **형태**뿐이다 — `equipRules?: { bannedSlots?: SlotId[]; bannedUniqueIds?: number[]; maxRarity?: number }` 같은, 열거가 나중에 채워져도 스키마가 안 깨지는 **열린 레코드**. 개별 제약 카탈로그 항목은 **PD 에서** 채운다(스펙도 "개별 항목 저작 미완"으로 미결에 둔다 — `.omc/specs/deep-interview-commission-system.md:30`).
- 판단 기준: 착수를 막는 것은 "어떤 제약이 있는가"가 아니라 "**제약을 실을 자리가 있는가**"다. 후자만 PB0 가 진다.

### Phase B — 서버 원장

촉매 원장(`supabase/migrations/20260727000000_catalyst_ledger.sql`) 패턴 복제 — RLS select-own, write 는 `SECURITY DEFINER` + `search_path=''` RPC 전용, `for update` 잠금, 영수증 jsonb, 정산 시 1회성 봉인.

- 테이블 `commission_inventory(profile_id, commission_id uuid, payload jsonb, grade, created_at)`
- 테이블 `commission_runs(run_id, profile_id, commission_id, status, payload, loadout_sealed jsonb, replay, replay_gz, client_result, started_at, verified_at, created_at)`
  - **`status` 는 4상태** ← rev6 (pre-mortem ④): `issued` / `active` / `verified` / `rejected`. rev5 는 전부 "pending" 이라 회수 대상(`issued`)과 TTL 대상(`verified|rejected`)을 구분하지 못했다.
- 테이블 **`commission_grants(grant_id uuid pk, profile_id uuid, commission_run_id uuid, kind text, item_payload jsonb, granted_at timestamptz)`** ← rev7 신설 (D7 · ADR-0045)
  - **소유의 정본이다.** 클라 `items` 미러는 표시용 사본이며, 어긋나면 이 테이블이 이긴다.
  - 삽입 주체는 **`settle_commission` 하나뿐**이다. 그 외의 생성자·수정자·삭제자를 만들지 않는다.
  - **TTL 대상이 아니다** — 리플레이와 달리 지우면 소유가 사라진다. cron 정리 목록에 넣지 않는다.
  - `kind` 는 `'unique'` 우선 1종, 의뢰 전용 설계도가 생기면 `'blueprint'` append.

**RLS 계약** ← rev6 신설 (Critic Missing)

촉매 원장 패턴(`20260727000000_catalyst_ledger.sql:77` `catalyst_inventory_select_own`)을 따른다 — **select-own 만, insert/update/delete 정책 없음**(쓰기는 `SECURITY DEFINER` RPC 전용).

| 대상 | 정책 |
|---|---|
| `commission_inventory` | `select_own`(본인 행) |
| `commission_runs` 일반 컬럼 | `select_own` — 수신소 UI 가 진행 상태를 읽어야 한다 |
| **`commission_runs.replay` / `replay_gz` / `client_result`** | **본인도 읽지 못한다.** RLS 는 컬럼 단위가 아니므로 `select_own` 을 컬럼 목록으로 좁힌 **뷰**를 두고 클라는 뷰만 읽는다 |
| `loadout_sealed` | 뷰에서 제외(위조 대조의 기준값이라 노출 이득 0) |
| **`commission_grants`** | `select_own` ← rev7 (D7). 쓰기 정책 없음 — `settle_commission`(service_role) 전용 |

- **침공과 다르게 가는 이유**: 침공은 `get_invasion_replay_gz`(`20260726000100_invasion_replay_ttl.sql:70-101`)로 **참여자 본인 읽기를 허용**한다 — 관전(replaySpectate) 기능이 있기 때문이다. **의뢰는 관전 기능이 없다.** 읽기를 허용할 이유가 없고, 자기 리플레이를 내려받을 수 있으면 "합격하는 입력로그의 형태"를 연구할 재료가 된다. 기능 요구가 생기기 전까지 닫는다.
- **← rev7 정정: "침공은 `get_invasion_replay_gz` 로 허용"은 과소 서술이었다.** `invasions_select_participant`(`20260717000000_m4_initial_schema.sql:359-363`)은 **컬럼 제한이 없는 행 단위 select** 다 — `using (auth.uid() = attacker_id or auth.uid() = defender_id)` 뿐이라 **참여자는 `replay`·`replay_gz`·`client_result` 를 PostgREST 로 직접 읽는다.** `get_invasion_replay_gz` 는 그 위에 얹힌 편의 RPC(bytea → base64 변환 · 48h 게이트)이지 유일 통로가 아니다.
  - 따라서 **의뢰를 뷰로 좁히는 것은 "침공과 다르게 간다"가 아니라 침공보다 엄격한 신규 규율**이다. 그렇게 기록한다.
  - 신규 규율이므로 **비용을 인정한다**: 수신소 UI 가 `commission_runs` 를 직접 읽지 못하고 뷰를 경유해야 하며, 뷰에 컬럼을 추가할 때마다 노출 판정을 다시 해야 한다. 그 대가로 얻는 것은 "합격하는 입력로그를 연구할 재료를 주지 않는다" 하나다.
  - 이 규율을 **침공에 소급하지 않는다**(관전 기능이 실제로 그 컬럼을 쓴다 — 범위 밖).
- **rev6 이 "미확인"으로 남겼던 항목이었고, rev7 에서 원문 대조로 닫았다.**

**RPC**

- `grant_commission(...)` — **`settle_pve_run` 안에서만** 호출한다(pre-mortem ⑧ 방어 ①). 독립 RPC 로 노출하지 않는다. 보관 상한 초과 시 미발령. **발령 시점에 payload 를 굴려 고정**하고 유니크 중복 지급을 허용한다(pre-mortem ⑥). **시간당 발령 시도 상한**을 강제한다(방어 ②). 클라 트리거 금지(guard 트리거로 서버 필드 봉인).
  - **1회성 앵커는 D9** — `pve_runs` pending 이 아니라 `settle_pve_run` 이 남기는 **정산 이력 행의 `id`** 에 unique 제약으로 건다.
- `consume_commission(p_commission_id uuid, p_loadout jsonb)` — `for update` → 소유·존재 확인 → 삭제 → `commission_runs` **`issued`** 행 발급(+ `loadout_sealed := p_loadout` 봉인) → `{ run_id, payload }`
- `mark_commission_active(p_run_id uuid)` ← rev6 신설 / **rev7 시한 부여(D8)** — 클라가 런 **시작 직후** 부른다.
  - `issued → active` 전이를 **`created_at + 유예` 이내에만** 허용한다. 유예 초과 뒤 호출은 **명시 거부**한다(no-op 이 아니다 — 클라가 실패를 알아야 재시도하지 않는다).
  - 이것이 회수 유예를 멈추는 유일한 신호다.
  - **호출 빈도 상한** ← rev7 신설 (Critic 3차 Missing). 이 RPC 도 **발령 빈도 상한과 같은 축**을 진다 — 상한이 없으면 `consume_commission` 을 반복해 `issued` 행을 양산하고 전이를 난사하는 경로가 열린다. 실질 상한은 **의뢰서 재고**가 주지만(consume 없이는 `run_id` 가 안 생긴다) **시간당 호출 상한을 명시적으로 건다**. 실값은 밸런스 큐 — 발령 빈도 상한과 **같은 표에 나란히** 적어 두 축이 어긋나지 않게 한다.
- `restore_commission(p_run_id uuid)` — **RPC 로 노출하지 않는다** ← rev7 정정 (D13). rev6 은 "service_role 전용 RPC"로 뒀으나 **호출자가 cron 하나뿐**이므로 함수 형태로 존재할 이유가 없다. **회수 로직을 cron SQL 본문에 직접 넣어 공격면을 줄인다**(존재하지 않는 함수는 권한 실수로 노출될 수 없다).
  - 회수 조건은 아래 cron ① 이 정본이다. `issued` 이고 유예 초과인 행만 원장 복구 + 종결.
  - ⚠️ **회수는 착취 차단의 주체가 아니다**(D8 ③). "회수된 `run_id` 는 제출 거부"는 **부수 효과**이고, 실제 차단은 `settle_commission`/EF 의 `status='active'` 요구가 진다.
- `settle_commission(p_run_id, ...)` — service_role 전용. accept 일 때만 지급 + 1회성 봉인(`active → verified`).
  - **수락 조건** ← rev7 (D8 ②): `status = 'active'` 이며 `started_at` 이 유효한 행만 받는다. `issued` 행은 **cron 실행 여부와 무관하게** 거부한다.
  - **지급 범위** ← rev6 (A-8b) · rev7 용어 통일(D12): payload 의 확정 보상 **+ EF 재실행 `finalState` 에서 뽑은 자원 축(credits/minerals)** 을 **함께** 지급한다. 클라 `settlePveRunCurrency` 는 타지 않는다. 킬·틱은 지급물이 아니다.
  - **`grant_currency` 접점** ← rev7 (D10): `source='commission'` 분기를 신설하고 상한을 명시한다. **확정 보상에 개연성 캡을 적용하지 않는다**(서버 재실행 증거가 캡을 대체한다). `app.in_settle` 플래그를 세우지 않고 `resourceMult` 를 싣지 않는다. 1h·24h 누적 캡은 그대로 문다. 상세 근거는 §A-8b D10.
  - **`commission_grants` 삽입** ← rev7 (D7): 확정 유니크(및 의뢰 전용 설계도)를 `commission_grants` 에 발급한다. **EF accept 시점에 이 삽입을 먼저 하고**, 재화 지급은 멱등으로 구성해 부분 실패 시 서버 측 재시도가 같은 `commission_run_id` 로 안전하게 돌게 한다(D13).
  - **행성 인기 배율 미적용을 명문화** ← Critic M-2 ②: `settle_commission` 은 배율 표를 **읽지 않는다.** 적힌 금액이 그대로 지급액이다(ADR-0038 "대체 가능한 보상에만 배율"과 정합). ⚠️ 이 명문화의 범위는 **payload 의 확정 보상**이다 — 합류한 자원 축에 배율을 적용할지는 **미확인**(PB 착수 시 ADR-0038 원문 대조 후 확정).
    - ⓐ 다만 **런 입력 쪽은 rev7 에서 확정했다**(D13): 의뢰 런은 `planetMultCenti`/`planetMultEpoch` 를 **스탬프하지 않는다**. `runConfig.ts` 는 `opts.planetMult` 가 있을 때만 두 필드를 싣는 **조건부 스탬프**이고(`src/run/runConfig.ts:191-195`, 주석 `:79-87` 이 "침공·예비역 소집·하네스는 미지정"을 계약으로 명시), 미지정이면 `hashWorld` 꼬리 폴드도 안 돈다. 의뢰를 같은 목록에 넣는 것이 그 규율과 정합하고, **sim 드랍 건수까지 배율 밖에 두는 것**이 스펙 AC "배율 미적용"의 자연스러운 해석이다(배율은 ADR-0038 상 sim 레이어에서 적용된다 — 스탬프하지 않으면 적용 자체가 없다).

**압축·TTL·회수 — cron 은 1건이 아니라 2건이다** ← rev6 정정 (Critic MAJ-3)

rev5 는 "`20260726000100_invasion_replay_ttl.sql` 을 **그대로 복제**한다"고 썼다. **거짓이다.** 그 마이그레이션의 cron 은 `verified_at is not null and verified_at < now() - interval '48 hours'` 만 본다(`:126-127`). 즉 **미확정 행은 애초에 대상이 아니다**(`:112` 주석이 "미확정(pending) 행(verified_at is null)은 대상이 아니다"라고 명시). 복제만 하면 **`issued` 행이 영원히 남고 의뢰서도 영원히 증발한 채**다 — pre-mortem ④ 가 바로 그 사고인데 rev5 의 방어가 그것을 못 잡는다.

**복제 1건 + 신규 1건**:

**⚠️ rev7 — cron 은 매시 정각 배치다.** 침공 cron 은 `'0 * * * *'`(`20260726000100_invasion_replay_ttl.sql:121-123`)이고 이 리포의 다른 cron 도 같은 결이다. 따라서 **유예 만료와 실제 회수 사이가 최대 1시간 벌어진다.** rev6 은 이 지연을 보지 않은 채 "회수된 `run_id` 는 제출 거부"를 착취 차단으로 삼았다 — 그 1시간 창이 그대로 착취 창이었다. **D8 이 판정을 cron 에서 떼어냈으므로**(전이 시한 + `status='active'` 요구) 지연이 방어에 영향을 주지 않는다. cron 은 **의뢰서를 돌려주는 편의 장치**일 뿐이다.

| cron | 대상 | 동작 |
|---|---|---|
| ① 회수 (**신규**) | `status = 'issued'` **and** `created_at < now() - 유예` | 원장 복구(`commission_inventory` 재삽입) + `status` 종결. **로직은 cron SQL 본문에 인라인**(별도 RPC 미노출 — D13). 지연 최대 1h 는 허용(판정 주체가 아니다) |
| ② 정리 (**복제**) | `status in ('verified','rejected')` **and** `verified_at < now() - 48h` | `replay`·`replay_gz`·`client_result` null 화. 결과 행 보존 |

- ②는 침공과 같은 이유로 **세 컬럼 모두** 비운다 — 조기 구조 reject 는 gzip 아카이브를 거치지 않아 원본 `replay`(jsonb)만 남고, `replay_gz` 만 비우면 무거운 조기거부 리플레이가 영구 잔존한다(`20260726000100:114-118`).
- gzip 압축 자체(`store_*_replay_gz` 패턴)는 복제한다. 다만 **의뢰는 관전이 없으므로 `get_*` 대응 RPC 를 만들지 않는다**(위 RLS 계약).
- ADR-0044 의 용량 논거("제출 건수가 극소수라 예산 안")는 **보존 기간이 유한할 때만** 성립한다.

### Phase C — 리플레이 제출 + verify-commission EF

- 클라: 의뢰 런은 `ReplayRecorder` 를 돌린다. **recorder 에는 `world.config` 가 아니라 원본 config 를 준다**(`src/main.ts:1304-1320` 계약). 호출부가 없는 `buildPveRunResult`(`src/net/pveRun.ts:41`)를 여기서 회수한다.
- 제출: `commission_runs` 에 `replay`/`client_result` 를 붙이고 `functions.invoke('verify-commission', ...)`. 침공 `submitInvasion`(`src/net/invasionGateway.ts:395-423`) 동형.
- **실패 런도 제출한다** ← Critic Missing #6: 격추로 끝난 런도 제출해야 `active` 행이 정상 종결된다(미제출 시 잔존). 실패 제출은 보상 0 으로 봉인만 한다.
- **실패 런 제출의 비용 축** ← rev6 신설 (Critic Missing). "실패해도 제출한다"는 **스팸 벡터를 연다** — 치터가 아니어도, 의뢰서 한 장으로 EF 전수 재실행 1회(최대 예산 2초 CPU) + 리플레이 수백 KB 저장이 확정된다. 완주 런만 제출하던 rev5 가정보다 건수가 늘어난다.
  - **상한의 원천은 의뢰서 재고다.** 발령이 클라 주장 축이라(pre-mortem ⑧) 재고 상한만으로는 부족하고, **발령 빈도 상한(⑧ 방어 ②)이 곧 제출 빈도 상한**이 된다. 두 방어가 같은 축을 진다는 것을 명시한다.
  - **조기 거부는 재실행 전에 끝난다**: `inputs.length > replayBudgetTicks` 선차단 · 촉매 선검사 · 로드아웃 봉인 대조는 전부 `verifyRun` **이전**이라 CPU 를 안 쓴다. 순서를 계약으로 못 박는다(아래 EF 절 번호 순서).
  - **미확인**: 무료 티어 EF 호출 수·DB 용량 예산에 대한 실제 여유는 이 작업에서 재지 않았다. **PC 실측 게이트에서 건당 ms 와 함께 건수 상한을 산출한다.**
- **제출 실패 재시도** ← pre-mortem ⑤: 클라가 리플레이를 로컬 보존하고 재시도한다. **`active` 행이 살아 있는 동안(TTL 이전) 멱등 재제출이 가능하다.** 회수 대상은 `issued` 뿐이므로 재시도 창과 회수 유예가 겹치지 않는다(rev5 의 수명 충돌 해소 — Critic MAJ-4).

**오프라인 전환 시 거동** ← rev6 신설 (Critic Missing)

의뢰 런은 오프라인에서 돌 수 없다(ADR-0044 결과 절) — 획득·출격이 이미 온라인 전용이기 때문이다. 문제는 **런 도중에 끊기는 경우**다.

- **sim 은 계속 돈다.** 네트워크는 sim 에 들어오지 않으므로(Principle 6) 런은 정상 완주한다. 끊김이 결정론을 건드리지 않는다.
- **정산 시점에 제출이 실패**하고, 위 재시도 경로로 넘어간다. `active` 행이 살아 있으므로 복구 후 멱등 재제출로 보상을 받는다.
- **TTL 을 넘겨 재접속하면 보상은 소멸한다.** 자인한다 — 무제한 보관은 "성공 리플레이를 쟁여두고 유리한 시점에 제출" 축을 열고, 그 이득이 유실 구제보다 크다고 판단한다. TTL 실값은 이 판단의 입력이므로 밸런스 큐가 아니라 **PC 계약**에서 정한다.
- **`isNetConfigured()` 가 false 인 상태에서 의뢰 런이 시작되는 경로는 결함이다** — 출격이 `consume_commission`(서버 RPC) 성공을 전제하므로 원리상 도달 불가. 도달 시 정산을 건너뛰고 로그한다(A-8b).
- EF `verify-commission/verifyCommissionCore.ts` — **아래 1~6 은 전부 `verifyRun` 이전**이라 CPU 를 안 쓴다(실패 런 비용 축):
  0. **행 상태 게이트** ← rev7 (D8 ②): `commission_runs` 행이 `status='active'` 이고 `started_at` 이 유효한지. 아니면 `commission-run-not-active`. **가장 앞이다** — 조회 1회로 끝나고, 이걸 통과 못 하면 나머지가 무의미하다.
  1. `inputs.length > replayBudgetTicks` 선차단(`invasion-inputs-too-long` 선례 — `verifyInvasionCore.ts:385-388`). **CPU 상한 게이트라 가장 앞에 둔다** (rev5 는 4번에 뒀다 — 순서가 곧 비용이다)
  2. 제출 config 의 `commission` 블록을 **서버 원장 payload 로 덮어쓴다**(`verifyInvasionCore.ts:411-414` 동형 — `{ ...cfg, invasion3: authoritativeInvasion }` 의 의뢰판)
  3. **로드아웃 봉인 대조** ← rev6 신설 (pre-mortem ⑦ · Critic CRIT-2): 제출 `config.loadout` 을 `commission_runs.loadout_sealed` 와 대조하고 불일치면 `commission-loadout-mismatch`. **이 대조는 "장비를 진짜 보유했는가"를 증명하지 않는다** — 출격 후 편집만 닫는다(ADR-0044 §증명하지 못하는 것). **덮어쓰기가 아니라 대조인 이유**: 봉인값도 클라 미러에서 온 값이라 권위가 아니다. 권위가 아닌 값으로 덮으면 "서버가 정했다"는 착시가 생긴다
  4. **촉매 필드 선검사** ← rev5 신설 (Critic M-2 ③): `config.catalysts` 가 비어 있지 않으면 **즉시 reject**(`commission-catalyst-present`). rev4 까지 유일한 방어가 Phase E 의 "촉매 픽커 미표시"였는데, 그것은 **클라 UI 이고 서버는 못 잡는다** — 촉매가 실린 config 는 그대로 재실행돼 해시가 일치하고 accept 된다. Principle 4 정면 위반이었다
  5. 제약 계약이면 `loadout` 과 `config.commission.constraints.bannedPowerupLines` 를 payload 와 대조
  6. **의뢰 유니크 소유 대조** ← rev7 신설 (D7 · ADR-0045): 제출 `config.loadout` 에 **의뢰 전용 유니크**가 있으면 `commission_grants` 를 조회해 그 `profile_id` 에게 실제로 발급된 적이 있는지 대조하고, 없으면 `commission-unauthorized-unique`. **이것이 D7 의 강제 지점이다** — 이 단계가 없으면 `commission_grants` 는 증거만 남기고 아무것도 막지 못한다.
     - **판정 기준(의뢰 전용 유니크 id 집합)이 새 단일 정본**이 된다. 클라·서버가 갈리면 오거부가 나므로 상수 모듈 1곳에서만 정의하고 EF 가 그것을 읽는다.
     - **3(봉인 대조)과 다른 축이다**: 3 은 "출격 후 편집했는가", 6 은 "그 물건을 받은 적이 있는가". 3 은 봉인값이 클라 미러 파생이라 권위가 없고, 6 은 **서버가 발급한 행**이라 권위가 있다.
  7. `verifyRun` 위임 ← **여기서부터 CPU 를 쓴다**
  8. `settle_commission`(accept 면 지급, reject 면 보상 0 봉인 — 어느 쪽이든 행을 종결한다)
- **`verify-run/verifyCore.ts` 는 수정하지 않는다.** `runReplay` 는 `stepRun` 호출로 3줄만 바뀐다.

**PC 실측 차단 게이트** ← rev5 신설 (Critic M-6). Phase 0 이 낸 것은 외삽이다. verify-commission 이 배포된 **직후**가 첫 진짜 실측 시점이다.
- 최장 구성 리플레이를 **원격 EF 로 실호출**해 ms 를 잰다.
- 예산 초과 시 축소 순서: **① 최종 계급 구간 수 → ② 특급 구간 수 → ③ 구간당 틱 상한.** 보상 설계는 구간 수에 연동돼 있으므로 이 순서를 지켜야 되감기가 최소화된다.
- 이 게이트를 통과해야 Phase D/E/F 의 상수가 확정된다.

### Phase D — 주문 4종

Phase 0 골격 + PC 게이트가 확정한 상수 모듈을 읽는다. 하드코딩 금지.

- **연쇄 원정**: Phase A 가 곧 구현. 추가는 의뢰 보스 배치뿐.
- **정예 소집령**(ADR-0043): 잡몹 스폰 0 + 젬 드랍 0 + 정예 겹침 소환.
  - **겹침 소환의 형태를 확정한다** ← Critic Ambiguity #1: **이전 정예가 살아 있을 때만 추가 투입**한다(B안). 고정 간격 타이머(A안)는 ADR-0043 이 명시적으로 폐기한 "고정 웨이브 타이머"를 되살려 그 ADR 의 근거를 무너뜨린다. 임계("늦으면")는 **직전 정예 처치 이후 경과 틱**이며 상수 모듈에 산다.
  - 붙는 층: 스포너(`updateWaves` 의 스폰 경로)이지 세그먼트 게이트가 아니다.
  - 파워업 3택이 안 열리는 것은 젬 0 의 **자연 귀결**이라 별도 차단을 넣지 않는다(진실이 둘이 되면 안 된다).
- **제약 계약**: sim 무변경. 장비축은 `buildRunConfig` 의 `equippedItems` 단계, 성장축은 `powerups.ts` 3택 풀 구성에서 `config.commission.constraints.bannedPowerupLines` 로 제외. **위반 처리기·감시 카운터를 만들지 않는다.**
- **현상금 표적**:
  - 마킹 형태 확정 ← Critic Ambiguity #2: **기존 kind + `enemyType` 마킹**(B안). 신규 `EntityKind` append 는 `hashEntity` 레이아웃 규율을 건드린다. 적 엔티티라 플레이어 `aux0`/`aux1` 시그니처와 충돌하지 않는다.
  - **도주 성립 조건 확정** ← Critic Missing #3: **HP 임계 이하로 떨어진 뒤 일정 틱 생존하면 도주**한다(피격 후 경과 틱 기반). 화면 이탈 기반은 강제 스크롤 모드에서 의미가 무너진다. 임계·틱은 상수 모듈.
  - 도주 → A-3 의 ①(중간 구간) 또는 ③(마지막 구간 = `gameOver`).

### Phase E — 지시 수신소 (UI)

- `src/ui/pixi/` 신설, 기지 화면 진입. 카툰나무풍 크롬 + 장비 아이콘체.
- 목록 행 클릭은 **행 Container 에** 건다.
- 출격 시 `consume_commission` → payload → `buildRunConfig` → 런 시작. **촉매 픽커 미표시**(단, 이것은 UX 이지 방어가 아니다 — 방어는 Phase C ②).
- 런 **시작 직후** `mark_commission_active` 호출(pre-mortem ④). ← rev6 정정: rev5 의 "런 시작 실패 시 `restore_commission` 즉시 호출"을 **철회**한다. 클라는 복구를 지시하지 못한다 — 신호를 **안 보내는 것**이 곧 회수 조건이고, 회수는 cron 만 한다. 실패 경로에 클라 코드가 필요 없다는 것이 이 설계의 이점이다(부르지 못하고 죽는 경우가 정상 처리된다).
- **정예 소집령 런에 "런 내 성장 없음"을 명시한다** ← rev5 (Critic Minor #5). ADR-0043 결과 절의 요구다 — 아무 설명 없이 파워업이 안 열리면 플레이어는 그것을 결함으로 읽는다.

### Phase F — 의뢰 보스 3종

- `data/bosses/` 행 추가(3페이즈 + HP 임계 + 공격 프리미티브). 주문별 1종.
- 신규 프리미티브 필요 시 `src/sim/boss.ts` 확장. 3D 모델은 meshy-forge 라이브러리 **조회 후** 미보유분만 생성.

### Phase G — 다구간 난이도 계측 + 통합 ← rev5 신설 (Critic Missing #4)

ADR-0042 결과 절이 "난이도 기준선을 조합 단위로 재야 한다 — 모드별 단일 계측에서 자동으로 파생되지 않는다"를 명시했는데 rev4 에 계측 단계가 없었다.
- 계급별 대표 구간 조합에 대해 96시드 클리어율·평균 소요를 재고, 침공 밴드 계측과 같은 방식으로 밴드에 앉힌다.
- 산출물을 밸런스 큐(`.omc/plans/balance-queue.md` — P0 가 만든다)에 등재.

**PC 게이트가 확정한 상수를 G 가 되돌려야 할 때** ← rev6 신설 (Critic Minor)

PC 는 **CPU 예산**으로 구간 수·틱 상한을 확정하고, G 는 **난이도**로 같은 상수를 다시 본다. 두 게이트가 같은 값을 반대 방향으로 밀 수 있다(G: "구간이 적어 너무 쉽다" ↔ PC: "더 늘리면 예산 초과").

- **PC 가 상한, G 가 그 안에서의 선택**이다. 순서가 아니라 **포함 관계**다 — G 는 PC 가 그은 상한을 **넘길 수 없다.**
- G 가 "PC 상한 안에서는 목표 밴드에 못 앉힌다"고 판정하면, 상수를 되돌리는 것이 아니라 **난이도 축을 상수 밖에서 조정한다**: 구간별 스테이지 난이도·의뢰 보스 HP·제약 강도. 이들은 CPU 예산과 무관하다.
- 그래도 안 되면 **PC 를 다시 돌린다**(예산 재측정 — EF 성능은 배포마다 바뀔 수 있다). 상한 자체를 협상하지 않는다.
- 이 규칙을 어기는 유일한 경우는 **예산 상한이 잘못 측정된 것**이고, 그때 고칠 것은 상수가 아니라 측정이다.

---

## Acceptance Criteria

### 머지 하드 게이트 — 회귀
- [ ] 무의뢰 PvE 런 per-tick 해시 스트림이 변경 전 커밋과 **바이트 동일**
- [ ] 침공 골든 18건 전량 통과, `INVASION_HASH_VERSION` 3 그대로
- [ ] `verify-invasion` EF 재배포 없이 기존 침공 리플레이 계속 accept
- [ ] `verify-run/verifyCore.ts` diff 0 줄

### 머지 하드 게이트 — 진단력 (위 4건은 무의뢰 런만 밟아 신규 코드에 대해 항진)
- [ ] **전수 대조**: `CARRY`/`RESET_ZERO`/`FRESH` 합집합 == `WorldState` 키 전체 ∪ 플레이어 `Entity` 키 전체. 어느 타입에 필드를 추가하면 **컴파일 또는 테스트가 깨진다**
- [ ] **뮤테이션**: `carryAcrossSegment` 에서 임의 한 필드 제거 시 승계 불변식 테스트가 **실패**
- [ ] `preDerived` 분기 무력화 시 "파워업 0회 스탯 동일" 테스트가 **실패**
- [ ] 의뢰 꼬리 폴드 제거 시 전환 골든이 **실패**
- [ ] 조우 억제(A-7) 무력화 시 "의뢰 런에 조우 미등장" 테스트가 **실패**
- [ ] **`finalTick` 을 `w.tick` 으로 되돌리면 다구간 정산 테스트가 실패**(rev4 최고위험축 C4 의 진단력)
- [ ] **`main.ts` 캐치업 루프의 월드 재조회를 되돌리면 참조 캐싱 테스트가 실패**(H5 의 진단력)

### 구간 전환
- [ ] 파워업 0회 런에서 2구간 시작 `weapon`·`playerSpeed`·`playerHp`·`magnetRadius` 가 1구간 시작과 **정확히 같다**
- [ ] 파워업 N회 런에서 2구간 시작 스탯 == 1구간 종료 스탯
- [ ] 1구간에서 hp 를 잃은 채 전환하면 2구간 시작 hp 가 그 값
- [ ] 시그니처 스택(`player.aux0`/`aux1`)이 구간을 넘어 유지된다
- [ ] **`player.targetX`(런당 1회 치명 무효)가 유지된다** — N구간이 N회 부활이 되지 않는다
- [ ] `targetY`·`ownerId`·`cooldown`·`dashCooldown` 이 구간 시작에 무료 재발급되지 않는다
- [ ] `iframes`·`phase` 는 구간 시작에 0
- [ ] 1구간 수거 `loot`(보스 드랍 포함)이 최종 정산에 전량 포함
- [ ] **레이싱 → 뱀서류 전환 후 `scrollRuntime` 이 `undefined`**, 수축 → 오염 후 `shrinkRuntime` 이 `undefined`
- [ ] **2구간 시작 후 첫 3,000틱에 보급 습격이 정확히 1기**
- [ ] **1구간에서 하네스 개입한 런은 2구간에서도 `tainted === true`**
- [ ] **N구간 의뢰 런의 정산 `finalTick` 이 전 구간 누적 틱과 같다**
- [ ] **보스 처치와 같은 틱에 플레이어가 죽으면 전환하지 않고 런이 패배로 끝난다**
- [ ] 중간 구간의 마지막 입력 프레임 뒤에 전환이 일어나지 않는다
- [ ] 2구간 시작 시 1구간 엔티티가 `entities` 에 없다(플레이어 제외)
- [ ] 레벨업 프리즈 중에는 전환이 일어나지 않는다
- [ ] `advance` 가 항등을 반환한 틱에는 `entityRenderer.reset()` 이 호출되지 않는다
- [ ] 전환 시드가 wire 에 실리지 않고 클라·서버가 각자 재도출해 같은 값을 얻는다
- [ ] **전환이 캐치업 루프 안에서 일어난 프레임에도 정산·HUD·오버레이가 새 월드를 읽는다**
- [ ] **하네스 `ff`/`step` 이 전환 후 새 월드로 오토파일럿·종료 검사를 이어간다**
- [ ] 해츨링 런에서 `player.aux0`(kills 스냅샷)과 `state.kills` 가 전환 후에도 정합
- [ ] `stepWorld` 를 직접 부르는 프로덕션 호출부가 0건이고 `pnpm lint` 가 통과한다
- [ ] `carryAcrossSegment` 우회 이식 코드 없음(grep 게이트)

### 플레이한 런 == 정산된 런
- [ ] 라이브 루프 최종 `kills`·`level`·`loot` 개수가 같은 리플레이의 `runReplay` 재실행 결과와 **일치**(다구간 기준)

### 서버 · 원장
- [ ] 출격 시 원장 차감, 런 실패 후 목록에 없음
- [ ] **`issued` 행이 유예를 넘기면 cron 회수로 의뢰서가 원장에 돌아온다**
- [ ] ~~**회수된 `run_id` 로 제출하면 거부된다**~~ ← **rev7 폐기 (D8).** **항진이다** — 회수가 이미 일어난 경우만 검사하므로 cron 지연(최대 1h) 창의 착취를 원리적으로 못 본다. 아래 둘로 교체한다
- [ ] **유예를 초과한 뒤 `mark_commission_active` 를 호출하면 거부된다** ← rev7 (D8 ①)
- [ ] **cron 이 아직 안 돌아 행이 살아 있어도, 유예를 초과한 `issued` 행으로는 제출이 거부된다** ← rev7 (D8 ②·③). *검증법: cron 을 unschedule 한 상태에서 유예 초과 후 승리 리플레이를 제출해 거부를 확인한다 — cron 이 도는 상태에서 재면 무엇이 막았는지 갈리지 않는다*
- [ ] **`restore_commission` 이라는 이름의 RPC 가 존재하지 않는다**(`pg_proc` 조회 0건) ← rev7 (D13 — RPC 미노출)
- [ ] **`mark_commission_active` 를 받은 행은 유예가 지나도 회수되지 않는다** ← rev6
- [ ] **`mark_commission_active` 시간당 호출 상한을 넘긴 호출이 거부된다** ← rev7 (Missing)
- [ ] 보관 상한이 찬 상태에서 보스를 잡아도 미발령
- [ ] **시간당 발령 시도 상한을 넘긴 신고는 미발령**(재고에 여유가 있어도) ← rev6 (재고 캡 ≠ 빈도 캡)
- [ ] **`grant_commission` 이 `settle_pve_run` 밖에서 호출 불가**(독립 노출 0) ← rev6
- [ ] **촉매를 주입하지 않은 일반 PvE 런에서도 의뢰서가 발령된다** ← rev7 (D9). *rev6 의 pending 앵커였다면 이 AC 가 실패한다 — pending `pve_runs` 행은 `consume_catalysts` 만 만들기 때문이다*
- [ ] **같은 정산 이력 행으로 두 번 발령되지 않는다**(unique 제약 위반) ← rev7 (D9 앵커의 진단력)
- [ ] 의뢰 런 정산이 새 의뢰서를 발령하지 않음
- [ ] **`grant_commission` 이 이미 가진 유니크를 굴려도 정상 지급되고 격납고가 "중복 — 효과 없음"으로 표기한다** ← rev6 (rev5 의 "제외하고 굴린다" AC 를 **폐기**. 서버가 그 원장을 갖고 있지 않다)
- [ ] **`settle_commission` 이 행성 인기 배율 표를 읽지 않는다** — 적힌 금액이 그대로 지급된다
- [ ] **의뢰 런 config 에 `planetMultCenti`·`planetMultEpoch` 가 둘 다 부재한다** ← rev7 (D13 — 조건부 스탬프 미지정)
- [ ] **의뢰 런이 `settlePveRunCurrency` 를 호출하지 않는다** ← rev6 (단일 정산)
- [ ] **의뢰 런의 자원 축(credits/minerals)이 `settle_commission` 을 통해 지급된다** — 확정 보상과 합산 1회 ← rev6 / rev7 용어 통일(D12)
- [ ] **최종 지시 계급의 최대 확정 보상이 클램프 없이 전액 지급된다**(`grant_currency` 응답의 `clamped === false`) ← rev7 (D10). *`source='commission'` 분기가 없으면 `CAP_DEFAULT_*`=1000 으로 조용히 깎여 이 AC 가 실패한다*
- [ ] **`settle_commission` 이 `app.in_settle` 을 세우지 않고 `resourceMult` 를 싣지 않는다** ← rev7 (D10 ③)
- [ ] **`storyRewardCredits > 0` 인 의뢰 런에서 `grantCurrency(…, 'story')` 가 호출되고 크레딧이 실제로 늘어난다** ← rev7 (D11). *별도 호출이 없으면 claim 만 소모되고 크레딧이 증발한다*
- [ ] **`commission_grants` 에 행이 생기고, 그 행 없이 같은 유니크를 로드아웃에 실은 제출이 `commission-unauthorized-unique` 로 거부된다** ← rev7 (D7 · ADR-0045). *`items` 미러에 직접 써 넣은 상태로 재현한다 — 미러만으로는 통과하지 못해야 한다*
- [ ] **`commission_grants` 의 insert/update/delete 를 authenticated 롤로 시도하면 전부 거부된다**(select-own 만) ← rev7 (D7)
- [ ] **`commission_grants` 가 cron 정리 대상에 포함되지 않는다** ← rev7 (소유의 정본이라 TTL 없음)
- [ ] **EF 지급 중 재화 지급이 실패해도 `commission_grants` 행이 남고, 같은 `run_id` 재처리가 중복 발급하지 않는다** ← rev7 (D13 멱등)
- [ ] **`verified|rejected` 행이 48시간 뒤 `replay`·`replay_gz`·`client_result` 셋 다 null 이 된다**
- [ ] **`issued` 행이 영구 잔존하지 않는다**(cron ①) ← rev6 — 침공 cron 은 `verified_at is not null` 만 보므로 복제로는 안 닫힌다
- [ ] **본인도 자기 `commission_runs.replay` 를 읽지 못한다**(뷰 경유만) ← rev6 RLS 계약
- [ ] **의뢰 런 승리 후 그 행성·단계의 최고 클리어 단계가 변하지 않는다**(`settlement.ts:177-178` 게이트)

### 서버 · 검증
- [ ] `victory: true` 만 보내고 리플레이 미제출이면 의뢰 보상 0
- [ ] 조작 해시 스트림이 `hash-stream-divergence` 로 거부
- [ ] 제약 계약을 금지 장비·금지 파워업으로 돌린 리플레이가 거부
- [ ] **촉매가 실린 config 의 의뢰 리플레이가 `commission-catalyst-present` 로 거부**(클라 UI 가 아니라 서버가 잡는다)
- [ ] 같은 `commission_run_id` 재제출이 멱등(`active` 인 동안)
- [ ] 실패 런 제출이 보상 0 으로 정상 봉인된다
- [ ] `inputs.length > replayBudgetTicks` 제출이 즉시 거부
- [ ] **출격 시 봉인된 loadout 과 다른 loadout 이 실린 제출이 `commission-loadout-mismatch` 로 거부** ← rev6 (pre-mortem ⑦)
- [ ] **`status='active'` 가 아닌 행으로 제출하면 `commission-run-not-active` 로 즉시 거부** ← rev7 (D8 ②)
- [ ] **위 6종 거부가 `verifyRun` 재실행 이전에 반환된다**(EF 소요 ms 가 정상 accept 대비 자릿수로 작다) ← rev6 실패 런 비용 축 / rev7 에서 `commission-run-not-active`·`commission-unauthorized-unique` 추가로 6종
- [ ] **PC 실측 게이트**: 최장 구성 리플레이가 원격 EF 실호출로 예산 안에 든다
- [ ] **PC 실측 게이트 2**: 건당 ms 와 리플레이 바이트에서 **시간당 제출 건수 상한**을 산출하고, 발령 빈도 상한이 그 안에 든다 ← rev6

> ⚠️ **이 절이 증명하지 못하는 것** ← rev7 갱신: 위 AC 를 전부 통과해도 **제출 config 의 loadout 중 *일반* 장비·기체가 진짜 플레이어 소유인지는 증명되지 않는다**(ADR-0028 · ADR-0044 §증명하지 못하는 것). 출격 전 클라 미러 위조는 그 축에서 열려 있다.
> - **rev7 에서 닫힌 것은 한 줄기뿐**이다: **의뢰 전용 유니크**의 소유(D7 · ADR-0045 · EF 6단계). 그 밖의 아이템·XP·기체는 그대로다.
> - **또 하나 닫히지 않는 것**: 의뢰 유니크를 받은 뒤 **일반 PvE 런**에 끌고 나가는 경우. 일반 PvE 는 EF 를 타지 않으므로(ADR-0026) 대조 지점이 없다. 전면 원장이 생기기 전까지 열려 있다.
> - **AC 목록의 길이를 방어의 완결성으로 읽지 말 것** — 이것이 rev5 가 저지른 오독이다.

### 게임플레이
- [ ] 연쇄 원정 구간 전환 시 행성 모드가 실제로 바뀐다(하네스 스크린샷 + `modeStateOf`)
- [ ] 정예 소집령: 잡몹 0 스폰 · 젬 0 드랍 · 파워업 3택 0회
- [ ] 정예 소집령에서 **직전 정예가 살아 있을 때만** 다음 정예가 추가 투입된다(고정 타이머 아님)
- [ ] 현상금 표적 도주 시 진행 게이트 무관하게 구간 종료
- [ ] **마지막 구간에서 표적이 도주하면 `victory === false && gameOver === true` 이고 `settle_commission` 이 호출되지 않는다** ← C-1
- [ ] 의뢰 런에 중반 격전·조우 미등장
- [ ] 정예 소집령 화면에 "런 내 성장 없음"이 표시된다

---

## 리스크와 완화

| # | 리스크 | 완화 |
|---|---|---|
| R1 | 승계 누락으로 조용한 상태 소실 | 범위를 `WorldState` + 플레이어 `Entity` 로 확장 · 계승 기본(config)/화이트리스트(state) 비대칭의 근거 명시 · **전수 대조 + 뮤테이션 병용** · grep 게이트 |
| R2 | 파생 이중 적용(제곱) | `preDerived` + recorder 에 원본 config + 뮤테이션 게이트 |
| R3 | 침공 해시 오염 | 꼬리 append-only 조건부 폴드 + 무의뢰 바이트 불변 + 침공 골든 |
| R4 | EF CPU 초과 | Phase 0 은 **외삽**일 뿐 — 진짜 차단은 **PC 실측 게이트**. 초과 시 축소 순서 명기 |
| R5 | 모드 전환 조합 | 전환은 쌍 국소적 → 모드 쌍 전수 골든 |
| R6 | ~~루프 층 호출 누락~~ | `stepRun` 진입점 + 린트로 완화(구조적 봉인 아님 — R11) |
| R7 | `buildPveRunResult` 회수 시 PvE 전반에 리플레이 부활 | 호출부를 의뢰 경로 한 곳으로 제한 + 일반 PvE recorder 미가동 테스트 |
| R8 | `replayBudgetTicks` 가 사실상 제한시간 | PC 실측 후 par 대비 배수를 넉넉히 + 상한 근접 시 HUD 경고. ADR-0044 결과 절에 명시 |
| R9 | `fork()` 반환형 불일치 | `fork(...).getState()` 다리 + wire 미탑재·양측 재도출을 코드 주석과 EF 계약에 명문화 |
| R10 | `aux0`/`aux1` 승계의 밸런스 영향 | 6기체 전수 영향표(말로우는 승계가 **불리** — 근거의 반례). 해츨링 `aux0`↔`kills` 결합 명시. `.omc/plans/balance-queue.md` 등재 |
| R11 | **`stepRun` 봉인의 방어력이 린트·grep 수준** | rev3 의 "컴파일러가 전량 돈다"는 거짓이었다(소비처 113파일 595건, `tests/` 88파일, `scripts/` 는 tsconfig 밖). eslint `no-restricted-imports` + grep + **`tsconfig.scripts.json` 타입검사**. ⚠️ **이 리포에 CI 가 없다**(`.github/` 부재) — 게이트는 전부 **Verification Steps 의 수동 실행**이고 `.githooks` 편입을 검토한다 |
| R12 | 월드 참조 캐싱 — 타입으로 표현 불가 | A-4b 계약 + AC 2건 + **grep 게이트**(루프 앞 월드 바인딩 탐지) + branded type 검토 기록. 열거만으로는 완화가 아니다 |
| R13 | `tick` 리셋의 구간 곱셈 | 분류 원칙(안전망=런 단위 / 페이싱=무대 단위)에 따라 **정합으로 판정·수용**. 안전망류(`targetX`)는 승계로 분리. 밸런스 큐 등재 |
| R14 | **의뢰서 증발**(consume 후 런 미시작) | 4상태 + `mark_commission_active` 신호 + **cron 단독 회수**(클라 호출 금지, cron SQL 인라인) + **전이 시한**(D8 ①) + **`status='active'` 요구**(D8 ②) + AC 5건. ⚠️ rev6 의 "회수된 run_id 제출 거부"는 **항진이라 폐기**했다 — cron 은 매시 정각이라 판정 주체가 될 수 없다 ← rev6 재설계 / **rev7 재정정(D8)** |
| R15 | **리플레이 용량 무한 누적** | gzip + **cron 2건**(① `issued` 회수 ② `verified\|rejected` 48h 정리). 침공 복제만으로는 `issued` 가 영구 잔존한다(`20260726000100:126` 은 `verified_at is not null` 만 본다) ← rev6 정정 |
| **R17** | **확정 유니크를 부풀린 로드아웃으로 수확** | `consume_commission` 봉인 + EF 대조(`commission-loadout-mismatch`). **사후 편집만 닫는다 — 미러 위조는 열려 있다**(ADR-0028). ADR-0044 에 경계 명문화. 서버 권위 아이템 원장이 선행 요건 ← rev6 (Critic CRIT-2) |
| **R18** | **발령 자격이 클라 주장** | `settle_pve_run` 1회성 봉인 경로 안에서만 발령 + **시간당 시도 상한**(재고 캡과 다른 축). ADR-0026 PvE 신뢰 모델의 연장임을 자인 ← rev6 (Critic MAJ-1) |
| **R19** | **실패 런 제출 스팸의 EF·용량 비용** | 조기 거부 4종을 `verifyRun` **이전**에 배치 + 발령 빈도 상한이 제출 빈도 상한을 겸함 + PC 게이트에서 건수 상한 산출 ← rev6 (Critic Missing) |
| **R20** | **문서 주장이 코드와 어긋난 채 굳는다** | Principle 7. rev5 의 서버 축 주장 4건이 실제로 무너졌다(§변경 이력 rev6). 모든 사실 주장에 `파일:줄` 또는 "미확인" 표시 ← rev6 |
| **R21** | **확정 유니크가 의뢰 경로 밖에서 위조된다**(클라 `items` 직접 쓰기) | `commission_grants` 서버 권위 발급(D7 · ADR-0045) + **EF 6단계 소유 대조**. 테이블만 만들면 증거만 남는다 — 강제 지점이 방어의 실체다. 잔여: 일반 PvE 런에서의 사용은 못 막는다 ← rev7 (Critic 3차 CRIT-1) |
| **R22** | **문서가 폐기된 함수 본문을 인용한 채 설계가 굳는다** | Principle 9. rev6 의 `settle_pve_run` 인용 2건이 이미 재정의로 폐기된 본문이었다(§부록 A). 인용 전 `create or replace` 최종 정의 확인을 규율화 ← rev7 |
| R16 | **Phase B~F 의 검토 밀도가 A 의 1/10** | Critic 이 지목한 구조적 결함. PB0(payload 스키마)·PC 실측 게이트·pre-mortem 서버 축 3건으로 일부 메웠으나, **PB/PC 는 보안 검토를 별도로 받는다**(Verification Step 8) |

---

## Verification Steps

1. `pnpm test` — **`| tail` 로 파이프하지 않는다**(exit code 가 tail 것이 되어 거짓 그린)
2. `pnpm build` — tsc 포함. **테스트 추가 후 반드시 재실행**(node-shims 전례)
3. **`pnpm lint`** ← rev5 신설 — `eslint . --max-warnings 0`(`package.json:14`). `no-restricted-imports` 규칙이 실제로 도는지 확인. **이것이 R11 방어의 실행 배정이다**
4. **`pnpm exec tsc -p tsconfig.scripts.json --noEmit`** ← rev5 신설 — `scripts/**` 는 현재 `tsconfig.json` 의 `include` 밖이라 tsc 가 안 본다. 이게 없으면 `stepWorld` 관련 변경이 **Deno 검증 하네스만 런타임에 깨뜨린다**
5. **`scripts/deno-verify` 실행** ← rev5 신설 — Deno 가 `src/sim` 을 소스 그대로 import 하므로 tsc·vitest 그린과 무관하게 여기서만 드러나는 결함이 있다
6. 기준선 대조: 변경 전 커밋을 detached 워크트리에 체크아웃해 무의뢰 런 해시 바이트 대조
7. 진단력 게이트 실행 — 전수 대조 + 뮤테이션 각 항목이 실제로 실패하는지 확인 후 되돌린다
8. **보안 검토** ← rev5 신설 (Critic Missing #5) — 신규 RPC 4종 + 신규 EF 이므로 `security-reviewer` 패스를 받는다. 이 리포는 치팅 방어 레인에서 보안 3중 수정을 겪은 이력이 있다
9. 하네스 육안: 최장 계급 의뢰를 오토파일럿 완주, 구간마다 스크린샷 + `modeStateOf` + 스프라이트 id 캐시 덤프
10. **EF 실측**(PC 게이트): 최장 리플레이를 원격 EF 로 실호출해 ms 확보(개발기 외삽 금지)
11. 서버 거부 5종(조작·미제출·재제출·금지 장비·촉매 포함)을 원격 실호출로 확인

> ⚠️ **이 리포에는 CI 가 없다**(`.github/` 부재). 위 11단계는 전부 **머지 전 수동 실행**이며, `.githooks` 편입 가능한 항목(1·2·3)은 편입을 검토한다. rev4 본문의 "매 CI 마다"라는 표현은 사실이 아니었으므로 삭제했다.

---

## Expanded Test Plan (deliberate)

### Unit
- `stageOverride` 가 무대 필드만 덮고 빌드 필드를 건드리지 않는다
- **키 전수 대조**(`CARRY`/`RESET_ZERO`/`FRESH` ↔ `WorldState` + 플레이어 `Entity`)
- `carryAcrossSegment` 가 승계 전 필드를 옮기고 미승계 전 필드를 옮기지 않는다
- `createWorld({preDerived})` 가 로드아웃·촉매 굽기를 건너뛴다
- 의뢰 꼬리 폴드가 `commission === undefined` 일 때 미실행
- `fork('commission-seg-N')` 이 부모를 전진시키지 않고 `getState()` 가 안정적
- **A-3 3분기**: 중간 종료 / 마지막 완수 / **마지막 도주 = `gameOver`**
- `advance` 우선순위: `gameOver`/`victory` 가 `segmentDone` 을 이긴다
- `CommissionPayload` 스키마 검증(필수 필드·version)
- 계급 → 구간 수 매핑과 `replayBudgetTicks` 산출(상수 모듈 값 기준)

### Integration
- 2구간 의뢰 런: 스탯·loot·hp·`aux0`·`targetX`·`tainted` 승계 불변식
- **모드 쌍 전수 전환 골든** — 전환 직후 10틱 해시 배열 고정. 특히 스크롤 → 비스크롤 쌍
- **보급 습격 스폰 회귀**: 2구간 첫 3,000틱에 정확히 1기
- 무의뢰 PvE 해시 바이트 불변 · 침공 골든 18건
- 정예 소집령: 잡몹 0 · 젬 0 · `pendingLevelUp` 0회 · **직전 정예 생존 시에만 추가 투입**
- 제약 계약: 금지 장비·금지 파워업이 산출 config 에 미반영
- 의뢰 런에 `echoRuntime`/`encounterRuntime` 미생성
- **라이브 루프 결과 == `runReplay` 재실행 결과**
- **`settlement.ts` 게이트**: 의뢰 승리가 `recordPlanetClear` 를 부르지 않는다(`:177-178`)
- **사연 보상 별도 지급** ← rev7 (D11): `storyRewardCredits > 0` 인 의뢰 런에서 `grantCurrency(…, 'story')` 가 정확히 1회 호출되고, 그 호출을 지우면 **claim 은 소모됐는데 크레딧이 0** 인 상태를 테스트가 잡는다(뮤테이션 진단력)
- **`commission_grants` 대조** ← rev7 (D7): 발급 없이 의뢰 유니크를 실은 제출이 거부되고, 발급 후 같은 제출이 accept 된다(양방향)

### E2E
- 하네스 관통: 발령 → 수신소 → 수락 → 최장 계급 완주 → **단일 정산**(`settle_commission` 하나가 확정 보상 + 자원 축을 모두 지급, `settlePveRunCurrency` 미호출, **사연 보상만 `grantCurrency('story')` 별도 1회**) + **`commission_grants` 행 생성** 확인 ← rev6 / rev7(D11·D7·D12)
- 실패 경로: 중간 구간 격추 → 의뢰서 소멸 + 수거 loot 보존 + `active → rejected` 봉인
- **의뢰서 증발 경로**: `consume_commission` 후 `mark_commission_active` 없음 → 유예 후 cron 회수 → 원장 복구
- **회수 후 제출 거부**: 회수된 `run_id` 로 승리 리플레이를 제출해도 거부 ← rev6
- 원격 EF 관통: 정직 accept · 조작 reject · **촉매 포함 reject** · **로드아웃 봉인 불일치 reject** · 재제출 멱등
- TTL: 확정 48시간 뒤 `commission_runs` 리플레이 3컬럼 정리 확인 · `issued` 잔존 0 확인

### Observability
- EF 재실행 소요 ms 를 verdict 에 싣고 상한 근접 시 로그 경고
- 거부 사유별 카운터: `hash-stream-divergence` / `commission-payload-mismatch` / `commission-inputs-too-long` / `loadout-constraint-violation` / **`commission-catalyst-present`** / **`commission-loadout-mismatch`** / **`commission-run-not-active`**(rev7 D8) / **`commission-unauthorized-unique`**(rev7 D7)
- **`commission-unauthorized-unique` 는 0 이 기대값이다** — 0 이 아니면 위조 시도이거나 **의뢰 전용 유니크 id 집합이 클라·서버에서 갈렸다**(오거부). 둘을 구분하려면 발급 이력 유무를 함께 로그한다
- 발령률·**발령 시도 대비 발령률**(빈도 상한이 실제로 무는지)·수락률·완수율·**구간별 이탈률**·**cron ① 회수 건수**·**유니크 중복 지급률** 집계(밸런스 입력)
- **실패 런 제출 비율과 조기 거부 비율** — R19 비용 축의 실측 입력

---

## 미해결 — 착수 전 닫아야 하는 것 / 착수 중 닫는 것

**착수 전(PB0 에서)**: `CommissionPayload` 의 `rewards` 세부 필드 · `equipRules` 의 **형태**(개별 항목이 아니다 — §PB0 순환 해소)

**착수 중**: 구간당 틱 상한·계급별 구간 수(PC 실측 게이트) · 회수 유예 실값 · TTL 실값(PC 계약) · 제약 카탈로그 개별 항목(PD) · 계급별 발령 확률·보관 상한·**발령 빈도 상한**(밸런스) · `aux0`/`aux1` 승계의 밸런스 조정 · 의뢰 보스 3종 페이즈·패턴 저작 · 표적 도주 임계 실값 · 다구간 난이도 밴드(Phase G)

**미확인 — 착수 전 코드 대조가 필요한 것** ← rev6 신설 / rev7 갱신
- `grantBlueprintDrops`·`grantCatalystDrops`·`recordPveRunResult` 가 의뢰 런에서 `settle_commission` 지급과 이중이 되는가(A-8b) — **여전히 미확인**
- 자원 축에 행성 인기 배율(ADR-0038)을 적용할지 — 확정 보상 미적용은 확정, 합류분은 **여전히 미확정**(Phase B). 단 **런 입력의 스탬프 여부는 rev7 에서 확정**(D13 — 미스탬프)
- ~~침공 `invasions_select_participant` 정책이 `replay` 컬럼을 직접 노출하는지~~ → **rev7 에서 닫았다**: `20260717000000_m4_initial_schema.sql:359-363` 은 **컬럼 제한 없는 행 단위 select** 라 참여자가 직접 읽는다(§Phase B RLS)
- 무료 티어 EF 호출 수·DB 용량의 실제 여유(R19 — PC 게이트에서 산출) — **여전히 미확인**
- **← rev7 신설**: 현행 `settle_pve_run`(`20260727010000_planet_popularity.sql:325-337`)의 INSERT 가 **이미 드롭된 컬럼**(`pve_runs.replay`·`client_result` — `20260726000300:117-118`)을 참조한다. **원격 스키마의 실상태를 대조해야 D9 앵커를 확정할 수 있다**(§부록 A). 이 계획이 고칠 대상은 아니지만 **앵커가 그 위에 서므로 선행 확인이 필요하다**
- **← rev7 신설**: 현행 `settle_pve_run` 은 `catalyst_receipt` 도 `app.in_settle` 도 다루지 않는다 — 촉매 `resourceMult` 관통이 현재 살아 있는지 **미확인**. 의뢰 경로는 배율을 안 쓰므로 이 계획에 직접 영향은 없으나, D10 의 GUC 규약 서술이 전제하는 구조라 함께 확인한다
- **← rev7 신설**: 의뢰 런에서 촉매 **드랍**(주입이 아니라)을 허용할지. 스펙은 보상 축에 촉매를 넣었으나(`CONTEXT.md:209`) 지급 경로 표에서 "미확정"으로 남겼다

> 밸런스 항목의 등재처는 `.omc/plans/balance-queue.md` 로 **고정**한다. ⚠️ **이 파일은 현재 존재하지 않는다** — rev5 는 존재하지 않는 파일을 등재처로 "고정"해 등재 행위를 여전히 검증 불가능하게 뒀다. **P0 산출물 2 로 생성을 배정했다**(§Phase 0).

---

## 합의 이력

| 라운드 | 검토자 | 판정 | 주요 지적 |
|---|---|---|---|
| rev1 | Architect | REVISE | `Object.assign` stale 키 · `victory` 가드 도달 불가 · 타입 분할 불가 · CPU 역산 근거 · `waves.ts` 재사용 불가 · 조우 억제 누락 (8항) |
| rev2 | Architect | REVISE | 플레이어 `Entity` 누락 · `tick`/`supplyNextIndex` · 종료 플래그 우선순위 · dev throw 의 EF 사문화 · 호출 순서 계약 오류 (C1~C3·H1~H3·M1~M5·L1~L4) |
| rev3 | Architect | REVISE | `finalTick` 클램프 · `player.targetX` 부활 · `stepWorld` 소비처 113파일 · 월드 참조 캐싱 · `totalTicks` 파생 폴드 (C4·C5·H4·H5·M6·M7·M9·L5) |
| rev4 | Critic | REVISE | **마지막 구간 도주가 성공 판정(C-1)** · CI 부재인데 CI 를 근거로 삼음 · 스펙 3건 구현 미배정 · payload 스키마 부재 · pre-mortem 단일 문화 · PR 경계 없음 (C-1·M-1~M-9) |
| rev5 | Critic (2차) | REVISE | **rev5 가 새로 쓴 서버 축 주장 4건이 코드 대조에서 무너짐** — 유니크 제외 굴리기(서버에 원장 없음, CRIT-1) · 로드아웃 권위 미언급(CRIT-2) · 발령 자격 클라 주장(MAJ-1) · `restore_commission` 본인 호출 착취(MAJ-2) · cron "그대로 복제" 거짓(MAJ-3) · pending 수명 충돌(MAJ-4) · 이중 정산(MAJ-5) · Minor 5(줄 번호 · PR 표 불일치 · 밸런스 큐 부재 · `equipRules` 순환 · G↔PC 되돌림). 판정 요지: **"문제를 세는 밀도는 올랐고 답을 검증하는 밀도는 안 올랐다."** Phase A 는 재검증에서 전부 맞았다 |
| rev6 | Critic (3차) | REVISE | **인용 정확도는 100% 였다. 무너진 것은 인용이 아니라 결정이 딛는 구조를 한 홉 더 안 밟은 것이다** — 확정 유니크의 착지점이 클라 rw 미러(CRIT-1) · `mark_commission_active` 시간 경계 부재 + cron 매시 배치라 회수-기반 AC 가 항진(CRIT-2) · pending 행을 만드는 자가 `consume_catalysts` 뿐이라 발령 앵커가 촉매 런 한정(MAJ-1) · `settle_commission` 이 `grant_currency` 를 안 봐 미등록 source 가 `CAP_DEFAULT_*` 로 클램프(MAJ-2) · 사연 챕터 claim 소모 + 크레딧 증발(MAJ-3) · ADR-0044 용량 논증 과장(MAJ-4) · ADR-0028 선택 인용(MAJ-5) · "일반 전리품 축" 용어 불일치(MAJ-6) |
| **rev7** | — | **미검토** | 위 전부 반영 + ADR-0045 신설 + ADR-0044 2차 정정 + 스펙 줄번호 정정. **재검토를 받지 않았다** |

**합의 미도달.** rev7 은 Critic 3차의 CRITICAL 2 · MAJOR 6 · Minor/Missing 을 닫았으나 Architect·Critic 재검토를 거치지 않았다. 실행 승인 전에 최소 1회 재검토를 권한다.

**재검토 시 우선 볼 곳** — rev7 이 새로 쓴 것: §D7(ADR-0045 · `commission_grants` 와 EF 6단계) · §D8(전이 시한) · §D9(발령 앵커 재설계) · §D10(`grant_currency` 접점) · §A-8b 지급 경로 표. **rev7 은 처음으로 "한 홉 더" 규율(Principle 8·9)로 썼고, 그 규율이 실제로 잡아낸 것은 §부록 A 에 있다.** 여전히 **"미확인" 7건**(§미해결)이 대조되지 않았고, 그중 **2건은 D9 앵커가 그 위에 선다.**

---

## 변경 이력

- **rev7 (2026-07-31)** — Critic 3차 REVISE 반영. **rev6 의 잘못된 결정도 지우지 않고 정정 사실을 남겼다.**

  **rev6 이 틀렸던 것 — 무엇이 왜 틀렸는가**

  | # | rev6 의 결정 | 왜 틀렸나 (한 홉 더 밟은 결과) | rev7 |
  |---|---|---|---|
  | CRIT-1 | 확정 유니크를 `rewards.uniqueId` 로 payload 에 넣고 **EF 검증을 그 방어로 취급** | **지급 착지점이 클라 rw 미러다** — `items` 는 `for all`(`20260717000000:186-191`, `for all` 은 `:188`). 의뢰서 없이 직접 써 넣으면 되고 그 경로는 **EF 를 통과할 필요조차 없다**. `20260722020000:20-24` 가 근거로 든 "`pve_runs` 샘플링 사후 검증"은 **ADR-0026 이 폐기하고 `20260726000300` 이 철거**했다. ADR-0044 의 정당화 근거가 무너진다 | **D7 — ADR-0045 신설.** `commission_grants` 서버 권위 발급 + **EF 6단계 소유 대조**(강제 지점). 범위는 의뢰 확정 지급물 한정 |
  | CRIT-2 | `mark_commission_active` 는 `issued → active` 전이만 허용(**언제까지인지 미정**) + AC "회수된 `run_id` 로 제출하면 거부" | **시한이 없으면 "안 알리고 돌려보고 이기면 그때 신호+제출"이 그대로 산다.** 게다가 cron 은 **매시 정각**(`20260726000100:121-123`)이라 만료-회수 사이가 최대 1h 벌어지고, AC 는 **회수가 이미 일어난 경우만** 검사하는 **항진**이라 그 창을 못 본다 | **D8** — ①전이에 시한 ②`settle_commission`/EF 는 `status='active'`만 수락 ③**cron 은 정리일 뿐 판정 주체가 아니다**. AC 를 둘로 교체 |
  | MAJ-1 | 발령을 "`settle_pve_run` 의 **pending 1회성 봉인 경로 안에서만**" | **그 pending 행을 만드는 곳은 `consume_catalysts` 하나뿐**(`20260727000000:315-320`)이라 **촉매 런에만 존재**한다 → 의뢰서가 촉매 런에서만 나온다(스펙 위반). 게다가 인용한 UPSERT-by-runId 본문(`20260727000000:590-611`)은 **재정의로 폐기**됐고 현행(`20260727010000:263`)엔 그 경로가 **아예 없다** | **D9** — 앵커를 **정산 이력 행의 `id`** 로 옮기고 unique 제약. "촉매 패턴을 그대로 쓴다" 서술 **폐기** |
  | MAJ-2 | `settle_commission` 이 자원을 "지급한다"고만 서술 | **그 지급이 통과하는 관문(`grant_currency`)을 안 봤다.** 미등록 `source` 는 `CAP_DEFAULT_*`=**1000** 으로 떨어진다(`20260727000000:429-435`, 값 `:357` 계열) → 최종 지시 확정 보상이 **조용히 클램프**된다 | **D10** — `source='commission'` 분기 + 상한 명시 + **확정 보상 개연성 캡 미적용**(재실행 증거가 캡을 대체) + GUC 규약 명문화 |
  | MAJ-3 | D5 로 의뢰 런이 `settlePveRunCurrency` 를 안 타게 함 | **사연 챕터 claim 은 `settleRun` 이 소모하고**(`src/save/settlement.ts:264-265`) **크레딧 지급은 `settlePveRunCurrency` 안에서만** 일어난다(`src/net/index.ts:195-197`) → **claim 소모 + 크레딧 증발**. 사연 카운터가 승계 목록에 있어 **도달 가능** | **D11** — `grantCurrency(…, 'story')` 별도 호출 명시 + AC + Integration 1건 |
  | MAJ-4 | ADR-0044 §근거 "보관 상한이 재고를 묶으므로 예산 안" | **재고 캡 ≠ 빈도 캡**(pre-mortem ⑧ 이 이미 무효화). 실패 런도 전부 제출한다. 무료 티어 여유는 계획이 **"미확인"** 으로 남겼다 | ADR-0044 §근거 교체 — 빈도는 §D3 가 지고, **예산 적합은 가정이 아니라 PC 게이트** |
  | MAJ-5 | ADR-0044 §한 겹 방어 "ADR-0028 이 배제한 미봉책은 파워 클램프였다" | **ADR-0028 은 둘을 배제한다** — "**클라 rw 미러 대조는 무효이고**, …"(`0028:7`). 생략된 쪽이 봉인 대조의 **더 가까운 유사물**이다(봉인값도 미러 파생) | ADR-0044 §한 겹 방어 교체 — **시점 한정판임을 인정**하고 채택 근거를 ⓐ~ⓓ 로 재구성, **방어력 자체는 주장하지 않는다** |
  | MAJ-6 | A-8b "자원·킬·틱" ↔ AC "일반 전리품 축" | 이 리포에서 "전리품"은 `loot`/아이템이라 **아이템 해석이 D7 이전 구조에서는 구현 불가능**했다 | **D12** — **"자원 축(credits/minerals)"으로 통일** + §A-8b **지급 경로 표** 신설 |
  | Missing | `mark_commission_active` 호출 빈도 상한 · `commission_runs` RLS 계약 | — | 전자는 §Phase B RPC + AC, 후자는 §Phase B RLS 표에 `commission_grants` 행 추가 |
  | Minor | 스펙 `settlement.ts:175` 참조 | `:175-176` 은 주석. 실제는 `:177`(가드)·`:178`(호출) | **스펙 정정**(`.omc/specs/deep-interview-commission-system.md`) |
  | Minor | "침공은 `get_invasion_replay_gz` 로 허용" | **과소 서술.** `invasions_select_participant`(`20260717000000:359-363`)은 컬럼 제한 없는 행 단위 select 라 **참여자가 세 컬럼을 직접 읽는다** | 의뢰의 뷰 제한이 침공보다 **엄격한 신규 규율**임을 명시 |

  **그 밖에 신설**: Principle 8(한 홉 더)·9(최종 정의 확인) · pre-mortem ⑦b · §A-8b 지급 경로 표 · D13 3건(`restore_commission` 미노출 · `planetMult*` 미스탬프 · 지급 멱등) · R21·R22 · §부록 A · AC 15여 건 교체·추가

- **rev6 (2026-07-31)** — Critic 2차 REVISE 반영. **rev5 의 잘못된 주장은 지우지 않고 정정 사실을 남겼다**(이 리포는 "왜 그렇게 안 했는가"의 기록을 정본으로 다룬다).

  **rev5 가 틀렸던 것 — 무엇이 왜 틀렸는가**

  | # | rev5 의 주장 | 왜 틀렸나 | rev6 |
  |---|---|---|---|
  | CRIT-1 | `grant_commission` 이 "플레이어 보유 유니크를 **제외하고 굴린다**(서버가 원장을 보므로 가능)" | **서버는 그 원장을 갖고 있지 않다.** `ships`/`items` 는 클라 rw 미러이고 서버 권위는 `credits`/`minerals` 뿐(ADR-0028·ADR-0027). 게다가 미러를 보상 결정 입력으로 쓰면 **역방향 착취**(안 가졌다고 신고해 원하는 유니크 유도)가 열린다 | 발령 시점 고정 + **중복 지급 허용**. ADR-0039 는 *장착* 차단이지 *보유* 차단이 아니다(`0039:33`, `:57` "막되 빼앗지 않는다") |
  | CRIT-2 | EF 검증을 확정 유니크 지급의 충분한 방어로 취급(로드아웃 권위를 **한 번도 언급하지 않음**) | verify EF 는 `invasion3` 블록만 덮고 `config.loadout` 은 제출값 그대로 재실행한다(`verifyInvasionCore.ts:411-414`, `:390-391`). ADR-0028 과 `:39-50` 주석이 "부풀린 위조는 내적으로 일관돼 accept 된다"를 이미 확정 | pre-mortem ⑦ + ADR-0044 §"증명하는 것/못하는 것" 신설 + 봉인 대조(부분 방어, 한계 자인) |
  | MAJ-1 | 발령 자격 검증을 다루지 않음 | 발령은 **일반 PvE** 에서 일어나고 PvE 는 리플레이를 안 낸다(ADR-0026). `settle_pve_run` 은 클라 요약 jsonb 통짜를 받고(`20260726000200:269`) `victory` 를 **읽지도 않는다**(`:154-161`) | pre-mortem ⑧ — **자인** + 1회성 봉인 경로 + 시간당 시도 상한 |
  | MAJ-2 | `restore_commission` 을 "service_role + **본인 호출 허용**" | 본인이 부를 수 있으면 "런을 돌려보고 지면 복구"가 성립 — 의뢰서가 무한 재시도권이 된다 | **service_role 전용.** 회수는 cron 단독. 유예 < 런 최소 길이 + 회수된 `run_id` 제출 거부 |
  | MAJ-3 | 침공 TTL 마이그레이션을 "**그대로 복제**한다" | 침공 cron 은 `verified_at is not null` 만 본다(`20260726000100:126`, `:112` 주석이 명시). 복제만 하면 **`issued` 가 영구 잔존**해 pre-mortem ④ 를 못 잡는다 | **복제 1건 + 신규 1건** — ① `issued` 회수 ② `verified\|rejected` 48h 정리 |
  | MAJ-4 | pending 을 한 덩어리로 다뤄 회수 유예와 재제출 창이 충돌 | 회수해야 할 것(`issued`)과 재시도 창을 줘야 할 것(`active`)이 같은 상태였다 | **4상태 분화** + `mark_commission_active` 신호 |
  | MAJ-5 | "의뢰 런은 `settlePveRunCurrency` + `settle_commission` 을 **둘 다** 탄다" | 검증된 리플레이를 쥐고도 클라 주장 + 개연성 캡으로 지급하는 설계 낭비. 게다가 A-5 의 `finalTick` 이관이 그 캡(`:160-161`)을 N배로 연다 | **단일 정산**(A-8b) — EF `finalState` 에서 뽑아 `settle_commission` 이 전리품 축까지 지급 |
  | Minor | `settlement.ts:176` | `:176` 은 주석 줄. 실제는 `:177`(가드)·`:178`(호출) | 정정 |
  | Minor | 의존 그래프 `PA ─► PD` ↔ 표 `PD 선행 = PA·PC` | 표가 옳다(PD 가 PC 게이트 상수를 읽는다) | 그래프에 `PC ─► PD` 추가 |
  | Minor | 밸런스 큐 경로를 "고정" | **파일이 존재하지 않는다** — 등재가 여전히 검증 불가 | P0 산출물 2 로 **생성 배정** |
  | Minor | `equipRules: ...` 미정 + "PB0 착수 전 닫는다" | PB0 이 그 필드를 정하는 PR — 순환 | PB0 는 **형태**만, 개별 항목은 PD |
  | Minor | Phase G ↔ PC 상수 충돌 경로 없음 | — | **포함 관계**(PC 가 상한, G 가 그 안의 선택) 규칙 신설 |

  **rev5 의 `finalTick` 파급 기술 2건도 코드로 기각**: `main.ts:1510` 은 `finalTick` 이 아닌 별도 `w.tick/60` 표시 경로(고쳐야 하지만 성격이 다르다) · `replaySpectate.ts:170-171` 은 **침공 관전** 전용이라 범위 밖(삭제). 또 "프로필 저장 경로가 `finalTick` 을 탄다"는 가정은 **기각** — `settleRun` 인자에 런 길이 필드가 없다.

  **그 밖에 신설**: Principle 7(검증 밀도) · Phase B RLS 계약 · Phase C 실패 런 비용 축 · 오프라인 거동 · EF 게이트 순서 계약(조기 거부를 `verifyRun` 앞으로) · R17~R20 · AC 20여 건 교체·추가

- **rev5 (2026-07-31)** — Critic REVISE 반영:
  - **C-1** A-3 를 **3분기**로 수정 — 마지막 구간의 표적 도주가 `victory` 로 떨어지던 논리 오류(스펙 AC 의 정반대). 전용 AC 신설
  - **M-1** Verification Steps 에 `pnpm lint` · `tsconfig.scripts.json` 타입검사 · `deno-verify` 실행 배정. **이 리포에 CI 가 없다는 사실**(`.github/` 부재)을 명시하고 본문의 "매 CI 마다" 표현 삭제
  - **M-2** 스펙 3건에 구현 배정 — 최고 클리어 미갱신(A-8, `settlement.ts:176`) · 인기 배율 미적용(Phase B 명문화) · **촉매 차단을 서버로**(Phase C ②, 클라 UI 는 방어가 아니다)
  - **M-3** Option B 를 "기각"에서 "A′ 로 수렴"으로 재라벨 + **승계 기본값 대안**(블랙리스트)을 Viable Options 에 추가하고 기각 근거 명시
  - **M-4** R12 에 grep 게이트 + branded type 검토 기록 추가(열거는 완화가 아니다)
  - **M-6** Phase 0 을 "예비 추정"으로 재명명 + **PC 실측 차단 게이트** 신설 + 초과 시 축소 순서
  - **M-7** `commission_runs` gzip·48h TTL·pending 정리(침공 마이그레이션 복제)
  - **M-8** **PR 경계·의존 그래프·AC 배정** 신설(P0/PA/PB0/PB/PC/PD/PE/PF/PG)
  - **M-9** pre-mortem 을 서버·경제 축 3건으로 확장(의뢰서 증발 · 제출 실패 · 중복 유니크/ADR-0039)
  - **Missing** `CommissionPayload` 스키마(PB0 신설) · 성장축 제약의 config 탑재 · 표적 도주 조건 · 다구간 계측(Phase G) · 보안 검토 · 실패 런 제출 · 이중 정산 명시
  - **Minor** 필드 수 25 로 정정 · 3범주/3배열 정합 · 밸런스 큐 경로 고정 · R11 "또는" 해소 · ADR-0043 UI 요구 반영
  - R14·R15·R16 신설, AC 20여 건 추가
- rev4 — Architect 3차(C4·C5·H4·H5·M6·M7·M9·L5)
- rev3 — Architect 2차(C1~C3·H1~H3·M1~M5·L1~L4)
- rev2 — Architect 1차 8항(Option A′ 채택, `Object.assign` 폐기, `victory` 앞 트리거, 계승 기본, Phase 0, A-7, 뮤테이션 게이트)
- rev1 — Planner 초안

---

## 결정 로그 (D 라벨) ← rev7 신설

외부 문서(ADR-0044·ADR-0045)가 이 계획의 결정을 `§Dn` 으로 참조한다. 라벨 ↔ 본문 위치를 여기서 고정한다.

| 라벨 | 결정 | 본문 위치 | 도입 |
|---|---|---|---|
| D3 | 발령 자격 방어 2겹(경로 봉인 + 시도 빈도 상한) | pre-mortem ⑧ | rev6 |
| D4 | cron 2건(① `issued` 회수 ② 48h 정리) | §Phase B 압축·TTL·회수 | rev6 |
| D5 | 단일 정산(의뢰 런은 `settlePveRunCurrency` 미탑승) | §A-8b | rev6 |
| **D7** | 의뢰 확정 지급물 서버 권위(`commission_grants` + EF 대조) | pre-mortem ⑦b · §Phase B · §Phase C 6단계 · **ADR-0045** | **rev7** |
| **D8** | `mark_commission_active` 시간 경계 + `status='active'` 요구 + cron 은 판정 주체 아님 | pre-mortem ④ · §Phase B RPC · §Phase C 0단계 | **rev7** |
| **D9** | 발령 1회성 앵커를 정산 이력 행 `id` 로 | pre-mortem ⑧ 방어 ① | **rev7** |
| **D10** | `source='commission'` 분기 + 확정 보상 개연성 캡 미적용 + GUC 규약 | §A-8b | **rev7** |
| **D11** | 사연 챕터 보상 `grantCurrency(…, 'story')` 별도 호출 | §A-8b | **rev7** |
| **D12** | "자원 축(credits/minerals)" 용어 통일 + 지급 경로 표 | §A-8b | **rev7** |
| **D13** | `restore_commission` RPC 미노출 · `planetMult*` 미스탬프 · 지급 멱등 | §Phase B RPC · AC | **rev7** |

---

## 부록 A — "한 홉 더"가 실제로 잡아낸 것 ← rev7 신설

Principle 8·9 가 만들어진 근거다. **아래는 전부 rev6 이 인용한 좌표가 맞았는데도 결론이 틀렸던 사례**이며, 인용의 정확도가 아니라 **인용 범위**가 문제였다.

| # | rev6 이 본 것 | 안 본 것 | 결과 |
|---|---|---|---|
| 1 | `settle_pve_run` 이 pending 행을 1회성 봉인한다(`20260727000000:590-611`) | **그 pending 행을 누가 만드는가** → `consume_catalysts` 하나뿐(`:315-320`) | 의뢰서가 촉매 런에서만 나오는 설계 |
| 2 | 같은 함수 | **그 본문이 현재 정의인가** → `20260727010000_planet_popularity.sql:263` 이 재정의했고 pending 경로가 **없다** | 인용한 구조가 코드에 존재하지 않았다 |
| 3 | `settle_commission` 이 자원을 지급한다 | **어느 관문을 통과하는가** → `grant_currency`, 미등록 source 는 `CAP_DEFAULT_*`=1000 | 확정 보상이 조용히 클램프 |
| 4 | 침공 cron 이 `verified_at is not null` 만 본다(`20260726000100:126-127`) | **언제 도는가** → `'0 * * * *'` 매시 정각(`:121-123`) | 회수-기반 AC 가 최대 1h 창을 못 보는 항진 |
| 5 | `settleRun` 이 `storyRewardCredits` 를 반환한다 | **누가 실제로 지급하는가** → `settlePveRunCurrency` 안의 `grantCurrency(…,'story')` 하나뿐 | claim 소모 + 크레딧 증발 |
| 6 | `rewards.uniqueId` 를 payload 에 고정한다 | **그 유니크가 어디에 착지하는가** → 클라 rw `items`(`20260717000000:186-191`) | 의뢰서 없는 위조가 EF 를 우회 |
| 7 | 침공은 `get_invasion_replay_gz` 로 본인 읽기를 허용한다 | **RLS 가 이미 무엇을 허용하는가** → `invasions_select_participant` 는 컬럼 제한 없는 행 select(`:359-363`) | 의뢰 뷰 제한을 "침공과 동등"으로 오기술 |

**부수 발견(이 계획의 범위 밖 — 고치지 않았다)**: 현행 `settle_pve_run`(`20260727010000:325-337`)은 `pve_runs (profile_id, replay, client_result, …)` 로 INSERT 하는데 그 두 컬럼은 `20260726000300:117-118` 이 드롭했다. 또 같은 재정의가 `catalyst_receipt` 조회와 `set_config('app.in_settle', …)` 를 **둘 다 잃어서**, 촉매 `resourceMult` 관통이 살아 있는지 불명이다(`grant_currency:418-420` 이 그 플래그를 요구한다). **원격 스키마 실상태 대조가 필요하며, D9 앵커가 이 함수 위에 선다**(§미해결).
