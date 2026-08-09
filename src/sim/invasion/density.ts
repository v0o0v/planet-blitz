/**
 * 침공 밀도 축 — 정본 (2026-08-10 밀도 레인).
 *
 * ## 왜 새 축인가
 * 침공은 행성런과 **같은 결의 슈팅**이어야 하는데(사용자 결정 2026-08-10) 실측 밀도가
 * 자릿수로 달랐다:
 *
 * | | 행성런 | 침공(구) |
 * |---|---|---|
 * | 스폰 주기 | 카드 150~220틱 | L1 편대 **720틱(12초)** |
 * | 동시 적 상한 | 세그먼트별 12→44 (`data/waves.ts` SEGMENTS) | L1 상한 없음(편대 정의가 총량) |
 * | L2 이동 적 | — | 스포너 최대 1기 × 3 = **0~3마리** |
 * | L3 추가 스폰 | 보스 세그먼트도 cardInterval 200 | **0** (1회 배치가 전부) |
 *
 * L2 가 "0 아니면 3"인 것은 밴드 램프의 산식 결과다 — 설비 선택이
 * `catalogId = (i + shift) % kinds` 라 17종 중 스포너(id 5)가 창에 걸릴 때만 1기 들어온다.
 *
 * ## 설계 규율 — 기존 3규율을 하나도 깨지 않는다
 * ① **RNG 미소비.** 여기 값들은 전부 정수 상수이며 스폰 경로는 여전히 `summonEnemy` 만 쓴다.
 * ② **플레이어 좌표 비의존.** 반복 차수 변주는 `k` 의 정수 함수다(시드·좌표 미참조).
 * ③ **상태 없는 정수 등식 트리거.** 이것이 밀도 설계를 좁혔다 — "동시 적 수가 상한 아래면
 *    다음 편대를 당긴다"는 피드백 게이트는 `alive` 를 읽어야 하고, 그러면
 *    `formationSpawnedCount`(접미 어픽스 `alliesDestroyed` 의 입력)가 스케줄의 순수 함수라는
 *    전제가 깨진다. 그래서 **간격 압축 + 반복 순회**로만 민다 —
 *    `(i + k*INVASION_WAVE_SLOTS) * interval + delayTicks` 는 여전히 순수 등식이다.
 *
 * ## 편성 슬롯은 6칸 그대로다
 * 밀도를 올리려고 `INVASION_WAVE_SLOTS` 를 늘리지 않았다. 그 상수는 관제탑 UI·방어 사령부·
 * DB 제약(`invasion_layers_valid`)·밴드 램프 SQL 이 함께 보는 편성 계약이라, 늘리면 기존 유저
 * 방어 배치가 반쪽이 된다. 대신 런타임이 같은 6칸을 **여러 바퀴 돈다**.
 *
 * ## 튜닝 방법
 * 전 필드가 하네스 침공 탭 슬라이더로 노출된다(`src/harness/cheatPanel.ts`). 기준선은
 * **기본 수비대만 있는 상태**(아무것도 배치 안 한 방어)를 만렙 기체가 어느 정도 클리어하는
 * 지점이며, 사용자가 직접 플레이해 정한다. 여기 기본값은 그 출발점일 뿐이다.
 */

/**
 * 밀도 파라미터 묶음. **전 필드 정수**(ADR-0005 — f64 를 sim 입력에 넣지 않는다).
 * 부분 지정이 가능하며 미지정 필드는 {@link INVASION_DENSITY_DEFAULT} 로 메워진다.
 */
