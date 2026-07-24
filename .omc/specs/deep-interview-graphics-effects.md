# Deep Interview Spec: Planet Blitz 그래픽 이펙트 풍성화 + 셰이더

## Metadata
- Interview ID: pb-gfx-fx-2026-07-24
- Rounds: 8 (Round 0 topology + 8 scoring rounds)
- Final Ambiguity Score: 16%
- Type: brownfield (기존 Pixi v8 렌더러 확장)
- Generated: 2026-07-24
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- 선행 결정: [ADR-0031](../../docs/adr/0031-graphics-effects-disciplined-hybrid-glow.md) (규율 있는 하이브리드 글로우) · [CONTEXT.md](../../CONTEXT.md) 용어 "발광체"

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.82 | 0.35 | 0.287 |
| Constraint Clarity | 0.82 | 0.25 | 0.205 |
| Success Criteria | 0.85 | 0.25 | 0.213 |
| Context Clarity | 0.88 | 0.15 | 0.132 |
| **Total Clarity** | | | **0.837** |
| **Ambiguity** | | | **0.163** |

## Topology
5개 최상위 컴포넌트 전부 active(보류 0). Contrarian(R4)에서 단계화 기각 — 한 패스에 전부 확정.

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| C1 렌더 인프라 & 품질/접근성 | active | 발광 레이어·품질 티어·감소 토글·render-only 이벤트 채널 | R1(티어)·R2(이벤트 채널)·R3(WebGL)·R8(검증)로 커버 |
| C2 전투 핵심 피드백 3종 | active | 화면 흔들림·히트 플래시·파티클 폭발 | R5(흔들림 모델)로 커버, 플래시·파티클 표준값 |
| C3 이벤트 셰이더 3종 | active | 히트 시머·충격파 링·사망 디졸브 (+블룸) | R3(조달·WebGL)·R8(검증)로 커버 |
| C4 부가 전투 연출 | active | 머즐·트레일·그레이징·데미지 숫자·수집·레벨업 | R2(데미지 숫자)·R7(트레일)로 커버 |
| C5 메타 UI 연출 | active | 촉각 피드백·화면 전환·보상 세리머니 | R6(단순화)로 커버 |

## Goal
Planet Blitz의 전투 화면(SF 픽셀아트)과 메타 화면(카툰나무풍) 양쪽에 이펙트를 풍성하게 더하되, **게임플레이 가독 레이어는 어떤 풀스크린 필터도 걸지 않는 규율 있는 하이브리드 글로우**로 구현한다. 발광·블룸은 발광체(저빈도 고임팩트체)에만, 셰이더는 국소·이벤트성에만 걸고, 모든 이펙트는 render-only(결정론 불변)로 둔다. 품질은 3티어 자동 적응 + 수동 오버라이드로 스케일하고, 모션·발광 감소 접근성 토글을 별도로 제공한다.

## 구현 접근: 프로토타입 선택 게이트 (사용자 지정, 2026-07-24)
시각적으로 취향이 갈리는 이펙트는 **대량 배선 전에 2~3개 라이브 변형을 만들어 보여주고 사용자가 고른다.** 하네스 또는 독립 데모 갤러리(Vite dev + Pixi)에서 변형을 나란히 렌더하고, 사용자가 선택한 변형만 확정해 본 구현·배선으로 진행한다. 이는 대량 구현에 앞서는 **비주얼 스파이크** 단계다(오염 런·본 세이브 무관, render-only).

- **변형 대상(취향 결정)**: 파티클 폭발 스타일(파편 형태·색·수·확산), 글로우/블룸 룩(세기·반경·색온도), 사망 디졸브 패턴(디더 방식·방향), 충격파 링(굵기·왜곡 강도·속도), 메타 화면 전환(페이드/슬라이드/와이프), 보상 세리머니(레이아웃·모션).
- **변형 불필요(기계적 확정)**: 품질 티어 시스템, render-only 이벤트 채널, 데미지 숫자 표시 규칙, 감소 토글, WebGL 고정 — 설계가 이미 확정이라 변형 없이 구현.
- **게이트 산출물**: 각 변형군을 브라우저에서 즉시 비교 가능한 데모 갤러리 + 사용자 선택 기록 → 선택분만 프로덕션 코드로 승격.

