# 침공 진행 HUD + 하네스 침공/방어 편집 + 리플레이 재생 (2026-07-29)

브랜치: `feat/invasion-hud-harness-2026-07-29`
워크트리: `D:\ClaudeCowork\worktrees\shooting\invasion-hud-harness`

## 사용자 요청(원문)

1. 침공에서 각 침공마다 진행사항을 HUD 에 표시
2. 하네스에 침공과 침공방어 테스트를 위해 여러 내역을 수정할 수 있게 기능 추가
3. 하네스에 침공 리플레이를 볼 수 있는 테스트 기능 추가

## 확정 범위(사용자 팝업 응답 2건)

- HUD: **레이어 진행 게이지 + 남은 시간** · **L3 코어/보스 잔여 체력** · **방어 측 요약(잔존 수)**
- 하네스 수정 항목: **방어체 강화 재화(cr/min/bp)** · **방어 배치 세부(설비/편대 슬롯 레벨·등급·승급)**
- 리플레이: 하네스에서 침공 리플레이 재생

## 레인 분할 (파일 소유권 — 겹치면 안 됨)

### Lane A — 침공 진행 HUD
소유 파일:
- `src/ui/invasionProgress.ts` (신규, 순수 파생)
- `src/ui/hud.ts` (`setInvasion` 추가)
- `src/i18n/catalog.ts` (`hud.inv.*` 키)
- `src/main.ts` **HUD 갱신 호출부 1곳만**
- `tests/invasionHud.test.ts` (신규)

계약:
```ts
export interface InvasionHudState {
  phase: 0 | 1 | 2;
  /** 이미 번역된 레이어 문구(예: `L2 · 회랑 돌파`). */
  layerLabel: string;
  /** 현재 레이어 주파율 0..1 (L3 = 코어 파괴 진행도). */
  layerFraction: number;
  /** 현재 레이어 soft 예산 잔여 초. */
  layerRemainSec: number;
  /** 총 제한시간(hard) 잔여 초. */
  totalRemainSec: number;
  /** L3 코어(없으면 undefined). */
  core?: { hp: number; maxHp: number } | undefined;
  /** L3 방어 보스(없으면 undefined). */
  boss?: { hp: number; maxHp: number } | undefined;
  /** 방어 측 잔존 요약(라이브 엔티티 수). */
  defense: { facilities: number; guardians: number; props: number; enemies: number };
}
/** 침공 런이 아니면 null. */
export function invasionHudState(world: WorldState): InvasionHudState | null;
```
- 파생은 이 모듈이, 표시는 `Hud.setInvasion(state | null)` 이 한다(HUD 는 순수 뷰 — `RunInfoState` 와 같은 규율).
- 진행률 축: L1 = `-scrollY`, L2 = `scrollX`, 분모 `layerLength(phase)`(`src/sim/invasion/scroll.ts`). L3 은 축이 없으므로 코어 HP 소모율.
- 잔여 초 = `Math.max(0, budget - elapsed) / 60`. `INVASION_LAYER_TICKS` / `config.invasion3.timeLimitTicks`.
- 방어 잔존 수의 엔티티 kind 는 **실제 스폰 코드를 읽고 확정**할 것 (`src/sim/invasion/facility.ts` · `coreRoom.ts` · `formation.ts`). 추측 금지.
- 패널 위치는 좌상단(`#pb-invprog`) — 기존 `#pb-hud`(좌하단) · `#pb-boss`(상단중앙) · `#pb-runinfo`(우중앙) 와 겹치지 않게.
- 침공이 아닌 런에서는 반드시 감춘다.

### Lane B — 하네스 순수 모듈 (공유 파일 미접촉)
소유 파일:
- `src/harness/invasionEdit.ts` (신규)
- `src/harness/defenseMock.ts` (신규)
- `src/harness/replayStore.ts` (신규)
- `tests/harnessInvasionEdit.test.ts`, `tests/harnessDefenseMock.test.ts`, `tests/harnessReplayStore.test.ts`

