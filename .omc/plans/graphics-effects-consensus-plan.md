# 구현 플랜: Planet Blitz 그래픽 이펙트 풍성화 + 셰이더 (합의 정제)

- 상태: **pending approval** (합의 완료, 실행은 별도 승인)
- 스펙: [.omc/specs/deep-interview-graphics-effects.md](../specs/deep-interview-graphics-effects.md) (모호도 16% PASSED)
- 상위 계약: [ADR-0031](../../docs/adr/0031-graphics-effects-disciplined-hybrid-glow.md) · [CONTEXT.md](../../CONTEXT.md) "발광체" · ADR-0005(결정론)
- 생성: 2026-07-24 · 모드: consensus --direct (RALPLAN-DR short)

---

## Requirements Summary
전투(SF 픽셀아트)·메타(카툰나무풍) 양쪽에 이펙트를 더하되, 게임플레이 가독 레이어는 필터 금지, 발광은 발광체에만, 셰이더는 국소·이벤트성에만, 전부 render-only(결정론 불변). 품질 3티어 자동 적응+수동 오버라이드+감소 토글. **취향이 갈리는 이펙트는 프로토타입 변형을 만들어 사용자가 고른 뒤 대량 배선(사용자 지정 게이트).**

핵심 발견(탐색): 대부분의 이펙트는 기존 render-only 감지 패턴에 올라탄다 — 사망 FX([src/render/entityRenderer.ts:508](../../src/render/entityRenderer.ts) `effectLayer`+`effects[]`), 레벨업·수집·발사 델타([src/render/soundScape.ts:53](../../src/render/soundScape.ts)). **채택안(데미지 숫자 HP-델타)은 sim 0 변경**이고, 잠재 sim 접점(데미지 숫자 승격·머즐 정밀 위치)은 전부 render-only 기본 + 조건부·범위 밖으로 격리한다. 해시는 `WorldState` 를 직접 화이트리스트 순회([src/sim/replay.ts:268](../../src/sim/replay.ts))하므로, 설령 승격하더라도 스냅샷/틱-스크래치 전용 필드는 자동 해시 제외(planet·beams·visionRadius 선례).

---

## RALPLAN-DR Summary (short)

### Principles (원칙)
1. **가독 레이어 불가침** — 탄·적 실루엣·판정 대상은 어떤 풀스크린 필터도 안 걸린다. 이펙트는 언제나 그 위/아래 별도 레이어.
2. **결정론 골든 불변** — 모든 이펙트 render-only. 해시(`hashWorld`/`hashEntity`)에 접히는 필드는 단 1바이트도 안 바뀐다. 신규 render-only 필드는 스냅샷에만 둬 구조적으로 제외.
3. **기존 감지 패턴 재사용 우선** — 신규 sim 이벤트를 만들기 전에 entityRenderer 소멸 감지·soundScape 델타 감지로 되는지부터 본다(sim 표면 최소 침습).
4. **취향은 사용자가, 기계는 자동** — 룩이 갈리는 것은 변형→선택, 규칙이 확정된 것(티어·채널·토글·WebGL)은 변형 없이 구현.
5. **배선 증명 우선** — "유닛 그린인데 배선 없음" 반복 결함 방어. 순수함수 유닛 + 하네스 정규경로 배선 검증을 항상 쌍으로.

### Decision Drivers (상위 3)
1. 탄막 가독성·판정점 회피 공정성 보존(게임 핵심 루프).
2. 저사양 웹(CrazyGames) 성능 — 수천 탄+수백 적에서 프레임 유지.
3. 결정론 리플레이·골든 해시 무결(ADR-0005 — 침공 검증의 뿌리).

### Viable Options — 데미지 숫자용 피해량 전달 (Architect 합의 반영)
데미지 숫자는 **보스·엘리트 저빈도 한정 + 토글**이라, sim 표면 침습을 지연/최소화하는 것이 Principle #3(최소 침습)·#4(취향은 변형→선택)와 정합한다.
- **Option A (채택, 1순위): 렌더측 HP-델타 추론 — sim 표면 0 변경.** 렌더러가 스냅샷의 보스·엘리트 `hp`/`maxHp`([snapshot.ts:28-29](../../src/sim/snapshot.ts))를 프레임 간 델타로 읽어 피해 숫자를 띄운다. sim·해시·스냅샷 구조 무변경.
  - Pros: 결정론 리스크 0(sim 무접촉), 유일 sim 침습 제거, 즉시 출하·되돌림 자유.
  - Cons: 한 렌더 프레임에 같은 보스 다중 피격이 겹치면 델타가 병합됨(보스 저빈도·큰 체력이라 자연스러운 병합, 수용 가능).
