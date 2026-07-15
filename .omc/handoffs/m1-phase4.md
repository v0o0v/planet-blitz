# Handoff: M1 Phase 4 (에셋·벤치) 완료

- **완료(태스크 18~19)**: PixelLab 실 스프라이트 교체 + 렌더 전용 죽음 이펙트·화산 배경 / 성능 벤치 실측(60fps 통과). 재미 게이트 5인 테스트(태스크 20)·PR 머지(태스크 21)는 범위 밖(테스터/오케스트레이터).
- **커밋**: 8ae09c4(에셋 교체), 8479562(벤치 훅·README)
- **검증**: `npm run lint` 0 / `npm run test` 49 passed / `npm run build` 성공. 결정론 테스트 통과 = 에셋 교체가 시뮬 해시에 영향 0 확인.

## 에셋 내역 (태스크 18)

| 항목 | 캐시 재사용 | 신규 생성 |
|---|---|---|
| 재사용(score≥0.6) | **0건** | — |
| 신규 생성 | — | **9종 (2 packs)** |

- **캐시 조회 결과**: 전역 라이브러리 360개는 전부 다른 장르(경제/비즈니스 사이드스크롤 아이콘). 탑다운 슈팅 자산 최고 score 0.05~0.08 « 0.6 → 전량 miss.
- **생성 배치**:
  - Pack A (16-frame, size 64, top-down): 8종 한 배치 — 기체·파쇄차·박격포·용암샘·수리드론·젬·폭발·낙하산. `item_descriptions` 몰아서 1회.
  - Pack B (4-frame, size 128, top-down): 보스(용암 요새 전차) 1종.
- **비용**: 2 pack × 20 generations = 40 generations. 구독 잔여(7)는 불변, **전액 credit fallback**: **$9.16 → $8.98 = 총 $0.18**. (trial 구독 generations_remaining 7 유지)
- **후처리**: PixelLab 탑다운 출력은 north(위) 지향 → 방향성 스프라이트(기체·적4) `PIL ROTATE_270`(90° CW)로 east(+x) 지향 회전, 렌더 `rotation=angle` 규율 정합. 젬·폭발·낙하산·보스는 회전 불필요(fixedFacing/이펙트).
- **등록**: 생성분 9종 전량 전역 캐시 `add`(pb_* id, license PixelLab). global 360→369. 다음 프로젝트/재실행부터 재사용 가능.
- **파일**: `assets/{player,enemy_charger,enemy_mortar,enemy_lavaspring,enemy_support,gem,fx_explosion,fx_parachute}.png`(64px) + `boss.png`(128px). fx_parachute는 생성했으나 인게임 미사용(정산 낙하산은 DOM 이모지 🪂) — 향후 인게임 사출 연출용 예비.

### 렌더 통합 방식
- `src/render/textures.ts`: `loadGameTextures(renderer)` — 절차적 플레이스홀더 전체 생성 후 실 PNG가 로드된 슬롯만 오버라이드. **로딩 실패=플레이스홀더 폴백**(게임 불사, 태스크 요구). `import.meta.glob('../../assets/*.png', {eager, query:'?url'})`로 정적 수집 → 존재하는 PNG만 참조, 없는 슬롯 자동 플레이스홀더.
- **의도적 도형 유지**: 탄막(아군탄·적탄) = 화이트 코어 + 아웃라인 가독성 규칙. 텍스처화 시 규칙 붕괴 → 절차적 유지. 보급선·배경도 절차적(배경은 seam 회피 위해 도형 볼케이닉 타일).
- `src/render/entityRenderer.ts`: 스프라이트를 `radius*2*ART_SCALE(1.5)`로 생성 시 1회 스케일(기체 r16→48px=GDD 스펙, 적 r18→54px, 젬 r10→30px, 탄 r5→15px). 적/보스 despawn 시 렌더 전용 폭발 이펙트(effectLayer, 24프레임 페이드아웃·시뮬 무관).
- `src/main.ts`: `TilingSprite` 화산 배경(entityRenderer 아래) + `await loadGameTextures`.

## 성능 벤치 실측 (태스크 19)

- **환경 주의**: 프리뷰 탭이 hidden이면 rAF 스로틀 → 온스크린 FPS 왜곡. 그래서 **프레임당 update+render 소요 ms를 16.6ms 예산과 비교**해 판정(태스크 지정 대안). DEV 훅 `window.__bench.step()`(벤치)·`window.__pb`(게임)로 계측.
- **벤치 씬(`?bench=1`, ParticleContainer 탄 2,000 + Sprite 적 200)**: warmup 30 + 200프레임 측정
  - avg **0.49ms** / median 0.4 / p95 0.5 / p99 1.4 / max 24.2(단발 GC/업로드 outlier). 예산 16.6ms의 **~3%**. 환산 ≈2,000fps.
