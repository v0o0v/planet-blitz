/**
 * 우상단 플레이어 중심 레이더(미니맵) — 렌더 전용(ADR-0009).
 *
 * 월드가 청크 기반 무한 스크롤(ADR-0002)이라 "전체 지도" 개념이 성립하지 않으므로,
 * 전체 맵이 아니라 플레이어 주변 중범위를 축소한 레이더로 그린다. 표시 대상은
 * 보스·엘리트, 드랍 장비(loot), 기믹·해저드뿐(잡몹 제외). 북 고정(회전 없음)이며
 * 렌더 스냅샷(sim/snapshot.ts)만 읽어 sim 결정론(ADR-0005)에 무관하다.
 *
 * 투영·클램프 수학은 순수 함수(`projectBlip`/`projectRadar`)로 분리해 vitest로
 * 단위 검증한다(shipFacing.ts 패턴). 실제 그리기만 PixiJS Graphics를 쓴다.
 */

import { Container, Graphics } from 'pixi.js';
import { atan2 } from '../sim/math.js';
import type { WorldSnapshot, EntitySnapshot } from '../sim/snapshot.js';

/** 레이더에 찍히는 대상군. 색·도형으로 구분한다(탄의 시각 문법과 별개 체계). */
export type RadarCategory = 'boss' | 'elite' | 'loot' | 'hazard' | 'gimmick' | 'objective';

/** 레이더 기하 설정. `scale = radius / range`. */
export interface RadarConfig {
  /** 레이더 원 반지름(px, 설계 1920x1080 공간). */
  radius: number;
  /** `radius`에 대응하는 월드 반경(월드 단위). 이 범위 밖은 테두리 화살표로 지시. */
  range: number;
}

/** 레이더 위에 찍을 한 대상의 결과(레이더 로컬 좌표 = 중심 원점, 북 고정). */
export interface RadarBlip {
  category: RadarCategory;
  /** 레이더 로컬 x(중심 기준 px). */
  x: number;
  /** 레이더 로컬 y(중심 기준 px). */
  y: number;
  /** 레이더 사거리 밖이라 테두리에 클램프됨(방향 화살표로 렌더). */
  edge: boolean;
  /** 플레이어→대상 월드 각도(테두리 화살표 방향; edge=false여도 계산됨). */
  angle: number;
}

/** 기본 레이더 설정: 반경 110px에 월드 1600단위를 담는다(화면 뷰포트보다 넓게). */
export const DEFAULT_RADAR: RadarConfig = { radius: 110, range: 1600 };

/** 대상군별 색(레이더 전용 팔레트). 탄 거동 색과 겹치지 않게 고른다. */
const CATEGORY_COLOR: Record<RadarCategory, number> = {
  boss: 0xff3355, // 붉은색 — 최우선 위협
  elite: 0xc060ff, // 보라색 — 엘리트
  loot: 0xffd24a, // 금색 — 드랍 장비
  hazard: 0xff7a1a, // 주황색 — 해저드(위험 지대)
  gimmick: 0x33ffcc, // 청록색 — 상호작용 기믹 장치
  objective: 0x7dff5a, // 연두색 — 지금 가야 할 목표(추격 대피소). 위협 색과 안 겹친다.
};

/** 대상군별 블립 반지름(px). 보스가 가장 크게 읽히도록 우선순위 부여. */
const CATEGORY_SIZE: Record<RadarCategory, number> = {
  boss: 6.5,
  elite: 4.5,
  loot: 4,
  hazard: 3.5,
  gimmick: 3.5,
  objective: 7, // 보스보다 크게 — 목표는 화면 밖에 있을 때도 가장 먼저 읽혀야 한다.
};

/**
 * 스냅샷 엔티티를 레이더 대상군으로 분류. 표시 대상이 아니면 null(잡몹·젬·탄·벽 등 제외).
 *  - 보스: kind 'boss'
 *  - 엘리트: 'enemy'이면서 elite 어픽스 보유(일반 잡몹 제외)
 *  - 드랍 장비: 'loot'(엘리트·보스 장비 드랍)
 *  - 해저드: 'hazard'
 *  - 기믹: 상호작용 장치(자석/폭탄/포탑). 벽·파괴물은 지형성이라 제외.
 */
export function classifyRadar(e: EntitySnapshot): RadarCategory | null {
  switch (e.kind) {
    case 'boss':
      return 'boss';
    case 'enemy':
      return e.elite >= 0 ? 'elite' : null;
    case 'loot':
      return 'loot';
    case 'hazard':
      return 'hazard';
    case 'magnetEmitter':
    case 'bombDevice':
    case 'turretPickup':
      return 'gimmick';
    case 'shelter':
      // 추격(Lane6) 대피소. **지금 세그먼트의 대피소만**(snapshot `active`) 찍는다 — 6개 전부
      // 찍으면 어느 것이 목표인지 레이더에서도 갈리지 않는다. 대피소 링 반경(1600)은 화면
      // 절반(960×540) 밖이라 레이더가 유일한 방향 단서다(사거리 밖이면 테두리 화살표).
      return e.active ? 'objective' : null;
    default:
      return null;
  }
}

/**
 * 플레이어 기준 월드 오프셋(dx,dy)을 레이더 로컬 좌표로 투영. 사거리 안이면 축척만
 * 적용하고, 밖이면 테두리 원에 클램프해 방향만 남긴다(ADR-0009: 거리 정보 없음).
 * 북 고정 — 회전 변환 없음.
 */
