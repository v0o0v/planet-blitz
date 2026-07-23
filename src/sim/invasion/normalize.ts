/**
 * 침공 3레이어 — 공유 정규화 + 위조 대조 (M7a · L0-schema).
 *
 * ## 왜 공유 모듈인가
 * 구 구조는 클라 `normalizeLayout`(src/ui/defenseCommand.ts:387)과 서버
 * `normalizeServerLayout`(supabase/functions/verify-invasion/verifyInvasionCore.ts:243)이
 * **"자구 일치"라는 구두 계약**으로 묶여 있었다. 한쪽만 고치면 정직한 런이 전량
 * `defense-mismatch` 로 오거부된다. 3레이어에서는 필드 수가 몇 배로 늘어 이 계약이 유지될 수
 * 없으므로, 정규화를 이 모듈 **하나로 승격**한다. EF 는 sloppy-imports 로 `src/sim/**` 를
 * 직접 읽으므로 추가 인프라가 필요 없다.
 *
 * ## 왜 total function 인가
 * 구 정규화는 손상 시 `null` 을 돌려 호출부마다 분기가 갈렸다. 여기서는 **항상 유효한
 * InvasionLayers 를 돌려준다**: 손상 슬롯은 비운다(null), 미지정 필드는 기본값을 넣고, 초과분은
 * 자른다. "정규화 실패"라는 상태가 없으면 클라·서버가 갈릴 여지도 없다.
 *
 * ## 위조 대조의 완전성
 * {@link layersEqual} 은 **정규형 전체를 구조적으로 깊이 비교**한다(필드 화이트리스트가 아니다).
 * sim 이 읽는 값은 전부 정규형이므로, 정규형 전체를 비교하면 "대조 누락 = 위조 프리패스"가
 * 구조적으로 불가능하다. 필드가 늘어도 대조 코드를 갱신할 필요가 없다.
 * 나아가 {@link enumerateLayerFields} / {@link mutateLayerField} 로 스키마에서 변조 케이스를
 * **파생**할 수 있어, 테스트가 필드 전수를 하드코딩 없이 강제한다.
 */

import type { GuardianSnapshot } from '../../../data/guardian.js';
import {
  normalizeGuardianWeaponType,
  normalizeGuardianBulletCount,
  normalizeGuardianSpread,
} from '../../../data/guardian.js';
import {
  INVASION_ASCENSION_MAX,
  INVASION_ASCENSION_MIN,
  INVASION_CORE_HP,
  INVASION_CORE_MODULE_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_LEVEL_MAX,
  INVASION_LEVEL_MIN,
  INVASION_PROP_SLOTS,
  INVASION_RARITY_COUNT,
  INVASION_SOCKET_COUNTS,
  INVASION_TEMPLATE_COUNT,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_STRAIGHT,
} from './constants.js';
import type {
  FacilityRef,
  FormationRef,
  InvasionCorePlacement,
  InvasionGuardianPlacement,
  InvasionLayer1,
  InvasionLayer2,
  InvasionLayer3,
  InvasionLayers,
  InvasionRef,
  LayerField,
  ModuleRef,
  PropRef,
} from './types.js';

// ---------------------------------------------------------------------------
// 정수 헬퍼 (전 스키마가 정수 도메인 — f64 없음)
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 임의 값 → 정수. 비유한·비숫자는 fallback. `-0` 은 `0` 으로 접는다(Object.is 대조에서
 * `-0 !== 0` 이 되는 함정 제거 — 정규형은 정준형이어야 한다).
 */