- **Option B (조건부 승격, 2순위): 틱-클리어 스크래치 배열(링버퍼 아님).** 하네스 눈검증에서 Option A 충실도가 눈에 띄게 부족할 때만 승격. 피해 적용([world.ts:2807](../../src/sim/world.ts))에서 보스·엘리트만 `state.hitEvents` 에 push하되, **`stepWorld` 상단에서 매 틱 `state.hitEvents.length=0` 으로 비운다**([world.ts splitSpawns/hiveSpawns 2739-2741](../../src/sim/world.ts) 틱-스크래치 선례). `snapshotWorld`([snapshot.ts:89](../../src/sim/snapshot.ts))가 그 틱 이벤트만 복사.
  - **핵심 계약(Architect must-fix)**: 캡/클리어는 반드시 **`stepWorld`(sim) 내부**. 서버 `runReplay`([replay.ts:554-563](../../src/sim/replay.ts))는 `stepWorld`+`hashWorld`만 재실행하고 `snapshotWorld`를 **호출하지 않으므로**, 클리어를 snapshot/render에 두면 헤드리스 18000틱에서 버퍼가 무한 성장(해시는 불변이어도 EF CPU/메모리 예산을 축낸다).
  - **불변식**: sim 로직은 `hitEvents` 를 **절대 읽지 않는다**(write-only). 부정 증명 불가라 write-only 주석 상주 + 코드리뷰 체크리스트 + 헤드리스 장기 재실행 테스트(해시 불변 AND 버퍼 바운드)로 방어.
  - ⚠️ **"planet/beams 선례" 유비 정정**: 그 필드들은 snapshot-**파생**(WorldState 비상주)이고, `hitEvents` 는 sim 핫루프 상주 가변 채널이라 **범주가 다르다** — 별도 계약(위)이 필요하다.
- **Option C (무효): sim 핫루프가 리스너로 write 하는 옵서버/이미터.** 피해 적용 중 렌더 콜백을 부작용으로 호출.
  - 무효 사유(Critic m2): 스텝 도중 부작용·리스너 등록 순서에 결과가 의존하게 되어, 헤드리스 서버 재실행([replay.ts:554](../../src/sim/replay.ts))에서 리스너 부재·순서 차이로 **비결정적 분기**가 생긴다(ADR-0005 정면 위반). Option A/B 는 sim 이 데이터만 쓰고(또는 안 쓰고) 렌더가 관찰하는 단방향이라 이 위험이 없다.

### Viable Options — 프로토타입 데모 갤러리 배치
- **Option A (채택): 하네스 치트 패널 신규 씬 탭 `gallery`.** [cheatPanel.ts:114-120](../../src/harness/cheatPanel.ts) `SCENE_TABS` 에 추가, `window.__pb`([main.ts:1550](../../src/main.ts)) 로 renderer 직접 접근.
  - Pros: DEV 가드로 프로덕션 트리셰이킹 제거(ADR-0008 정합), 기존 하네스 부팅·격리 재사용, 새 빌드 진입점 0.
  - Cons: 치트 패널 UI 에 탭 하나 늘어남.
- **Option B: 독립 HTML + vite 진입.** `index.html` 형제 페이지.
  - 무효 사유(약): 부팅·격리·`window.__pb` 배선을 중복 구현. A 가 재사용으로 더 싸다. (완전 무효는 아니라 폴백으로 보존.)

---

## Acceptance Criteria (testable)

