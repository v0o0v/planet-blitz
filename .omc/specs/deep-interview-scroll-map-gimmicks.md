# Deep Interview Spec: 무한 스크롤 맵 + 개체 2배 스케일 + 맵 기믹

## Metadata
- Interview ID: di-scroll-map-size
- Rounds: 8 (+ Round 0 토폴로지)
- Final Ambiguity Score: 17%
- Type: brownfield (M1 완성 코드 기반)
- Generated: 2026-07-15
- Threshold: 0.2 / Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.85 | 0.25 | 0.213 |
| Success Criteria | 0.75 | 0.25 | 0.188 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.835** |
| **Ambiguity** | | | **0.165** |

## Topology
| Component | Status | Description | Coverage |
|---|---|---|---|
| 개체 사이즈 확대 | active | 기체·몹·보스 실스케일(히트박스 포함) 약 2배 | 배율·재튜닝 범위 확정 |
| 스크롤 맵 | active | 무한 맵 + 카메라 추적 (뱀서식), 런 구조는 유지 | 월드 형태·런 구조 관계 확정 |
| 맵 기믹 | active | 벽/엄폐물·지형 해저드·파괴물+보상·이벤트 오브젝트 4종 전부 첫 버전 필수 | 종류·규칙·효과 확정 |

## Goal
M1의 고정 1920×1080 아레나를 **무한 스크롤 월드**로 바꾼다. 카메라는 플레이어를 따라가고(뱀파이어 서바이벌식), 기존 "6구간 웨이브 → 보스 → 정산" 런 구조는 그대로 유지한다(적은 플레이어 주변 화면 밖 스폰, 보스도 플레이어 근처 등장). 모든 개체의 실스케일(히트박스 포함)을 **약 2배**로 키우고(기체 48→~96px), 맵 곳곳에 **기믹 4종**(벽/엄폐물, 지형 해저드, 파괴 가능 오브젝트+보상, 상호작용 이벤트 오브젝트)을 시드 결정론적으로 배치한다.

## Constraints
- **결정론 유지 (ADR-0005, 절대 조건)**: 청크/기믹 절차 배치는 시드 RNG 스트림(`rng.fork`)으로, 좌표 무한 증가에 따른 float 정밀도·해시 안정성 검토 포함. 결정론 테스트(동일 시드+입력 2회 해시 일치)가 계속 CI 게이트.
- **런 구조 불변**: 6구간 타이머 웨이브→보스→정산, 젬/파워업/보급선 시스템 유지. 이동은 순수 전술·탐험 자유도.
- **적 스폰**: 플레이어 주변 화면 밖 링에서 스폰(웨이브 예산표 유지). 보급선은 플레이어 기준 상대 경로 횡단.
- **벽/엄폐물**: 이동 차단 + **양측 탄 모두 차단** + 플레이어 자동 조준은 **LOS(시야) 판정** — 벽 뒤 적은 조준 대상에서 제외. 적 이동 AI도 벽에 막힘(최소: 충돌 슬라이드, 경로탐색은 비범위).
- **개체 2배 스케일**: sim radius 기준 2배(히트박스 포함). 탄막 밀도·웨이브 예산·이동/탄속 등 밸런스 재튜닝 필수. 에셋은 128px 재생성 권장(64px 업스케일 폴백 허용).
- **성능**: 탄 2,000발 60fps 벤치 기준 유지. 무한 맵 배경은 청크 타일링, 기믹은 활성 반경 밖 컬링.
- **탄막 가독성 규칙 유지** (적탄 화이트 코어+아웃라인).

## Non-Goals
- 런 구조의 뱀서화(시간 생존형 재설계) — 명시적으로 거부됨
- 적 경로탐색(A* 등) 고도화 — 벽 충돌 슬라이드까지만
- 미니맵·월드맵 UI (후속 검토)
- M2 파밍 시스템과의 통합(드랍 테이블 등)은 이 작업 비범위

## Acceptance Criteria
- [ ] 플레이어가 어느 방향으로든 경계 없이 이동, 카메라 추적, 배경 청크 심리스 스크롤
- [ ] 동일 시드+입력로그 2회 실행 시 틱별 해시 100% 일치 (기믹 배치·LOS 포함)
- [ ] 기체 표시 ~96px(히트박스 radius 2배), 적·보스 동일 배율 — 벤치 60fps 유지
- [ ] 벽: 플레이어·적 이동 차단, 양측 탄 차단, 벽 뒤 적은 자동 조준에서 제외됨을 로그/테스트로 확인
- [ ] 지형 해저드 1종+ 배치, 밟으면 피해
- [ ] 파괴 가능 오브젝트: 부수면 젬/자원 드랍
- [ ] 이벤트 오브젝트 3종 가동: 자기장 발생기(젬 자석 범위 대폭 증가 버프), 광역 폭발 장치(주변 적 피해+적탄 소거), 임시 포탑(일정 시간 자동 사격)
- [ ] 6구간 웨이브→보스→정산 런이 무한 맵에서 크래시 없이 완주 가능 (e2e 테스트)
- [ ] 기존 테스트 스위트(54개) 전부 통과 유지 (수정 필요 시 의미 보존 갱신)

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|---|---|---|
| 무한 맵 = 뱀서식 구조 전환? | Contrarian R4 | 아니오 — 런 구조 유지, 이동만 자유 |
| "커졌으면" = 카메라 줌? | R3 | 아니오 — 실스케일(히트박스 포함) 2배 |
| 벽은 연출용 장애물? | R5 | 아니오 — 양측 탄 차단 + LOS 조준까지 포함한 전술 요소 |
| 기믹은 일부만 우선? | R7 | 아니오 — 4종 전부 첫 플레이어블 필수 |

