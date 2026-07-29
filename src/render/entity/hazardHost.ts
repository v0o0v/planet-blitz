/**
 * 해저드 렌더 **진입점** — 장판 그리기와 재질(material) 확장 지점을 한곳에 모은다.
 *
 * ## 왜 옮겼는가
 * 해저드는 스프라이트가 없다. `entityRenderer.drawOverlay` 안의 루프가 `Graphics` 에 직접
 * 원과 빗금을 그렸고, 그래서 해저드 레인이 셰이더·입자·텍스처 재질을 붙이려면 **공유 파일의
 * 같은 줄**을 고쳐야 했다. 이 모듈이 그 루프를 통째로 받아, 레인은 여기 등록만 한다
 * ({@link registerHazardMaterialFactory}) — 장식자 심({@link file://./adorner.ts})과 같은 규율이다.
 *
 * ## 이관 시점의 계약: 그림은 그대로다
 * 지금 이 모듈이 하는 일은 이전 루프와 **바이트 단위로 같은 순서의 그리기 호출**이다:
 * 용암은 `lava` 캔버스로, 나머지는 `base` 로, 장식 예산은 프레임당
 * {@link MAX_DECORATED_HAZARDS} 개까지. 재질 팩토리가 하나도 없으면 {@link HazardHost.view} 는
 * 빈 컨테이너라 아무것도 그리지 않는다.
 *
 * ## 계약
 * - **render-only**(ADR-0005). `src/sim/` 은 타입·상수만 읽고 해시에 기여하지 않는다.
 * - 재질은 {@link HazardHostContext.gates} 뒤에 있어야 한다(티어 게이트 필수).
 * - **색 외 채널을 지워선 안 된다** — 빗금·점선·수렴 링은 색약 사용자에게 정보가 남는 유일한
 *   경로다. 재질은 그 위에 얹는 것이지 대체하는 것이 아니다.
 * - 재질 컨테이너는 {@link HazardMaterial.dispose} 가 명시 회수한다(장판 소멸·reset·destroy).
 */

import { Container } from 'pixi.js';

import type { EntitySnapshot } from '../../sim/snapshot.js';
import { HAZARD_LAVA } from '../../sim/patterns/types.js';
import type { EnvTheme } from '../env/theme.js';
import type { EffectGates, QualityTier } from '../qualityTier.js';
import {
  DECOR_MIN_RADIUS,
  MAX_DECORATED_HAZARDS,
  drawHazardZone,
  hazardVisual,
  type HazardCanvas,
  type HazardVisual,
} from '../hazardVisual.js';

/** 장판 하나의 이번 프레임 상태(재질이 읽는 전부). 순수 데이터 — 그리기는 하지 않는다. */
export interface HazardZone {
  /** 엔티티 id. 재질 수명의 키다. */
  readonly id: number;
  /** 월드 좌표 중심. */
  readonly x: number;
  readonly y: number;
  /** 판정 반경(월드 유닛). **재질이 이 경계를 흐리면 안 된다** — 안쪽 립을 유지해라. */
  readonly radius: number;
  /** 해저드 subtype 코드(`HAZARD_LAVA` 등). 재질 팩토리의 등록 키다. */
  readonly subtype: number;
  /** 활성(피해 중)인가. false = 예열. */
  readonly active: boolean;
  /** 영구 지형(청크 배치)인가. subtype 2 의 감속↔피해지형을 가르는 유일한 신호다. */
  readonly permanent: boolean;
  /** 이번 프레임의 표시 서술(색·채움·빗금 여부). */
  readonly visual: HazardVisual;
  /** 이번 프레임 장식 예산을 받았는가. false 면 재질도 최소 표현으로 낮춰라. */
  readonly decorated: boolean;
}