function toInt(v: unknown, fallback: number): number {
  if (!isFiniteNumber(v)) return fallback;
  const t = Math.trunc(v);
  return t === 0 ? 0 : t;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ref
// ---------------------------------------------------------------------------

/**
 * 방어체 참조 1건 정규화. `catalogId` 가 없거나 음수면 **빈 슬롯(null)** 으로 본다 —
 * 손상 데이터가 "존재하는 무언가"로 살아남지 않게 한다.
 */
export function normalizeRef(raw: unknown): InvasionRef | null {
  const r = asRecord(raw);
  if (r === null) return null;
  if (!isFiniteNumber(r.catalogId)) return null;
  const catalogId = toInt(r.catalogId, -1);
  if (catalogId < 0) return null;
  return {
    catalogId,
    level: clampInt(toInt(r.level, INVASION_LEVEL_MIN), INVASION_LEVEL_MIN, INVASION_LEVEL_MAX),
    ascension: clampInt(
      toInt(r.ascension, INVASION_ASCENSION_MIN),
      INVASION_ASCENSION_MIN,
      INVASION_ASCENSION_MAX,
    ),
    // uint32 도메인(INVASION_AFFIX_SEED_MASK)으로 접는다 — 음수·초과분이 재현을 가르지 않게.
    affixSeed: toInt(r.affixSeed, 0) >>> 0,
    rarity: clampInt(toInt(r.rarity, 0), 0, INVASION_RARITY_COUNT - 1),
  };
}

// ---------------------------------------------------------------------------
// 수호 배치
// ---------------------------------------------------------------------------

/** {@link GuardianSnapshot} 의 수치 필드(전부 정수여야 결정론 재현 성립). 순서 = 직렬화 계약. */
export const GUARDIAN_SNAPSHOT_FIELDS: readonly (keyof GuardianSnapshot)[] = [
  'preset',
  'radius',
  'hp',
  'contactDamage',
  'fireCooldown',
  'bulletDamage',
  'bulletSpeed',
  'bulletRadius',
  'bulletLife',
  'range',
  'moveSpeed',
  'standoff',
  // 발사 서술자(ADR-0025) — append-only. 순서 변경 금지(직렬화 계약).
  'weaponType',
  'bulletCount',
  'spread',
];

/**
 * 발사 서술자(ADR-0025) 기본값 — 구 스냅샷(발사 필드 부재)을 벌컨 단발로 우아하게 승격한다
 * (정규화가 슬롯을 통째로 버려 구 수호가 방어에서 사라지는 것을 막는다). 클라(Node)·서버(Deno)가
 * 동일 기본값을 쓰므로 바이트 정합이 유지된다. **코어 12필드는 기본값 없음** — 비유한이면 슬롯을
 * 통째로 null 로 버린다(결정론 가드 — 손상 스냅샷이 hashFloat 에 닿는 것 차단).
 */
const GUARDIAN_SNAPSHOT_FIELD_DEFAULTS: Partial<Record<keyof GuardianSnapshot, number>> = {
  weaponType: 0,
  bulletCount: 1,
  spread: 0,
};

/**
 * 수호 배치 1기 정규화. 코어 스냅샷 필드가 **하나라도** 유한수가 아니면 슬롯을 통째로 비운다
 * (손상 스냅샷이 hashFloat 에 닿으면 재현이 깨진다 — 구 normalizeGuardian 규율 계승). 발사
 * 서술자 3필드(ADR-0025)는 부재/비유한 시 {@link GUARDIAN_SNAPSHOT_FIELD_DEFAULTS}로 승격한다.
 */
export function normalizeGuardianPlacement(raw: unknown): InvasionGuardianPlacement | null {
  const g = asRecord(raw);
  if (g === null) return null;
  const snapRaw = asRecord(g.snapshot);
  if (snapRaw === null) return null;
  const snap: Record<string, number> = {};
  for (const key of GUARDIAN_SNAPSHOT_FIELDS) {
    const v = snapRaw[key as string];
    if (!isFiniteNumber(v)) {
      const def = GUARDIAN_SNAPSHOT_FIELD_DEFAULTS[key];
      if (def === undefined) return null; // 코어 필드 비유한 → 슬롯 폐기(결정론 가드)
      snap[key as string] = def; // 발사 서술자 부재 → 기본값(구 수호 하위호환)
      continue;
    }
    snap[key as string] = toInt(v, 0);
  }
  // 주입 경계 방어(ADR-0025): 발사 서술자를 민팅과 동일 상한으로 클램프한다 — 변조된 대량
  // bulletCount(예: 1e6)가 sim 발사(fireGuardianFan)에서 탄 폭주로 CPU·메모리 예산을 고갈시키는
  // DoS 를 막는다. 정상 데이터엔 no-op(범위 내). 클라·EF 공유 코드라 결정론 무해(해시 정합).
  snap.weaponType = normalizeGuardianWeaponType(snap.weaponType ?? 0);
  snap.bulletCount = normalizeGuardianBulletCount(snap.bulletCount ?? 1);
  snap.spread = normalizeGuardianSpread(snap.spread ?? 0);
  return {
    x: toInt(g.x, 0),
    y: toInt(g.y, 0),
    snapshot: snap as unknown as GuardianSnapshot,
    performanceCP: toInt(g.performanceCP, 0),
    lineageBonusBp: toInt(g.lineageBonusBp, 0),
    milestones: toInt(g.milestones, 0),
  };
}

// ---------------------------------------------------------------------------
// 슬롯 배열
// ---------------------------------------------------------------------------

/**
 * 임의 배열 → 고정 길이 슬롯 배열. 초과분은 자르고 모자란 만큼 null 로 채운다.
 * **슬롯 인덱스가 계약**이므로 밀집화(compaction)하지 않는다 — null 은 자리를 지킨다.
 */
function normalizeSlots<T>(raw: unknown, length: number, one: (v: unknown) => T | null): (T | null)[] {
  const out: (T | null)[] = new Array(length).fill(null);
  if (!Array.isArray(raw)) return out;
  const n = raw.length < length ? raw.length : length;
  for (let i = 0; i < n; i++) out[i] = one(raw[i]);
  return out;
}

// ---------------------------------------------------------------------------
// 레이어별 정규화
// ---------------------------------------------------------------------------

function normalizeL1(raw: unknown): InvasionLayer1 {
  const d = asRecord(raw);
  return {
    waveSlots: normalizeSlots<FormationRef>(d?.waveSlots, INVASION_WAVE_SLOTS, normalizeRef),
  };
}

function normalizeL2(raw: unknown): InvasionLayer2 {
  const d = asRecord(raw);
  const templateId = clampInt(
    toInt(d?.templateId, MAP_TEMPLATE_STRAIGHT),
    0,
    INVASION_TEMPLATE_COUNT - 1,
  );
  const socketCount = INVASION_SOCKET_COUNTS[templateId] ?? 0;
  return {
    templateId,
    sockets: normalizeSlots<FacilityRef>(d?.sockets, socketCount, normalizeRef),
  };
}

function normalizeCore(raw: unknown): InvasionCorePlacement {
  const c = asRecord(raw);
  const hp = toInt(c?.hp, INVASION_CORE_HP);
  return {
    hp: hp < 1 ? 1 : hp,
    x: toInt(c?.x, 0),
    y: toInt(c?.y, 0),
  };
}

function normalizeL3(raw: unknown): InvasionLayer3 {
  const d = asRecord(raw);
  return {
    boss: normalizeRef(d?.boss),
    guardians: normalizeSlots<InvasionGuardianPlacement>(
      d?.guardians,
      INVASION_GUARDIAN_SLOTS,
      normalizeGuardianPlacement,
    ),
    props: normalizeSlots<PropRef>(d?.props, INVASION_PROP_SLOTS, normalizeRef),
    core: normalizeCore(d?.core),
    modules: normalizeSlots<ModuleRef>(d?.modules, INVASION_CORE_MODULE_SLOTS, normalizeRef),
  };
}

/**
 * 신뢰 불가 값 → 정규 {@link InvasionLayers}. **항상 성공**한다(total function).
 * 클라 저장·서버 로드·EF 대조가 전부 이 함수 하나를 쓴다.
 *
 * 멱등: `normalize(normalize(x))` 는 `normalize(x)` 와 깊이 동일하다.
 */
export function normalizeInvasionLayers(raw: unknown): InvasionLayers {
  const d = asRecord(raw);
  return {
    l1: normalizeL1(d?.l1),
    l2: normalizeL2(d?.l2),
    l3: normalizeL3(d?.l3),
  };
}

/** 전 슬롯이 빈 정규형(기본 수비대가 전부 충원하는 배치). 시드·테스트 기준점. */
export function emptyInvasionLayers(): InvasionLayers {
  return normalizeInvasionLayers(undefined);
}

/** 정규형 깊은 복제(JSON 왕복 없이 — 구조가 확정돼 있어 수동 복제가 더 빠르고 안전하다). */
export function cloneInvasionLayers(layers: InvasionLayers): InvasionLayers {
  return normalizeInvasionLayers(layers);
}

// ---------------------------------------------------------------------------
// 위조 대조
// ---------------------------------------------------------------------------

/**
 * 정규형 평면 데이터(객체·배열·정수·null)의 구조적 깊은 비교.
 * 키 집합까지 양방향으로 대조하므로 **필드가 늘어도 자동으로 대조 대상**이다.
 */
function deepEqualCanonical(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const ta = typeof a;
  if (ta === 'number' || typeof b === 'number') {
    return ta === 'number' && typeof b === 'number' && Object.is(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualCanonical(a[i], b[i])) return false;
    }
    return true;
  }
  if (ta !== 'object' || typeof b !== 'object') return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  const kb = Object.keys(rb);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k)) return false;
    if (!deepEqualCanonical(ra[k], rb[k])) return false;
  }
  return true;
}