## Technical Context (brownfield)
- 현재 `ARENA_WIDTH/HEIGHT=1920/1080` 고정, `world.ts`에서 위치 클램프 — 제거/치환 대상
- 렌더 `entityRenderer.ts` `ART_SCALE=1.5`, 히트박스 연동 표시(`radius×2×1.5`) — radius 2배 시 자동 반영
- 웨이브 스폰은 아레나 가장자리 절대좌표 — 플레이어 상대 링 스폰으로 치환
- 박격포 장판·용암 라인은 절대좌표 해저드 — 이미 hazard kind 존재, 기믹 해저드와 통합 가능
- `SpatialHash`는 아레나 크기 고정 그리드 — 무한 좌표 대응(월드 오프셋 또는 해시맵 버킷) 필요
- 카메라: 현재 레터박스 고정 뷰 — 스냅샷 보간에 카메라 오프셋 추가
- float 정밀도: 좌표가 무한히 커지면 f64 정밀도 저하 → 원점 리베이스 또는 도달 현실 범위 검토(5~8분 런이라 실제 이동 거리 유한)
- 에셋: PixelLab 캐시 워크플로 재사용, 기체·적 128px 재생성 권장

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|---|---|---|---|
| InfiniteWorld | core domain | 청크 시드, 원점 | Chunk 다수 보유 |
| Camera | supporting | 오프셋, 뷰포트 | Player 추적 |
| Chunk | core domain | 좌표, 배경 타일, 기믹 배치 | InfiniteWorld 소속, Gimmick 스폰 |
| Player(기체) | core domain | radius(2배), LOS 조준 | Wall에 시야 차단됨 |
| Enemy(몹) | core domain | radius(2배), 상대 스폰 | Wall에 이동/탄 차단 |
| Wall(벽/엄폐물) | core domain | 충돌체, 탄 차단(양측) | LOS 판정 대상 |
| Hazard(지형) | supporting | 피해, 범위 | Chunk 배치 |
| Destructible(파괴물) | supporting | HP, 보상 드랍 | 젬/자원 스폰 |
| MagnetEmitter(자기장) | supporting | 버프 지속시간, 자석 반경 배율 | Player 버프 |
| BombDevice(폭발 장치) | supporting | 피해 반경, 탄 소거 | Enemy/EnemyBullet |
| TurretPickup(임시 포탑) | supporting | 지속시간, 발사 스탯 | 자동 사격 |
| Run(런 구조) | core domain | 6구간, 보스, 정산 | 불변 유지 |

## Ontology Convergence
| Round | Entities | New | Changed | Stable | Stability |
|---|---|---|---|---|---|
| 1 | 6 | 6 | - | - | N/A |
| 2 | 9 | 3 | 1 | 5 | 67% |
| 3~7 | 9 | 0 | 0 | 9 | 100% |
| 8 | 12 | 3 (이벤트 3종 구체화) | 0 | 9 | 100%* |

*R8 신규 3종은 기존 EventObject의 구체화 — 개념 분열 아님.

## Interview Transcript
<details>
<summary>Full Q&A (8 rounds)</summary>

- **R0 토폴로지**: 3 컴포넌트(사이즈·스크롤 맵·기믹) → "3개 다 맞음"
- **R1 월드 구조**: 유한/무한/전진형? → **무한 맵 (뱀서 그대로)** (모호도 66%)
- **R2 기믹 정체**: → **벽(이동+탄 차단 엄폐), 지형 해저드, 파괴물+보상, 이벤트 오브젝트 전부** (61%)
- **R3 확대 방식**: 줌 vs 실스케일? → **개체 스케일 자체 확대(히트박스 포함)** (55%)
- **R4 [Contrarian] 런 구조**: → **런 구조 유지, 이동만 자유** (50%)
- **R5 벽 탄 차단**: → **양측 탄 모두 차단 + LOS 조준** (45%)
- **R6 [Simplifier] 배율**: → **약 2배 (기체 ~96px)** (43%)
- **R7 최소 범위**: → **기믹 4종 전부 첫 버전 필수** (23%)
- **R8 이벤트 효과**: → **자기장·광역 폭발·임시 포탑 3종 + 추가는 설계 위임** (17%)
</details>