/** 매 프레임 재질에게 주어지는 읽기 전용 맥락. 프레임당 한 번 만들어 전 재질이 공유한다. */
export interface HazardHostContext {
  /** 재질 레이어가 붙는 컨테이너({@link HazardHost.view}). 장판 채움 위·스프라이트 아래다. */
  readonly layer: Container;
  /** 렌더 프레임 카운터(결정적 애니메이션 위상). */
  readonly frameTick: number;
  /** 프레임 델타(초). */
  readonly dt: number;
  /** 이번 프레임 이펙트 게이트. */
  readonly gates: EffectGates;
  /** 이번 프레임 실 품질 티어. */
  readonly tier: QualityTier;
  /** 이번 런의 환경 테마(광원 정본). null = 담당 테마 없음. */
  readonly theme: EnvTheme | null;
}

/** 장판 하나에 붙는 재질. 수명은 장판 엔티티와 평행하다. */
export interface HazardMaterial {
  /** 진단·테스트 식별용 이름(선택). */
  readonly name?: string;
  /** 첫 등장 1회. 컨테이너 생성·`ctx.layer` 부착은 여기서. */
  onAttach?(zone: HazardZone, ctx: HazardHostContext): void;
  /** 매 프레임. */
  onFrame(zone: HazardZone, ctx: HazardHostContext): void;
  /** 회수. 자기 컨테이너를 떼고 파괴한다. 두 번 불려도 안전해야 한다. */
  dispose(ctx: HazardHostContext): void;
}

/** subtype 하나에 대해 재질 목록을 만드는 팩토리. */
export type HazardMaterialFactory = (zone: HazardZone) => HazardMaterial[];

/** 재질이 없을 때 쓰는 공유 빈 배열(오염 셀처럼 장판이 많을 때 할당 0). */
const NO_MATERIALS: readonly HazardMaterial[] = Object.freeze([]);

/** subtype → 팩토리 목록. 등록 순서가 곧 호출 순서다. */
const registry = new Map<number, HazardMaterialFactory[]>();

/**
 * 재질 팩토리를 등록한다. **해저드 레인은 자기 모듈에서 한 번만** 부른다(함수 호출식 등록이라
 * 다른 레인과 같은 줄을 다투지 않는다).
 */
export function registerHazardMaterialFactory(subtype: number, factory: HazardMaterialFactory): void {
  const list = registry.get(subtype);
  if (list === undefined) registry.set(subtype, [factory]);
  else list.push(factory);
}

/** 등록된 재질 팩토리 수(진단·테스트용 관측창). */
export function hazardMaterialFactoryCount(subtype: number): number {
  return registry.get(subtype)?.length ?? 0;
}

/** 레지스트리를 비운다. **테스트 격리 전용**. */
export function clearHazardMaterialFactories(): void {
  registry.clear();
}

/** 이 장판에 붙일 재질을 만든다. 등록이 없으면 공유 빈 배열(할당 0 · 거동 불변). */
function createMaterials(zone: HazardZone): readonly HazardMaterial[] {
  const list = registry.get(zone.subtype);
  if (list === undefined || list.length === 0) return NO_MATERIALS;
  const out: HazardMaterial[] = [];
  for (const f of list) {
    for (const m of f(zone)) out.push(m);
  }
  return out.length === 0 ? NO_MATERIALS : out;
}

/** 장판 하나의 살아있는 재질 묶음(수명 추적용). */
interface MaterialEntry {
  materials: readonly HazardMaterial[];
  seenTick: number;
}

/**
 * 해저드 렌더 호스트. 렌더러가 하나를 소유하고 매 프레임 {@link draw} 를 부른다.
 *
 * 재질 수명은 스프라이트 캐시와 같은 규율이다: 이번 프레임에 안 보인 장판의 재질은 즉시
 * 회수한다(장판은 예열↔활성을 오갈 뿐 아니라 통째로 사라지므로, 안 걷으면 재질이 빈 바닥에
 * 남는다 — 접지 그림자가 밟았던 자리와 같다).
 */
export class HazardHost {
  /**
   * 재질 레이어가 붙는 컨테이너. 렌더러가 장판 오버레이 **위**, 스프라이트 **아래**에 끼운다.
   * 재질 팩토리가 없으면 자식 0 이라 아무것도 그리지 않는다(거동 불변의 근거).
   */
  readonly view = new Container();

