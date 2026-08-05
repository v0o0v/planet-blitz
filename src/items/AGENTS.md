<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# items — 아이템·스킬 파생

## 목적

전리품과 빌드가 **스탯이 되는 자리**. sim 밖에 있지만 **결정론 규율을 손으로 지킨다** —
서버 Edge Function 이 같은 입력으로 같은 아이템을 재도출해 대조하기 때문이다(ADR-0005).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `types.ts` | 아이템 데이터 모델 — 슬롯 7종(8칸)·4등급·`RARITY_CODE` |
| `roll.ts` | **결정론 아이템 롤러.** `rollItem(dropSeed, rarity, source)` 는 순수 — 같은 입력 → 바이트 동일 아이템 |
| `loadout.ts` | 장착 → 파생 스탯 파이프라인 |
| `skills.ts` | 스킬 투자 → 파생 스탯 파이프라인 |
| `activeSkills.ts` | 액티브 스킬 **장착 규칙**(해금 게이트·최대 2개, ADR-0041) |
| `requiredLevel.ts` | 요구 레벨 파생 — `min(내재 파워, stageLevelCap(드랍 단계))`(ADR-0030). 서버 재도출 가능 |
| `uniqueEquip.ts` | 같은 유니크 중복 장착 차단 술어(ADR-0039) |
| `uniques.ts` | 유니크 효과 레지스트리 |
| `starterKit.ts` | 기본 장비 — 신규 조종사와 **세대 교체 직후 기체**가 맨몸으로 출격하지 않게 한다 |
| `refiningChain.ts` | 정련 공정 상태기계(ADR-0040, push-your-luck) |
| `rollDefenseUnit.ts` | 결정론 방어체 롤러 |
| `commissionGrant.ts` | 의뢰 확정 지급물 → 실물 `Item` 변환기 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **`Math.random`·`Date.now` 금지.** ESLint 가 여기까지는 안 잡으니 손으로 지킨다 — 어기면
  서버 재도출이 갈려 제출이 거부된다.
- 롤 순서(슬롯 → 무기 타입 → 어픽스 개수 → 어픽스 → 값)를 바꾸면 **기존 시드의 결과가 전부 달라진다**.
- `defaultProfile()` 은 제품 기본값이 아니라 **24개 테스트의 맨몸 기준선 픽스처**다 — 기본 장비를
  거기에 넣지 마라.
- 요구 레벨은 **장비 파워 축에만 걸리는 직교 게이트**다. 콘텐츠 접근(침략 단계 개방)을 잠그지 않는다.

### 테스트 요구사항

`tests/items.test.ts` · `loadout.test.ts` · `requiredLevel.test.ts` · `refiningChain.test.ts` ·
`starterKit.test.ts` · `uniqueEquip*.test.ts`. 서버 parity 는 `scripts/deno-verify/` 가 본다.

### 공통 패턴

- 전부 순수 함수 + 시드 RNG(`src/sim/rng.ts` 를 빌려 쓴다).
- 카탈로그 데이터는 `data/affixes.ts`·`data/uniques.ts`·`data/skills.ts` 에서 읽는다.

## 의존성

### 내부

`src/sim/rng.ts` · `data/affixes.ts` · `data/uniques.ts` · `data/skills.ts` · `data/ships/**`

### 외부

없음.

<!-- MANUAL: -->
