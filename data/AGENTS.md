<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# data — 콘텐츠 카탈로그

## 목적

게임 콘텐츠의 **데이터 정의**. sim 은 규칙만 갖고 수치·구성은 여기서 읽는다. 전부 TypeScript
상수 테이블이라 타입이 잠기고 트리셰이킹이 된다.

> ⚠️ 이 디렉터리는 `src/` 밖이지만 **번들 그래프 안**이다. 특히 `enemies.ts` 는 침공 편대가
> 참조하므로 PvE 전용 파일이 아니다 — 고치면 Edge Function 재배포 여부를 따져야 한다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `enemies.ts` | 적 로스터 — 행성당 **역할 슬롯 4종**(돌격·사수·특수·지원)을 채운다. 침공 편대도 참조 |
| `waves.ts` | 웨이브 예산표 + 카드 추첨 풀 |
| `boss.ts` | M1 카르곤 보스(용암 요새 전차) |
| `affixes.ts` | 어픽스 풀 24종 |
| `uniques.ts` | 유니크 5점 + 레지스트리 등록 |
| `skills.ts` | 스킬트리 데이터(3계열 · 사슬 · 캡스톤) |
| `economy.ts` | 메타 재화 소비 공식 — 정련·리스펙·창고 확장 |
| `encounters.ts` | 조우 카탈로그·상수(ADR-0033) |
| `dailyReward.ts` · `dailyRewardSelection.ts` | 일일 보상 순수 산식(연속 접속·가치 예산·상한) / 후보 생산·낙찰(ADR-0048) |
| `coreModules.ts` | 코어 모듈 카탈로그(구 방어 카드) |
| `defenseUnits.ts` | 방어체 인벤토리 · 방어체 어픽스 엔진 · 강화 3축 |
| `guardian.ts` · `lineage.ts` | 수호 기체 프리셋·스냅샷 / 계보 트리 |
| `commissionBosses.ts` | 의뢰 보스 **카탈로그 단일 정본** |
| `planets.ts` | 성계 지도 표시 메타 |
| `seedBases.ts` | NPC 시드 기지 20개(배치전) |
| `cosmetics.ts` · `stickers.ts` | 도감 코스메틱 / 도발 스티커 12종 |
| `inputBits.ts` | 액티브 발동 입력 비트 — `InputFrame.special` 의 leaf 정의 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `planets/` | 행성 6종 로스터 + 특산 설계도 (`planets/AGENTS.md`) |
| `ships/` | 기체 타입 7종 + 액티브 스킬 (`ships/AGENTS.md`) |
| `bosses/` | 행성 보스 6 + 의뢰 보스 3 (`bosses/AGENTS.md`) |
| `invasion/` | 침공 3레이어 카탈로그(편대·설비·기물·맵 템플릿) (`invasion/AGENTS.md`) |
| `lore/` | 서사 데이터 정본(`index.ts`) + 스키마(`types.ts`) — 오스카 문명 세계관·기체 사연·인트로 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **수치를 여기서 튜닝하지 마라.** 밸런스는 출시 직전 일괄 조정이 정책이다(경제·적·전리품 축만
  2026-07-27 에 착지). 지금 만지면 계측 기준선이 흔들린다.
- **콘텐츠를 추가할 때는 레지스트리(`index.ts`)에만 등록**한다 — 밸런스 하네스의 축이 카탈로그에서
  파생되므로 자동으로 측정 대상이 된다.
- **카드 풀 길이를 바꾸면 그 행성 런 전체가 재추첨된다**(골든 2종 + 증인 5파일이 함께 빨개진다).
- 표시 이름은 여기 두지 말고 `src/ui/*Labels.ts` / `src/i18n/` 으로 보낸다.

### 테스트 요구사항

- 데이터 무결성 테스트(`tests/*Catalog*.test.ts`·`tests/*AssetPresence.test.ts`)는 파일시스템·
  카탈로그를 훑으므로 **`--changed` 가 놓친다.** 데이터를 건드렸으면 직접 지정해 돌린다.
- 수치를 바꿨으면 `pnpm test:sim`(골든·계측 레인)도 돌린다.

### 공통 패턴

- `as const` 상수 테이블 + `types.ts` 스키마 + `index.ts` 레지스트리 3종 세트.

## 의존성

### 내부

`src/sim/**`·`src/items/**`·`src/ui/**` 가 소비한다. `supabase/functions/**` 도 sim 을 통해 간접 번들.

### 외부

없음.

<!-- MANUAL: -->
