# M2 Lane 1 핸드오프 — 아이템·드랍·무기·엘리트·변칙 (Phase A+B)

- 브랜치: `feat/m2-farming-loop` / 커밋: `2f7279e`(Phase A) · `6007081`(Phase B) · `84d2cce`(테스트)
- 상태: 106/106 테스트 녹색, `tsc --noEmit`·`eslint` 통과. push/PR 안 함.

## Decided (채택)
- **드랍 결정 경계 ①A**: 시뮬은 드랍 시드(u32)+rarity만 방출, 아이템 확정은 순수 함수 `rollItem`. `Entity` 해시 레이아웃 불변.
- **로드아웃 반영 ②A**: `computeLoadoutStats` → `WorldConfig.loadout` 블록 주입 → `createWorld`가 초기 weapon/config/player/magnet에 1회 적용. `Replay.config`가 스냅샷을 나름.
- **무기 3타입 ③A**: `WeaponStats.weaponType`(0 발칸/1 스프레드/2 레일건) + `autoAttack` 분기. 레일건=단발 관통, 발칸/스프레드=부채꼴(베이스라인 차이는 loadout이 부여).
- **엘리트 마커**: 신규 필드 없이 enemy의 미사용 `pierce` 필드에 `affixCode+1` 저장(0=일반). 이미 해시됨.
- **엘리트 어픽스 4종**: 0 분열(사망 파편)·1 가속(speed×1.6)·2 자기장(접촉피해·크기↑ 위협형 첫 패스)·3 완강(HP×2 추가). `rng.fork('elite')`(OQ-M2-4).
- **변칙 수락 = config 플래그**(OQ-M2-3). 오퍼는 seed-only(`rng.fork('anomaly')` ~25%), active는 offered&&accepted.
- **암흑 성운 시야↓는 렌더 전용**(OQ-M2-5) — sim은 유니크 드랍률↑만.
- **loot 접촉 자동 획득**(OQ-M2-1) → `state.loot[]` 누적.
- **hashWorld는 append-only**(맨 끝에 추가), **KIND_CODE loot=14**(1~13 불변).

## Rejected
- 시뮬 안에서 아이템 전체 롤(①B) — 가변 어픽스 배열이 flat Entity/해시와 불일치.
- 매 틱 장비 재계산(②B), 무기 전략객체 다형성(③B) — 과설계.
- 어픽스 슬롯 제한 — M2는 21종을 전 슬롯 허용(단순화, 튜닝 대상).

## Risks / 주의
- **어픽스 무제한 슬롯**: bulletCount가 armor에 붙을 수 있음. 밸런스/UX 튜닝 시 슬롯별 화이트리스트 도입 여지.
- **자기장 엘리트**는 M2 첫 패스로 스탯 위협형(접촉피해·크기↑). 고유 거동은 튜닝 루프에서 재검토.
- **loot 영속**: 바닥 loot는 청크 컬링 대상 아님(엘리트·보스는 희소해 무해). 폭증 시 컬링 필요.
- **saveVersion**은 `src/items/types.ts`에 상수(=1)만. 실제 마이그레이션은 Lane 2(C1).
- **유니크**: `rollItem('unique')`는 레지스트리 빈 상태면 uniqueId=undefined(레어처럼 동작). Lane 3이 채우면 자동 연결.

## Files
- 신규: `src/items/{types,roll,loadout,uniques}.ts`, `data/affixes.ts`, `src/sim/{anomaly,drops,elite}.ts`, `tests/{items,loadout,drops,anomaly}.test.ts`
- 수정: `src/sim/{world,replay,entities,waves,snapshot}.ts`

## 소비 API (Lane 2·3용)

### rollItem (Lane 2 정산에서 loot→아이템 확정)
```ts
import { rollItem } from 'src/items/roll.js';
rollItem(dropSeed: number, rarity: Rarity, source: ItemSource): Item
// Item: { id, slot, rarity, affixes: {id,stat,value}[], weaponType?, uniqueId?, source }
// rarity 코드: 0 normal·1 magic·2 rare·3 unique (RARITY_CODE/RARITY_BY_CODE in types.ts)
```

### loot 정산 이벤트 (Lane 2)
런 종료 후 `finalState.loot: LootRecord[]` 소비:
```ts
interface LootRecord { seed: number; rarity: number; planet: number; tier: number }
// 각 항목을 rollItem(seed, RARITY_BY_CODE[rarity], {planet,tier})로 아이템화 → 인벤 적재
```

### computeLoadoutStats (Lane 2 UI가 런 config 구성)
```ts
import { computeLoadoutStats, neutralLoadout } from 'src/items/loadout.js';
const { loadout, worldMods } = computeLoadoutStats(equipped: Item[]);
// worldMods.mineralFindMult 은 sim 밖(정산 광물 환산). loadout 은 sim용.
const config: WorldConfig = { ...DEFAULT_CONFIG, planet, tier, anomalyAccepted, loadout };
createWorld(seed, config);
```

### WorldConfig 확장 필드 (모두 optional, 없으면 M1 거동)
- `planet?: number`(0 카르곤/1 베르단), `tier?: number`(0 정찰/1 교전)
- `anomalyAccepted?: boolean`, `loadout?: LoadoutConfig`(15필드, world.ts 정의)

### 유니크 훅 (Lane 3)
```ts
import { registerUnique } from 'src/items/uniques.js';
registerUnique({ id, name, slot, bit });  // bit 0..30 → LoadoutConfig.uniqueMask
// computeLoadoutStats가 장착 유니크의 bit를 OR → sim은 config.loadout.uniqueMask로 거동 게이트
```

### 스냅샷 (렌더 Lane)
- `EntitySnapshot.elite: number`(엘리트 어픽스 코드 0~3, 아니면 -1) — 명판/아웃라인용
- loot 엔티티: `kind:'loot'`, `enemyType`=rarity 코드(빔 색)

## Remaining (Lane 1 범위 밖 — 다른 Lane)
- 세이브/정산 연결(C1·C2), 인벤·성계지도 UI(D), 베르단 로스터·여왕보스·드랍테이블(E), 유니크 5점·세리머니(F), 밸런스 튜닝(§5).