## Constraints
- **결정론(ADR-0005)**: 모든 이펙트 render-only. `hashWorld`/`hashEntity` 골든 바이트 불변. render-only 스냅샷 필드는 해시에서 제외(`visionRadius`/`safeRadius` 선례).
- **탄막 가독성(GDD §10)**: 탄은 흰 코어 + 유색 아웃라인, 색=거동 유지. **탄은 발광체가 아니다** — 동적 블룸 금지(정적 헤일로를 텍스처에 굽는 것만 허용).
- **시각 레지스터 3종 경계**: 전투=SF 픽셀아트, 메타=카툰나무풍. 메타 연출은 전투 SF 글로우를 빌려오지 않는다.
- **픽셀 크리스프**: 정수 배율·nearest·antialias off 유지. 항상 켜진 풀스크린 포스트(크로매틱·CRT·비네트) 금지.
- **저사양 웹(CrazyGames)**: 수천 발 탄 + 수백 마리 적. Low 티어는 저사양 바닥을 보장.
- **렌더러 WebGL 고정**: `preference:'webgl'` — 셰이더 GLSL 단일 언어, 저사양 보편 호환.
- **밸런스 수치는 출시 직전 일괄 튜닝**(defer-balance-tuning): 발광 세기·헤일로 반경·블룸 threshold·흔들림 진폭·FPS 강등 임계·트라우마 감쇠 계수 등.

## Non-Goals
- 풀스크린 포스트프로세싱(크로매틱 애버레이션·CRT/스캔라인·비네트) — 기각.
- 탄(적탄·아군탄)의 동적 블룸/발광 — 배제.
- 플레이어 아웃고잉 크리티컬 데미지 숫자 — 크리티컬 시스템 부재로 성립 안 함(데미지 숫자는 보스·엘리트만).
- 잡몹 처치·플레이어 발사 시 화면 흔들림 — 멀미·상시성으로 배제.
- 조밀·빠른 잡몹탄 트레일 — 성능·번짐으로 배제.
- 기지 맵 앰비언트(건물 5종 애니메이션·배경 파티클) — 아트 비용상 이번 패스 보류(GDD 계획으로 잔존).
- hitstop(sim 프리즈) — 결정론 고정 sim·리플레이와 충돌하므로 도입 안 함.