### Phase 0 — 파운데이션 (기계적 확정, 변형 없음)
- [ ] AC-0.1 렌더러 WebGL 고정: [app.ts:30](../../src/render/app.ts) `app.init({..., preference:'webgl'})`. 부팅 시 `app.renderer.type` 이 WebGL 임을 하네스에서 확인.
- [ ] AC-0.2 `src/render/graphicsSettings.ts` 신설([audio.ts](../../src/render/audio.ts) 구조 복제): `parse/serialize/clamp` 순수함수 + `STORAGE_KEY='pb.graphics'` + `readStored/writeStored` + `onChange`. 필드: `quality:'auto'|'low'|'med'|'high'`, `reducedMotion:boolean`, `reducedGlow:boolean`.
- [ ] AC-0.3 `tests/graphicsSettings.test.ts` — [tests/audioSettings.test.ts](../../tests/audioSettings.test.ts) 동형 round-trip·clamp·기본값·손상값 폴백.
- [ ] AC-0.4 품질 티어 런타임: FPS 롤링 평균(예 2초 창) 감시 → 임계 미만 지속 시 1단계 강등, 이력현상(복귀 임계 별도)으로 진동 방지. **티어 선택은 순수함수** `selectTier(currentTier, fpsAvg, manualOverride)` 로 분리해 유닛 테스트. 수동 오버라이드가 자동을 잠금.
- [ ] AC-0.5 `tests/qualityTier.test.ts` — `selectTier` 경계·이력현상·오버라이드 잠금·단조 강등 검증.
- [ ] AC-0.6 감소 토글 직교: `reducedMotion` 이 흔들림·플래시를, `reducedGlow` 가 헤일로·블룸을 어느 티어에서든 끈다(순수 게이트 함수 `effectGates(tier, settings)`).
- [ ] AC-0.7 Pixi 설정 패널([settingsPanel.ts:232](../../src/ui/pixi/settingsPanel.ts)) 에 품질 셀렉터 + 감소 토글 2개 행 추가(사운드/언어 행 아래, close 앞). DOM 판([src/ui/settingsPanel.ts](../../src/ui/settingsPanel.ts))도 1:1 동등 유지.
- [ ] AC-0.8 발광 레이어 스캐폴딩: [entityRenderer.ts:396-399](../../src/render/entityRenderer.ts) 레이어 스택에 `glowLayer`(가산 blend Container) 추가 — draw order 는 spriteLayer **아래**(발광이 불투명 코어를 안 덮도록)이되 배경 위. 빈 상태로도 골든/기존 테스트 불변.
  - ⚠️ **비대칭 명문화(Architect)**: glowLayer 는 스프라이트 **아래**지만, 파티클 폭발(AC-2.4)은 기존 `effectLayer`(스프라이트 **위** — [entityRenderer.ts:398](../../src/render/entityRenderer.ts))에 그려져 가독 레이어를 순간 덮을 수 있다. 사망 유닛 위 폭발은 허용, 살아있는 적 피드백은 tint 방식(AC-2.3)이라 안전. 이 "glow=아래, 폭발=위" 규율을 코드 주석으로 못박는다.
- [ ] AC-0.9 **셰이더 인프라 선행**(사용자 1단 갤러리 결정): `pixi-filters` 의존성 추가([package.json](../../package.json), tree-shaken) + 핸드 GLSL 필터 스캐폴딩(빈 셸 + WebGL GLSL) + graceful 폴백([textures.ts tryLoad](../../src/render/textures.ts) 정신, 컴파일 실패 시 효과 생략·게임 불사망). 이 인프라가 있어야 Phase 1 갤러리가 셰이더 룩(글로우·충격파·디졸브)을 실 필터로 렌더. 빈 셸 상태로도 기존/골든 테스트 불변.

### Phase 1 — 프로토타입 선택 게이트: 6종 단일 갤러리 (사용자 지정 1단, **차단 게이트**)
사용자 결정(2026-07-24): 6종을 **한 갤러리에서 한 번에** 보고 고른다. 이를 위해 셰이더 인프라(pixi-filters + GLSL 스캐폴딩 + 폴백)를 **Phase 0 로 선행**(AC-0.9)해, 셰이더 룩 변형도 "실 프로덕션 코드"(AC-1.3)로 렌더한다. Architect must-fix #2 는 "게이트 분할" 대신 "인프라 선행"으로 해소.
- [ ] AC-1.1 하네스 `gallery` 씬 탭([cheatPanel.ts SCENE_TABS](../../src/harness/cheatPanel.ts)) 신설. DEV 전용(프로덕션 트리셰이킹 제거).
- [ ] AC-1.2 취향 대상 **6종** 각 2~3개 라이브 변형을 한 갤러리에서 동시 비교: ①파티클 폭발(파편형/색/수/확산) ②글로우·블룸 룩(세기/반경/색온도) ③사망 디졸브(디더 방식/방향) ④충격파 링(굵기/왜곡/속도) ⑤메타 전환(페이드/슬라이드/와이프) ⑥보상 세리머니(레이아웃/모션).
- [ ] AC-1.3 각 변형은 실제 프로덕션 코드가 될 구현으로 렌더(목업 아님) — 선택분을 그대로 승격. (셰이더 룩은 AC-0.9 인프라 위에서 실 필터로 렌더.)
- [ ] AC-1.4 **각 변형에 정규경로 스모크 동반**(Architect tradeoff): 갤러리 렌더와 **동시에** 실 스냅샷/effectLayer 경로로도 한 번 태워 `effectCount`([entityRenderer.ts:407](../../src/render/entityRenderer.ts) 관측창 선례)·glowLayer child 수로 배선을 함께 증명. "갤러리에선 완벽한데 실 경로 미배선" 반복 결함 방어.
- [ ] AC-1.5 **사용자 선택 기록**(Critic m6): 선택을 `.omc/state/` 의 기록 파일(예 `fx-gallery-choices.json` — 변형군→선택 id)에 남긴다. **무선택/침묵 시 기본값**은 각 변형군의 "추천" 변형(코드에 명시)으로 진행하되, 진행 전 사용자에게 명시 확인. 선택분만 승격, 미선택 변형은 제거 또는 갤러리 전용 보존. **이 게이트 통과 전 Phase 2·4·5 대량 배선 금지.**

