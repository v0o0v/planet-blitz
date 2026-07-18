# Lane A 핸드오프 — 방어 카드 데이터 카탈로그 + 결정론 롤러

- **커밋**: `2539328` (feat(cards): Lane A 방어 카드 데이터 카탈로그 + 결정론 롤러)
- **브랜치**: `feat/defense-card-system` (push 안 함 — 리드가)
- **검증**: `npm test` 692 passed(61 files, 기존 664 + 신규 28) · `npm run lint` green · `tsc --noEmit` green · denoFixture 불변(sim 무수정).

## Files
- `data/defenseCards.ts` (신규) — 순수 데이터+순수 함수. Deno 무참조(유일 의존 SeededRng·RARITY_CODE, 둘 다 순수).
- `src/items/rollCard.ts` (신규) — `rollCard`·`attemptFusion`·`rollShopRotation` 결정론 롤러(rollItem 준용).
- `tests/defenseCards.test.ts` (신규) — 28 케이스.

## Decided
- **접두=정적 카운터(8종)**: condition 필드로 스냅샷 시점 매치업. `fireAttacker/coldAttacker/lightningAttacker/beamAttacker/powerSuperiority/revenge/reinvasion/subweaponHeavy`.
- **접미=동적 트리거(8종)**: trigger(+threshold)로 런 중 이벤트 반응. `coreProximity/turretsDestroyed(3)/timeElapsed(90·120)/guardianDowned/coreHpLow(30%)/earlyPhase(20s)/coreHit`.
- **어픽스 수**: normal 0 / magic 1~2 / rare 3~6 / unique 고정 `CARD_UNIQUE_AFFIX_COUNT=4`. 접두+접미 합집합(16종)에서 distinct 추첨 후 kind 로 접두/접미 배열에 분류(rollItem 방식).
- **드로우 순서(정본, 변경 금지)**: 어픽스 수 → 어픽스(distinct) → 사용 횟수 → (unique면) uniqueId.
- **사용 횟수**: `CARD_CHARGE_RANGE` n6~10/m5~8/r3~6/u2~4. `chargesLeft=chargesMax` 생성 시.
- **합성**: `FUSION_INPUT_COUNT=3`. `FUSION_CHANCE` n→m 0.5 / m→r 0.2 / r→u 0.03. unique 는 상위 없어 항상 실패(동급 유니크 재롤). `attemptFusion`=승급 판정(nextFloat) → 결과 카드 시드(nextU32)로 rollCard. 통계 검증 N=20000 오차 <0.02/0.02/0.01 통과.
- **상점 로테이션**: `dailyShopRotation(dateSeed,userSeed)` → `ShopSlot[]`(등급+시드 계획, normal 3~4+magic 1~2). `SeededRng(dateSeed).fork(userSeed)`. `rollShopRotation`(rollCard.ts)이 계획→CardInstance.
- **획득 확률(OQ#2)**: `defenseSuccessDropChance(base, attackerCp, defenderCp) = base × (1 + clamp(attackerCp−defenderCp, 0, 5000)/5000)`. `DROP_CP_DIFF_CAP=5000`.
- **분해 환급**: `cardSalvageValue(card) = SALVAGE_BASE[rarity] + affixCount×4`(등급 base n5/m15/r40/u100). 남은 횟수 무관(롤 가치 회수).
- **보관 상한**: `CARD_STORAGE_CAP=20`(OQ#1 만석 획득 차단용).
- **기저 효과**: `CARD_BASE_EFFECT[rarity] = {turretDamagePct, coreHpPct}`(normal도 3/3, 등급별 증가). 무조건 적용.

## Rejected
- **dailyShopRotation 이 CardInstance[] 직접 반환**: data→src/items/rollCard 순환 import 유발. 대신 data 는 로테이션 계획(ShopSlot), rollCard.ts 가 확정 — sim의 seed-emission/roll 분리 철학과 정합.
- **cardSalvageValue 를 rollCard.ts 에 배치**(task #2 문구): 순수 경제 함수라 data/economy.ts 결과 정합하게 data/defenseCards.ts 에 둠. Lane C(server/Deno)가 src/items 를 import 하지 않아도 됨.
- **weaponTypeMatch 범용 조건**: 파라미터 필요해 복잡 → `beamAttacker` 등 구체 조건으로 고정.

## CardInstance 타입 요약 (직렬화 계약 — jsonb·스냅샷)
```ts
interface CardAffixRoll { id: string; stat: CardStatKey; value: number }
interface CardInstance {
  id: string;            // 'card-<seed>'
  rarity: Rarity;        // src/items/types.ts 재사용
  prefixes: CardAffixRoll[];  // 정적 카운터 롤
  suffixes: CardAffixRoll[];  // 동적 트리거 롤
  uniqueId?: string;     // rarity=unique 일 때만 (DEFENSE_CARD_UNIQUES 키)
  chargesMax: number;
  chargesLeft: number;   // 서버가 apply_invasion_result 확정 시 1 차감, 바닥 0
  seed: number;
}
```
- 필드 추가는 **append-only**(스냅샷 해시 계약). Lane C 는 이 형태 그대로 jsonb 저장/스냅샷 주입.

## Lane B 효과 해석 계약 (각 어픽스 id → sim 보정)
sim 은 profile/카탈로그를 읽지 않고 **스냅샷의 CardInstance 롤(id·stat·value)만** 소비해야 함(결정론·서버 권위). 기저 효과는 `CARD_BASE_EFFECT[rarity]` 를 무조건 적용.

### 접두(정적 카운터) — 스폰 시 공격자 스냅샷 매치업, 조건 일치 시에만 value 적용
| id | 조건(condition) | stat | 방향 | sim 보정(제안) |
|----|----------------|------|------|----------------|
| cc-quench | fireAttacker | incomingDmgReductionPct | 방어시설 피해 감소 | 코어·포탑 피격 피해 ×(1−v/100) |
| cc-frostward | coldAttacker | incomingDmgReductionPct | 〃 | 〃 |
| cc-insulate | lightningAttacker | attackerSubCdPct | 공격자 보조무기 쿨↑ | 공격자 subWeapon 쿨다운 ×(1+v/100) |
| cc-refract | beamAttacker | incomingDmgReductionPct | 방어시설 피해 감소 | 〃(주무기 빔/레일건 계열일 때) |
| cc-armorbreak | powerSuperiority | turretDamagePct | 포탑 화력↑ | 포탑 damage ×(1+v/100) (공격자 CP 우위 임계 초과 시) |
| cc-avenger | revenge | turretDamagePct | 〃(대형) | 포탑 damage ×(1+v/100) (복수전 공격자) |
| cc-blockade | reinvasion | incomingDmgReductionPct | 방어시설 피해 감소 | 〃(동일 공격자 재침공) |
| cc-disruptor | subweaponHeavy | attackerSubCdPct | 공격자 보조무기 쿨↑ | 〃(공격자 보조무기 강함) |

- **조건 판정 입력**: 공격자 로드아웃 원소 어픽스 유무(fireDmg/coldSlow/lightning>0), 주무기 weaponType, 공격자/방어자 전투력점수, 복수전·재침공 플래그, 보조무기 스펙. 이 매치업 데이터가 begin_invasion 스냅샷에 실려야 함(Lane C 협의 필요).

### 접미(동적 트리거) — 런 중 이벤트 발동 시 value 적용
| id | 트리거(threshold) | stat | sim 반영(제안) |
|----|-------------------|------|----------------|
| ct-forcefield | coreProximity | coreShieldFlat | 공격자 코어 반경 진입 시 코어에 실드 v(절대) 부여 |
| ct-fury | turretsDestroyed(3) | turretFireRatePct | 포탑 3기 파괴 후 잔여 포탑 연사 ×(1+v/100) |
| ct-attrition | timeElapsed(90s) | attackerSlowPct | 90초(5400틱) 경과 후 공격자 이속 ×(1−v/100) |
| ct-retribution | guardianDowned | volleyDamage | 수호 격추 순간 공격자에 일제사격 v 피해 |
| ct-laststand | coreHpLow(30%) | turretDamagePct | 코어 HP ≤30% 시 포탑 화력 ×(1+v/100) |
| ct-vanguard | earlyPhase(20s) | turretFireRatePct | 시작~20초(1200틱) 포탑 연사 ×(1+v/100) |
| ct-reflection | coreHit | reflectDamagePct | 코어 피격 시 피해 v% 를 공격자에 반사 |
| ct-entrenchment | timeElapsed(120s) | incomingDmgReductionPct | 120초(7200틱) 경과 후 방어시설 피해 감소 |

- threshold 단위: turretsDestroyed=포탑 수, timeElapsed/earlyPhase=**초**(TICK_RATE=60 → ×60 틱), coreHpLow=코어 HP **%**.

### 유니크(룰 변경형) — `DEFENSE_CARD_UNIQUES[uniqueId].params`
| uniqueId | params | 효과 골자 |
|----------|--------|-----------|
| uq-mirage-core | decoyCount 1, decoyHpPct 50 | 가짜 코어 스폰(실효 HP 50%) |
| uq-blackout | radarDisableTicks 1800 | 첫 30초 공격자 레이더 무력화 |
| uq-last-reboot | reviveHpPct 20, reviveCount 1 | 코어 파괴 직전 1회 부활(최대 HP 20%) |
| uq-mirror-gate | reflectPct 25 | 코어 피해 25% 반사 |

- 유니크 카드도 접두/접미 4개(고정)를 함께 가지므로, 위 룰 변경 + 일반 어픽스 보정이 **동시** 적용.

## 해시 불변(팀 제약) 주의 — Lane B
- 카드 미장착 침공·PvE 리플레이는 **hashWorld 바이트 불변**이어야 함(fixtures diff 0). 카드 효과는 계보 마일스톤(PR#51)·수호(PR#35)처럼 **조건부 폴드**로만 접합: config 에 카드 필드가 없으면(=미장착) 기존 코드경로·해시 완전 동일. 신규 필드는 append-only, `undefined==미장착` 하위호환 테스트 필수.

## Remaining (Lane A 범위 밖 — 후속 lane)
- Lane B: `InvasionConfig`/DefensePlacement 에 카드 효력 필드 접합, 정적 카운터 스폰 보정·동적 트리거 스텝 판정, 결정론+하위호환 테스트.
- Lane C: 카드 소유/장착 테이블·가드 트리거(횟수 서버 전용), begin_invasion 스냅샷에 CardInstance + 매치업 데이터 주입, apply_invasion_result 차감(바닥 0).
- Lane D: 슬롯·보관함·상점·합성·분해 UI, 타겟 등급 배지, i18n(카드 어픽스 명·유니크 명은 카탈로그 name 필드 참조).
- 📝 모든 수치 튜닝 대상.
