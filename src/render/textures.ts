/**
 * Game textures: real pixel-art sprites with a procedural fallback.
 *
 * Phase 4 swapped the primitive-shape placeholders for PixelLab-generated
 * sprites in `assets/`. `loadGameTextures` builds the procedural set first, then
 * overrides each slot with the real PNG when it loads — so a missing or corrupt
 * asset silently falls back to its placeholder and the game never dies (task 18
 * requirement). `createPlaceholderTextures` remains the synchronous, dependency
 * free path used by the bench harness.
 *
 * The directional sprites (ship, enemies) are authored pointing +x (east) to
 * match the renderer's `rotation = angle` convention; PixelLab's north-facing
 * output was rotated 90° CW at asset-prep time.
 *
 * Readability rule (spec): bullets stay a WHITE CORE with a coloured OUTLINE —
 * friendly bullets outline cyan, enemy bullets outline hot-red — so hostile fire
 * stays legible at bullet-hell density. Bullets are therefore kept procedural on
 * purpose (a textured bullet would undermine the readability contract).
 */

import { Assets, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import type { AnimatedKind } from './spriteAnimation.js';
import {
  INVASION_FACILITIES,
  FACILITY_BEHAVIOR_HAZARD,
  FACILITY_BEHAVIOR_SPAWNER,
} from '../../data/invasion/facilities.js';
import {
  L3_PROPS,
  PROP_ROLE_COUNT,
  PROP_FIXED_CANNON,
  PROP_GRAVITY_ANCHOR,
  PROP_SHIELD_GENERATOR,
  PROP_REPAIR_PYLON,
  PROP_DECOY_HOLOGRAM,
  PROP_MINE_SWARM,
} from '../../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../../data/invasion/defenseBosses.js';
import { CATALOG_BOSS, CATALOG_FACILITY, CATALOG_PROP, catalogSlug } from '../../data/invasion/catalog.js';
import {
  SHIP_TYPES,
  DEFAULT_SHIP_TYPE,
  shipTypeDef,
  normalizeShipTypeId,
} from '../../data/ships/index.js';

/**
 * 타입 0(스트라이커)의 인게임 기체 스프라이트 basename. **개명·이동 금지** — M8 이전부터 있던
 * 자산이고, 아트가 아직 없는 신규 타입 전부의 최종 폴백이기도 하다(설계서 §9).
 */
export const LEGACY_SHIP_SPRITE = 'player.png';

/**
 * 기체 타입 → 인게임 스프라이트 basename(64×64, 기수 +X 방향). 타입 0 만 레거시 이름을 쓰고
 * 1~ 은 `ship_<slug>.png` 다. 범위 밖 typeId 는 `shipTypeDef` 가 0 으로 되돌리므로 손상
 * 세이브가 존재하지 않는 파일명을 만들지 않는다.
 *
 * 순수 문자열 유도(Pixi 미의존) — 로더 없이 테스트한다. **실 PNG 가 없으면 예외가 아니라
 * 폴백**이다: `ship_<slug>.png` → `player.png` → 절차적 플레이스홀더.
 */
export function shipSpriteName(typeId: number): string {
  const def = shipTypeDef(typeId);
  return def.id === DEFAULT_SHIP_TYPE ? LEGACY_SHIP_SPRITE : `ship_${def.slug}.png`;
}

/**
 * 전 기체 타입의 인게임 스프라이트 basename. 리터럴이 아니라 **레지스트리 파생**이라, 타입이
 * 늘면 로더가 조용히 한 장을 빠뜨리는 일이 없다(설계서 §10-7 의 인게임 스프라이트 판).
 */
export const SHIP_SPRITE_NAMES: readonly string[] = SHIP_TYPES.map((d) => shipSpriteName(d.id));

/**
 * 타입별 로드 결과(index = typeId, 미존재·로드 실패는 null)를 **전 슬롯 non-null** 인
 * 타입별 텍스처 배열로 접는다. 로더 안에 인라인으로 두면 "폴백이 실제로 어느 슬롯을 채우는가"를
 * 테스트가 못 본다(Pixi 없이 `loadGameTextures` 를 부를 수 없다) — 그래서 순수 함수로 뽑아
 * 로더와 테스트가 **같은 코드**를 타게 한다. 제네릭인 것은 테스트가 문자열로 대신 넣기 위함이다.
 */
export function resolveShipTextures<T>(typed: readonly (T | null | undefined)[], fallback: T): T[] {
  return SHIP_TYPES.map((d) => typed[d.id] ?? fallback);
}

/**
 * 플레이어 슬롯을 `typeId` 의 기체 스프라이트로 갈아끼운다(**동기**, 렌더 전용).
 *
 * 런 시작 직전에 부른다 — `EntityRenderer` 가 `textures.player` 를 스프라이트 생성 시점에
 * 읽으므로, `createWorld` 앞에서 대입해야 그 런의 플레이어가 올바른 기체로 뜬다. 범위 밖·
 * 손상 `typeId` 는 `normalizeShipTypeId` 가 0(스트라이커)으로 되돌린다.
 */
export function applyShipSprite(tex: PlaceholderTextures, typeId: number): void {
  const slot = tex.shipByType[normalizeShipTypeId(typeId)];
  if (slot !== undefined) tex.player = slot;
}

export interface PlaceholderTextures {
  player: Texture;
  /**
   * 기체 타입별 인게임 스프라이트(index = typeId, `SHIP_TYPES` 파생 · 전 슬롯 non-null).
   *
   * ⚠️ 이 배열이 존재하는 이유는 **런 시작 시점에 동기적으로** 기체 스프라이트를 갈아끼우기
   * 위해서다. 텍스처는 부팅 때 한 번만 로드되는데(`main.ts` 의 `loadGameTextures` 1회 호출)
   * 기체는 챔피언 선택으로 런 사이에 바뀐다. 런마다 다시 `await` 하면 스프라이트가 이미
   * 생성된 뒤에 도착해 그 런 내내 옛 기체로 보인다. 그래서 전 타입을 미리 로드해 두고
   * `applyShipSprite` 가 대입만 한다.
   *
   * 각 슬롯 폴백: `ship_<slug>.png` → `player.png` → 절차적 플레이스홀더. 아트가 없어도
   * 예외 없이 스트라이커 스프라이트로 뜬다.
   */
  shipByType: Texture[];
  bullet: Texture;
  enemyBullet: Texture;
  /**
   * 적탄 거동별 텍스처(시각 문법, 탄막 다양성 Lane 1): index = 거동 코드(BK_*,
   * 0 가속 / 1 유도 / 2 곡사 / 3 분열). 색(아웃라인) = 거동 종류(주 시그널). 흰 코어 +
   * 유색 아웃라인 규칙은 유지해 고밀도에서도 가독성을 지킨다. 거동 없는 적탄(BK_NONE,
   * enemyType -1)은 기본 `enemyBullet`(hot-red)로 렌더한다. sim에는 이 색이 살지 않는다.
   */
  enemyBulletBehaviors: Texture[];
  gem: Texture;
  /**
   * Enemy textures indexed by global typeIndex (0..21): 카르곤 0~3, 베르단 4~9,
   * 니플헤임 10~15, 아르케 16~21 (data/enemies ENEMY_BY_TYPE 순서와 1:1).
   */
  enemy: Texture[];
  /**
   * Boss textures indexed by planetIndex (0 카르곤 요새 .. 3 아르케 오벨리스크).
   * A missing per-planet PNG falls back to the Kargon boss (slot 0).
   */
  boss: Texture[];
  /** Supply raider transport. */
  supply: Texture;
  /**
   * Parachute canopy for the supply drop (render-only decoration). `null` when
   * no `fx_parachute.png` is present — the supply then renders unchanged.
   */
  parachute: Texture | null;
  /** Floor loot pickup (neutral gold glyph; renderer tints by rarity code). */
  loot: Texture;
  /** Death burst effect (render-only juice). */
  explosion: Texture;
  /**
   * Tileable arena backdrop indexed by planetIndex (0 카르곤 화산 .. 3 아르케).
   * A missing per-planet PNG falls back to the Kargon backdrop (slot 0).
   */
  background: Texture[];
  // --- Scroll-map gimmicks (plan Phase E/F) ---
  /** Cover wall — a unit square stretched to the AABB by the renderer. */
  wall: Texture;
  /** Destructible object (drops a gem when broken). */
  destructible: Texture;
  /** Magnet emitter event object. */
  magnetEmitter: Texture;
  /** Bomb device event object. */
  bombDevice: Texture;
  /** Turret pickup event object. */
  turretPickup: Texture;
  /**
   * 대피소(추격 모드=Lane6 의 신규 inert kind `shelter`). 안전지대 도달 = 세그먼트 전진.
   * fixedFacing(회전 없음). 실 PNG(`shelter.png`) 가 있으면 덮고, 없으면 절차적 돔 유지(회귀 0).
   */
  shelter: Texture;
  // --- 방어 코어·수호 기체 (M4/M5) ---
  // (구 방어 포탑 6종 텍스처 슬롯은 M7a L11 에서 삭제 — L2 회랑 설비 3종이 계승했다.)
  /** 방어 코어(침공 목표). fixedFacing. `decoyCore`(가짜 코어)도 이 텍스처로 렌더한다. */
  core: Texture;
  /**
   * 수호 기체 2종. index = `guardian.enemyType` = preset(0 타이탄 / 1 인터셉터 —
   * data/guardian.ts GUARDIAN_* 순서와 1:1). 이동 렌더 규약(e.angle)을 따른다(+x 향 저작).
   */
  guardian: Texture[];
  // --- M7a 침공 3레이어 (ADR-0017~0019, L10-render) ---
  /**
   * 레이어별 침공 배경. **index = 침공 페이즈 코드**(PHASE_L1 0 대기권 / PHASE_L2 1 회랑
   * 격벽 / PHASE_L3 2 코어방 — src/sim/invasion/constants.ts 와 1:1). 타일 가능(TilingSprite).
   * 전환 크로스페이드는 src/render/invasionBackdrop.ts 가 담당한다.
   */
  invasionBackdrop: Texture[];
  /**
   * L2 회랑 설비. **index = 설비 catalogId**(INVASION_FACILITIES 배열 인덱스). 설비 3 kind
   * (`facilityGun`/`facilityHazard`/`facilitySpawner`)가 모두 `enemyType = catalogId` 규약이라
   * 한 배열을 공유한다 — 거동별 색은 카탈로그의 behavior 에서 파생하므로 드리프트가 없다.
   */
  facility: Texture[];
  /**
   * L3 기물. **index = 기물 역할 코드 PROP_\***(엔티티 `enemyType` = spec.role — catalogId 가
   * 아니다, data/invasion/props.ts 참조).
   */
  prop: Texture[];
  /** L3 방어 보스. **index = 보스 catalogId**(DEFENSE_BOSSES 배열 인덱스). */
  defenseBoss: Texture[];
  // --- 조우 프레임워크(ADR-0033) ---
  /**
   * 보물 격실 포탈(`encounterPortal` kind + `encounterRuntime.type === treasureVault`).
   * 진입하면 별도 공간으로 워프하는 관문이라 "빨려 들어가는" 소용돌이로 읽혀야 한다.
   * fixedFacing(회전 없음).
   */
  encounterPortal: Texture;
  /**
   * 봉인 수호자의 봉인석(`encounterPortal` kind + `encounterRuntime.type === sealedGuardian`).
   *
   * ⚠️ **kind 가 포탈과 같다** — 봉인은 신규 `EntityKind` 를 만들지 않고 포탈 kind 를 재사용하기
   * 때문이다(`src/sim/encounter.ts` 의 `maybeSpawnEncounter` 주석: `KIND_CODE` 는 append-only
   * 해시 계약이라 신규 kind 는 골든 재생성을 강제한다). 그래서 이 슬롯의 선택은 kind 가 아니라
   * **조우 유형**으로 갈린다({@link spriteSlotFor} 의 `encounterType` 인자). fixedFacing.
   */
  encounterSeal: Texture;
  /** 오스카 제단(`encounterAltar` kind). 3택 공물을 바치는 제단. fixedFacing. */
  encounterAltar: Texture;
  /** L1 편대 리더(진형 기준점). 이동 렌더 규약(+x 향 저작). */
  formation: Texture;
  /** L1 편대원. 이동 렌더 규약(+x 향 저작). */
  formationDrone: Texture;
  /** L2 스포너가 소환한 드론. 편대원과 구분되는 색(스포너 계열 톤). */
  spawnedDrone: Texture;
  /**
   * 아군·이익 오브젝트의 루프 애니메이션 프레임(2026-07-26). `assets/anim_<name>.png` 가로
   * 스트립을 프레임 사각형으로 잘라 담는다. 파일이 없으면 그 슬롯은 null 이고 렌더는 기존 정지
   * 스프라이트를 그대로 쓴다(회귀 0).
   *
   * **선택 필드**인 이유: 테스트 여럿이 이 인터페이스를 객체 리터럴로 직접 만든다. 필수로 두면
   * 애니메이션과 무관한 테스트 파일까지 전부 고쳐야 하는데, 렌더는 부재를 이미 정상 경로로
   * 다룬다(에셋 부재와 같은 취급).
   */
  anim?: Partial<Record<AnimatedKind, Texture[] | null>>;
}

/**
 * Per-typeIndex colour + base radius + shape, covering ALL 22 enemies
 * (ENEMY_BY_TYPE order). Radii match the 2x-scale sim hitboxes (plan D1) so the
 * shape placeholders line up with the enlarged entities when no PixelLab asset
 * is present. Role reads from the SHAPE (tri charger / square gunner / diamond
 * special / hex support; elites reuse the gunner/charger shape one size up), and
 * PLANET reads from the palette — 카르곤 화염 red/amber, 베르단 산성 green,
 * 니플헤임 서리 ice-blue, 아르케 고대기계 bronze — so the fallback still tells the
 * four planets apart (task Phase F ①).
 */
const ENEMY_STYLE: { color: number; radius: number; shape: 'tri' | 'square' | 'diamond' | 'hex' }[] = [
  // 카르곤 0~3 (M1 원본 유지)
  { color: 0xff5533, radius: 36, shape: 'tri' }, // 0 charger — aggressive dart
  { color: 0xffb020, radius: 32, shape: 'square' }, // 1 gunner
  { color: 0xff3300, radius: 44, shape: 'diamond' }, // 2 lava spring
  { color: 0x33ffcc, radius: 30, shape: 'hex' }, // 3 support
  // 베르단 4~9 — 산성 그린
  { color: 0x7ec53a, radius: 32, shape: 'tri' }, // 4 charger
  { color: 0x9bd94a, radius: 30, shape: 'square' }, // 5 gunner
  { color: 0x5fa82c, radius: 42, shape: 'diamond' }, // 6 special
  { color: 0xb6e86a, radius: 28, shape: 'hex' }, // 7 support
  { color: 0xcfff70, radius: 44, shape: 'square' }, // 8 elite gunner
  { color: 0xcfff70, radius: 50, shape: 'tri' }, // 9 elite charger
  // 니플헤임 10~15 — 서리 아이스블루
  { color: 0x5cc4f2, radius: 30, shape: 'tri' }, // 10 charger
  { color: 0x7ad3f7, radius: 32, shape: 'square' }, // 11 gunner
  { color: 0x3f9dd0, radius: 44, shape: 'diamond' }, // 12 special
  { color: 0xa6e6ff, radius: 28, shape: 'hex' }, // 13 support
  { color: 0xd0f4ff, radius: 46, shape: 'square' }, // 14 elite gunner
  { color: 0xd0f4ff, radius: 52, shape: 'tri' }, // 15 elite charger
  // 아르케 16~21 — 고대기계 브론즈
  { color: 0xc07a28, radius: 38, shape: 'tri' }, // 16 charger
  { color: 0xd6923a, radius: 34, shape: 'square' }, // 17 gunner
  { color: 0x9a5f1e, radius: 46, shape: 'diamond' }, // 18 special
  { color: 0xe0ad5a, radius: 30, shape: 'hex' }, // 19 support
  { color: 0xf0c268, radius: 48, shape: 'square' }, // 20 elite gunner
  { color: 0xf0c268, radius: 54, shape: 'tri' }, // 21 elite charger
  // 톡사르 22~27 — 부식 톡식 퍼플 (TODO(art): 실 스프라이트 대기)
  { color: 0xb04dd6, radius: 32, shape: 'tri' }, // 22 charger
  { color: 0xc46ae6, radius: 30, shape: 'square' }, // 23 gunner
  { color: 0x8a34b0, radius: 42, shape: 'diamond' }, // 24 special
  { color: 0xd79bf0, radius: 28, shape: 'hex' }, // 25 support
  { color: 0xe6b8f8, radius: 44, shape: 'square' }, // 26 elite gunner
  { color: 0xe6b8f8, radius: 50, shape: 'tri' }, // 27 elite charger
  // 크라스 28~33 — 파괴 크림슨/러스트 (TODO(art): 실 스프라이트 대기)
  { color: 0xc0303a, radius: 38, shape: 'tri' }, // 28 charger
  { color: 0xd6484a, radius: 34, shape: 'square' }, // 29 gunner
  { color: 0x8f2028, radius: 46, shape: 'diamond' }, // 30 special
  { color: 0xe08a6a, radius: 30, shape: 'hex' }, // 31 support
  { color: 0xf06058, radius: 48, shape: 'square' }, // 32 elite gunner
  { color: 0xf06058, radius: 54, shape: 'tri' }, // 33 elite charger
];

/**
 * 적탄 거동별 아웃라인 색(시각 문법: 색 = 거동 종류). index = 거동 코드(BK_*).
 * 친근한 시안(아군탄)·젬 그린과 겹치지 않는 밝은 warm/hostile 계열로 구분한다.
 *   0 가속 = 앰버, 1 유도 = 마젠타, 2 곡사 = 옐로, 3 분열 = 퍼플.
 */
const ENEMY_BULLET_BEHAVIOR_OUTLINE: readonly number[] = [0xff8a20, 0xff33cc, 0xffe033, 0xb060ff];

/** 적탄 기본(거동 없음) 아웃라인 — hot-red. */
const ENEMY_BULLET_BASE_OUTLINE = 0xff2233;
/** 아군 진영색(플레이어·아군탄·자석 링). 가독성 규칙의 기준색. */
const FRIENDLY_SIGNAL = 0x39d0ff;

/**
 * **전경 신호색 정본** — 플레이어가 "위험/이익"으로 읽어야 하는 작고 밝은 것들의 색.
 *
 * 배경 레이어(특히 카르곤 용암 발광)는 이 색들과 **색상각이 충분히 떨어져야** 한다. 배경의
 * 주황 띠와 적탄의 앰버가 같은 색이면 플레이어는 배경을 위협으로, 위협을 배경으로 읽는다.
 *
 * ⚠️ 이 배열이 존재하는 이유: `kargonLavaLight.ts` 가 이 색들을 **복제**해 갖고 있었다. 같은
 * 레인에서 `UPPER_THRESHOLD` 복제본이 실제로 갈라져 발광이 엉뚱한 등고선에 붙은 전례가 있어,
 * 두 번째 복제가 생기기 전에 정본을 여기로 모은다. 색을 바꾸면 그 레이어의 분리 거리 테스트가
 * 자동으로 재평가된다 — 그게 이 export 의 목적이다.
 */
export const FOREGROUND_SIGNAL_COLORS: readonly number[] = [
  ENEMY_BULLET_BASE_OUTLINE,
  ...ENEMY_BULLET_BEHAVIOR_OUTLINE,
  FRIENDLY_SIGNAL,
];

/** 적탄 텍스처: 흰 코어 + 지정 아웃라인(가독성 규칙 유지). */
function enemyBulletTexture(renderer: Renderer, outline: number): Texture {
  const g = new Graphics();
  g.circle(0, 0, 5).fill({ color: 0xffffff }).stroke({ color: outline, width: 2, alignment: 0 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

function drawTriangle(g: Graphics, r: number, color: number): void {
  g.moveTo(r, 0)
    .lineTo(-r * 0.8, r * 0.7)
    .lineTo(-r * 0.8, -r * 0.7)
    .lineTo(r, 0)
    .fill({ color })
    .stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawSquare(g: Graphics, r: number, color: number): void {
  g.rect(-r, -r, r * 2, r * 2).fill({ color }).stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawDiamond(g: Graphics, r: number, color: number): void {
  g.moveTo(0, -r)
    .lineTo(r, 0)
    .lineTo(0, r)
    .lineTo(-r, 0)
    .lineTo(0, -r)
    .fill({ color })
    .stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawHex(g: Graphics, r: number, color: number): void {
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath().fill({ color }).stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function enemyTexture(renderer: Renderer, style: (typeof ENEMY_STYLE)[number]): Texture {
  const g = new Graphics();
  switch (style.shape) {
    case 'tri':
      drawTriangle(g, style.radius, style.color);
      break;
    case 'square':
      drawSquare(g, style.radius, style.color);
      break;
    case 'diamond':
      drawDiamond(g, style.radius, style.color);
      break;
    case 'hex':
      drawHex(g, style.radius, style.color);
      break;
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Per-planet backdrop palette (base fill, crack under/over, ember). */
interface BackdropPalette {
  base: number;
  crackUnder: number;
  crackOver: number;
  ember: number;
}

// One palette per planetIndex. Slot 0 = the original M1 volcanic look (unchanged
// values), so the Kargon backdrop is byte-identical to before (no regression).
const BACKDROP_PALETTES: readonly BackdropPalette[] = [
  { base: 0x0d0a12, crackUnder: 0x4a1608, crackOver: 0xff5a1e, ember: 0xffb020 }, // 0 카르곤 화산
  { base: 0x0a1207, crackUnder: 0x24401a, crackOver: 0x7ec53a, ember: 0xb6e86a }, // 1 베르단 산성 습지
  { base: 0x081018, crackUnder: 0x1a3a52, crackOver: 0x5cc4f2, ember: 0xa6e6ff }, // 2 니플헤임 빙원
  { base: 0x120e08, crackUnder: 0x4a3418, crackOver: 0xc07a28, ember: 0xe0ad5a }, // 3 아르케 유적
  // Lane9 신규 2행성(index 4·5). 없으면 background[0](카르곤 빨강)으로 폴백하던 것을 테마색으로
  // 교정한다 — 톡사르=부식 톡식 퍼플, 크라스=파괴 크림슨(ENEMY_STYLE·팔레트와 정합). 렌더 전용.
  { base: 0x14081a, crackUnder: 0x3a1050, crackOver: 0xb04dd6, ember: 0xe6b8f8 }, // 4 톡사르 오염 늪
  { base: 0x160808, crackUnder: 0x4a1010, crackOver: 0xc0303a, ember: 0xf06058 }, // 5 크라스 파괴 폐허
];

/**
 * Procedural tiled backdrop: a dark base with a few seam-tolerant cracks and
 * embers. The crack/ember geometry is fixed (non-random) so tiles seam cleanly;
 * only the palette changes per planet.
 */
function backgroundTexture(renderer: Renderer, pal: BackdropPalette): Texture {
  const S = 256;
  const g = new Graphics();
  g.rect(0, 0, S, S).fill({ color: pal.base });
  const cracks: [number, number][][] = [
    [[20, 0], [60, 70], [40, 140], [90, 210], [70, 256]],
    [[180, 0], [150, 60], [200, 120], [170, 200], [210, 256]],
    [[0, 120], [80, 150], [140, 110], [220, 160], [256, 130]],
  ];
  for (const line of cracks) {
    const [first, ...rest] = line;
    if (first === undefined) continue;
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    g.stroke({ color: pal.crackUnder, width: 4, alpha: 0.9 });
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    g.stroke({ color: pal.crackOver, width: 1.5, alpha: 0.7 });
  }
  const embers: [number, number][] = [
    [45, 40], [120, 80], [200, 50], [30, 190], [160, 170], [230, 220], [90, 130], [180, 240],
  ];
  for (const [x, y] of embers) g.circle(x, y, 1.5).fill({ color: pal.ember, alpha: 0.6 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Per-planet boss placeholder palette (dark hull + molten/energy core). */
const BOSS_PALETTES: readonly [number, number][] = [
  [0x7a1410, 0xff5a1e], // 0 카르곤 용암 요새
  [0x1f5a12, 0x9bd94a], // 1 베르단 여왕
  [0x123a5a, 0x7ad3f7], // 2 니플헤임 기함
  [0x5a3a12, 0xf0c268], // 3 아르케 오벨리스크
];

/** Large hexagonal boss placeholder — dark hull ring + bright inner core (2x). */
function bossTexture(renderer: Renderer, hull: number, core: number): Texture {
  const g = new Graphics();
  drawHex(g, 128, hull);
  drawHex(g, 80, core);
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * Floor loot placeholder — a neutral gold diamond glyph with a bright rim. The
 * renderer tints this by rarity code, so the sprite itself stays rarity-neutral
 * (a real `loot.png` overrides it and is tinted the same way).
 */
function lootTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  drawDiamond(g, 22, 0xffcf4a);
  g.circle(0, 0, 6).fill({ color: 0xffffff, alpha: 0.85 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Procedural death burst fallback: layered orange radial flare. */
function explosionTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(0, 0, 22).fill({ color: 0xff7a1a, alpha: 0.35 });
  g.circle(0, 0, 14).fill({ color: 0xffb020, alpha: 0.7 });
  g.circle(0, 0, 6).fill({ color: 0xffffff, alpha: 0.9 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 방어 코어 플레이스홀더: 헥스 헐 + 밝은 에너지 코어. 침공 목표라 눈에 확 띄게 한다. fixedFacing.
 */
function coreTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  drawHex(g, 62, 0x1f6f5a); // 청록 헐
  g.circle(0, 0, 34).fill({ color: 0x33ffcc }).stroke({ color: 0xffffff, width: 3, alignment: 0 });
  g.circle(0, 0, 14).fill({ color: 0xffffff, alpha: 0.9 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 대피소 플레이스홀더(추격 모드 Lane6): 안전지대 돔. 어두운 베이스 원반 + 청록 보호막 돔 +
 * 안전 오라 링 + 회복 십자. 아군 톤(민트·시안)이라 적 스프라이트와 겹치지 않고 "여기가 안전"이
 * 즉시 읽힌다. inert·fixedFacing(회전 없음).
 */
function shelterTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(0, 0, 30).fill({ color: 0x0e2a24 }).stroke({ color: 0x2fe0b0, width: 3, alignment: 0 }); // 베이스 원반
  g.circle(0, 0, 22).fill({ color: 0x1f7a5c, alpha: 0.55 }).stroke({ color: 0x5affc0, width: 2, alignment: 0 }); // 보호막 돔
  g.circle(0, 0, 34).stroke({ color: 0x39d0ff, width: 2, alpha: 0.6, alignment: 0 }); // 안전 오라
  g.rect(-3, -12, 6, 24).fill({ color: 0xd8fff0 }); // 회복 십자(세로)
  g.rect(-12, -3, 24, 6).fill({ color: 0xd8fff0 }); // 회복 십자(가로)
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 수호 기체 플레이스홀더: 타이탄 = 육중한 사각 방패형, 인터셉터 = 날렵한 삼각 요격기. 둘 다
 * +x(동쪽)을 향해 저작해 이동 렌더의 `rotation = e.angle` 규약에 맞춘다. 아군 톤(블루/민트)이라
 * 적 스프라이트와 겹치지 않는다.
 */
function guardianTexture(renderer: Renderer, titan: boolean): Texture {
  const g = new Graphics();
  if (titan) {
    // 타이탄: 육중한 방패형 사각 + 전방 노즈.
    g.rect(-30, -30, 60, 60).fill({ color: 0x3a4a6a }).stroke({ color: 0x8ab4ff, width: 3, alignment: 0 });
    g.moveTo(30, -14).lineTo(48, 0).lineTo(30, 14).fill({ color: 0x8ab4ff });
  } else {
    // 인터셉터: 날렵한 삼각 요격기(+x 향).
    drawTriangle(g, 34, 0x1f7a5c);
    g.circle(6, 0, 8).fill({ color: 0x5affc0 });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

// ---------------------------------------------------------------------------
// 조우 오브젝트(ADR-0033) — 포탈 · 봉인석 · 제단
//
// 셋 다 실 PNG(`encounter_*.png`)가 정본이고 아래는 부재 시 폴백이다. **셋이 화면에서 서로
// 달라 보이는 것**이 이 절의 유일한 요구다(포탈=관문 / 봉인=억눌린 것 / 제단=공물) — 폴백에서도
// 실루엣·색으로 구분된다. 전부 fixedFacing(회전 없음).
// ---------------------------------------------------------------------------

/**
 * 보물 격실 포탈 폴백: 어두운 관문 링 + 안으로 빨려드는 보라 소용돌이 + 밝은 중심점.
 * 나선을 안쪽으로 감아 "빨려 들어간다"는 방향성이 정지 화면에서도 읽힌다.
 */
function encounterPortalTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(0, 0, 46).fill({ color: 0x160a28 }).stroke({ color: 0xb060ff, width: 5, alignment: 0 }); // 관문 링
  // 안으로 감기는 나선 2줄(각 4분의 1 바퀴씩 반경을 줄여 그린다).
  for (const phase of [0, Math.PI]) {
    let first = true;
    for (let i = 0; i <= 24; i++) {
      const a = phase + (i / 24) * Math.PI * 1.8;
      const r = 40 - (i / 24) * 30;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (first) {
        g.moveTo(x, y);
        first = false;
      } else g.lineTo(x, y);
    }
    g.stroke({ color: 0xd79bf0, width: 4, alpha: 0.85 });
  }
  g.circle(0, 0, 8).fill({ color: 0xffffff, alpha: 0.95 }); // 목구멍(빨려드는 중심)
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 봉인석 폴백: 각진 석판 + 십자로 두른 사슬 + 균열로 새는 진홍 빛. 포탈(보라 원형 소용돌이)과
 * **형태·색이 모두** 갈려, 같은 kind 를 공유해도 화면에서 헷갈리지 않는다.
 */
function encounterSealTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.rect(-42, -42, 84, 84).fill({ color: 0x2a2430 }).stroke({ color: 0x8a8090, width: 4, alignment: 0 }); // 석판
  // 균열로 새는 진홍 빛(안에 억눌린 것).
  g.moveTo(-30, -34).lineTo(-6, -4).lineTo(-22, 16).lineTo(4, 38).stroke({ color: 0xff3355, width: 5 });
  g.moveTo(30, -30).lineTo(10, 2).lineTo(28, 22).stroke({ color: 0xff6a70, width: 4 });
  // 십자 사슬(억누르는 구속) + 중앙 자물쇠.
  g.rect(-46, -10, 92, 20).fill({ color: 0x6a7080 }).stroke({ color: 0x2a2f3a, width: 3, alignment: 0 });
  g.rect(-10, -46, 20, 92).fill({ color: 0x6a7080 }).stroke({ color: 0x2a2f3a, width: 3, alignment: 0 });
  g.circle(0, 0, 13).fill({ color: 0x3a3040 }).stroke({ color: 0xffb020, width: 4, alignment: 0 });
  g.circle(0, 0, 5).fill({ color: 0xff3355 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 오스카 제단 폴백: 사다리꼴 대좌 + **3개**의 금빛 공물 그릇. 그릇이 셋인 것은 3택이라는
 * 게임 규칙을 실루엣으로 예고하기 위함이다(제단 UI 를 열기 전에 읽힌다).
 */
function encounterAltarTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  // 대좌(위가 좁은 사다리꼴 — 제단의 고전 실루엣).
  g.moveTo(-30, -34)
    .lineTo(30, -34)
    .lineTo(44, 40)
    .lineTo(-44, 40)
    .closePath()
    .fill({ color: 0x2e2a1e })
    .stroke({ color: 0xffd24a, width: 4, alignment: 0 });
  g.rect(-48, 34, 96, 12).fill({ color: 0x4a4230 }).stroke({ color: 0xffd24a, width: 3, alignment: 0 }); // 기단
  // 금빛 공물 그릇 3(좌·중·우) — 중앙이 조금 크다.
  for (const [x, r] of [[-24, 9], [0, 12], [24, 9]] as const) {
    g.circle(x, -28, r).fill({ color: 0xffb020 }).stroke({ color: 0xfff0b0, width: 3, alignment: 0 });
    g.circle(x, -28, r * 0.4).fill({ color: 0xffffff, alpha: 0.9 });
  }
  // 대좌 룬 각인(앰버 가로선 2줄).
  g.moveTo(-24, 4).lineTo(24, 4).stroke({ color: 0xffd24a, width: 3, alpha: 0.75 });
  g.moveTo(-30, 20).lineTo(30, 20).stroke({ color: 0xffd24a, width: 3, alpha: 0.6 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

// ---------------------------------------------------------------------------
// M7a 침공 3레이어 — 배경 3종 · 신규 kind 스프라이트 (L10-render)
// ---------------------------------------------------------------------------

/**
 * 설비 거동별 색(index = FACILITY_BEHAVIOR_*). 색 = 거동이라 팔레트·화면 어디서든 방어포/
 * 해저드/스포너가 즉시 구분된다. 아군 톤(시안·민트)과 겹치지 않는 적대 계열.
 */
const FACILITY_BEHAVIOR_COLORS: readonly number[] = [
  0xff6a3a, // 0 방어포 — 주적 오렌지레드
  0xb060ff, // 1 해저드 — 퍼플(장판 예고 링과 같은 계열)
  0x7ec53a, // 2 스포너 — 산성 그린(생산 = 증식 이미지)
];

/**
 * 설비 플레이스홀더. 벽 부착물이라 각진 마운트가 기본이고, 거동별로 상부 실루엣이 다르다:
 * 방어포 = +x 포신(사계 기준 방향 = e.angle 로 회전), 해저드 = 동심 방사 링, 스포너 = 사출 해치.
 */
function facilityTexture(renderer: Renderer, behavior: number, radius: number): Texture {
  const color = FACILITY_BEHAVIOR_COLORS[behavior] ?? FACILITY_BEHAVIOR_COLORS[0] ?? 0xffffff;
  const r = radius;
  const g = new Graphics();
  // 공통: 어두운 벽 마운트(각진 사각) + 유형색 테두리.
  g.rect(-r, -r, r * 2, r * 2)
    .fill({ color: 0x232838 })
    .stroke({ color, width: 3, alignment: 0 });
  if (behavior === FACILITY_BEHAVIOR_HAZARD) {
    g.circle(0, 0, r * 0.72).stroke({ color, width: 4, alignment: 0 });
    g.circle(0, 0, r * 0.4).stroke({ color, width: 3, alignment: 0 });
    g.circle(0, 0, r * 0.16).fill({ color });
  } else if (behavior === FACILITY_BEHAVIOR_SPAWNER) {
    // 사출 해치: +x 쪽이 열린 사다리꼴 + 내부 드론 실루엣.
    g.moveTo(r * 0.1, -r * 0.75)
      .lineTo(r, -r * 0.45)
      .lineTo(r, r * 0.45)
      .lineTo(r * 0.1, r * 0.75)
      .closePath()
      .fill({ color: 0x101520 })
      .stroke({ color, width: 3, alignment: 0 });
    drawTriangle(g, r * 0.3, color);
  } else {
    // 방어포: +x 포신 + 유형색 상부 헥스(구 포탑과 같은 문법 — 학습 비용 0).
    g.rect(0, -r * 0.22, r * 1.35, r * 0.44)
      .fill({ color: 0x101520 })
      .stroke({ color, width: 2, alignment: 0 });
    drawHex(g, r * 0.55, color);
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 기물 역할색(index = PROP_*). 실드 = 시안, 중력 = 바이올렛, 주포 = 앰버,
 * 수리 파일런 = 라임(회복), 기만 홀로그램 = 창백한 청록(가짜 코어), 지뢰군 = 주홍(위험).
 *
 * **길이가 `L3_PROPS.length` 와 맞아야 한다** — 짧으면 신규 역할이 조용히 0번 색으로
 * 폴백해 화면에서 실드 발생기와 구분되지 않는다(M7c 통합 게이트에서 3색 추가).
 */
const PROP_ROLE_COLORS: readonly number[] = [
  0x39d0ff, 0x8a6aff, 0xffb020, 0x6ee06e, 0x8ad8d0, 0xff6a40,
];

/**
 * L3 기물 플레이스홀더. 역할이 실루엣으로 읽힌다: 실드 발생기 = 팔각 돔 + 보호막 링,
 * 중력 앵커 = 하강 화살 삼각 + 소용돌이 링, 고정 주포 = 대형 +x 포신,
 * 수리 파일런 = 십자 + 방사 링, 기만 홀로그램 = 코어형 이중 마름모(반투명),
 * 지뢰군 = 중심 원 + 방사 스파이크 6. 전부 fixedFacing.
 */
function propTexture(renderer: Renderer, role: number, radius: number): Texture {
  const color = PROP_ROLE_COLORS[role] ?? PROP_ROLE_COLORS[0] ?? 0xffffff;
  const r = radius;
  const g = new Graphics();
  drawHex(g, r * 0.9, 0x1b2130); // 공통 대좌
  switch (role) {
    case PROP_SHIELD_GENERATOR:
      g.circle(0, 0, r * 0.62).fill({ color, alpha: 0.35 }).stroke({ color, width: 4, alignment: 0 });
      g.circle(0, 0, r * 0.28).fill({ color });
      g.circle(0, 0, r).stroke({ color, width: 2, alpha: 0.6, alignment: 0 });
      break;
    case PROP_GRAVITY_ANCHOR:
      g.circle(0, 0, r * 0.7).stroke({ color, width: 3, alpha: 0.8, alignment: 0 });
      g.circle(0, 0, r * 0.45).stroke({ color, width: 3, alpha: 0.9, alignment: 0 });
      g.moveTo(0, r * 0.55)
        .lineTo(-r * 0.34, -r * 0.2)
        .lineTo(r * 0.34, -r * 0.2)
        .closePath()
        .fill({ color });
      break;
    case PROP_REPAIR_PYLON:
      // 회복 십자 + 영향 반경을 암시하는 방사 링.
      g.circle(0, 0, r * 0.86).stroke({ color, width: 2, alpha: 0.5, alignment: 0 });
      g.rect(-r * 0.14, -r * 0.6, r * 0.28, r * 1.2).fill({ color });
      g.rect(-r * 0.6, -r * 0.14, r * 1.2, r * 0.28).fill({ color });
      break;
    case PROP_DECOY_HOLOGRAM:
      // 진짜 코어와 같은 계통으로 읽히되 **반투명 윤곽만** — 가짜라는 힌트.
      g.moveTo(0, -r * 0.85)
        .lineTo(r * 0.7, 0)
        .lineTo(0, r * 0.85)
        .lineTo(-r * 0.7, 0)
        .closePath()
        .fill({ color, alpha: 0.22 })
        .stroke({ color, width: 3, alpha: 0.9, alignment: 0 });
      g.circle(0, 0, r * 0.26).stroke({ color, width: 2, alpha: 0.8, alignment: 0 });
      break;
    case PROP_MINE_SWARM:
      // 중심 원 + 방사 스파이크 6 — 부설 링을 실루엣으로 예고한다.
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.moveTo(0, 0)
          .lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85)
          .stroke({ color, width: 3, alignment: 0 });
      }
      g.circle(0, 0, r * 0.34).fill({ color }).stroke({ color: 0x101520, width: 2, alignment: 0 });
      break;
    case PROP_FIXED_CANNON:
    default:
      g.rect(0, -r * 0.24, r * 1.25, r * 0.48)
        .fill({ color: 0x101520 })
        .stroke({ color, width: 3, alignment: 0 });
      drawSquare(g, r * 0.45, color);
      break;
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 방어 보스 플레이스홀더. PvE 보스(육각 + 코어)와 같은 문법을 쓰되 **강철 회색 헐 + 진홍
 * 코어**로 색을 갈라, 침공 L3 의 보스가 PvE 보스와 다른 계통임을 즉시 알린다.
 */
function defenseBossTexture(renderer: Renderer, radius: number): Texture {
  const g = new Graphics();
  drawHex(g, radius, 0x4a5160);
  drawHex(g, radius * 0.72, 0x2a3040);
  g.circle(0, 0, radius * 0.36).fill({ color: 0xff3355 }).stroke({ color: 0xffd0d8, width: 3, alignment: 0 });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    g.moveTo(Math.cos(a) * radius * 0.75, Math.sin(a) * radius * 0.75)
      .lineTo(Math.cos(a) * radius, Math.sin(a) * radius)
      .stroke({ color: 0xff8090, width: 3 });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 편대 유닛 플레이스홀더(+x 향 저작 — 이동 렌더 규약). 리더는 크고 날개가 붙은 삼각,
 * 편대원·소환 드론은 작은 삼각이며 색으로 소속이 갈린다(편대 = 적색 계열, 소환 = 스포너 그린).
 */
function formationUnitTexture(renderer: Renderer, radius: number, color: number, leader: boolean): Texture {
  const g = new Graphics();
  drawTriangle(g, radius, color);
  if (leader) {
    // 리더 표식: 뒤쪽으로 뻗은 날개 + 밝은 코어.
    g.moveTo(-radius * 0.8, -radius * 0.7)
      .lineTo(-radius * 1.25, 0)
      .lineTo(-radius * 0.8, radius * 0.7)
      .closePath()
      .fill({ color, alpha: 0.75 });
    g.circle(radius * 0.1, 0, radius * 0.24).fill({ color: 0xffffff, alpha: 0.9 });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** 침공 레이어별 배경 팔레트(index = 페이즈 코드). */
interface InvasionBackdropPalette {
  /** 바탕. */
  readonly base: number;
  /** 주 구조선(격벽 이음매·성층권 밴드·에너지 그리드). */
  readonly line: number;
  /** 강조점(별·리벳·코어 글로우). */
  readonly accent: number;
}

const INVASION_BACKDROP_PALETTES: readonly InvasionBackdropPalette[] = [
  { base: 0x060a18, line: 0x1b3358, accent: 0x9fd0ff }, // 0 L1 대기권 — 짙은 남색 성층권
  { base: 0x14100a, line: 0x4a3a22, accent: 0xffb020 }, // 1 L2 회랑 격벽 — 금속 갈색 + 경고색
  { base: 0x120616, line: 0x3d1a52, accent: 0xff5ad0 }, // 2 L3 코어방 — 자주빛 에너지실
];

/**
 * 침공 레이어 배경 타일(256², 이음매 안전). 레이어마다 구조가 다르다:
 * L1 = 성층권 밴드 + 별, L2 = 격벽 패널 격자 + 리벳, L3 = 에너지 그리드 + 코어 글로우.
 * 기하는 전부 고정(비랜덤)이라 타일 경계가 어긋나지 않는다(행성 배경과 같은 규율).
 */
function invasionBackdropTextureFor(renderer: Renderer, layer: number, pal: InvasionBackdropPalette): Texture {
  const S = 256;
  const g = new Graphics();
  g.rect(0, 0, S, S).fill({ color: pal.base });
  if (layer === 0) {
    // 성층권: 가로 밴드(스크롤 축과 무관하게 읽히도록 옅게) + 고정 별자리.
    for (const y of [36, 104, 178, 236]) {
      g.rect(0, y, S, 10).fill({ color: pal.line, alpha: 0.35 });
    }
    const stars: [number, number, number][] = [
      [22, 18, 1.6], [88, 62, 1.1], [150, 28, 2.0], [212, 74, 1.3],
      [40, 132, 1.2], [118, 168, 1.8], [196, 140, 1.1], [236, 208, 1.5],
      [70, 224, 1.3], [166, 244, 1.0],
    ];
    for (const [x, y, r] of stars) g.circle(x, y, r).fill({ color: pal.accent, alpha: 0.85 });
  } else if (layer === 1) {
    // 회랑 격벽: 128 격자 패널 + 이음매 + 모서리 리벳 + 경고 사선.
    for (const p of [0, 128]) {
      for (const q of [0, 128]) {
        g.rect(p + 6, q + 6, 116, 116).fill({ color: pal.line, alpha: 0.5 });
        for (const [rx, ry] of [[18, 18], [110, 18], [18, 110], [110, 110]] as const) {
          g.circle(p + rx, q + ry, 3).fill({ color: pal.accent, alpha: 0.7 });
        }
      }
    }
    for (let i = -S; i < S; i += 64) {
      g.moveTo(i, 0).lineTo(i + S, S).stroke({ color: pal.accent, width: 2, alpha: 0.16 });
    }
  } else {
    // 코어방: 32 간격 에너지 그리드 + 교차점 글로우 + 중앙 대형 링.
    for (let i = 32; i < S; i += 32) {
      g.moveTo(i, 0).lineTo(i, S).stroke({ color: pal.line, width: 1.5, alpha: 0.7 });
      g.moveTo(0, i).lineTo(S, i).stroke({ color: pal.line, width: 1.5, alpha: 0.7 });
    }
    for (const [x, y] of [[64, 64], [192, 64], [64, 192], [192, 192]] as const) {
      g.circle(x, y, 3.5).fill({ color: pal.accent, alpha: 0.8 });
    }
    g.circle(128, 128, 52).stroke({ color: pal.accent, width: 3, alpha: 0.45 });
    g.circle(128, 128, 30).stroke({ color: pal.accent, width: 2, alpha: 0.3 });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** 카탈로그 식별자 → 자산 파일명 조각(영숫자 외는 `_`). 하드코딩 표 없이 파생한다. */
function assetSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * 설비 자산 파일명(index = catalogId). 카탈로그에서 파생하므로 항목이 늘면 파일명도 자동으로
 * 늘어난다 — 배열 길이가 어긋나 조용히 폴백하는 사고가 구조적으로 불가능하다.
 */
export const FACILITY_ASSET_FILES: readonly string[] = INVASION_FACILITIES.map(
  (s) => `def3_fac_${assetSlug(catalogSlug(CATALOG_FACILITY, s.key))}.png`,
);

/** 기물 자산 파일명(index = 역할 코드 PROP_*). */
export const PROP_ASSET_FILES: readonly string[] = buildPropAssetFiles();

function buildPropAssetFiles(): string[] {
  const files: string[] = [];
  for (let role = 0; role < PROP_ROLE_COUNT; role++) {
    const spec = L3_PROPS.find((p) => p.role === role);
    files.push(`def3_prop_${assetSlug(spec === undefined ? String(role) : catalogSlug(CATALOG_PROP, spec.id))}.png`);
  }
  return files;
}

/** 방어 보스 자산 파일명(index = catalogId). */
export const DEFENSE_BOSS_ASSET_FILES: readonly string[] = DEFENSE_BOSSES.map(
  (b) => `def3_boss_${assetSlug(catalogSlug(CATALOG_BOSS, b.id))}.png`,
);

/** 침공 배경 자산 파일명(index = 페이즈 코드). */
export const INVASION_BACKDROP_ASSET_FILES: readonly string[] = [
  'bg_invasion_l1.png',
  'bg_invasion_l2.png',
  'bg_invasion_l3.png',
];

/**
 * 침공 단일 슬롯 유닛 자산 파일명 — 편대 리더 · 편대 드론 · 스포너 사출 드론(index 0/1/2).
 *
 * 카탈로그 파생 배열들과 달리 이 셋은 슬롯이 하나씩이라 원래 로더에 문자열로 박혀 있었다.
 * 배열로 끌어올린 이유는 **결손 대조 테스트가 훑을 수 있게** 하기 위해서다 — 로더가 부르는
 * 이름이 소스 어디에도 목록으로 없으면, 아트가 빠져도 조용한 null 폴백만 남는다
 * (tests/invasionAssetPresence.test.ts 머리말).
 */
export const DEF3_UNIT_ASSET_FILES: readonly string[] = [
  'def3_formation_leader.png',
  'def3_formation_drone.png',
  'def3_spawned_drone.png',
];

/** 역할별 기물 반지름(카탈로그에서 파생 — 없으면 기본 48). */
function propRadius(role: number): number {
  return L3_PROPS.find((p) => p.role === role)?.radius ?? 48;
}

/** Synchronous procedural texture set — bullets, fallbacks, and the bench path. */
export function createPlaceholderTextures(renderer: Renderer): PlaceholderTextures {
  const playerG = new Graphics();
  drawTriangle(playerG, 36, 0x39d0ff); // cyan — friendly (readability rule); 2x scale

  // Friendly bullet: white core + cyan outline.
  const bulletG = new Graphics();
  bulletG.circle(0, 0, 5).fill({ color: 0xffffff }).stroke({ color: 0x39d0ff, width: 2, alignment: 0 });

  // Enemy bullet: white core + hot-red outline (hostile fire readability).
  const enemyBulletG = new Graphics();
  enemyBulletG
    .circle(0, 0, 5)
    .fill({ color: 0xffffff })
    .stroke({ color: 0xff2233, width: 2, alignment: 0 });

  const gemG = new Graphics();
  drawDiamond(gemG, 16, 0x66ff88); // 2x scale

  // Supply raider: a wide neutral transport (amber outline, dark hull); 2x scale.
  const supplyG = new Graphics();
  supplyG
    .roundRect(-92, -52, 184, 104, 16)
    .fill({ color: 0x2a3550 })
    .stroke({ color: 0xffcc44, width: 3, alignment: 0 });
  supplyG.rect(-60, -24, 120, 48).fill({ color: 0x4a5a80 });

  // Cover wall: a 64x64 basalt tile with a lighter rim. Drawn as a unit square
  // (the renderer stretches it to each wall's exact AABB), so a border reads on
  // any size. Solid, opaque — visually distinct from the darker backdrop.
  const wallG = new Graphics();
  wallG
    .rect(-32, -32, 64, 64)
    .fill({ color: 0x565b6e })
    .stroke({ color: 0x9aa2bd, width: 4, alignment: 0 });

  // Destructible: an amber crate with a cross brace (reads as "shootable").
  const destructibleG = new Graphics();
  destructibleG
    .rect(-40, -40, 80, 80)
    .fill({ color: 0x8a5a1e })
    .stroke({ color: 0xffcc55, width: 4, alignment: 0 });
  destructibleG.moveTo(-40, -40).lineTo(40, 40).moveTo(40, -40).lineTo(-40, 40).stroke({
    color: 0xffcc55,
    width: 3,
  });

  // Magnet emitter: cyan concentric rings (evokes an attraction field).
  const magnetG = new Graphics();
  magnetG.circle(0, 0, 40).stroke({ color: 0x39d0ff, width: 5, alignment: 0 });
  magnetG.circle(0, 0, 24).stroke({ color: 0x8ae7ff, width: 4, alignment: 0 });
  magnetG.circle(0, 0, 8).fill({ color: 0x39d0ff });

  // Bomb device: red core with a spiked warning ring.
  const bombG = new Graphics();
  bombG.circle(0, 0, 40).fill({ color: 0x2a0e0e }).stroke({ color: 0xff3322, width: 5, alignment: 0 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    bombG.moveTo(Math.cos(a) * 40, Math.sin(a) * 40).lineTo(Math.cos(a) * 54, Math.sin(a) * 54);
  }
  bombG.stroke({ color: 0xffb020, width: 4 });
  bombG.circle(0, 0, 14).fill({ color: 0xff5522 });

  // Turret pickup: green hex with a barrel nub (reads as a deployable ally).
  const turretG = new Graphics();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = Math.cos(a) * 38;
    const y = Math.sin(a) * 38;
    if (i === 0) turretG.moveTo(x, y);
    else turretG.lineTo(x, y);
  }
  turretG.closePath().fill({ color: 0x1f7a4a }).stroke({ color: 0x66ffaa, width: 4, alignment: 0 });
  turretG.rect(-6, -46, 12, 20).fill({ color: 0x66ffaa });

  const playerTex = renderer.generateTexture(playerG);
  const textures: PlaceholderTextures = {
    player: playerTex,
    // 절차적 단계에서는 전 타입이 같은 플레이스홀더를 가리킨다. `loadGameTextures` 가
    // 실파일이 로드되는 슬롯만 덮어쓴다.
    shipByType: SHIP_TYPES.map(() => playerTex),
    bullet: renderer.generateTexture(bulletG),
    enemyBullet: renderer.generateTexture(enemyBulletG),
    enemyBulletBehaviors: ENEMY_BULLET_BEHAVIOR_OUTLINE.map((c) => enemyBulletTexture(renderer, c)),
    gem: renderer.generateTexture(gemG),
    enemy: ENEMY_STYLE.map((s) => enemyTexture(renderer, s)),
    boss: BOSS_PALETTES.map(([hull, core]) => bossTexture(renderer, hull, core)),
    supply: renderer.generateTexture(supplyG),
    parachute: null, // only populated when fx_parachute.png loads (loadGameTextures)
    loot: lootTexture(renderer),
    explosion: explosionTexture(renderer),
    background: BACKDROP_PALETTES.map((p) => backgroundTexture(renderer, p)),
    wall: renderer.generateTexture(wallG),
    destructible: renderer.generateTexture(destructibleG),
    magnetEmitter: renderer.generateTexture(magnetG),
    bombDevice: renderer.generateTexture(bombG),
    turretPickup: renderer.generateTexture(turretG),
    shelter: shelterTexture(renderer),
    // 조우 3종(ADR-0033). 봉인석은 포탈과 kind 를 공유하고 조우 유형으로 갈린다(슬롯 주석 참조).
    encounterPortal: encounterPortalTexture(renderer),
    encounterSeal: encounterSealTexture(renderer),
    encounterAltar: encounterAltarTexture(renderer),

    core: coreTexture(renderer),
    guardian: [guardianTexture(renderer, true), guardianTexture(renderer, false)],
    // M7a 침공 3레이어: 배경 3종 + 신규 kind 스프라이트. 인덱스 계약은 인터페이스 주석 참조.
    invasionBackdrop: INVASION_BACKDROP_PALETTES.map((p, i) => invasionBackdropTextureFor(renderer, i, p)),
    facility: INVASION_FACILITIES.map((s) => facilityTexture(renderer, s.behavior, s.radius)),
    prop: Array.from({ length: PROP_ROLE_COUNT }, (_, role) => propTexture(renderer, role, propRadius(role))),
    defenseBoss: DEFENSE_BOSSES.map((b) => defenseBossTexture(renderer, b.radius)),
    formation: formationUnitTexture(renderer, 40, 0xff5533, true),
    formationDrone: formationUnitTexture(renderer, 26, 0xff8a6a, false),
    spawnedDrone: formationUnitTexture(renderer, 24, 0x9bd94a, false),
  };

  playerG.destroy();
  bulletG.destroy();
  enemyBulletG.destroy();
  gemG.destroy();
  supplyG.destroy();
  wallG.destroy();
  destructibleG.destroy();
  magnetG.destroy();
  bombG.destroy();
  turretG.destroy();

  return textures;
}

// Eagerly resolve URLs for whatever PNGs actually exist in assets/. Missing
// files simply do not appear here, so unfilled slots keep their placeholder.
const ASSET_URLS = import.meta.glob('../../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function assetUrl(basename: string): string | undefined {
  for (const key in ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return ASSET_URLS[key];
  }
  return undefined;
}

/**
 * 애니메이션 슬롯 → 스트립 파일명. 파일명은 정지 스프라이트 이름에 `anim_` 접두를 붙인 규약이라
 * (`turret_pickup.png` ↔ `anim_turret_pickup.png`) 두 자산이 항상 짝으로 읽힌다.
 */
const ANIM_STRIP_FILES: readonly (readonly [AnimatedKind, string])[] = [
  ['turretPickup', 'anim_turret_pickup.png'],
  ['magnetEmitter', 'anim_magnet_emitter.png'],
  ['bombDevice', 'anim_bomb_device.png'],
  ['supply', 'anim_supply.png'],
  ['loot', 'anim_loot.png'],
  ['gem', 'anim_gem.png'],
];

/**
 * 가로 스트립 PNG 를 프레임 텍스처 배열로 자른다(애니메이션 로더). 스트립 폭이 높이의 정수배가
 * 아니면 손상으로 보고 null 을 돌려준다 — 프레임 경계가 어긋난 채 재생되면 스프라이트가 옆
 * 프레임을 물고 흔들린다. 파일 부재·로드 실패도 null(정지 스프라이트 유지, 회귀 0).
 */
async function tryLoadStrip(basename: string): Promise<Texture[] | null> {
  const sheet = await tryLoad(basename);
  if (sheet === null) return null;
  const h = sheet.height;
  if (h <= 0 || sheet.width % h !== 0) return null;
  const count = sheet.width / h;
  if (count < 2) return null;
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(new Texture({ source: sheet.source, frame: new Rectangle(i * h, 0, h, h) }));
  }
  return frames;
}

/** Load one PNG as a nearest-filtered texture; null on any failure (graceful). */
async function tryLoad(basename: string): Promise<Texture | null> {
  const url = assetUrl(basename);
  if (url === undefined) return null;
  try {
    const tex = await Assets.load<Texture>(url);
    tex.source.scaleMode = 'nearest';
    return tex;
  } catch {
    return null;
  }
}

/**
 * Build the full texture set, overriding placeholder slots with real sprites
 * where the asset loads. Any load failure keeps the procedural placeholder.
 *
 * `shipType`(M8, 기본 0 = 스트라이커)은 플레이어 슬롯에 어느 기체 스프라이트를 넣을지만
 * 정한다. 인자를 생략하면 기존과 **완전히 동일**하게 `player.png` 를 쓴다 — 신규 타입의 PNG 가
 * 아직 없으면 로드가 null 이라 그대로 `player.png` 로 되돌아간다(예외 없음, 화면 안 비침).
 */
export async function loadGameTextures(
  renderer: Renderer,
  shipType: number = DEFAULT_SHIP_TYPE,
): Promise<PlaceholderTextures> {
  const tex = createPlaceholderTextures(renderer);

  // Enemy filenames by global typeIndex (0..21). 0~3 keep the M1 names; 4~21
  // follow the planet/role contract `enemy_<planet>_<role>` with elites tagged
  // `elite_<role>` (see data/planets — order == ENEMY_BY_TYPE). Any missing file
  // silently keeps its planet-tinted shape placeholder.
  const enemyFiles = [
    'enemy_charger.png', // 0
    'enemy_mortar.png', // 1
    'enemy_lavaspring.png', // 2
    'enemy_support.png', // 3
    'enemy_berdan_charger.png', // 4
    'enemy_berdan_gunner.png', // 5
    'enemy_berdan_special.png', // 6
    'enemy_berdan_support.png', // 7
    'enemy_berdan_elite_gunner.png', // 8
    'enemy_berdan_elite_charger.png', // 9
    'enemy_niflheim_charger.png', // 10
    'enemy_niflheim_gunner.png', // 11
    'enemy_niflheim_special.png', // 12
    'enemy_niflheim_support.png', // 13
    'enemy_niflheim_elite_gunner.png', // 14
    'enemy_niflheim_elite_charger.png', // 15
    'enemy_arke_charger.png', // 16
    'enemy_arke_gunner.png', // 17
    'enemy_arke_special.png', // 18
    'enemy_arke_support.png', // 19
    'enemy_arke_elite_gunner.png', // 20
    'enemy_arke_elite_charger.png', // 21
    // 톡사르 22~27 · 크라스 28~33 (Lane9). TODO(art): 실 스프라이트 대기 — 없으면 절차적 유지.
    'enemy_toxar_charger.png', // 22
    'enemy_toxar_gunner.png', // 23
    'enemy_toxar_special.png', // 24
    'enemy_toxar_support.png', // 25
    'enemy_toxar_elite_gunner.png', // 26
    'enemy_toxar_elite_charger.png', // 27
    'enemy_kras_charger.png', // 28
    'enemy_kras_gunner.png', // 29
    'enemy_kras_special.png', // 30
    'enemy_kras_support.png', // 31
    'enemy_kras_elite_gunner.png', // 32
    'enemy_kras_elite_charger.png', // 33
  ];

  // Boss + backdrop by planetIndex (0 카르곤 .. 5 크라스). Slot 0 keeps the M1
  // filenames (`boss.png`, `bg_kargon.png`); others follow the planet contract.
  // 4~5(톡사르·크라스)는 Lane9 append — TODO(art): 실 스프라이트 대기.
  const bossFiles = ['boss.png', 'boss_berdan.png', 'boss_niflheim.png', 'boss_arke.png', 'boss_toxar.png', 'boss_kras.png'];
  const bgFiles = ['bg_kargon.png', 'bg_berdan.png', 'bg_niflheim.png', 'bg_arke.png', 'bg_toxar.png', 'bg_kras.png'];

  // 방어 엔티티(파일명 계약, spec 레인 A). 없는 파일은 절차적 플레이스홀더 유지(tryLoad 패턴).
  //
  // 구 포탑 6종(turret_*.png)은 M7a L11 에서 로드 목록에서 빠졌고, 설비 아트의 정본은
  // FACILITY_ASSET_FILES 다. ⚠️ 그런데 **대체 아트를 만들지 않은 채로 목록만 지웠다** — 누락이
  // 조용한 절차적 폴백이라 신호가 없었고, 침공 방어체 전체가 도형으로 보이는 상태로 남았다
  // (사용자 신고 2026-07-28). 아트는 그때 채웠고, 재발은 tests/invasionAssetPresence.test.ts 가
  // 막는다. `assets/turret_*.png` 6장은 아무도 참조하지 않는 사자산이라 함께 삭제했다.
  const guardianFiles = ['guardian_titan.png', 'guardian_interceptor.png']; // preset 0/1

  // 기체 스프라이트는 2단 폴백이다: `ship_<slug>.png`(신규 타입) → `player.png` → 절차적.
  // 부팅 1회에 **전 타입**을 함께 로드한다 — 런 시작 시점의 교체를 동기로 만들기 위해서다
  // (근거는 `PlaceholderTextures.shipByType` 주석). 실파일이 없는 타입은 null 이라 비용 0.

  const [
    shipTypedAll,
    player,
    gem,
    explosion,
    loot,
    parachute,
    supply,
    wall,
    destructible,
    magnetEmitter,
    bombDevice,
    turretPickup,
    shelter,
    encounterPortal,
    encounterSeal,
    encounterAltar,
    bosses,
    backgrounds,
    enemies,
    core,
    guardians,
    invasionBackdrops,
    facilities,
    props,
    defenseBosses,
    formation,
    formationDrone,
    spawnedDrone,
  ] = await Promise.all([
    Promise.all(
      SHIP_SPRITE_NAMES.map((f) => (f === LEGACY_SHIP_SPRITE ? Promise.resolve(null) : tryLoad(f))),
    ),
    tryLoad(LEGACY_SHIP_SPRITE),
    tryLoad('gem.png'),
    tryLoad('fx_explosion.png'),
    tryLoad('loot.png'),
    tryLoad('fx_parachute.png'),
    tryLoad('supply.png'),
    tryLoad('wall.png'),
    tryLoad('destructible.png'),
    tryLoad('magnet_emitter.png'),
    tryLoad('bomb_device.png'),
    tryLoad('turret_pickup.png'),
    tryLoad('shelter.png'),
    // 조우 3종(ADR-0033). 파일명은 **유형** 기준이다 — 봉인석이 포탈과 같은 kind 를 쓰므로
    // kind 기준으로 이름 지으면 두 자산이 한 이름을 다투게 된다.
    tryLoad('encounter_portal.png'),
    tryLoad('encounter_seal.png'),
    tryLoad('encounter_altar.png'),
    Promise.all(bossFiles.map((f) => tryLoad(f))),
    Promise.all(bgFiles.map((f) => tryLoad(f))),
    Promise.all(enemyFiles.map((f) => tryLoad(f))),
    tryLoad('defense_core.png'),

    Promise.all(guardianFiles.map((f) => tryLoad(f))),
    // M7a 침공 3레이어: 파일명은 카탈로그 파생(FACILITY_ASSET_FILES 등) — 없으면 절차적 유지.
    Promise.all(INVASION_BACKDROP_ASSET_FILES.map((f) => tryLoad(f))),
    Promise.all(FACILITY_ASSET_FILES.map((f) => tryLoad(f))),
    Promise.all(PROP_ASSET_FILES.map((f) => tryLoad(f))),
    Promise.all(DEFENSE_BOSS_ASSET_FILES.map((f) => tryLoad(f))),
    tryLoad(DEF3_UNIT_ASSET_FILES[0]!),
    tryLoad(DEF3_UNIT_ASSET_FILES[1]!),
    tryLoad(DEF3_UNIT_ASSET_FILES[2]!),
  ]);

  // 아군·이익 오브젝트 루프 애니메이션(2026-07-26). 정지 스프라이트 로드와 별개로 스트립을
  // 읽는다 — 스트립이 없으면 슬롯이 null 이라 렌더가 정지 스프라이트를 그대로 쓴다(회귀 0).
  const animStrips = await Promise.all(
    ANIM_STRIP_FILES.map(async ([slot, file]) => [slot, await tryLoadStrip(file)] as const),
  );
  tex.anim = Object.fromEntries(animStrips) as Partial<Record<AnimatedKind, Texture[] | null>>;

  // 우선순위: 타입 전용 → 레거시 → 절차적. 타입 전용이 null 인 경우(파일 미존재·로드 실패·
  // 타입 0)에도 아무 예외 없이 다음 단으로 내려간다.
  if (player !== null) tex.player = player;
  // 전 타입 슬롯을 채운다. 폴백 기준은 이 시점의 `tex.player`(= 레거시 또는 절차적)다.
  tex.shipByType = resolveShipTextures(shipTypedAll, tex.player);
  applyShipSprite(tex, shipType);
  if (gem !== null) tex.gem = gem;
  if (explosion !== null) tex.explosion = explosion;
  if (loot !== null) tex.loot = loot;
  if (parachute !== null) tex.parachute = parachute;
  // Scroll-map gimmicks: PNG overrides the shape placeholder; missing file keeps
  // the procedural fallback (regression 0). All render fixedFacing (no rotation);
  // wall stretches to its AABB unit-square, supply keeps the fx_parachute child.
  if (supply !== null) tex.supply = supply;
  if (wall !== null) tex.wall = wall;
  if (destructible !== null) tex.destructible = destructible;
  if (magnetEmitter !== null) tex.magnetEmitter = magnetEmitter;
  if (bombDevice !== null) tex.bombDevice = bombDevice;
  if (turretPickup !== null) tex.turretPickup = turretPickup;
  if (shelter !== null) tex.shelter = shelter;
  if (encounterPortal !== null) tex.encounterPortal = encounterPortal;
  if (encounterSeal !== null) tex.encounterSeal = encounterSeal;
  if (encounterAltar !== null) tex.encounterAltar = encounterAltar;
  bosses.forEach((t, i) => {
    if (t !== null) tex.boss[i] = t;
  });
  backgrounds.forEach((t, i) => {
    if (t !== null) tex.background[i] = t;
  });
  enemies.forEach((t, i) => {
    if (t !== null) tex.enemy[i] = t;
  });
  // 방어 엔티티: PNG 가 있으면 유형색 플레이스홀더를 덮고, 없으면 그대로 유지(회귀 0).
  if (core !== null) tex.core = core;

  guardians.forEach((t, i) => {
    if (t !== null) tex.guardian[i] = t;
  });
  // 침공 3레이어: 슬롯 길이는 절차적 생성이 이미 카탈로그에서 확정했으므로, 여기서는
  // 존재하는 PNG 만 덮는다(누락 = 플레이스홀더 유지, 회귀 0).
  invasionBackdrops.forEach((t, i) => {
    if (t !== null) tex.invasionBackdrop[i] = t;
  });
  facilities.forEach((t, i) => {
    if (t !== null) tex.facility[i] = t;
  });
  props.forEach((t, i) => {
    if (t !== null) tex.prop[i] = t;
  });
  defenseBosses.forEach((t, i) => {
    if (t !== null) tex.defenseBoss[i] = t;
  });
  if (formation !== null) tex.formation = formation;
  if (formationDrone !== null) tex.formationDrone = formationDrone;
  if (spawnedDrone !== null) tex.spawnedDrone = spawnedDrone;

  return tex;
}