## Acceptance Criteria
- [ ] **[게이트]** 프로토타입 선택 게이트: 취향 대상(폭발·글로우·디졸브·충격파·전환·세리머니) 각 2~3개 라이브 변형을 데모 갤러리로 제시 → 사용자 선택 → 선택분만 프로덕션 승격. 대량 배선은 선택 확정 후 시작.
- [ ] **[C1]** 품질 3티어(Low/Med/High) 구현. Low=발광·흔들림·블룸 없음+파티클 최소, Med=헤일로 발광+흔들림+파티클 정상, High=Med+블룸 필터+이벤트 셰이더 풀.
- [ ] **[C1]** FPS 롤링 평균 감시로 자동 강등(이력현상으로 진동 방지). 설정 수동 오버라이드가 자동을 잠근다.
- [ ] **[C1]** 모션·발광 감소 접근성 토글이 티어와 직교하게 흔들림·번쩍임·블룸을 끈다.
- [ ] **[C1]** 설정 패널(DOM·Pixi 양판)에 품질 오버라이드 + 감소 토글 추가.
- [ ] **[C1]** render-only 피격 이벤트 채널: 보스·엘리트 피격만 스냅샷에 실림(피해량·위치·대상종류), 해시 제외. 골든 해시 불변 테스트 통과.
- [ ] **[C1]** 사망·충격파·디졸브는 기존 스프라이트 소멸 추론([entityRenderer.ts:508]) 재사용 — 신규 sim 이벤트 최소화.
- [ ] **[C1]** 렌더러 `preference:'webgl'` 고정([app.ts]).
- [ ] **[C2]** 화면 흔들림: 트라우마 모델(shake=trauma²·감쇠). 트리거=플레이어 피격(중)·보스/엘리트 처치(강)·대형 폭발(중)만.
- [ ] **[C2]** 히트 플래시: 피격 대상 2~3프레임 화이트 틴트(전 적 kind 확장, 기존 보스 flash 일반화).
- [ ] **[C2]** 파티클 폭발: 기존 단일 사망 스프라이트 → 파편 파티클 버스트 + 가산 플래시.
- [ ] **[C3]** 블룸=pixi-filters(AdvancedBloomFilter, tree-shaken), High 티어 발광 렌더타깃에만 1패스.
- [ ] **[C3]** 히트 시머(용암 지대·보스 과열 창 국소 변위)·충격파 링(보스 처치·대형 폭발 짧은 원형 왜곡)·사망 디졸브(디더 알파) = 핸드 GLSL 필터.
- [ ] **[C4]** 데미지 숫자: 보스·엘리트 피격만 떠오르는 텍스트 + 설정 토글.
- [ ] **[C4]** 탄 트레일: 플레이어 발사체 + 큰/느린 적탄(유도·곡사)만 짧은 가산 스트릭.
- [ ] **[C4]** 그레이징 스파크: render-only 근접 회피 감지 → 스파크(보상 없음, 용어집 정합).
- [ ] **[C4]** 젬/전리품 수집 팝 + 레벨업 링 쇼크웨이브.
- [ ] **[C4]** 머즐 플래시: 발사 순간 총구 섬광.
- [ ] **[C5]** 하나의 재사용 전환 프리미티브(빠른 페이드/슬라이드)를 전 메타 화면 swap에 균일 적용.
- [ ] **[C5]** 신규 보상 세리머니(코인 카운트업·전리품 등급 공개), 기존 정산 흐름([resultOverlay.ts]) 통합.
- [ ] **[C5]** 촉각 피드백: 버튼 눌림 스쿼시·호버 광택·카드 집기 반응(카툰나무풍 레지스터 유지).
- [ ] **[검증]** 4중 게이트 전부 통과: ①결정론 골든 해시 불변 ②이펙트 로직 순수함수 유닛(트라우마 감쇠·티어 선택·디졸브 진행·크로스페이드 등) ③하네스 정규경로 배선 검증(스크린 점프+오토파일럿 런에서 실제 화면 표시) ④벤치 성능(High 티어 최대 탄밀도 FPS + 자동 강등 실측).

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 셰이더/블룸이 픽셀아트에 잘 맞는다 | 픽셀 크리스프·가독성과 충돌 | 규율 있는 하이브리드 — 가독 레이어 필터 금지, 발광은 발광체에만 |
| 탄도 발광하면 화려하다 | 수천 발 번짐→판정점 틈 소실·저사양 붕괴 | 탄은 발광체 아님(정적 헤일로만 허용) |
| "유의미 히트=크리티컬" | 코드 확인: 아웃고잉 크리티컬 시스템 부재([capstones.ts:21]) | 데미지 숫자=보스·엘리트 피격만 |
| 데미지 숫자 데이터는 렌더가 안다 | 렌더는 피해량을 모름(사망도 소멸로 추론) | 소량 render-only 피격 이벤트 채널(해시 제외) |
| 5개 전부 한 패스 = 도금? (Contrarian) | 출시 리스크 vs 완성도 | 계획대로 5개 전부 — 의도된 선택으로 확인 |
| 메타 연출 맞춤 제작 필요 (Simplifier) | 유지·아트 비용 | 전환은 균일 프리미티브, 세리머니만 신규 |
| 셰이더는 직접 저작 | 번들 무게·이중 언어(WebGPU/WebGL) | 하이브리드 — 블룸=pixi-filters, 나머지=핸드 GLSL, WebGL 고정 |
| 유닛 테스트면 검증 충분 | 프로젝트 반복 결함="유닛 그린인데 배선 없음" | 4중 게이트(하네스 정규경로 배선 검증 포함) |

