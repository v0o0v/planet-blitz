/**
 * Renders simulation snapshots to PixiJS sprites with interpolation.
 *
 * The sim advances at a fixed 60 Hz, but the display may refresh at any rate.
 * Each render frame we interpolate between the previous and current sim snapshot
 * by `alpha` (the fractional progress toward the next tick), so motion looks
 * smooth regardless of monitor refresh. The sim itself is never touched here —
 * render reads immutable snapshots only (sim/render separation, ADR-0005).
 *
 * Sprites cover point-like entities (player, enemies, bullets, gems). Hazards
 * (telegraphed zones) and support heal beams have per-frame variable geometry,
 * so they are drawn into a Graphics overlay from the current snapshot each frame.
 */

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { WorldSnapshot, EntitySnapshot } from '../sim/snapshot.js';
import type { EntityKind } from '../sim/entities.js';
import type { PlaceholderTextures } from './textures.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';
import { shipFacing } from './shipFacing.js';
import { facilitySpecFor } from '../../data/invasion/facilities.js';
import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../sim/patterns/types.js';

interface TrackedSprite {
  sprite: Sprite;
  seenTick: number;
  kind: EntityKind;
}

interface DeathEffect {
  sprite: Sprite;
  life: number;
}

/** Sprite display diameter relative to the sim hitbox (art reads a bit larger). */
const ART_SCALE = 1.5;
/** Frames a death burst stays alive (render-only, not sim time). */
const EFFECT_LIFE = 24;
/** Fixed on-screen size (px) of a floor loot glyph — the sim `radius` is the
 *  pickup range (44), far larger than the icon should read. */
const LOOT_SIZE = 48;
/** Rarity → tint for loot (render-only): normal grey, magic blue, rare gold,
 *  unique orange. Indexed by the rarity code carried in `enemyType`. */
const LOOT_TINT = [0xcfd6e0, 0x5aa0ff, 0xffd24a, 0xff8a2a];
/** 보조무기 5종의 직접 발사체 색(render-only): friendly bullet에 실린 sub-type 코드
 *  (0..4, sim의 subWeapon이 enemyType에 태깅)로 색을 구분한다. 주무기 탄은 enemyType
 *  -1이라 이 배열을 타지 않고 기본 흰색으로 렌더된다.
 *  0 사이드킥=청록, 1 스캐터=연두, 2 기뢰장=주황, 3 센트리=미사용(포탑탄은 기본), 4 플레어=자홍. */
const SUB_BULLET_TINT = [0x4ff0d0, 0x9cff5a, 0xff9a3a, 0xffffff, 0xff5ad0];

// ---------------------------------------------------------------------------
// kind → 텍스처 슬롯 매핑 (M7a L10-render)
//
// 이 매핑이 **모든** kind 를 덮는지는 tests/invasionRender.test.ts 가 KIND_CODE 배열에서
// 파생해 전수 검사한다. 미등록 kind 는 조용히 player 텍스처로 폴백해 결함이 눈에 띄지 않기
// 때문에(정찰 지적), 매핑을 스위치 안에 숨기지 않고 **순수 함수로 꺼내** 검증 가능하게 뒀다.
// ---------------------------------------------------------------------------

/** 단일 텍스처 슬롯 이름. */
export type SingleTextureSlot =
  | 'player'
  | 'bullet'
  | 'enemyBullet'
  | 'gem'
  | 'supply'
  | 'loot'
  | 'wall'
  | 'destructible'
  | 'magnetEmitter'
  | 'bombDevice'
  | 'turretPickup'
  | 'core'
  | 'formation'
  | 'formationDrone'
  | 'spawnedDrone';

/** 배열 텍스처 슬롯 이름(인덱스 의미는 textures.ts 인터페이스 주석이 정본). */
export type ArrayTextureSlot =
  | 'enemy'
  | 'boss'
  | 'enemyBulletBehaviors'
  | 'guardian'
  | 'facility'
  | 'prop'
  | 'defenseBoss';

/** 한 kind 가 어느 텍스처를 쓰는지의 서술(순수 데이터 — 렌더 상태 무관). */
export type SpriteSlot =
  | { readonly kind: 'single'; readonly slot: SingleTextureSlot }
  | { readonly kind: 'array'; readonly slot: ArrayTextureSlot; readonly index: number }
  /** 스프라이트가 없는 kind(오버레이 Graphics 로 그린다) — `hazard` 하나뿐이다. */
  | { readonly kind: 'overlay' };