export interface InvasionDensity {
  /**
   * L1 웨이브 슬롯 간 간격(틱). 구값 720(12초) → 행성런 `cardInterval`(150~220틱) 대역.
   * 하한 30 — 이보다 짧으면 한 슬롯의 구성원 `delayTicks` 가 다음 슬롯을 추월해 편대 형태가
   * 뭉갠다.
   */
  l1IntervalTicks: number;
  /**
   * L1 편대 반복 순회 횟수. 1 = 구 거동(6칸을 한 바퀴만). k 바퀴째 슬롯 i 의 트리거는
   * `(i + k*6) * l1IntervalTicks` 라 등식 트리거가 유지된다.
   *
   * ⚠️ `l1IntervalTicks × (6 × l1Repeats - 1)` 이 L1 예산(5400틱)을 넘으면 뒤쪽 반복이
   * 강제 전이에 잘린다. {@link invasionL1ScheduleSpan} 이 그 값을 돌려준다.
   */
  l1Repeats: number;
  /**
   * L2 배경 편대 간격(틱). 0 = 끔.
   *
   * L2 밀도를 스포너만으로 올릴 수 없어서 필요하다 — 스포너는 **유저가 배치한 설비**라
   * 런타임이 늘릴 수 없고(배치 위조), 배치 안 한 기지에는 아예 없다. 배경 편대는 설비와
   * 독립적으로 L1 편성을 재사용해 회랑에 병력을 흘려보낸다.
   */
  l2FormationIntervalTicks: number;
  /**
   * L2 스포너 1기당 동시 생존 상한 **가산분**. 카탈로그 `spawnMaxAlive`(드론 스포너 3)에
   * 더해진다. 어픽스 `defSpawnCapFlat` 과 같은 가산 축이라 자연스럽게 합쳐진다.
   */
  l2SpawnAliveAdd: number;
  /**
   * 빈 L2 소켓을 기본 수비대가 채울 때 **스포너로** 채울 기수. 나머지 빈 소켓은 종전대로
   * 속사포. 0 이면 구 거동(전부 속사포 = 이동 적 0마리).
   *
   * 배치된 소켓은 건드리지 않는다 — 유저가 꽂은 설비를 런타임이 바꾸면 배치 계약이 깨진다.
   */
  l2GarrisonSpawners: number;
  /**
   * L3 코어 증원 간격(틱). 0 = 끔. 코어 HP 가 낮을수록 짧아진다
   * ({@link invasionCoreAddInterval}) — 행성런 보스 세그먼트가 `cardInterval: 200` 으로
   * 보스전 중에도 잡몹을 계속 내보내는 것과 같은 의도다.
   */
  l3AddIntervalTicks: number;
  /** L3 코어 증원의 동시 생존 상한. 0 = 끔. */
  l3AddMaxAlive: number;
}

/**
 * 구 거동을 정확히 재현하는 값 묶음. 하네스가 "밀도 이전"과 A/B 하거나, 회귀를 짚을 때 쓴다.
 * 이 값으로 돌리면 밀도 레인 이전과 **스폰이 바이트 동일**해야 한다.
 */
export const INVASION_DENSITY_LEGACY: InvasionDensity = {
  l1IntervalTicks: 720,
  l1Repeats: 1,
  l2FormationIntervalTicks: 0,
  l2SpawnAliveAdd: 0,
  l2GarrisonSpawners: 0,
  l3AddIntervalTicks: 0,
  l3AddMaxAlive: 0,
};

/**
 * 현행 기본값 — 밀도 상향 출발점.
 *
 * ## L1 값의 근거 (`pnpm bench:density` 실측, 2026-08-10 · 빈 배치 · 무입력)
 *
 * | 간격 | 바퀴 | span | L1 지속 | 총 스폰 | 동시 피크 |
 * |---|---|---|---|---|---|
 * | 720 | 4 | 예산 초과 | 3455t | 25 | **5** ← 구값. "적이 없다"의 실체 |
 * | 200 | 4 | 4600 | 5344t | 120 | 6 |
 * | 100 | 8 | 4700 | 5399t | 240 | 12 |
 * | **90** | **8** | **4230** | **5190t** | **240** | **15** ← 채택 |
 * | 80 | 8 | 3760 | 5400t | 220 | 20 |
 * | 60 | 4 | 1380 | 5399t | 120 | 78 ← 절벽 |
 *
 * 참고선은 행성런의 세그먼트별 동시 적 상한 12→44(`data/waves.ts` SEGMENTS)다. 기준선이
 * **가장 약한 방어(기본 수비대만)** 이므로 그 곡선의 아래쪽(12~20)을 겨눴고, 배치물·계보가
 * 그 위에 얹힌다.
 *
 * 60틱 아래의 절벽은 눈속임이 아니라 **국면 전환**이다: 적이 안 줄어들면 "구간 전멸"이 안
 * 걸려 스크롤 가속(`INVASION_ACCEL_*`)이 안 붙고, L1 이 예산 끝까지 늘어지며 적이 계속
 * 쌓인다. 그래서 90 은 그 절벽에서 충분히 떨어져 있고, span 4230 이 예산 5400 안이라
 * 마지막 바퀴가 잘리지도 않는다.
 *
 * ⚠️ 이 값들은 **무입력 상한**에서 고른 출발점이다. 실제 플레이어는 적을 잡으므로 체감은
 * 이보다 옅다 — 확정은 사용자가 하네스에서 직접 플레이해 정한다(사용자 결정 2026-08-10).
 * L2·L3 값은 아직 같은 밀도의 실측을 못 거쳤다(L1 만 스윕했다).
 */
