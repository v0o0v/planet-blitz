/**
 * 주기 온오프 해저드 상태머신 — 순수 정수 함수 (M7a · L4-facility).
 *
 * ## 왜 신설했나
 * 현행 해저드(`spawnHazard` + `stepHazards`, src/sim/world.ts)는 **windup 1회 → active 1회 →
 * 소멸**, 또는 `life < 0` 인 영구 지형 둘뿐이다. 레이저 격자처럼 "켜졌다 꺼졌다"를 반복하는
 * 리듬은 `timer`/`life` 만으로 표현할 수 없다.
 *
 * ## 설계 — 상태를 들고 있지 않는다
 * 엔티티에 주기 상태를 새로 얹는 대신, **주기의 시작 틱마다 기존 `spawnHazard` 로 장판을 새로
 * 융기**시킨다. 그러면
 *   ① 예열(windup)·활성(life) 처리는 world.ts 의 기존 `stepHazards`·`hazardActive` 가 그대로
 *      해 주고(신규 world.ts 코드 0줄),
 *   ② 설비가 파괴되면 융기가 멈추므로 장판이 자연히 사라지며,
 *   ③ 온오프 시각이 **틱의 순수 함수**라 재현·검증이 자명하다.
 *
 * 이 모듈은 그 "언제 켜지는가"만 정수 산술로 계산한다. 상태·부동소수·RNG 를 쓰지 않는다.
 *
 * ## 주기 구조 (period = windup + on + off)
 * ```
 *   pos:  0 ............ windup ............ windup+on ............ period
 *         |<-- 예열(무피해) -->|<-- 활성(피해) -->|<-- 휴지(없음) -->|
 * ```
 */

/**
 * 주기 안에서의 위치(0 .. periodTicks-1)를 구한다.
 *
 * `phaseOffset` 은 소켓마다 다른 값을 줘 격자를 엇갈리게 만드는 용도다. 음수 틱·음수 오프셋도
 * 항상 [0, period) 로 접는다(JS `%` 는 음수에서 음수를 돌려주므로 한 번 더 보정한다).
 * period <= 0 은 "주기 없음"이라 항상 0 을 돌려준다.
 */
export function cyclePosition(tick: number, periodTicks: number, phaseOffset: number): number {
  if (periodTicks <= 0) return 0;
  const raw = (tick - phaseOffset) % periodTicks;
  return raw < 0 ? raw + periodTicks : raw;
}

/**
 * 이번 틱이 주기의 **시작 틱**(장판을 새로 융기시키는 순간)인가.
 * `cyclePosition === 0` 과 동치다.
 */
export function isCycleSpawnTick(tick: number, periodTicks: number, phaseOffset: number): boolean {
  return cyclePosition(tick, periodTicks, phaseOffset) === 0;
}

/**
 * 이번 틱에 장판이 **피해를 주는가**(예열이 끝났고 활성 구간 안인가).
 *
 * 반열린 구간 [windup, windup+on) 이다 — 경계 틱 계약:
 *   pos === windup - 1  → false(아직 예열)
 *   pos === windup      → true (활성 첫 틱)
 *   pos === windup+on-1 → true (활성 마지막 틱)
 *   pos === windup+on   → false(휴지 첫 틱)
 * on <= 0 이면 항상 false.
 */
export function isCycleOn(
  tick: number,
  periodTicks: number,
  windupTicks: number,
  onTicks: number,
  phaseOffset: number,
): boolean {
  if (onTicks <= 0) return false;
  if (periodTicks <= 0) return true; // 주기 없음 = 상시 활성(영구 장판)
  const pos = cyclePosition(tick, periodTicks, phaseOffset);
  return pos >= windupTicks && pos < windupTicks + onTicks;
}

/**
 * 소켓 인덱스에서 결정론 위상 오프셋을 파생한다(RNG 미소비).
 *
 * 같은 템플릿의 레이저 격자들이 일제히 켜지면 리듬이 아니라 벽이 되므로, 소켓마다 주기를
 * 균등 분할해 엇갈리게 한다. 정수 나눗셈만 쓴다(`Math.floor` 는 정확).
 */
export function socketPhaseOffset(socketIndex: number, periodTicks: number, socketCount: number): number {
  if (periodTicks <= 0 || socketCount <= 0) return 0;
  const i = socketIndex % socketCount;
  return Math.floor((i * periodTicks) / socketCount);
}