- **게임플레이 개별 Sprite 경로(entityRenderer, 2,000탄+200적=2,200 sprite)**: 크래프트 스냅샷으로 실측
  - avg **1.07ms** / median 0.9 / p95 1.7 / max 2.3. 예산의 **~6%**. 환산 ≈934fps.
- **판정: PASS**. 60fps(16.6ms) 목표를 양 경로 모두 큰 여유로 통과.
- **결론**: 게임플레이 탄이 개별 Sprite(ParticleContainer 미사용)여도 Pixi v8 동일 텍스처 배칭으로 2,000발 여유 통과. **ParticleContainer 이관 불필요**(태스크의 "미달 시 이관" 조건 미발생). 벤치 씬 자체는 이미 ParticleContainer 뼈대 유지.

## 수용 기준 결과표 (§5, 자동 검증 가능 항목)

| 기준 | 결과 | 근거 |
|---|---|---|
| 결정론 테스트(동일 시드+입력로그 틱별 해시 일치) | ✅ | determinism.test.ts 8건 포함 49 passed |
| src/sim에 PixiJS·Math.random·Date.now 0건(lint) | ✅ | `npm run lint` 0 |
| 리플레이 재생 = 라이브 동일 정산 재현 | ✅(해시) | 상태 해시 동치 테스트로 커버 |
| 벤치 탄 2,000발 60fps | ✅ | 실측 0.49ms/frame(예산 16.6ms) |
| 적 4종 역할 4슬롯 고유 패턴 | ✅ | data/enemies + combat/pattern 테스트(Phase 2) |
| 보스 페이즈 전환 탄 소거 + 과열 5초 2배 | ✅ | Phase 3 핸드오프 DEV-훅 실플레이 확증 |
| 젬 콤보 배율 UI 표시 + 중단 리셋 | ✅ | progression.test.ts + HUD |
| 보급선 20초 이탈 + 격추 보상 | ✅ | progression.test.ts |
| 웨이브 시드 의존 + 동시 탄 상한 | ✅ | waves 테스트(Phase 2) |
| 런 1회 5~8분 무크래시 완주 | ⚠️ 부분 | Phase 3에서 DEV-훅 전 흐름 확증(전투→레벨업→보급선→보스→정산). 본 세션 실시간 롱런 미재현 |
| 재미 게이트 5인 "한 판 더" 4/5 + 완주율 60% | ⏸ 제외 | 테스터 항목(태스크 20) |

## 남은 튜닝 포인트 / 미완

- **재미 게이트(태스크 20)**: 5인 테스터 플레이 필요. 미달 시 우선순위 ①파워업 체감 ②웨이브 리듬 ③적 탄속/밀도(플랜 §6). Phase 3 핸드오프의 "M1 임의 튜닝 수치"(콤보 계단·자석 반경·xpToNext·보스 HP2200·보급선 등)가 1차 조정 대상.
- **PR 머지(태스크 21)**: 오케스트레이터가 전역 git 규칙(브랜치→PR→merge)으로 처리. 브랜치 `feat/m1-combat-prototype`.
- **에셋 후속(선택)**: 보급선·배경은 절차적 유지 중 — 원하면 PixelLab 실 에셋으로 교체 가능(캐시에 없음, 신규 생성 필요). fx_parachute 인게임 사출 연출 미연결(정산은 DOM 이모지).
- **탄막 텍스처**: 가독성 규칙상 의도적 도형 유지. 실 스프라이트화하려면 화이트 코어+아웃라인 규칙을 스프라이트로 재현해야 함.
- **비결정론 무관**: 모든 Phase 4 변경은 렌더 계층 한정. 시뮬/데이터/입력 미변경 → 결정론 리스크 0.

## DEV 훅 (프로덕션 제외, import.meta.env.DEV 가드)
- `window.__pb`(게임): world·entityRenderer·gameApp·injectInput·state. entityRenderer.sprites/effects/spriteLayer로 스프라이트·이펙트 내부 검사 가능.
- `window.__bench`(?bench=1): step(dt)·bulletCount·enemyCount. 스로틀 무관 프레임 ms 계측용.