  /** 엔티티 id → 살아있는 재질. */
  private readonly materials = new Map<number, MaterialEntry>();
  /** 프레임 카운터(seen 판정용). {@link draw} 마다 1 증가한다. */
  private tick = 0;

  /** 현재 살아있는 재질 묶음 수(읽기 전용 관측창). 렌더 거동에는 관여하지 않는다. */
  get materialCount(): number {
    return this.materials.size;
  }

  /**
   * 이번 프레임의 해저드를 전부 그린다.
   *
   * @param entities 현재 스냅샷의 엔티티 전체(해저드만 골라 쓴다).
   * @param base     비-용암 장판을 그릴 캔버스(`overlay`).
   * @param lava     용암 장판을 그릴 캔버스(`lavaOverlay` — 시머가 여기만 흔든다).
   * @param ctx      이번 프레임 맥락(`layer` 는 {@link view} 여야 한다).
   */
  draw(
    entities: readonly EntitySnapshot[],
    base: HazardCanvas,
    lava: HazardCanvas,
    ctx: HazardHostContext,
  ): void {
    this.tick++;
    // 장식 예산: 프레임당 상한을 넘긴 장판은 채움+테두리만 그린다(오염 셀 다수 성능 방어).
    let decorBudget = MAX_DECORATED_HAZARDS;
    for (const e of entities) {
      if (e.kind !== 'hazard') continue;
      // 색 = 성질(아프다/방해만), 형태 = 상태(예열 점선 / 활성 실선+빗금). `permanent` 는 같은
      // 코드를 쓰는 감속 지대와 피해 지형을 가르는 유일한 신호다(hazardVisual.ts 주석 참조).
      const permanent = e.permanent === true;
      const v = hazardVisual(e.enemyType, e.active, permanent);
      const target = e.enemyType === HAZARD_LAVA ? lava : base;
      const decor = decorBudget > 0;
      if (decor && e.radius >= DECOR_MIN_RADIUS) decorBudget--;
      drawHazardZone(target, e.x, e.y, e.radius, v, ctx.frameTick, decor);

      const zone: HazardZone = {
        id: e.id,
        x: e.x,
        y: e.y,
        radius: e.radius,
        subtype: e.enemyType,
        active: e.active,
        permanent,
        visual: v,
        decorated: decor && e.radius >= DECOR_MIN_RADIUS,
      };
      this.syncMaterials(zone, ctx);
    }
    this.pruneMaterials(ctx);
  }

  /** 장판 하나의 재질을 유지·갱신한다(없으면 만든다). 등록이 없으면 추적조차 하지 않는다. */
  private syncMaterials(zone: HazardZone, ctx: HazardHostContext): void {
    let entry = this.materials.get(zone.id);
    if (entry === undefined) {
      const created = createMaterials(zone);
      if (created.length === 0) return; // 재질 없음 = 추적 없음(Map 성장 0).
      entry = { materials: created, seenTick: this.tick };
      this.materials.set(zone.id, entry);
      for (const m of created) m.onAttach?.(zone, ctx);
    }
    entry.seenTick = this.tick;
    for (const m of entry.materials) m.onFrame(zone, ctx);
  }

  /** 이번 프레임에 안 보인 장판의 재질을 회수한다(장판 소멸 경로). */
  private pruneMaterials(ctx: HazardHostContext): void {
    if (this.materials.size === 0) return;
    for (const [id, entry] of this.materials) {
      if (entry.seenTick === this.tick) continue;
      for (const m of entry.materials) m.dispose(ctx);
      this.materials.delete(id);
    }
  }

  /**
   * 살아있는 재질을 전부 회수한다(런 전환·렌더러 파괴). {@link view} 컨테이너 자체는 건드리지
   * 않는다 — 렌더러 `reset` 은 레이어를 살려 두고, `destroy` 는 `layer.destroy({children:true})`
   * 가 자식으로서 이 view 를 회수한다.
   */
  clear(ctx: HazardHostContext): void {
    for (const entry of this.materials.values()) {
      for (const m of entry.materials) m.dispose(ctx);
    }
    this.materials.clear();
  }
}