/**
 * 엔티티 kind(+ 유형 코드)를 텍스처 슬롯으로 사상한다. **순수 함수** — 폴백 판단(범위 밖
 * 인덱스 → 0)은 텍스처 해석 단계가 맡고, 여기서는 "어느 배열의 몇 번" 만 정한다.
 *
 * @param planet `boss` 전용(행성별 보스 아트). 그 외 kind 는 무시된다.
 */
export function spriteSlotFor(kind: EntityKind, enemyType: number, planet = 0): SpriteSlot {
  switch (kind) {
    case 'player':
      return { kind: 'single', slot: 'player' };
    case 'bullet':
      return { kind: 'single', slot: 'bullet' };
    case 'enemyBullet':
      // 시각 문법(탄막 다양성 Lane 1): 색 = 거동 종류. 거동 없는 적탄(-1)은 기본 hot-red.
      return enemyType >= 0
        ? { kind: 'array', slot: 'enemyBulletBehaviors', index: enemyType }
        : { kind: 'single', slot: 'enemyBullet' };
    case 'hazard':
      return { kind: 'overlay' };
    case 'gem':
      return { kind: 'single', slot: 'gem' };
    case 'supply':
      return { kind: 'single', slot: 'supply' };
    case 'boss':
      return { kind: 'array', slot: 'boss', index: planet };
    case 'wall':
      return { kind: 'single', slot: 'wall' };
    case 'destructible':
      return { kind: 'single', slot: 'destructible' };
    case 'magnetEmitter':
      return { kind: 'single', slot: 'magnetEmitter' };
    case 'bombDevice':
      return { kind: 'single', slot: 'bombDevice' };
    case 'turretPickup':
      return { kind: 'single', slot: 'turretPickup' };
    case 'loot':
      return { kind: 'single', slot: 'loot' };
    case 'enemy':
      return { kind: 'array', slot: 'enemy', index: enemyType };
    case 'core':
    case 'decoyCore':
      // 가짜 코어도 실제 코어와 동일 텍스처(조준·피격이 같은 시각 계약).
      return { kind: 'single', slot: 'core' };
    case 'guardian':
      return { kind: 'array', slot: 'guardian', index: enemyType };
    // --- M7a 침공 3레이어 ---
    case 'formation':
      return { kind: 'single', slot: 'formation' };
    case 'formationDrone':
      return { kind: 'single', slot: 'formationDrone' };
    case 'spawnedDrone':
      return { kind: 'single', slot: 'spawnedDrone' };
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
      // 설비 3종 모두 `enemyType = 설비 catalogId`(facility.ts 필드 매핑표가 정본).
      return { kind: 'array', slot: 'facility', index: enemyType };
    case 'prop':
      // 기물은 `enemyType = 역할 코드 PROP_*`(catalogId 가 아니다 — coreRoom.ts 필드 매핑표).
      return { kind: 'array', slot: 'prop', index: enemyType };
    case 'defenseBoss':
      return { kind: 'array', slot: 'defenseBoss', index: enemyType };
  }
}

/** 슬롯 서술 → 실제 텍스처. 범위 밖 인덱스·빈 슬롯은 순차 폴백(화면이 비지 않는다). */
export function resolveSpriteSlot(textures: PlaceholderTextures, s: SpriteSlot): Texture {
  if (s.kind === 'overlay') return textures.player; // 호출되지 않는 경로(방어적)
  if (s.kind === 'single') return textures[s.slot] ?? textures.player;
  const arr = textures[s.slot];
  const i = s.index >= 0 && s.index < arr.length ? s.index : 0;
  return arr[i] ?? arr[0] ?? textures.player;
}

// ---------------------------------------------------------------------------
// 예고선(관통 레일포 텔레그래프) · 주기 해저드 온오프 시각 표현
// ---------------------------------------------------------------------------

/** 예고선 색(경고 앰버 — 적탄 hot-red 와 구분되어 "아직 안 맞는다"가 읽힌다). */
export const TELEGRAPH_COLOR = 0xffb020;
/** 예고선 굵기(px). */
export const TELEGRAPH_WIDTH = 3;

/** 화면에 그릴 예고선 1개(월드 좌표). */
export interface TelegraphRail {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly alpha: number;
}