/**
 * 제출 배치 ↔ 서버 권위 배치 대조(EF `defense-mismatch` 판정의 정본).
 * 양쪽을 정규화한 뒤 **정규형 전체**를 비교한다 — 화이트리스트가 없으므로 신규 필드가
 * 대조에서 누락되는 보안 구멍이 구조적으로 생기지 않는다.
 */
export function layersEqual(a: unknown, b: unknown): boolean {
  return deepEqualCanonical(normalizeInvasionLayers(a), normalizeInvasionLayers(b));
}

// ---------------------------------------------------------------------------
// 필드 전수 파생 (테스트가 변조 케이스를 스키마에서 뽑아 쓰기 위한 메타 API)
// ---------------------------------------------------------------------------

/** 변조용 표본 Ref(어떤 슬롯에 넣어도 정규화를 통과한다). */
export const SAMPLE_REF: InvasionRef = {
  catalogId: 1,
  level: 7,
  ascension: 2,
  affixSeed: 123456789,
  rarity: 2,
};

/** 변조용 표본 수호 배치. */
export const SAMPLE_GUARDIAN: InvasionGuardianPlacement = {
  x: 120,
  y: -240,
  snapshot: {
    preset: 0,
    radius: 44,
    hp: 900,
    contactDamage: 24,
    fireCooldown: 48,
    bulletDamage: 22,
    bulletSpeed: 1100,
    bulletRadius: 12,
    bulletLife: 120,
    range: 1100,
    moveSpeed: 220,
    standoff: 700,
    // 발사 서술자는 벌컨 단발(0/1/0)로 둔다 — invasionE2E 의 filledLayers 가 이 표본을 수호로
    // 쓰므로, 여기를 비-벌컨으로 바꾸면 e2e 런 궤적이 바뀐다. 변조 테스트는 값과 무관하게 필드
    // 봉인만 검증한다(0→변조도 해시가 갈린다). 아키타입 발사 자체는 별도 통합 테스트가 다룬다.
    weaponType: 0,
    bulletCount: 1,
    spread: 0,
  },
  performanceCP: 9000,
  lineageBonusBp: 1200,
  milestones: 3,
};

