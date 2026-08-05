<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# data/planets — 행성 로스터

## 목적

행성별 **콘텐츠 묶음** — 잡몹 4종(역할 슬롯), 보스, 지형·환경 테마 배정, 행성 모드, 드랍 테이블,
특산 자원. 행성은 점령되지 않는 재침략 가능한 파밍 스팟이고, **행성 모드는 다른 행성으로 이식되지
않는다**(행성 귀속 원칙, ADR-0021).

## 주요 파일

| 파일 | 설명 |
|---|---|
| `index.ts` | **행성 레지스트리** — 데이터 주도 행성 메타. 새 행성은 여기에만 등록 |
| `berdan.ts` | 베르단(산성 습지) — index 1 |
| `niflheim.ts` | 니플헤임(빙원) — index 2 |
| `arke.ts` | 아르케(유적) — index 3 |
| `toxar.ts` | 톡사르(오염 늪) — index 4 |
| `kras.ts` | 크라스(파괴 폐허) — index 5 |
| `blueprints.ts` | 행성 특산 설계도 분배 — **방어체 획득 경로의 정본** |

카르곤(화산, index 0)은 M1 원형이라 로스터가 이 디렉터리가 아니라 `data/enemies.ts`·`data/boss.ts`
에 있다.

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- 행성 하나를 추가하려면 **넷이 함께 움직인다**: 여기 로스터 · `data/bosses/` 보스 ·
  `src/render/env/themes/<행성>/` 환경 테마 · `src/sim/modes/` 모드 배정(기존 모드 재사용 가능).
- **품질(rarity)은 전 행성 동일**이 계약이다(ADR-0022). 행성이 바꾸는 것은 수량·특산·환경이다.
- 행성 인기 배율(ADR-0038)이 걸리는 축은 수량·XP·자원 셋뿐 — 품질·보스 확정 드랍·특산 설계도·
  특산 촉매는 배율 밖이다.
- 표시 로스터("이 행성에서 무엇이 나오는가")는 `src/ui/enemyLabels.ts` 가 정본이다.

### 테스트 요구사항

`tests/berdan.test.ts` 등 행성별 테스트 + `tests/planetTierCompletion.test.ts`(**sim 레인**).
난이도 델타는 60시드 오토파일럿 스캔으로 잰다.

### 공통 패턴

- 역할 슬롯 4칸을 반드시 채운다. 슬롯 안의 패턴은 행성별로 완전히 고유하게 저작한다.

## 의존성

### 내부

`data/enemies.ts`(스키마) · `data/bosses/**` · `src/sim/planetMode.ts` · `src/render/env/themes/**`

### 외부

없음.

<!-- MANUAL: -->
