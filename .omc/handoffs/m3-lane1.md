# M3 Lane 1 핸드오프 — 스킬트리·리롤·무기 5타입·파워업 24종 (Phase A + C)

- 브랜치: `feat/m3-progression-complete` / 커밋: `2222440`
- 상태: 183/183 테스트 녹색, `tsc --noEmit`·`eslint --max-warnings 0` 통과. push/PR 안 함.
- 범위: 계획 Phase A(A1~A4)·Phase C(C1~C2). Phase B(행성·어픽스/유니크·상태이상)는 Lane 2, UI(연구소·정제소·기지맵)는 Lane 3.

## Decided (채택)
- **스킬 반영 ①A**: 스킬 파생 스탯을 M2 로드아웃 파이프라인(`computeLoadoutStats`)에 합류. `WorldConfig.skillInvest`(60벡터) 스냅샷을 `Replay.config`가 나름 → `hashWorld` **append-only** 말미 fold(AC2). 스킬 효과는 이미 `config.loadout`에 접혀 sim에 재적용 안 함(런 중 스킬 불변).
- **시너지 ②(OQ-M3-2)**: 계열 하위 tier 총투자량이 상위 노드 출력을 소폭 증폭(0.004/pt, 상한 +50%). 디아2식.
- **파워업 필터 ①(OQ-M3-1)**: 소프트 가중. 범용 항상 후보, 무기타입 일치·투자 계열 가중↑, off-build도 낮은 확률로 후보 유지(하드 제외 금지). `powerupRng` 정수 가중 추첨(결정론).
- **미사일 ④(OQ-M3-4)**: 제한 선회 유도(0.09 rad/tick). `ownerId=MISSILE_MARK` 마커, `stepProjectiles`에서 매 틱 최근접 적으로 각도 클램프 선회, 속도 보존. `src/sim/math.ts` 결정론 trig만.
- **빔 ③(OQ-M3-3)**: 매틱 짧은 수명(2틱) 정적 세그먼트 라인(speed 0, pierce 9999). 사거리/spacing으로 세그먼트 수 결정(상한 16). 신규 엔티티 kind 없음(bullet 재사용).
- **무기 5타입**: `rollItem` main `rng.int(0,4)`(발칸/스프레드/레일건/미사일/빔). `int`은 span 무관 nextU32 1회 소비 → 기존 RNG 스트림 형태 불변(뒤 롤 안 밀림).
- **saveVersion 2**: `skillInvest` 추가. `migrateV1toV2`(스탬프만) + `normalizeSkillInvest`(길이·노드 max 클램프).

## Rejected
- 스킬 전용 config 블록·별도 적용 경로(②B), 런 중 실시간 판정(②C) — 이중화·과설계.
- 파워업 하드 필터(비해당 제외) — "빌드 파생"이되 선택 다양성 상실.
- 빔 지속 히트박스 엔티티 — 결정론·성능 대비 이득 없음.

## 소비 API (Lane 3 UI가 소비)

### 스킬 데이터 (`data/skills.ts`)
```ts
SKILLS: readonly SkillNode[]           // 60노드. index = firepower[0..19]/survival[20..39]/mobility[40..59]
SKILL_NODE_COUNT = 60
SKILL_TREES: readonly SkillTree[]      // ['firepower','survival','mobility'] — 순서 불변
NODES_PER_TREE = 20, TREE_DEPTH = 5
treeRange(tree): { start, end }        // 계열 노드 index 범위 [start,end)
// SkillNode: { id, tree, name, desc, stat(StatKey), perPoint, maxPoints(4|5), tier(0..4) }
```

### 스킬 투자·리스펙 (`src/save/profile.ts`)
```ts
Profile.skillInvest: number[]          // 길이 60, skillInvest[i]=SKILLS[i] 투자량(0..maxPoints)
investSkill(profile, index): boolean   // 뱅크 1점 소비해 노드 +1. maxed/포인트0/범위밖 → false
respecCost(profile): number            // activeShip.level * 100(RESPEC_COST_PER_LEVEL)
respecSkills(profile): boolean         // 전액 환급→뱅크, 크레딧 차감, 벡터 0. 투자0/크레딧부족 → false
totalInvested(profile): number
zeroSkillInvest(): number[]            // 60개 0 벡터
```
- UI: 연구소 화면에서 `SKILLS` 트리 시각화(tier별 배치), `investSkill`/`respecSkills` 호출, `computeSkillStats(profile.skillInvest)`로 현재 파생 스탯 프리뷰 표시.

