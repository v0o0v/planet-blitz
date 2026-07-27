/**
 * 행성 인기 배율 클라 캐시 + 30분 폴링(ADR-0038).
 *
 * 서버가 30분마다 스냅샷을 굳히고, 클라는 그 표를 폴링해 캐시한 뒤 **런 시작에 스탬프**한다.
 * 런 중에 표가 갱신돼도 진행 중인 런은 출격 시점 값에 묶인다(설명가능성 + 서버 재검증 가능).
 *
 * ## 규율 — 무촉매 오프라인 런을 깨지 않는다
 * 이 저장소는 "촉매가 있을 때만 서버를 부르고, 없으면 서버 없이 출격한다"는 성질을 의도적으로
 * 보존해 왔다(`src/main.ts` `beginSortie`). 그래서 이 모듈은:
 *  - **출격 경로를 절대 블로킹하지 않는다.** `currentMultipliers()` 는 **동기**이고 캐시만 읽는다.
 *  - 폴링 실패·미설정·미로그인은 전부 **전 행성 1.0** 폴백이다(throw 없음).
 *  - 앱 시작과 30분 간격으로만 fire-and-forget 로 갱신한다.
 */

import type { NetDeps } from './index.js';
import {
  EPOCH_SECONDS,
  NEUTRAL_MULT_CENTI,
  PLANET_COUNT,
  neutralMultipliersCenti,
} from '../economy/planetPopularity.js';

/** 캐시된 배율표 스냅샷. `epoch` 은 서버가 그 표를 굳힌 30분 슬롯이다. */
export interface PlanetMultiplierSnapshot {
  /** 행성 인덱스별 배율(centi). 길이 = PLANET_COUNT. */
  readonly centi: readonly number[];
  /** 서버 스냅샷 epoch. 폴백(미설정/실패)이면 0 — 서버가 "표 없음"으로 읽는다. */
  readonly epoch: number;
  /** 서버에서 실제로 받아온 값인가(false = 중립 폴백). UI 가 "집계 대기" 표시에 쓴다. */
  readonly live: boolean;
}

/** 전 행성 1.0 폴백 — 오프라인·미로그인·게이트웨이 미설정·폴링 실패의 공통 결과. */
export const NEUTRAL_SNAPSHOT: PlanetMultiplierSnapshot = {
  centi: neutralMultipliersCenti(),
  epoch: 0,
  live: false,
};

let cached: PlanetMultiplierSnapshot = NEUTRAL_SNAPSHOT;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 지금 런에 스탬프할 배율표(**동기** — 캐시만 읽는다). 한 번도 갱신되지 않았거나 폴링이
 * 실패했으면 중립 스냅샷이다.
 */
export function currentMultipliers(): PlanetMultiplierSnapshot {
  return cached;
}

/** 행성 하나의 배율(centi). 범위 밖 인덱스는 중립. */
export function multCentiFor(planet: number): number {
  return cached.centi[planet] ?? NEUTRAL_MULT_CENTI;
}

/**
 * 서버에서 배율표를 1회 당겨 캐시를 갱신한다. **절대 throw 하지 않는다** — 실패하면 직전 캐시를
 * 유지하고(첫 실패면 중립 폴백 그대로) false 를 반환한다.
 *
 * 서버 행이 6개 미만이거나 행성 인덱스가 비면 그 자리는 중립으로 채운다(부분 표로도 동작).
 */
export async function refreshPlanetMultipliers(deps: NetDeps = {}): Promise<boolean> {
  try {
    // 순환 import 를 피하려고 지연 로드한다(index.ts 가 이 모듈을 다시 부르지는 않지만,
    // 번들 그래프를 단순하게 유지해 미설정 경로에 SDK 가 실리지 않게 한다).
    const { resolvePlanetMultiplierGateway } = await import('./index.js');
    const gateway = await resolvePlanetMultiplierGateway(deps);
    if (gateway === null || gateway.fetchPlanetMultipliers === undefined) return false;
    const rows = await gateway.fetchPlanetMultipliers();
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const centi = neutralMultipliersCenti();
    let epoch = 0;
    for (const row of rows) {
      const p = row.planet | 0;
      if (p < 0 || p >= PLANET_COUNT) continue;
      const c = row.mult_centi;
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) centi[p] = c | 0;
      // 서버는 한 스냅샷의 6행을 같은 epoch 으로 굳힌다. 섞여 오면 **가장 최신**을 택해,
      // 정산이 서버에 말하는 epoch 이 실제로 존재하는 스냅샷을 가리키게 한다.
      if (typeof row.epoch === 'number' && Number.isFinite(row.epoch) && row.epoch > epoch) {
        epoch = row.epoch | 0;
      }
    }
    cached = { centi, epoch, live: true };
    return true;
  } catch {
    return false;
  }
}

/**
 * 앱 시작 시 1회 호출 — 즉시 한 번 갱신하고 이후 30분 간격으로 폴링한다. 이미 시작됐으면 no-op.
 * 타이머는 `unref` 하지 않는다(브라우저에는 개념이 없고, 테스트는 {@link stopPlanetMultiplierPolling}
 * 로 정리한다).
 */
export function startPlanetMultiplierPolling(deps: NetDeps = {}): void {
  if (timer !== null) return;
  void refreshPlanetMultipliers(deps);
  timer = setInterval(() => void refreshPlanetMultipliers(deps), EPOCH_SECONDS * 1000);
}

/** 폴링 중단 + 캐시 초기화(테스트·화면 종료용). */
export function stopPlanetMultiplierPolling(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  cached = NEUTRAL_SNAPSHOT;
}