### Phase 2 — 전투 핵심 피드백 3종
- [ ] AC-2.1 화면 흔들림: 트라우마 모델 순수함수 `shakeOffset(trauma, tick)`=trauma²·감쇠, 카메라 팬([entityRenderer.ts:424](../../src/render/entityRenderer.ts))에 render-only 오프셋 가산. 트리거=플레이어 피격(중)·보스/엘리트 처치(강)·대형 폭발(중)만. 잡몹 처치·발사 제외. `reducedMotion` 시 0.
- [ ] AC-2.2 `tests/screenShake.test.ts` — `shakeOffset` 감쇠·trauma 상한·0 입력·결정론.
- [ ] AC-2.3 히트 플래시: 피격 대상 2~3프레임 화이트 틴트(기존 보스 flash [entityRenderer.ts:495](../../src/render/entityRenderer.ts) 일반화 → 전 적 kind). 트리거는 **HP-델타 감지로 통일**(데미지 숫자와 동일 소스 — Critic m5, sim 표면 불확대).
- [ ] AC-2.4 파티클 폭발: 기존 단일 스프라이트 `spawnExplosion`([entityRenderer.ts:520](../../src/render/entityRenderer.ts))을 선택된 변형(파편 버스트+가산 플래시)으로 교체. 파티클 시스템은 절차적 가산 스프라이트 인스턴싱. 티어별 파티클 상한.

### Phase 3 — 이벤트 셰이더 3종 (+블룸) — Phase 1 에서 **선택된** 룩을 프로덕션 배선
인프라(pixi-filters·GLSL 스캐폴딩·폴백)는 Phase 0(AC-0.9)에서 완료, 룩 선택은 Phase 1 갤러리에서 완료. Phase 3 은 선택분을 정규 경로에 배선·튜닝한다.
- [ ] AC-3.1 블룸(pixi-filters AdvancedBloomFilter, Phase 0 에서 의존성 추가됨)을 High 티어에서만 발광 렌더타깃/glowLayer 에 1패스. 선택된 글로우 룩 파라미터 적용.
- [ ] AC-3.2 히트 시머: 핸드 GLSL 변위 필터, 용암 해저드·보스 과열 창([world.ts:2774](../../src/sim/world.ts) iframes) 위 국소 적용. WebGL GLSL 단일.
- [ ] AC-3.3 충격파 링: 핸드 GLSL, 보스 처치·대형 폭발 순간(기존 소멸 감지 [entityRenderer.ts:508](../../src/render/entityRenderer.ts) 트리거) 짧은 원형 왜곡. 진행도 순수함수 `shockwaveProgress(elapsed)`([backdropCrossfadeAlpha](../../src/render/invasionBackdrop.ts) 선례).
- [ ] AC-3.4 사망 디졸브: 핸드 GLSL 디더 알파, 선택 변형. 기존 소멸 감지에 연동.
- [ ] AC-3.5 `tests/shaderProgress.test.ts` — 셰이더 진행도 순수함수(시머 위상·충격파·디졸브)의 경계·단조·NaN 내성.
- [ ] AC-3.6 셰이더 미지원/컴파일 실패 시 graceful 폴백(효과 생략, 게임 불사망 — [textures.ts tryLoad](../../src/render/textures.ts) 정신). 핸드-GLSL 필터는 이 폴백 뒤에 격리해, 훗날 WebGPU 전환 시 no-op 되고 스택 전체는 살아남게.
- [ ] AC-3.7 (Phase 1 단일 갤러리로 통합됨 — 별도 미니 게이트 없음. 셰이더 룩 선택은 AC-1.2·AC-1.5 에서 완료.)