/**
 * 방향 제한 방어포의 **예고선**. 예고 구간(`facility.ts` 의 `phase === 1`)에만 나오며,
 * 스냅샷에서는 `active` 플래그로 실려 온다(설비 텔레그래프 = active).
 *
 * 길이는 카탈로그의 사거리(`spec.range`)에서 파생한다 — 하드코딩하면 설비 스펙이 바뀔 때
 * 예고선과 실제 사거리가 조용히 어긋난다. 잠긴 조준각(`angle`)을 그대로 쓴다.
 *
 * 알파는 프레임 틱의 순수 함수로 맥동시켜(0.45~0.9) 정지 화면에서도 "곧 발사"가 읽힌다.
 */
export function railTelegraph(e: EntitySnapshot, frameTick: number): TelegraphRail | null {
  if (e.kind !== 'facilityGun' || !e.active) return null;
  const spec = facilitySpecFor(e.enemyType);
  if (spec === undefined || spec.range <= 0) return null;
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.5);
  return {
    x1: e.x,
    y1: e.y,
    x2: e.x + Math.cos(e.angle) * spec.range,
    y2: e.y + Math.sin(e.angle) * spec.range,
    alpha: 0.45 + 0.45 * pulse,
  };
}

/** 해저드 장판 1개의 표시 스타일. */
export interface HazardStyle {
  readonly color: number;
  /** 채움 알파(0 = 테두리만 = 예열 중). */
  readonly fillAlpha: number;
  readonly strokeAlpha: number;
}

/**
 * 해저드 subtype·활성 여부 → 표시 스타일. 주기 온오프 설비(L2)·중력 앵커(L3)가 이 장판을
 * 반복 융기시키므로, **예열(테두리만) ↔ 활성(채움)** 대비가 리듬을 읽게 하는 핵심이다.
 *
 * 색 = subtype: 박격 red / 용암 orange / 감속 cyan. 미지의 subtype 은 박격 색으로 폴백한다.
 */
export function hazardStyle(subtype: number, active: boolean): HazardStyle {
  const color =
    subtype === HAZARD_LAVA
      ? 0xff7a1a
      : subtype === HAZARD_SLOW
        ? 0x39d0ff
        : subtype === HAZARD_MORTAR
          ? 0xff3355
          : 0xff3355; // 미지의 subtype = 박격 색 폴백(장판이 보이지 않는 것보다 낫다)
  return active
    ? { color, fillAlpha: 0.4, strokeAlpha: 0.9 }
    : { color, fillAlpha: 0, strokeAlpha: 0.85 };
}

/** 사망 폭발 스케일. 등록되지 않은 kind 는 폭발 없음(0). */
function explosionScale(kind: EntityKind): number {
  switch (kind) {
    case 'boss':
    case 'defenseBoss':
      return 3;
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
    case 'prop':
      return 2;
    case 'enemy':
    case 'formation':
    case 'formationDrone':
    case 'spawnedDrone':
      return 1;
    default:
      return 0;
  }
}

/**
 * 회전하지 않는(고정 방향) kind 집합. 여기 없는 kind 는 이동 렌더 규약(`rotation = e.angle`)을
 * 따른다.
 *
 * - 코어는 고정 방향(OQ1/OQ4). 수호(guardian)는 목록 밖이라 조준각으로 돈다.
 * - 침공 3레이어: 벽 부착 해저드·스포너와 L3 기물·보스는 고정 자세다. `facilityGun` 만
 *   조준각으로 회전한다 — 예고선과 포신 방향이 일치해야 예고가 읽힌다.
 */
const FIXED_FACING_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'gem',
  'boss',
  'supply',
  'wall',
  'destructible',
  'magnetEmitter',
  'bombDevice',
  'turretPickup',
  'loot',
  'core',
  'decoyCore',
  'facilityHazard',
  'facilitySpawner',
  'prop',
  'defenseBoss',
]);

function isFixedFacing(kind: EntityKind): boolean {
  return FIXED_FACING_KINDS.has(kind);
}

export class EntityRenderer {
  readonly layer = new Container();
  private readonly sprites = new Map<number, TrackedSprite>();
  private readonly spriteLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly effects: DeathEffect[] = [];
  private readonly overlay = new Graphics();
  private frameTick = 0;
  /** Active planet index (from the current snapshot) — selects boss art. */
  private planet = 0;
  /** 기체가 마지막으로 향한 각도(대상·이동이 없을 때 유지). shipFacing 참조. */
  private lastPlayerAngle = 0;