export function projectBlip(dx: number, dy: number, cfg: RadarConfig): { x: number; y: number; edge: boolean; angle: number } {
  const scale = cfg.radius / cfg.range;
  const rx = dx * scale;
  const ry = dy * scale;
  const angle = atan2(dy, dx);
  const dist = Math.hypot(rx, ry);
  if (dist <= cfg.radius) {
    return { x: rx, y: ry, edge: false, angle };
  }
  const inv = cfg.radius / dist; // dist > radius > 0
  return { x: rx * inv, y: ry * inv, edge: true, angle };
}

/**
 * 스냅샷에서 표시 대상만 골라 레이더 블립 목록으로 투영. 플레이어(px,py) 중심,
 * 북 고정. 순수 함수 — 렌더 상태에 의존하지 않아 단위 테스트로 검증 가능.
 */
export function projectRadar(
  px: number,
  py: number,
  entities: readonly EntitySnapshot[],
  cfg: RadarConfig,
): RadarBlip[] {
  const blips: RadarBlip[] = [];
  for (const e of entities) {
    const category = classifyRadar(e);
    if (category === null) continue;
    const p = projectBlip(e.x - px, e.y - py, cfg);
    blips.push({ category, x: p.x, y: p.y, edge: p.edge, angle: p.angle });
  }
  return blips;
}

/** 사거리 안 블립 도형을 대상군별로 그린다(로컬 좌표, 중심 원점). */
function drawInner(g: Graphics, b: RadarBlip): void {
  const color = CATEGORY_COLOR[b.category];
  const s = CATEGORY_SIZE[b.category];
  const { x, y } = b;
  switch (b.category) {
    case 'boss':
      // 다이아몬드(마름모) — 가장 크게.
      g.moveTo(x, y - s).lineTo(x + s, y).lineTo(x, y + s).lineTo(x - s, y).closePath().fill({ color });
      break;
    case 'elite':
      // 삼각형(위 꼭짓점).
      g.moveTo(x, y - s).lineTo(x + s, y + s).lineTo(x - s, y + s).closePath().fill({ color });
      break;
    case 'loot':
      // 사각형.
      g.rect(x - s, y - s, s * 2, s * 2).fill({ color });
      break;
    case 'hazard':
      // X 표식(위험).
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color, width: 2 });
      break;
    case 'gimmick':
      // 작은 원.
      g.circle(x, y, s).fill({ color });
      break;
    case 'objective':
      // 이중 링 + 중심 점(웨이포인트). 채운 도형들 사이에서 형태로도 구분된다.
      g.circle(x, y, s).stroke({ color, width: 2 });
      g.circle(x, y, s * 0.55).fill({ color });
      break;
  }
}

/** 사거리 밖 블립을 테두리 방향 화살표로 그린다(거리 정보 없음). */
function drawEdgeArrow(g: Graphics, b: RadarBlip): void {
  const color = CATEGORY_COLOR[b.category];
  const ca = Math.cos(b.angle);
  const sa = Math.sin(b.angle);
  const tip = 8; // 화살표 길이
  const half = 4; // 밑변 반폭
  // 테두리 지점(b.x,b.y)을 꼭짓점으로, 안쪽을 향해 삼각형을 그린다.
  const tx = b.x;
  const ty = b.y;
  const bx = b.x - ca * tip;
  const by = b.y - sa * tip;
  // 밑변 두 점(방향에 수직).
  const nx = -sa * half;
  const ny = ca * half;
  g.moveTo(tx, ty).lineTo(bx + nx, by + ny).lineTo(bx - nx, by - ny).closePath().fill({ color });
}

/**
 * PixiJS 레이더 위젯. `layer`를 stage에 추가하고 매 프레임 `render(snapshot)`로 갱신한다.
 * 위치(우상단)는 결선 측에서 `layer.position`으로 지정한다. 렌더 전용 — sim 미접촉.
 */
export class Radar {
  readonly layer = new Container();
  private readonly frame = new Graphics();
  private readonly blips = new Graphics();
  private readonly cfg: RadarConfig;

  constructor(cfg: RadarConfig = DEFAULT_RADAR) {
    this.cfg = cfg;
    this.drawFrame();
    this.layer.addChild(this.frame);
    this.layer.addChild(this.blips);
  }

  /** 레이더 원 반지름(px). 결선 측 우상단 배치 계산에 쓴다. */
  get radiusPx(): number {
    return this.cfg.radius;
  }

  /** 정적 배경(반투명 원 + 테두리 + 십자 눈금)을 한 번만 그린다. */
  private drawFrame(): void {
    const r = this.cfg.radius;
    this.frame.clear();
    this.frame
      .circle(0, 0, r)
      .fill({ color: 0x080a14, alpha: 0.62 })
      .stroke({ color: 0x2a3552, width: 2, alpha: 0.9 });
    // 십자 눈금(북 고정 참조선).
    this.frame
      .moveTo(-r, 0)
      .lineTo(r, 0)
      .moveTo(0, -r)
      .lineTo(0, r)
      .stroke({ color: 0x2a3552, width: 1, alpha: 0.5 });
  }

  /** 스냅샷을 읽어 블립을 다시 그린다. 플레이어가 없으면(메뉴 등) 위젯을 숨긴다. */
  render(snap: WorldSnapshot): void {
    const player = snap.entities.find((e) => e.kind === 'player');
    this.blips.clear();
    if (player === undefined) {
      this.layer.visible = false;
      return;
    }
    this.layer.visible = true;
    const blips = projectRadar(player.x, player.y, snap.entities, this.cfg);
    for (const b of blips) {
      if (b.edge) drawEdgeArrow(this.blips, b);
      else drawInner(this.blips, b);
    }
    // 플레이어 중심 마커(흰 점).
    this.blips.circle(0, 0, 2.5).fill({ color: 0xffffff });
  }

  destroy(): void {
    this.frame.destroy();
    this.blips.destroy();
    this.layer.destroy({ children: true });
  }
}