### 스킬 파생 스탯 프리뷰 (`src/items/skills.ts`)
```ts
computeSkillStats(invest): Record<StatKey, number>  // 순수. 시너지 반영, pierce/bulletCount 내림
```

### 정제소 리롤 (`src/items/roll.ts`)
```ts
rerollAffixes(item, rerollSeed, lockedIndex?): Item
// 순수. 어픽스 개수 보존, lockedIndex 어픽스 제자리 보존·나머지 결정론 재롤.
// 잠금 어픽스는 재롤 풀에서 제외(중복 방지). id/slot/rarity/weaponType/uniqueId/source 불변.
// lockedIndex 생략/범위밖 = 전부 재롤. 0어픽스 = 동일 복사본.
// 광물 3배 비용·슬롯머신 연출은 UI/메타 책임(이 함수는 순수 결과만).
```

### 무기 타입 상수 (`src/items/loadout.ts`)
```ts
WEAPON_VULCAN=0, WEAPON_SPREAD=1, WEAPON_RAILGUN=2, WEAPON_MISSILE=3, WEAPON_BEAM=4
```
- 렌더 Lane: 미사일 탄은 `bullet` + `ownerId`가 큰 마커값(유도), 빔은 `bullet` 다수 세그먼트(speed 0, life≤2). 스프라이트 분화 시 참고.

### 파워업 (`src/sim/powerups.ts`)
```ts
POWERUPS: readonly PowerupDef[]        // 24종. PowerupDef에 태그 { weaponType? | tree? | universal? }
drawPowerupChoices(state, count)       // 소프트 가중 추첨(내부, sim이 호출)
// 인덱스 0~7 불변(리플레이 와이어). 8~23 신규. 카드 UI는 index→POWERUPS[index].name/desc.
```

### 런 config 조립 (main.ts 이미 반영 — Lane 3가 다른 진입점 쓸 때 참고)
```ts
const skillInvest = profile.skillInvest.slice();
const { loadout } = computeLoadoutStats(equipped, skillInvest);  // invest 2번째 인자 추가됨
const config: WorldConfig = { ...DEFAULT_CONFIG, planet, tier, anomalyAccepted, loadout, skillInvest };
```

## Risks / 주의
- **밸런스 1차 패스**: 노드 perPoint·시너지율·무기 배율·파워업 가중은 §5 튜닝 대상. 수치 검증(40% 커버)은 고정.
- **미사일 속도 미세 드리프트**: 유도 각도 재계산이 결정론 다항 trig(cos²+sin²≈1)라 속도가 틱마다 ~1e-5 상대 드리프트. 결정론엔 무해(모든 플랫폼 동일), 밸런스 무시 가능.
- **빔+분열 코어 유니크**: 세그먼트마다 분열 파편 예약 가능(엔티티×세그먼트). 세그먼트 상한 16·파편 수명 짧아 유계지만, 극단 조합 성능은 튜닝 루프에서 재확인.
- **스킬 벡터 길이**: 항상 `SKILL_NODE_COUNT`. 저장 손상 시 `normalizeSkillInvest`가 복구.

## Files
- 신규: `data/skills.ts`, `src/items/skills.ts`, `tests/{skills,reroll,weapons}.test.ts`
- 수정: `src/items/{loadout,roll,types}.ts`, `src/save/profile.ts`, `src/sim/{world,powerups,replay}.ts`, `src/main.ts`, `tests/{items,save}.test.ts`

## Remaining (Lane 1 범위 밖)
- 연구소·정제소·기지맵 UI(Phase D), FTUE(E), 아트(F) — Lane 3.
- 행성 5개·섬멸 티어·어픽스24/유니크15·상태이상(Phase B) — Lane 2.
- 밸런스 튜닝(§5), G 통합 검증(5행성×3티어 e2e).