### Phase 4 — 부가 전투 연출
- [ ] AC-4.1 데미지 숫자: **1순위 렌더측 HP-델타 추론(sim 0 변경)** — 스냅샷 보스·엘리트 `hp`/`maxHp`([snapshot.ts:28-29](../../src/sim/snapshot.ts))를 id별(`prevById` [entityRenderer.ts:429](../../src/render/entityRenderer.ts)) 프레임 간 델타로 표시. 보스·엘리트만 + `graphicsSettings` 토글. id 는 런 내 단조 증가·재사용 없음([world.ts:779](../../src/sim/world.ts) `nextEntityId++`)이라 다중 엘리트 귀속·좌표 안전.
  - **엣지(Critic m3)**: ①**치명타(킬 블로우)**: 대상이 curr 스냅샷에서 사라지면 마지막 치사 피해 델타를 얻지 못한다 → 소멸 감지([entityRenderer.ts:508](../../src/render/entityRenderer.ts)) 시 `prevHp` 잔량을 최종 숫자로 띄운다. ②**힐 델타**: 서포트 빔이 적을 힐([snapshot.ts:123](../../src/sim/snapshot.ts))하면 hp 델타가 양수 → **델타<0 만 데미지 숫자**(양수는 무시 또는 별색 힐 표기, 기본은 무시).
- [ ] AC-4.2 **조건부 승격만**: AC-4.1 충실도가 하네스 눈검증에서 눈에 띄게 부족할 때에 한해 틱-클리어 스크래치(RALPLAN-DR Option B)로 승격. 승격 시 캡/클리어는 `stepWorld` 내부, write-only 불변식 준수.
- [ ] AC-4.3 **결정론 불변 증명(승격 시)**: `hashWorld`/`hashEntity`([replay.ts](../../src/sim/replay.ts))가 새 필드를 안 접음 + **헤드리스 장기 재실행에서 버퍼 바운드**. [tests/invasionHash.test.ts](../../tests/invasionHash.test.ts)·[tests/determinism.test.ts](../../tests/determinism.test.ts) 골든 바이트 불변. (AC-4.1 채택 시 이 항목은 무해 통과 — sim 무변경.)
- [ ] AC-4.4 탄 트레일: 플레이어 발사체 + 큰/느린 적탄(유도·곡사)만 짧은 가산 스트릭. 조밀 잡몹탄 제외. 티어별 on/off.
- [ ] AC-4.5 그레이징 스파크: render-only 근접 회피 감지(플레이어↔적탄 거리, 판정점 밖·근접) → 스파크. 보상 없음(용어집 정합). sim 무개입.
- [ ] AC-4.6 젬/전리품 수집 팝 + 레벨업 링: 기존 델타 신호([soundScape.ts:53-56](../../src/render/soundScape.ts))·`pendingLevelUp`([world.ts:3301](../../src/sim/world.ts)) 재사용, effectLayer 확장.
- [ ] AC-4.7 머즐 플래시: 발사 순간 총구 섬광. 우선 발사체 생성 감지(bulletCount 델타/신규 bullet 엔티티)로, 정밀 위치 필요 시에만 발사 이벤트 채널 확장(범위 밖 기본은 근사).

### Phase 5 — 메타 UI 연출
- [ ] AC-5.1 균일 전환 프리미티브: [main.ts clearToMenu()](../../src/main.ts) 465-494 단일 초크포인트에 재사용 페이드/슬라이드 1종을 끼워 전 메타 화면 swap 에 균일 적용. 카툰나무풍 레지스터(SF 글로우 차용 금지).
- [ ] AC-5.2 신규 보상 세리머니: 선택 변형(코인 카운트업·전리품 등급 공개), 기존 정산 흐름([resultOverlay.ts](../../src/ui/pixi/resultOverlay.ts))·`ceremony.notice`([main.ts:1233](../../src/main.ts)) 통합.
- [ ] AC-5.3 촉각 피드백: 버튼 눌림 스쿼시·호버 광택·카드 집기([PixiButton](../../src/ui/pixi/button.ts) 확장).