function walkFields(value: unknown, path: string, out: LayerField[]): void {
  if (value === null) return;
  if (typeof value === 'number') {
    out.push({ path, kind: 'number' });
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walkFields(value[i], `${path}[${i}]`, out);
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const k of Object.keys(rec)) walkFields(rec[k], path === '' ? k : `${path}.${k}`, out);
}

/** 슬롯 경로(채움↔비움 토글 대상) 목록. 배열 슬롯 + 단일 보스 슬롯. */
function slotPaths(layers: InvasionLayers): LayerField[] {
  const out: LayerField[] = [{ path: 'l3.boss', kind: 'slot' }];
  for (let i = 0; i < layers.l1.waveSlots.length; i++) {
    out.push({ path: `l1.waveSlots[${i}]`, kind: 'slot' });
  }
  for (let i = 0; i < layers.l2.sockets.length; i++) {
    out.push({ path: `l2.sockets[${i}]`, kind: 'slot' });
  }
  for (let i = 0; i < layers.l3.guardians.length; i++) {
    out.push({ path: `l3.guardians[${i}]`, kind: 'slot' });
  }
  for (let i = 0; i < layers.l3.props.length; i++) {
    out.push({ path: `l3.props[${i}]`, kind: 'slot' });
  }
  for (let i = 0; i < layers.l3.modules.length; i++) {
    out.push({ path: `l3.modules[${i}]`, kind: 'slot' });
  }
  return out;
}