  constructor(private readonly textures: PlaceholderTextures) {
    // Draw order (bottom → top): hazard/beam overlay, entity sprites, death bursts.
    this.layer.addChild(this.overlay);
    this.layer.addChild(this.spriteLayer);
    this.layer.addChild(this.effectLayer);
  }

  /** 스냅샷 1건의 텍스처. 매핑 판단은 순수 함수({@link spriteSlotFor})가 하고 여기서는 해석만 한다. */
  private textureFor(e: EntitySnapshot): Texture {
    return resolveSpriteSlot(this.textures, spriteSlotFor(e.kind, e.enemyType, this.planet));
  }

  render(prev: WorldSnapshot, curr: WorldSnapshot, alpha: number): void {
    this.frameTick++;
    this.planet = curr.planet;
    // Camera follow: pan the whole layer so the interpolated camera (= player)
    // sits at the viewport centre. Sprites keep their absolute world coordinates;
    // only the layer is translated (vampire-survivors-style scrolling).
    const camX = prev.cameraX + (curr.cameraX - prev.cameraX) * alpha;
    const camY = prev.cameraY + (curr.cameraY - prev.cameraY) * alpha;
    this.layer.position.set(DESIGN_WIDTH / 2 - camX, DESIGN_HEIGHT / 2 - camY);
    this.drawOverlay(curr);
    this.updateEffects();

    const prevById = new Map<number, EntitySnapshot>();
    for (const e of prev.entities) prevById.set(e.id, e);

    for (const e of curr.entities) {
      if (e.kind === 'hazard') continue; // drawn in the overlay
      let tracked = this.sprites.get(e.id);
      if (tracked === undefined) {
        const sprite = new Sprite(this.textureFor(e));
        sprite.anchor.set(0.5);
        if (e.kind === 'wall') {
          // Walls render at their EXACT AABB (radius = half-width, aabbH =
          // half-height) — no ART_SCALE, so the cover the player sees matches the
          // collision box exactly.
          sprite.setSize(e.radius * 2, e.aabbH * 2);
        } else if (e.kind === 'loot') {
          // Loot: fixed icon size (sim radius is the large pickup range, not the
          // glyph). Tint by rarity so the drop's grade always reads — whether the
          // sprite is the placeholder diamond or a neutral gold loot.png.
          sprite.setSize(LOOT_SIZE, LOOT_SIZE);
          sprite.tint = LOOT_TINT[e.enemyType] ?? LOOT_TINT[0] ?? 0xffffff;
        } else if (e.kind === 'bullet' && e.enemyType >= 0) {
          // 보조무기 직접 발사체: sub-type 코드로 색 구분(주무기 탄은 enemyType -1이라
          // 이 분기를 타지 않음). 크기는 일반 탄과 동일한 hitbox 기준.
          const size = e.radius * 2 * ART_SCALE;
          sprite.setSize(size, size);
          sprite.tint = SUB_BULLET_TINT[e.enemyType] ?? 0xffffff;
        } else {
          // Real sprites are 64/128px; scale to the sim hitbox so art matches
          // collisions (player r16 → 48px, matching the GDD ship size).
          const size = e.radius * 2 * ART_SCALE;
          sprite.setSize(size, size);
        }
        // Supply drop: pin a parachute canopy above the transport when the
        // fx_parachute.png asset is present (render-only; no PNG → unchanged).
        if (e.kind === 'supply' && this.textures.parachute !== null) {
          const tw = sprite.texture.width;
          const th = sprite.texture.height;
          const chute = new Sprite(this.textures.parachute);
          chute.anchor.set(0.5, 1);
          chute.setSize(tw * 0.95, tw * 0.95);
          chute.position.set(0, -th * 0.35);
          sprite.addChild(chute);
        }
        this.spriteLayer.addChild(sprite);
        tracked = { sprite, seenTick: this.frameTick, kind: e.kind };
        this.sprites.set(e.id, tracked);
      }
      tracked.seenTick = this.frameTick;

      const p = prevById.get(e.id) ?? e;
      tracked.sprite.x = p.x + (e.x - p.x) * alpha;
      tracked.sprite.y = p.y + (e.y - p.y) * alpha;
      // 플레이어 기체는 마우스 조준각(e.angle)이 아니라 실제 사격 방향(최근접
      // 적/보스/보급 = autoAttack 대상군)을 향한다. 렌더 전용 계산(sim 불변).
      if (e.kind === 'player') {
        const facing = shipFacing(e.x, e.y, curr.entities, e.x - p.x, e.y - p.y, this.lastPlayerAngle);
        this.lastPlayerAngle = facing;
        tracked.sprite.rotation = facing;
      } else {
        // Gems, boss, supply and the static gimmicks keep a fixed facing; others
        // face their travel/aim angle. 목록은 isFixedFacing 이 정본이다.
        tracked.sprite.rotation = isFixedFacing(e.kind) ? 0 : e.angle;
      }

      if (e.kind === 'boss') {
        // Phase transition = white flash; overheat = bright red pulse (spec).
        if (e.flash) {
          tracked.sprite.tint = (this.frameTick >> 2) % 2 === 0 ? 0xffffff : 0xff8080;
        } else if (e.active) {
          const pulse = 0.5 + 0.5 * Math.sin(this.frameTick * 0.4);
          tracked.sprite.tint = 0xff4020;
          tracked.sprite.alpha = 0.8 + 0.2 * pulse;
        } else {
          tracked.sprite.tint = 0xffffff;
          tracked.sprite.alpha = 1;
        }
      }
    }

    for (const [id, tracked] of this.sprites) {
      if (tracked.seenTick !== this.frameTick) {
        // A combat unit vanishing = a kill: leave a brief death burst behind.
        // 침공 3레이어의 설비·기물·보스도 파괴 연출을 받는다(스케일은 explosionScale).
        const scale = explosionScale(tracked.kind);
        if (scale > 0) this.spawnExplosion(tracked.sprite.x, tracked.sprite.y, scale);
        tracked.sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  private spawnExplosion(x: number, y: number, scale: number): void {
    const sprite = new Sprite(this.textures.explosion);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.setSize(46 * scale, 46 * scale);
    this.effectLayer.addChild(sprite);
    this.effects.push({ sprite, life: EFFECT_LIFE });
  }

  private updateEffects(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (fx === undefined) continue;
      fx.life--;
      if (fx.life <= 0) {
        fx.sprite.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      const t = fx.life / EFFECT_LIFE; // 1 → 0
      fx.sprite.alpha = t;
      fx.sprite.scale.set(fx.sprite.scale.x * (1 + 0.04 * (1 - t)));
    }
  }

  private drawOverlay(curr: WorldSnapshot): void {
    const g = this.overlay;
    g.clear();
    // Support heal beams.
    for (const b of curr.beams) {
      g.moveTo(b.x1, b.y1).lineTo(b.x2, b.y2).stroke({ color: 0x33ffcc, width: 3, alpha: 0.5 });
    }
    // Hazard zones: telegraph = outlined warning ring; active = filled danger.
    // 주기 온오프 해저드(L2 설비·L3 중력 앵커)는 이 예열↔활성 대비가 리듬을 읽게 한다.
    for (const e of curr.entities) {
      if (e.kind !== 'hazard') continue;
      const st = hazardStyle(e.enemyType, e.active);
      if (st.fillAlpha > 0) {
        g.circle(e.x, e.y, e.radius)
          .fill({ color: st.color, alpha: st.fillAlpha })
          .stroke({ color: st.color, width: 2, alpha: st.strokeAlpha });
      } else {
        g.circle(e.x, e.y, e.radius).stroke({ color: st.color, width: 2, alpha: st.strokeAlpha });
      }
    }
    // 예고선(관통 레일포 텔레그래프): 조준각이 잠긴 예고 구간에만 나온다. 탄보다 먼저 선이
    // 보이므로 플레이어가 사계를 벗어날 시간을 얻는다(예고 중에는 피해가 없다 — facility.ts).
    for (const e of curr.entities) {
      const rail = railTelegraph(e, this.frameTick);
      if (rail === null) continue;
      g.moveTo(rail.x1, rail.y1)
        .lineTo(rail.x2, rail.y2)
        .stroke({ color: TELEGRAPH_COLOR, width: TELEGRAPH_WIDTH, alpha: rail.alpha });
    }
  }

  destroy(): void {
    for (const { sprite } of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    for (const { sprite } of this.effects) sprite.destroy();
    this.effects.length = 0;
    this.overlay.destroy();
    this.layer.destroy({ children: true });
  }
}