계약 — `invasionEdit.ts`(배치 세부 편집, 전부 순수·정수):
```ts
export type SlotGroup = 'wave' | 'socket' | 'boss' | 'prop';
export interface SlotPath { group: SlotGroup; index: number }
export interface SlotView {
  path: SlotPath;
  /** UI 표시 라벨(`L1 편대 #3`). */
  label: string;
  /** 비어 있으면 null. */
  ref: InvasionRef | null;
  /** 카탈로그 표시명(비었으면 ''). */
  catalogName: string;
}
export function listSlots(layers: InvasionLayers): SlotView[];
export function setSlot(layers: InvasionLayers, path: SlotPath, patch: Partial<InvasionRef>): InvasionLayers;
export function clearSlot(layers: InvasionLayers, path: SlotPath): InvasionLayers;
/** 전 슬롯을 같은 스펙으로 채운다(빠른 무대 조립). */
export function fillAll(layers: InvasionLayers, spec: Partial<InvasionRef>): InvasionLayers;
export function catalogSizeFor(group: SlotGroup): number;
```
- 반환은 **항상 새 객체**이고 `normalizeInvasionLayers` 를 통과시켜 정수 불변식을 지킨다.
- level/ascension/rarity/catalogId 는 각 상수 범위로 클램프(`INVASION_LEVEL_*`, `INVASION_ASCENSION_MAX`, `INVASION_RARITY_COUNT`). 범위·카탈로그 크기는 코드에서 읽어 파생할 것(하드코딩 금지).
- L2 소켓 개수는 `templateId` 종속(`INVASION_SOCKET_COUNTS`).

계약 — `defenseMock.ts`(오프라인 방어 사령부 강화 테스트):
```ts
export interface DefenseMockState { credits: number; minerals: number; blueprints: number }
export interface DefenseMockControl {
  gateway: DefenseUnitsGateway;         // src/net/defenseUnits.ts 인터페이스 전량 구현
  setCurrency(next: Partial<DefenseMockState>): void;
  state(): DefenseMockState;
  seedUnits(count: number): void;       // 결정론 시드로 보관함 채우기
  reset(): void;
}
export function createDefenseMock(seed: number): DefenseMockControl;
```
- 서버 산식(`data/defenseUnits.ts` 의 `defenseUnitLevelUpCost` 등)을 그대로 써서 차감·실패 코드를 재현한다(`insufficient-credits` 등).
- 순수 in-memory. 네트워크·SDK 미접촉. `src/harness/catalystMock.ts` 의 규율을 따른다.

계약 — `replayStore.ts`:
```ts
export interface ReplaySummary { seed: number; ticks: number; durationSec: number; invasion: boolean }
export function replaySummary(replay: Replay): ReplaySummary;
export function serializeReplay(replay: Replay): string;
/** 실패(파싱/shape)면 null — throw 금지. */
export function parseReplay(json: string): Replay | null;
```
- shape 검증은 `src/ui/replaySpectate.ts` 의 `isPlayableReplay` 를 재사용한다.

### Lane C — 통합 배선 (Lane A·B 완료 후 단일 레인)
소유 파일: `src/harness/core.ts` · `src/harness/cheatPanel.ts` · `src/main.ts`(HUD 호출부 제외) · `tests/*`

1. `HarnessHost` 확장: `getLiveReplay(): Replay | null` · `getLastReplay(): Replay | null` · `playReplay(replay: Replay, name: string): boolean`.
   `main.ts` 는 기존 `recorder`/`beginSpectate` 를 재사용하고, 런 종료 시 마지막 리플레이를 보관한다.
2. `Harness` API 추가: `replay()` · `lastReplay()` · `playReplay(replay?)` · `verifyReplay(replay?)`(헤드리스 재실행 후 `hashWorld` 대조).
3. 치트 패널 침공 탭 확장:
   - 배치 세부 편집 UI(슬롯 셀렉트 → level/rarity/ascension/catalogId/affixSeed 입력 → 적용/비움/전체채움)
   - 재화 편집(credits/minerals/blueprints) + 방어 mock 게이트웨이 on/off
   - 리플레이 섹션(현재 런 재생 · 최근 런 재생 · JSON 복사/붙여넣기 · 결정론 검증 · 요약 라인)
4. 방어 mock 은 `setDefenseUnitsGatewayFactory` 로 주입하고, 끄면 원복한다.

## 규율 (전 레인 공통)

- **DEV 전용**: 하네스 코드는 프로덕션 번들에 실리면 안 된다(`import.meta.env.DEV` 가드 유지).
- **sim 무수정**: 이 레인은 `src/sim/**` 를 고치지 않는다. 침공 해시·거동은 바이트 불변이어야 한다.
- 오염 규율(ADR-0008): 배치·재화 변조는 라이브 런을 오염시킨다(`markTaintedIfLive`). 리플레이 재생은 기존 관전 경로(진입 즉시 오염)를 그대로 쓴다.
- 문서·주석·UI 문구는 **한글**.
- 테스트 추가 후 **`pnpm tsc --noEmit` 필수**(node-shims 미선언으로 vitest 는 그린인데 빌드가 깨지는 재발 결함).
- 완료 기준은 "번들에 있다"가 아니라 **화면에서 본 것** — 하네스로 실제 침공 런을 띄워 HUD·편집·리플레이를 눈으로 확인한다.