## Technical Context
- **엔진**: PixiJS v8, 고정 1920×1080 디자인 스페이스, 레터박스, 정수 배율·nearest·antialias off([app.ts], ADR-0001).
- **전투 렌더러**: [entityRenderer.ts] — Sprite + Graphics 오버레이. 사망=스프라이트 소멸 추론→`spawnExplosion`(단일 스프라이트 24프레임 페이드). 보스=tint 맥동/화이트 flash. 필터·파티클·셰이더 전무.
- **배경**: [invasionBackdrop.ts] TilingSprite + 크로스페이드(`backdropCrossfadeAlpha` 순수함수 — 이펙트 로직 순수함수 테스트의 선례).
- **텍스처**: [textures.ts] 절차적 Graphics 폴백 + PixelLab PNG override(`tryLoad`). 파티클 아트=하이브리드(절차적 기본 + PixelLab 간판).
- **설정**: [settingsPanel.ts] 현재 사운드·볼륨·언어뿐 — 그래픽·접근성 옵션 신규 추가 대상.
- **PixelLab 자산**: 생성분은 pixellab-forge 리포 동기화(전역 규칙).

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 발광체 GlowEmitter | core render | kind, glowRadius, tier-gated | High 티어에서 블룸, 탄은 제외 |
| 품질 티어 QualityTier | core render | Low/Med/High, FPS threshold | 헤일로·블룸·흔들림·파티클을 게이트 |
| 감소 토글 ReducedMotion | core render | on/off | 티어와 직교, 흔들림·번쩍·블룸 끔 |
| 피격 이벤트 HitEvent | supporting (render-only) | amount, x, y, targetKind | 데미지 숫자·(충격파는 소멸추론) 소스 |
| 파티클 Particle | supporting | pos, vel, life, additive | 폭발·머즐·수집 버스트 |
| 이벤트 셰이더 EventShader | core render | bloom/shimmer/shockwave/dissolve | 국소·이벤트성, WebGL GLSL |
| 데미지 숫자 DamageNumber | supporting | value, pos, ttl | 보스·엘리트 HitEvent에서만 |
| 화면 흔들림 ScreenShake | core render | trauma, decay | 트라우마 모델, 규율 트리거 |
| 히트 플래시 HitFlash | supporting | tintFrames | 전 적 kind 피격 시 |
| 트레일 Trail | supporting | source, streak | 플레이어+큰/느린 적탄만 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 9 | 9 | - | - | N/A |
| 2 | 10 | 0 | 1 | 9 | 90% |
| 3 | 10 | 0 | 0 | 10 | 100% |
| 4-8 | 10 | 0 | 0 | 10 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (Round 0 + 8 rounds)</summary>

### Round 0 (Topology)
**Q:** 5개 컴포넌트 형상이 맞나요?
**A:** 맞음 — 5개 그대로.

### Round 1
**Q:** 품질 티어를 몇 단계로, 각 단계에 무엇을?
**A:** 3단계(Low/Med/High). **Ambiguity:** 37%

### Round 2
**Q:** 크리티컬 없는 상황에서 "유의미 히트" 정의?
**A:** 보스·엘리트 피격만. **Ambiguity:** 34%

### Round 3
**Q:** 이벤트 셰이더 조달 방식?
**A:** 하이브리드 + WebGL 고정. **Ambiguity:** 32%

### Round 4 (Contrarian)
**Q:** 스코프를 출시 기준으로 단계화?
**A:** 계획대로 5개 전부. **Ambiguity:** 31%

### Round 5
**Q:** 화면 흔들림 모델·트리거?
**A:** 트라우마 모델 + 규율 트리거. **Ambiguity:** 29%

### Round 6 (Simplifier)
**Q:** 메타 연출 단순화 수준?
**A:** 중간(전환 균일 + 세리머니 신규). **Ambiguity:** 28%

### Round 7
**Q:** 탄 트레일 대상 범위?
**A:** 플레이어 발사체 + 큰/느린 적탄만. **Ambiguity:** 24%

### Round 8
**Q:** 이펙트 "완성" 검증 기준?
**A:** 4중 게이트. **Ambiguity:** 16% (임계 도달)

</details>