### Phase 6 — 검증 (4중 게이트, **매 Phase 관통 — 종반 1회 아님**)
Critic M3: AC-6.1·6.2 는 **Phase 마다** 실행(결정론 회귀 조기검출), AC-6.3·6.4 는 각 이펙트가 통합되는 시점에 실행. Implementation Steps 각 Phase 말미에 `pnpm test` 게이트.
- [ ] AC-6.1 **결정론 게이트(매 Phase)**: 각 Phase 후 [tests/determinism.test.ts](../../tests/determinism.test.ts)·[tests/invasionHash.test.ts](../../tests/invasionHash.test.ts)·shipHashBaseline 골든 바이트 불변. Phase 0~3·5 는 sim 무변경이라 자동 통과, Phase 4(데미지 숫자 승격 시)가 실질 관문.
- [ ] AC-6.2 **순수함수 유닛 게이트(매 Phase)**: shakeOffset·selectTier·effectGates·shockwaveProgress·디졸브/시머 위상·graphicsSettings round-trip 유닛. [tests/invasionRender.test.ts](../../tests/invasionRender.test.ts) 동형(node 환경, PixiJS import-only).
- [ ] AC-6.3 **하네스 정규경로 배선 게이트 — 자동 통합 테스트(Critic M1)**: 수동 눈검증이 아니라 [tests/invasionRender.test.ts](../../tests/invasionRender.test.ts) 동형 **node-env 자동 vitest**로, 각 이펙트 트리거를 정규 snapshot→render 경로로 태우고 `effectCount`([entityRenderer.ts:407](../../src/render/entityRenderer.ts) 관측창)·glowLayer child 델타 `> 0` 을 **assert**. 이 프로젝트 #1 반복 결함("유닛 그린인데 배선 없음", 8건 이력)의 핵심 방어라 자동화 필수. 하네스 눈검증은 보조.
- [ ] AC-6.4a **자동 강등 거동 게이트(즉시 assert)**: 실 렌더러 + graphicsSettings 주입 **신규 벤치 씬**(기존 [bench.ts](../../src/bench/bench.ts)는 EntityRenderer/glowLayer 미사용 — Architect must-fix #3)에서 `FPS 하락→티어 강등→회복` 거동을 `selectTier` 경유로 자동 검증.
- [ ] AC-6.4b **절대 FPS 관측(임계 지연)**: High 티어 최대 탄밀도 FPS 실측·기록. 절대 pass 임계는 defer-balance-tuning(출시 직전). `createGameApp` 공유라 WebGL 고정이 벤치에도 적용.
- [ ] AC-6.5 `pnpm test`·`pnpm lint`·`pnpm build`(tsc --noEmit 포함) 그린.

---

## Implementation Steps (순서·파일 참조)

1. **Phase 0** — WebGL 고정([app.ts:30](../../src/render/app.ts)) → `graphicsSettings.ts` + 테스트 → `selectTier`/`effectGates` 순수함수 + 테스트 → 설정 패널 UI 2행([settingsPanel.ts:232](../../src/ui/pixi/settingsPanel.ts), DOM 판 동등) → `glowLayer` 스캐폴딩([entityRenderer.ts:396](../../src/render/entityRenderer.ts)) → **셰이더 인프라 선행**(pixi-filters + GLSL 스캐폴딩 + 폴백, AC-0.9). FPS 감시는 ticker([main.ts:1187](../../src/main.ts))에서 평균 산출 → graphicsSettings 로 전달.
2. **Phase 1 (단일 게이트)** — `gallery` 씬 탭([cheatPanel.ts:116](../../src/harness/cheatPanel.ts)) + **6변형군**(폭발·글로우·디졸브·충격파·전환·세리머니) 한 갤러리 라이브 렌더 + 정규경로 스모크 → **사용자 선택 대기**. 선택 전 아래 대량 배선 금지.
3. **Phase 2** — 선택된 폭발 변형으로 `spawnExplosion` 교체([entityRenderer.ts:520](../../src/render/entityRenderer.ts)), shakeOffset 트라우마→render 카메라 오프셋([entityRenderer.ts:424](../../src/render/entityRenderer.ts) — 카메라는 render-only 파생이라 sim 되먹임 없음), 히트 플래시 일반화([entityRenderer.ts:495](../../src/render/entityRenderer.ts)).
4. **Phase 3** — Phase 1 에서 **선택된** 셰이더 룩(블룸·시머·충격파·디졸브)을 정규 경로에 배선·튜닝, 진행도 순수함수 + 폴백 확인.
5. **Phase 4** — 데미지 숫자(HP-델타 우선, 승격은 조건부)([snapshot.ts:28](../../src/sim/snapshot.ts)) → 트레일 → 그레이징 → 수집/레벨업/머즐(기존 신호 재사용 [soundScape.ts:53](../../src/render/soundScape.ts)).
6. **Phase 5** — clearToMenu 전환 프리미티브([main.ts:465](../../src/main.ts)), 세리머니(resultOverlay 통합), 촉각 피드백(PixiButton).
7. **Phase 6** — 4중 게이트 전수 + `pnpm test/lint/build`.

### Phase → PR / 롤백 경계 (Critic M3)
각 Phase 는 독립 머지 단위다(전역 규칙: 변경→브랜치→PR→머지). 매 Phase 말미에 AC-6.1(결정론 골든)+AC-6.2(순수함수 유닛)를 실행해 회귀를 조기 검출하고, 그 Phase 만 롤백 가능하게 한다.
- PR-0: Phase 0 인프라(WebGL 고정·graphicsSettings·티어·설정 UI·glowLayer 스캐폴딩). 롤백=렌더러 기본 복귀.
- PR-1: Phase 1 게이트 A(갤러리·셰이더-무관 변형). DEV 전용이라 프로덕션 영향 0.
- PR-2: Phase 2 핵심 피드백. 롤백=이펙트 레이어 비활성.
- PR-3: Phase 3 셰이더 + 게이트 B. 롤백=폴백 경로(효과 생략).
- PR-4: Phase 4 부가 연출. 롤백=데미지 숫자/트레일 토글 off. (승격 시 결정론 골든이 이 PR 의 관문.)
- PR-5: Phase 5 메타 연출. 롤백=전환/세리머니 비활성.
- 각 PR 은 그 Phase 의 AC 만 닫고, `pnpm test/lint/build` 그린을 머지 전제로 한다.

---

## Risks & Mitigations
- **R1 결정론 회귀** (신규 필드가 해시에 새면 리플레이·침공 검증 붕괴). → 1순위로 HP-델타(sim 무접촉) 채택해 리스크 원천 제거; 승격 시에도 스냅샷/틱-스크래치 전용(`hashWorld` 화이트리스트 순회에서 제외 — [replay.ts:268](../../src/sim/replay.ts)), AC-4.3 골든 바이트 불변 즉시 실행.
- **R8 헤드리스 버퍼 무한 성장** (틱-스크래치 승격 시 캡을 render/snapshot 에 두면 서버 `runReplay` 18000틱에서 미클리어 → EF CPU/메모리 예산 축). → 캡/클리어를 **`stepWorld` 내부**에 고정, 헤드리스 장기 재실행 바운드 테스트(AC-4.3).
- **R9 WebGL 고정의 blast radius** (전 게임 렌더러 변경이 그래픽 이펙트 Phase 0 에 묻힘 + WebGPU 배칭 성능 포기). → 블룸은 라이브러리(듀얼 백엔드)라 충돌 없음; 핸드-GLSL 은 폴백 뒤 격리(AC-3.6); WebGL 고정을 ADR 에 별도 라인 + 재검토 트리거로 기록(되돌림 가능 결정으로 격리).
- **R2 탄막 가독성 훼손** (발광이 코어를 덮음). → glowLayer 를 spriteLayer 아래에 두고 탄은 발광체 배제(AC-0.8), 하네스 눈검증(AC-6.3).
- **R3 저사양 성능 붕괴** (블룸·파티클·트레일 과다). → 3티어+FPS 자동 강등(AC-0.4), 벤치 게이트(AC-6.4), 발광 저빈도체 한정.
- **R4 셰이더 이중 언어/미지원** (WebGPU/WebGL, 구형 GPU). → WebGL 고정(AC-0.1, GLSL 단일), 컴파일 실패 graceful 폴백(AC-3.6).
- **R5 "유닛 그린인데 배선 없음"** (프로젝트 반복 결함). → 하네스 정규경로 배선 게이트(AC-6.3)를 순수함수 유닛과 항상 쌍으로.
- **R6 프로토타입 게이트 우회** (변형 없이 임의 룩 확정). → Phase 1 을 차단 게이트로(AC-1.4), 선택 전 대량 배선 금지.
- **R7 pixi-filters 번들 증가** (CrazyGames 로딩). → tree-shaken import(쓰는 필터만), 블룸만 라이브러리·나머지 핸드.

---

## Verification Steps
1. `pnpm test` — 신규 순수함수 유닛 + 골든 해시 불변 전수 그린.
2. `pnpm lint && pnpm build` (tsc --noEmit) 그린.
3. 하네스 `?harness=1` → `gallery` 탭에서 변형 확인(Phase 1), 각 이펙트 스크린 점프+오토파일럿 런에서 실제 표시(Phase 6).
4. 벤치 씬에서 High 티어 최대 탄밀도 FPS + 자동 강등 실측.
5. 결정론: 동일 시드 리플레이 2회 해시 일치, 이펙트 추가 전후 골든 바이트 동일.

---

## ADR (합의 결정 기록)
- **Decision**: Planet Blitz 그래픽 이펙트를 ADR-0031(규율 있는 하이브리드 글로우)의 구현으로, 5개 컴포넌트(렌더 인프라·핵심 피드백·이벤트 셰이더·부가 연출·메타 연출)를 한 패스로 빌드하되, ①취향이 갈리는 룩은 프로토타입 갤러리→사용자 선택 게이트로, ②데미지 숫자는 sim 무접촉 HP-델타 추론 우선(승격은 조건부 틱-스크래치)으로, ③렌더러 WebGL 고정 + 블룸=pixi-filters·나머지 핸드 GLSL 로, ④검증은 4중 게이트(결정론 골든/순수함수 유닛/자동 배선 통합/벤치)를 매 Phase 관통으로 한다.
- **Drivers**: 탄막 가독성·판정점 공정성 보존 / 저사양 웹 성능 / 결정론 리플레이·골든 해시 무결(ADR-0005).
- **Alternatives considered**:
  - 데미지 숫자 피해량: `WorldState` 링버퍼(→헤드리스 버퍼 성장 리스크로 격하), sim 밖 옵서버 콜백(결정론 위반으로 기각). **HP-델타 채택**.
  - 프로토타입 게이트: 독립 HTML 페이지(중복 배선으로 폴백 보존) 대 하네스 씬 탭(**채택**). 1단 단일 갤러리(**사용자 채택 2026-07-24** — 셰이더 인프라 Phase 0 선행) 대 2단 분할(기각).
  - 렌더러: WebGPU-우선 기본 유지(셰이더 이중 언어·미래 배칭 이득) 대 **WebGL 고정 채택**(단일 GLSL·저사양 보편, 되돌림 가능 결정으로 격리).
- **Why chosen**: 채택 코어(sim 무접촉 HP-델타·`stepWorld` 내부 클리어·실 렌더러 벤치·WebGL 고정)가 결정론 안전·저사양 보편·최소 침습을 동시에 만족하고, Architect·Critic 이 소스로 검증(참조 7/7, hashWorld 화이트리스트 순회 확인).
- **Consequences**: 신규 의존성 pixi-filters(tree-shaken); 전 게임 렌더러 WebGL 전환(blast radius, R9 로 격리); 설정 패널 그래픽·접근성 확장; 매 Phase 결정론 골든 실행 비용; 미래 WebGPU 전환 시 핸드-GLSL 만 재검토.
- **Follow-ups**: 프로토타입 게이트 = **1단 단일 갤러리 확정**(사용자 2026-07-24, 셰이더 인프라 Phase 0 선행). WebGL 고정 재검토 트리거(타깃 WebGPU 보급·탄막 밀도 병목 시).

## Changelog
- **Architect 리뷰 반영(2026-07-24)**:
  - must-fix #1: 데미지 숫자 피해량 전달을 `WorldState` 링버퍼 → **HP-델타 추론 우선(sim 0 변경)**, 승격 시에도 틱-클리어 스크래치·캡을 `stepWorld` 내부로. "planet/beams 선례" 유비 정정, write-only 불변식·헤드리스 바운드 테스트 추가(R8).
  - must-fix #2: Phase 1 게이트를 셰이더-무관 변형으로 한정, 셰이더 룩 선택을 Phase 3 미니 게이트(AC-3.7)로 이동. 각 변형에 정규경로 스모크 동반(AC-1.4).
  - must-fix #3: AC-6.4 벤치를 실 EntityRenderer+graphicsSettings 주입 신규 씬으로 명시.
  - nice-to-have: 카메라 sim-권위 오해 정정(render-only 파생), effectLayer 가산 비대칭 명문화(AC-0.8), WebGL 고정 blast radius 격리(R9).
- **Critic 리뷰 반영(2026-07-24, APPROVE WITH IMPROVEMENTS·CRITICAL 0)**:
  - M1: AC-6.3 배선 게이트를 수동 눈검증 → **자동 vitest 통합 테스트**(effectCount/glowLayer child 델타 assert). 프로젝트 #1 반복 결함 방어 자동화.
  - M3: 검증을 종반 1회 → **매 Phase 관통**, Phase→PR 매핑 + 롤백 경계 추가.
  - m1: Requirements Summary stale 문구 정정(채택안 sim 0 변경). m2: Option C 무효 사유 강화(핫루프 옵서버 순서 의존). m3: HP-델타 엣지(킬 블로우 prevHp·힐 델타<0 클램프) AC-4.1 명시 + id 단조성 확인. m4: AC-6.4 강등-거동 게이트/절대 FPS 관측 분리. m5: 히트 플래시 HP-델타 통일. m6: 선택 기록 형식·무선택 기본.
  - OQ 종료: 엔티티 id 런 내 재사용 없음(`nextEntityId++`) → HP-델타 오귀속 리스크 없음.
  - **M2 해소(사용자 결정 2026-07-24)**: 프로토타입 게이트 **1단 단일 갤러리** 채택 → 셰이더 인프라를 Phase 0(AC-0.9)로 선행, Phase 1 갤러리에서 6종 동시 선택. Phase 3 미니 게이트(AC-3.7) 제거.
