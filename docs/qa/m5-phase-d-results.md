# M5 Phase D — QA·성능 최종 결과

- 대상: M5 계획(`.omc/plans/planet-blitz-m5-plan.md`) §4 Phase D, AC9
- 기준 커밋: `68307b9`(PR#33·#34·#35 머지 상태), 브랜치 `chore/m5-qa-perf`
- 검증 환경: Windows 10, Node.js v24.13.0, vite 6 / vitest 2
- 결정론 원칙(ADR-0005): 본 패스는 **sim 코어를 일절 수정하지 않는다**. 벤치·프로브·사운드 관찰은
  모두 render/관찰 레이어(단방향 sim→render)이며, fixtures·hashWorld에 영향이 없다. `npm test`
  전건(56파일·574테스트) 통과로 재확증(denoFixture bit-identical 포함).

---

## 1. 60fps / 2,000발 재검증 (AC9)

헤드리스 sim 벤치 `src/bench/simBench.ts`(`npx vite-node src/bench/simBench.ts`). 프레임 예산
@60fps = **16.67 ms/tick**. 각 수치는 3회 중 최선(노이즈 감쇠).

| 시나리오 | ms/tick | 예산 대비 여유 | 부하 구성 |
|---|---|---|---|
| 무한 맵 PvE, 브로드페이즈 cellSize=128 | 0.282 | 59.1x | 2,123 발사체 + 10 활성 벽 |
| 무한 맵 PvE, 브로드페이즈 cellSize=256(현행) | **0.257** | **64.8x** | 2,123 발사체 + 10 활성 벽 |
| **수호 포함 방어전(신규)** | **0.126** | **132.6x** | 2,233 발사체 + 수호 2기 + 포탑 6기 |

- **신규 시나리오 추가**: 이번 패스에서 수호 2기(타이탄+인터셉터, 완전 성능·계보 보너스 최대) +
  포탑 6기(발칸×2·미사일×2·테슬라×2) + 코어 + 2,000발 스트레스를 얹는 **침공 방어전** 부하
  경로를 `buildGuardianStressWorld`로 추가했다. 이것이 M5에서 새로 도입된 sim 부하(M4 침공 런 +
  수호 엔티티 추적·조준·발사).
- **회귀 없음**: 세 시나리오 모두 예산의 1% 미만 tick 시간, 최소 59x 여유. 수호 시나리오가 오히려
  더 빠른 것은 무한 맵의 청크/벽 생성 부하가 없는 고정 아레나(1920×1080)이기 때문이다.
- **결론**: 60fps 목표는 실측 대비 압도적 여유로 PASS. 병목·프로파일·sim 최적화 불필요(따라서
  부동소수 연산 순서·해시에 손대지 않음).

> 재현: `npx vite-node src/bench/simBench.ts`

---

## 2. 장시간 세션 메모리 누수 점검 (AC9)

### 2-1. sim 코어 힙 프로브(헤드리스)

신규 `src/bench/memProbe.ts` — 5,000틱 런을 40라운드 반복 생성·폐기하며 라운드마다 GC 강제 후
`heapUsed` 계측(이동 섞어 청크/벽 생성·컬링 경로 반복 밟음). 실행:
`node --expose-gc`(NODE_OPTIONS)로 vite-node.

| 지표 | 값 |
|---|---|
| 라운드 0 heapUsed | 28.20 MB |
| 워밍업(10R) 후 first→last | 28.07 → 28.15 MB |
| 워밍업 후 구간 min/max | 28.07 / 28.17 MB |
| 워밍업 후 증가량 | **+0.08 MB** (총 150,000틱, 임계 8MB) |

- **판정 PASS**: 힙이 초기 워밍업 후 완전히 평탄(±0.1MB 노이즈). 엔티티 풀·스냅샷·청크 컬링에
  잔존 참조 누수 신호 없음.

> 재현: `NODE_OPTIONS='--expose-gc' npx vite-node src/bench/memProbe.ts`

### 2-2. PixiJS/DOM 누수 정적 감사

sim은 DOM/렌더가 없으므로, 렌더·UI 레이어는 코드 정적 감사로 확인:

- **`src/render/audio.ts`(신규 WebAudio 노드)**: `play()`마다 oscillator/gain/bufferSource를
  생성하지만 모두 `osc.start(t)`+`osc.stop(t+dur)`로 종료 예약된다. WebAudio 규약상 ended 노드는
  브라우저가 자동 해제·GC하며(수동 disconnect 불필요), 그래프에 영구 누적되는 노드가 없다.
  마스터 게인·AudioContext·noiseBuffer는 **1회 지연 생성 후 재사용**(싱글턴). → 누수 없음.
- **`src/ui/settingsPanel.ts`·`src/ui/resultOverlay.ts`·`src/ui/stickerPicker.ts`**: 각 오버레이는
  생성자에서 `<style>`+루트 DOM을 **1회** 만들어 재사용하고, `show()`는 `root.innerHTML=''` 후
  재구성한다. innerHTML 교체는 이전 자식과 그에 붙은 리스너를 함께 제거하므로 리스너 누적이 없다.
  버튼 리스너는 자식 엘리먼트에 걸려 innerHTML 교체 시 자식과 함께 GC된다. 오버레이 루트가
  프레임/런마다 새로 `document.body`에 append되는 경로는 없음(생성 1회). → DOM/리스너 누적 없음.
- **`src/render/soundScape.ts`**: 상태는 이전 프레임 요약 1개(`prev`)만 보유. 무한 누적 없음.

- **결론**: 정적 감사에서 렌더/DOM 누수 패턴 미발견. 실브라우저 장시간(수십 분) 힙 스냅샷 추세
  확인은 아래 §5 사용자 게이트로 이월(자동화 환경 제약).

---

## 3. 크로스 브라우저 호환 감사 (AC9)

실기기 3종 자동 구동은 환경 제약으로, 코드 정적 감사 중심 + 빌드 타깃 확인:

- **빌드/언어 타깃**: `tsconfig` `target: ES2022`, `vite build target: es2022`. ES2022는
  Chrome/Edge 94+, Firefox 93+(2021년 말)부터 지원 — 3종 모두 현행 버전에서 안전.
- **위험 최신 API 미사용**: `structuredClone`·`Array.prototype.at`·`findLast`·`replaceAll`·
  `Object.hasOwn`·`Promise.withResolvers`·`requestIdleCallback`·`OffscreenCanvas` 등
  브라우저 편차 API 사용 0건(grep 전수).
- **WebAudio**: `typeof window`·`typeof AudioContext` 가드 후 사용, 첫 사용자 제스처에서 지연
  생성/resume(자동재생 정책 대응). `webkitAudioContext` 폴백은 불필요(대상 3종 모두 표준
  `AudioContext` 지원).
- **localStorage**: 전 사용처(`save/profile`·`i18n`·`audio`·`net`·`harness` 등)가 `typeof
  localStorage === 'undefined'` + try/catch 가드 — 프라이빗 모드/차단 시에도 무결.
- **`navigator.language`**(i18n): `typeof navigator` 가드 + try/catch. 3종 모두 지원.
- **WebGL**: PixiJS v8이 WebGL/WebGPU 렌더러 선택·폴백을 담당(빌드 산출에 WebGLRenderer·
  WebGPURenderer 청크 분리 확인). 앱 코드가 직접 WebGL 컨텍스트를 만지지 않음.
- **결정론 부동소수**: hashWorld는 FNV(정수 `Math.imul`+`>>>0`) 기반, sim 수치는 IEEE-754 f64.
  Firefox(SpiderMonkey)·Chrome/Edge(V8) 모두 IEEE-754 준수 → 해시 일치 편차 위험 없음
  (플랫폼 trig 금지 규약은 sim에서 유지됨).
- **결론**: 정적 감사상 Chrome·Edge·Firefox 비호환 요소 미발견. 실기기 3종 실측(FPS·입력·오디오
  언락·해시 일치)은 §5 사용자 게이트로 이월.

---

## 4. 발견·수정 이슈 (PR#34 리뷰 LOW 이월 3건)

- **LOW#1 — soundScape `entities[0]=플레이어` 가정으로 인한 사출음 오동작 여지 → 수정**:
  `RunSoundObserver`가 격추 사출(eject)·피격(hit)을 `entities[0]`의 HP 추정으로만 판정하던 것을,
  **런 종료(gameOver/victory) 전이 기반으로 견고화**했다. `SoundFrame`에 `gameOver`/`victory`를
  추가하고, eject는 `!prevOver && gameOver` 전이에서 정확히 1회 발생(엔티티 배열 재정렬과 무관),
  hit은 런 진행 중에만(종료 후 배열 변동에 의한 오발 차단). `src/render/soundScape.ts`,
  `src/main.ts`(관찰 호출부). sim 무수정.
- **LOW#2 — stickerTextKey 무검증 캐스팅 → 테스트 강화(확인+보강)**: `stickerTextKey`는
  `` `sticker.${id}` ``를 무검증 캐스팅한다. i18n 키 누락을 잡던 `tests/i18n.test.ts`가 하드코딩
  id 목록을 쓰고 있어 신규 스티커 추가 시 누락을 놓칠 수 있었다. 목록을 **정본 `STICKERS`에서
  파생**하도록 바꿔, 신규 id 추가 시 EN·KO 키 누락이 자동으로 실패하게 했다.
- **LOW#3 — settingsPanel 톱니 버튼(z-index 60, left 16px)과 게임 HUD 겹침 → 확인, 조정 불요**:
  톱니 버튼은 좌상단(left:16px, top:14px, 38×38). 메인 HUD(`#pb-hud`)는 **좌하단**(left:16px,
  bottom:16px), 보스 바·튜토리얼·보급 배너는 상단 중앙. 좌상단 코너에 겹치는 DOM 오버레이가
  없어(라다는 캔버스 드로우, DOM 아님) 실제 겹침 없음. 조정 불필요로 판정.

---

## 5. 사용자 실기기 확인 잔여 목록 (게이트 몫)

자동화 환경 제약으로 아래는 사용자 실기기/실브라우저 확인이 필요:

1. **실브라우저 3종 스모크**: Chrome·Edge·Firefox 최신에서 게임 로딩·플레이·오디오 언락(첫
   제스처 후 소리)·입력 반응 정상 동작 육안 확인.
2. **실기기 60fps 체감**: 2,000발+수호+보스 동시 상황에서 브라우저별 실 프레임레이트(rAF 기반
   화면 FPS 미터, `?bench=1`) 60fps 유지 확인. 헤드리스 sim은 예산의 1% 미만이나, 렌더(PixiJS
   드로우콜) 포함 실측은 GPU 종속.
3. **장시간(수십 분) 실브라우저 힙 추세**: DevTools 힙 스냅샷 2~3회로 우상향 누적 없음 확인
   (정적 감사·sim 프로브는 통과, 렌더 실측만 잔여).
4. **크로스 브라우저 해시 일치(선택)**: 동일 시드 런을 3종에서 각각 굴려 hashWorld 최종값 일치
   확인(정적으로는 IEEE-754·정수 해시라 안전 판정).

---

## 부록: 재현 명령

- sim 성능 벤치(무한 맵 + 수호 시나리오): `npx vite-node src/bench/simBench.ts`
- sim 메모리 프로브: `NODE_OPTIONS='--expose-gc' npx vite-node src/bench/memProbe.ts`
- 전 검증: `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run build`
- 렌더 FPS 하네스(브라우저): 개발 서버 `?bench=1`
