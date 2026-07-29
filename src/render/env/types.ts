/**
 * 행성 환경 레이어 계약 (카르곤 AAA 배경 레인).
 *
 * ## 왜 계약을 먼저 두는가
 * 배경을 "AAA 급"으로 올리는 작업은 시차 원경·지형 데칼·용암 발광·대기 입자·컬러 그레이딩처럼
 * **서로 독립인 시각 레이어 여러 장**을 쌓는 일이다. 각 레이어를 별도 모듈로 두고 이 계약만
 * 지키게 하면 ①레인끼리 파일이 겹치지 않고 ②main.ts 배선은 {@link file://./planetEnvironment.ts}
 * 한 곳으로 모이며 ③레이어 하나를 꺼도 나머지가 그대로 동작한다(회귀 격리).
 *
 * ## 결정론(ADR-0005)
 * 여기 있는 모든 것은 **렌더 전용**이다. `src/sim/` 를 import 하지 않고, sim 상태를 쓰지 않으며,
 * 해시에 기여하지 않는다. 레이어가 위치 의존 난수를 쓸 때는 `Math.random` 이 아니라 반드시
 * {@link EnvContext.seed} + 정수 좌표의 순수 해시를 써야 한다 — 그래야 같은 시드의 리플레이가
 * 같은 배경을 재현한다(autotile.ts 의 `upperAt` 과 같은 규율).
 *
 * ## 좌표계
 * 레이어의 `view` 는 stage 직속으로 붙는다. 즉 **design 공간(1920×1080 기준)** 이며 카메라 팬은
 * 레이어가 직접 한다. 월드 좌표 (wx,wy) → stage 좌표는 EntityRenderer 와 동일하게
 * `wx - camX + DESIGN_WIDTH/2` 다. 화면에 고정하고 싶은 레이어(그레이딩·비네트)는 카메라를
 * 무시하고 {@link EnvFrame} 의 view 사각형만 쓰면 된다.
 */

import type { Container, Renderer } from 'pixi.js';

/**
 * 레이어가 붙는 스테이지 슬롯. 이름이 곧 렌더 순서(뒤 → 앞)다.
 *
 * - `far`   : 지형 바닥보다 **뒤**. 원경·시차 배경.
 * - `floor` : 지형 바닥 **위**, 엔티티 **아래**. 데칼·용암 발광·지형 음영.
 * - `over`  : 엔티티 **위**. 떠다니는 잔불·재·연기 같은 전경 대기.
 * - `post`  : 최상단(HUD 아래). 비네트·컬러 그레이딩 등 화면 전체 보정.
 */
export type EnvSlot = 'far' | 'floor' | 'over' | 'post';

/** 런 시작·행성 교체 시 한 번 주어지는 정적 맥락. */
export interface EnvContext {
  /** 행성 인덱스(0=카르곤). 레이어는 자기가 지원하지 않는 행성이면 스스로 비활성화한다. */
  planet: number;
  /** 런 시드. 위치 의존 난수의 **유일한** 허용 근원(Math.random 금지). */
  seed: number;
  /**
   * Pixi 렌더러. 절차적 스프라이트 텍스처를 `generateTexture` 로 굽는 용도다.
   * **텍스처는 첫 configure 에서 한 번만 굽고 캐시**한다 — 매 프레임/매 런 굽으면 GPU 메모리가
   * 샌다(런을 반복하면 누적된다). 테스트에서는 캔버스가 없어 이 값이 없을 수 있으므로
   * 레이어는 `renderer === undefined` 에서도 던지지 않아야 한다.
   */
  renderer?: Renderer;
}

/** 매 프레임 주어지는 동적 상태. */
export interface EnvFrame {
  /** 보간된 카메라 중심(월드 좌표). */
  camX: number;
  camY: number;
  /** 화면에 실제로 보이는 design 사각형(레터박스·비율 오버스캔 포함). */
  viewMinX: number;
  viewMinY: number;
  viewMaxX: number;
  viewMaxY: number;
  /** 보간된 sim 틱(소수). 결정적 애니메이션 위상의 기준. */
  tick: number;
  /** 프레임 델타(초). 벽시계 기반 부드러운 감쇠에만 쓴다(해시 무관). */
  dt: number;
}

/**
 * 환경 레이어 하나. 구현체는 `src/render/env/` 안에 파일 하나로 존재하고,
 * {@link file://./planetEnvironment.ts} 의 레지스트리에 등록된다.
 */
export interface EnvLayer {
  /** 진단·하네스 토글용 고유 이름. */
  readonly name: string;
  /** 붙는 슬롯. */
  readonly slot: EnvSlot;
  /** 이 레이어의 루트 컨테이너. 생성자에서 만들고 이후 교체하지 않는다. */
  readonly view: Container;
  /**
   * 런 시작·행성 교체. 지원하지 않는 행성이면 `false` 를 반환해 스스로 꺼진다
   * (컴포저가 `view.visible` 을 내린다).
   */
  configure(ctx: EnvContext): boolean;
  /** 매 프레임. `configure` 가 false 를 반환했으면 호출되지 않는다. */
  update(f: EnvFrame): void;
  /** 뷰포트 크기 변경(design 공간 가시 영역). */
  resize(width: number, height: number): void;
  destroy(): void;
}
