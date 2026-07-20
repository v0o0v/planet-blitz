/**
 * 방어 배치 프리뷰 — **진입점 스텁** (M7a · L11-legacy-purge).
 *
 * ## 왜 스텁인가
 * 구 구현은 15×9 격자 · 포탑 6종 · `DefenseLayout`(코어/포탑/장애물)을 전제로 침공 정지 월드를
 * 한 프레임 그렸다. M7a 에서 침공이 3레이어(L1 대기권 종스크롤 → L2 회랑 횡스크롤 → L3 코어방)
 * 로 바뀌면서 그 전제가 통째로 사라졌다 — 격자도, 포탑도, 단일 아레나 카메라도 없다.
 * 3레이어 프리뷰(레이어 탭별 미리보기)는 **M7b-command-ui 레인**이 새 방어 사령부와 함께
 * 다시 만든다(레인 문서 M7b-command-ui 소유 파일 목록에 이 경로가 들어 있다).
 *
 * 그때까지 이 파일은 **계약만 남긴 no-op**이다. 파일을 지우지 않고 스텁으로 두는 이유:
 * 소비 측(main.ts)이 프리뷰를 다시 붙일 때 import 경로·인터페이스를 그대로 쓰게 해서,
 * M7b 가 "새 파일을 어디에 만들지"가 아니라 "이 안을 채우면 된다"가 되게 하려는 것이다.
 *
 * ## 지금 이 스텁을 쓰면 어떻게 되는가
 * 아무것도 그리지 않는다(무해). 렌더 대상이 없다는 것이 **조용한 결함이 아니라 설계된 상태**임을
 * 분명히 하려고 `active` 는 항상 false 를 돌려준다 — "켰는데 안 보인다"를 디버깅하는 대신
 * 이 주석에 도달하도록.
 */

import type { InvasionLayers } from '../sim/invasion/types.js';

/**
 * 프리뷰 제어 계약. M7b 방어 사령부(Pixi)가 소비한다. 좌표계·격자 환산 API(구 `clientToCell`)는
 * 3레이어에 격자 개념이 없어 계약에서 제외했다 — 레이어별 미리보기는 슬롯 목록 UI 가 주도하고
 * 프리뷰는 "그 배치로 만든 월드를 보여주는" 역할만 진다.
 */
export interface DefensePreviewControls {
  /** 프리뷰를 켠다. `layers` 가 null 이면 빈 화면(배치 없음). */
  start(layers: InvasionLayers | null): void;
  /** 프리뷰를 끈다(자원 정리). */
  stop(): void;
  /** 배치가 바뀌면 다시 그린다. */
  setLayers(layers: InvasionLayers | null): void;
  /** 프리뷰가 켜져 있는지. */
  readonly active: boolean;
}

/**
 * no-op 프리뷰. M7b 가 3레이어 렌더 구현으로 교체한다. 인스턴스를 만들어도 stage 에 아무것도
 * 붙이지 않으므로 화면·렌더 루프에 영향이 없다.
 */
export class DefensePreviewController implements DefensePreviewControls {
  get active(): boolean {
    return false;
  }

  start(_layers: InvasionLayers | null): void {
    /* M7b-command-ui 에서 구현 — 3레이어 레이어별 프리뷰. */
  }

  stop(): void {
    /* no-op */
  }

  setLayers(_layers: InvasionLayers | null): void {
    /* no-op */
  }
}