/**
 * 주어진 배치에서 **변조 가능한 모든 지점**을 열거한다(수치 리프 전수 + 슬롯 전수).
 * 테스트는 이 목록으로 위조 케이스를 파생해 `layersEqual` 이 전부 잡는지 강제한다 —
 * 스키마에 필드를 추가해도 테스트 테이블을 손댈 필요가 없다(= 대조 누락이 조용히 통과하지
 * 않는다).
 *
 * 주의: null 슬롯의 내부 수치 리프는 존재하지 않으므로 열거되지 않는다. 필드 전수 커버리지를
 * 원하면 **모든 슬롯이 채워진 배치**를 넘겨라.
 */
export function enumerateLayerFields(layers: InvasionLayers): LayerField[] {
  const norm = normalizeInvasionLayers(layers);
  const numbers: LayerField[] = [];
  walkFields(norm, '', numbers);
  return [...numbers, ...slotPaths(norm)];
}

type PathToken = string | number;

function parsePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  let buf = '';
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === '.') {
      if (buf !== '') tokens.push(buf);
      buf = '';
    } else if (c === '[') {
      if (buf !== '') tokens.push(buf);
      buf = '';
      let j = i + 1;
      let num = '';
      while (j < path.length && path[j] !== ']') {
        num += path[j];
        j++;
      }
      tokens.push(Number(num));
      i = j;
    } else {
      buf += c;
    }
  }
  if (buf !== '') tokens.push(buf);
  return tokens;
}

function readPath(root: unknown, tokens: PathToken[]): unknown {
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<PathToken, unknown>)[t];
  }
  return cur;
}

function writePath(root: unknown, tokens: PathToken[], value: unknown): void {
  let cur = root as Record<PathToken, unknown>;
  for (let i = 0; i < tokens.length - 1; i++) {
    cur = cur[tokens[i]!] as Record<PathToken, unknown>;
  }
  cur[tokens[tokens.length - 1]!] = value;
}

/** 슬롯 경로가 수호 슬롯인지(표본 채움 값이 Ref 가 아니라 수호 배치여야 한다). */
function isGuardianSlot(path: string): boolean {
  return path.startsWith('l3.guardians[');
}

/**
 * 필드 1건을 **실제로 다른 값**으로 변조한 정규형을 만든다(정규화 후에도 원본과 다름이 보장).
 *   - number: +1 → 정규화 후에도 같으면(클램프 상한 등) -1 로 재시도.
 *   - slot: null ↔ 표본(Ref 또는 수호 배치) 토글.
 * 어떤 이유로도 값이 갈리지 않으면 `null` 을 돌려준다(테스트가 명시적으로 실패하도록).
 */
export function mutateLayerField(layers: InvasionLayers, field: LayerField): InvasionLayers | null {
  const base = normalizeInvasionLayers(layers);
  const tokens = parsePath(field.path);

  if (field.kind === 'slot') {
    const draft = normalizeInvasionLayers(base);
    const cur = readPath(draft, tokens);
    const filler = isGuardianSlot(field.path) ? SAMPLE_GUARDIAN : SAMPLE_REF;
    writePath(draft, tokens, cur === null || cur === undefined ? filler : null);
    const out = normalizeInvasionLayers(draft);
    return layersEqual(out, base) ? null : out;
  }

  const cur = readPath(base, tokens);
  if (typeof cur !== 'number') return null;
  for (const delta of [1, -1]) {
    const draft = normalizeInvasionLayers(base);
    writePath(draft, tokens, cur + delta);
    const out = normalizeInvasionLayers(draft);
    if (!layersEqual(out, base)) return out;
  }
  return null;
}
