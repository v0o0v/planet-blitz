# Handoff: M1 Phase 0+1 → Phase 2

- **완료**: git init(main 기준선 `07356e8`) → `feat/m1-combat-prototype` 브랜치. Vite6+TS strict+PixiJS v8+vitest2+ESLint9 스캐폴드. sim 격리 lint(pixi/random/시간 금지). 시뮬 코어(math/rng/world/replay) + 결정론 테스트(틱별 해시 100% 일치). 렌더 어댑터(레터박스·보간·플레이스홀더). 벤치 씬 뼈대(?bench=1).
- **검증**: test 23 passed / lint 0 / build 성공. 브라우저 WASD 이동 확인.
- **커밋**: 07356e8, c93cea6, 20fac49, c33efaa, b9d6392

## API (src/sim/)
- `createWorld(seed, config?) → WorldState`, `stepWorld(state, input)` — 틱당 1회, 플레이어=entities[0]
- `InputFrame = { moveX, moveY, aim(rad), dash, special(비트플래그, SPECIAL_POWERUP_PICK 예약) }`
- `Entity = { id, kind, x, y, vx, vy, angle, radius, hp, timer, dashCooldown, iframes }`
- `WorldState = { tick, config, rng, wanderRng, entities, nextEntityId, playerId }`
- `SeededRng`: nextFloat/int/range/chance, `fork(streamId)` — 서브시스템별 스트림 분리
- `runReplay`, `hashWorld`, `ReplayRecorder`, `snapshotWorld`. 상수 TICK_RATE=60, DT=1/60, ARENA 1920×1080

## 주의점
1. 시뮬 코어 삼각함수는 반드시 `src/sim/math.ts` 사용 (Math.sin 직접 금지 — 컨벤션).
2. 새 RNG 스트림은 `world.rng.fork(이름)`을 WorldState에 영속 저장 (매 틱 fork 금지). 예시: wanderRng.
3. stepWorld는 in-place 뮤테이션이되 외부 입력 0 — 틱 순수함수 계약 유지.
4. 엔티티 float64 비트 해시 — 연산 순서 변경도 해시 갈림. 결정론 테스트 상시 유지.
5. `window.__pb` DEV 훅은 DEV 가드 (디버그·프레임 주입용).
6. 엔티티 kind 확장 시 `snapshotWorld`·`textures.ts`·`replay.ts hashEntity` 함께 갱신.
7. 벤치 실측(60fps)은 Phase 4로 이월. `.omc/state/sessions/**`는 하니스 파일 — 커밋 금지.