export const INVASION_DENSITY_DEFAULT: InvasionDensity = {
  l1IntervalTicks: 90,
  l1Repeats: 8,
  l2FormationIntervalTicks: 300,
  l2SpawnAliveAdd: 2,
  l2GarrisonSpawners: 3,
  l3AddIntervalTicks: 60,
  l3AddMaxAlive: 24,
};

// ---------------------------------------------------------------------------
// 정규화 — 손상 입력 방어 (전부 정수 클램프)
// ---------------------------------------------------------------------------

/** 정수 클램프. 비유한·소수 입력을 기본값으로 떨어뜨린다. */
function clampInt(raw: number | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  const v = Math.trunc(raw);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 밀도 입력을 정규형으로 접는다. 미지정 = {@link INVASION_DENSITY_DEFAULT}.
 * 상한은 성능 폭주 방지선이지 밸런스 판단이 아니다.
 */
export function normalizeInvasionDensity(raw?: Partial<InvasionDensity>): InvasionDensity {
  const d = INVASION_DENSITY_DEFAULT;
  return {
    l1IntervalTicks: clampInt(raw?.l1IntervalTicks, d.l1IntervalTicks, 30, 3600),
    l1Repeats: clampInt(raw?.l1Repeats, d.l1Repeats, 1, 32),
    l2FormationIntervalTicks: clampInt(raw?.l2FormationIntervalTicks, d.l2FormationIntervalTicks, 0, 3600),
    l2SpawnAliveAdd: clampInt(raw?.l2SpawnAliveAdd, d.l2SpawnAliveAdd, 0, 32),
    l2GarrisonSpawners: clampInt(raw?.l2GarrisonSpawners, d.l2GarrisonSpawners, 0, 12),
    l3AddIntervalTicks: clampInt(raw?.l3AddIntervalTicks, d.l3AddIntervalTicks, 0, 3600),
    l3AddMaxAlive: clampInt(raw?.l3AddMaxAlive, d.l3AddMaxAlive, 0, 64),
  };
}

// ---------------------------------------------------------------------------
// 파생 — 순수 정수 함수(테스트가 직접 검증한다)
// ---------------------------------------------------------------------------

/** L1 편대가 도는 총 바퀴 수 × 슬롯 = 전체 웨이브 수. */
export function invasionL1WaveCount(density: InvasionDensity, slots: number): number {
  return slots * density.l1Repeats;
}

/**
 * 마지막 웨이브의 슬롯 트리거 틱(구성원 `delayTicks` 제외). 예산 초과 진단용.
 * 웨이브가 0개면 0.
 */
export function invasionL1ScheduleSpan(density: InvasionDensity, slots: number): number {
  const waves = invasionL1WaveCount(density, slots);
  if (waves <= 0) return 0;
  return (waves - 1) * density.l1IntervalTicks;
}

/**
 * 반복 차수 k 의 좌우 변주 오프셋(월드 유닛). 같은 편대가 같은 자리에 겹쳐 나와 단조로워지는
 * 것을 막는다. **시드를 쓰지 않는다** — k 의 순수 정수 함수라 RNG 미소비 규율이 유지된다.
 *
 * 331 은 801 과 서로소라 k 가 도는 동안 오프셋이 -400..400 을 고르게 훑는다.
 */
export function invasionL1RepeatOffsetX(repeatIndex: number): number {
  if (repeatIndex <= 0) return 0;
  return ((repeatIndex * 331) % 801) - 400;
}

/** 코어 HP 백분율 하한 — 이보다 낮아도 증원 간격이 더 짧아지지는 않는다. */
export const INVASION_CORE_ADD_MIN_PCT = 40;

/**
 * 코어 HP 비율에 따른 증원 간격(틱). 코어가 깎일수록 짧아진다(막판 압박).
 * 100% → 그대로, 40% 이하 → 0.4배. 정수 산술.
 */
export function invasionCoreAddInterval(base: number, coreHpPct: number): number {
  if (base <= 0) return 0;
  const pct = coreHpPct < INVASION_CORE_ADD_MIN_PCT ? INVASION_CORE_ADD_MIN_PCT : coreHpPct > 100 ? 100 : coreHpPct;
  const v = Math.round((base * pct) / 100);
  return v < 1 ? 1 : v;
}
