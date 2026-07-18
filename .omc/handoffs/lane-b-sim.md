# Lane B 핸드오프 — sim 방어 카드 효력 통합

- **브랜치**: `feat/defense-card-system` (Lane A 커밋 `2539328` 위, push 안 함 — 리드가)
- **검증**: `npm test` 708 passed(62 files, Lane A 692 + 신규 16) · `npm run lint` green · `npx tsc --noEmit` green · `deno task verify`(Node↔Deno bit-identical) + `deno task verify-invasion` green · **PvE `fixtures.json` git diff 0(바이트 불변)**.

## Files
- `src/sim/cardEffects.ts` (신규) — 설정 계약(AttackerMatchup·DefenseCardConfig) + 런타임 해석(`initCardRuntime`) + 매 틱 갱신(`stepCardRuntime`). WorldState **type-only** import(defense.ts 규율) — world↔cardEffects 런타임 사이클 없음. Deno 무참조(entities·constants·data/defenseCards 만 의존, 전부 순수).
- `src/sim/defense.ts` (수정) — `InvasionConfig.card?: DefenseCardConfig`(append-only). `stepDefenseTurrets`/`fireTurret` 에 카드 화력·연사 배율 적용(미장착=배율 1=비트 동일).
- `src/sim/entities.ts` (수정) — `EntityKind` 에 `decoyCore` 추가, `KIND_CODE.decoyCore=18`(append-only, 재번호 없음). 신기루 코어 유니크에만 등장.
- `src/sim/world.ts` (수정) — `WorldState.cardRuntime?`, createWorld 카드 초기화, stepWorld 카드 스텝(stepPlayer 이전, 게이트), stepPlayer 공격자 감속·subCooldown 보조무기 쿨↑, isPlayerTargetable/resolveCollisions grid·타겟에 decoyCore, resolveCollisions 피해 감소·반사·코어 부활·수호 격추 일제사격.
- `src/sim/replay.ts` (수정) — hashWorld 침공 블록 최후미에 **조건부** 카드 폴드(카드 미장착이면 폴드 없음 → 바이트 불변).
- `tests/defenseCardSim.test.ts` (신규) — 16 케이스(하위호환 baseline·정적·동적·유니크 4종·결정론).

## Decided
- **접합 지점 = `InvasionConfig.card`**(DefenseLayout 아님). 카드+매치업을 한 묶음으로. `undefined` = 미장착 = 기존 침공/PvE 경로 완전 동일(조건부 접기, 계보 마일스톤 PR#51·수호 실드공유 PR#35 선례).
- **런타임 상태 = `WorldState.cardRuntime`**(장착 침공만 생성). 정적 해석 상수 + 유니크 파라미터 + 런 중 래치(reviveCount·blackoutTicksLeft·coreProximityFired) + 매 틱 재계산 배율(스크래치, 미접힘). 신규 **Entity 필드 없음**(hashEntity 레이아웃 불변) — decoyCore 만 신규 KIND.
- **정적 카운터(접두)**: `initCardRuntime` 가 스폰 시점 1회 매치업 조건 판정 → 일치 롤만 stat 누적. `powerSuperiority` = `attackerCp − defenderCp >= CARD_POWER_SUPERIORITY_MARGIN(500 📝)`. incomingDmgReductionPct=코어·포탑 피해 배율(실드 흡수 前, 상한 90%), turretDamagePct=포탑 발당 피해 배율, attackerSubCdPct=`subCooldown` 배율(공격자 보조무기 간격↑).
- **기저 효과(무조건)**: `CARD_BASE_EFFECT[rarity]` — turretDamagePct 는 staticTurretDamagePct 초기값에 가산, coreHpPct 는 스폰 시 실제 코어 hp/maxHp 스케일(Math.round). 미장착 대비 기저만으로도 해시가 갈린다(의도 — 카드 장착 자체가 효력).
- **동적 트리거(접미)**: `stepCardRuntime`(stepPlayer 이전, 같은 틱 일관) 이 틱·시작시점 코어 HP·현재 포탑 수로 판정. coreProximity=코어 반경+`CARD_CORE_PROXIMITY_MARGIN(260 📝)` 진입 시 코어 `targetY` 실드 1회(실드공유와 동일 흡수 경로), fury=포탑 N기 파괴 후 연사 배율, vanguard=초반 `threshold×60`틱 연사 배율, laststand=코어 HP≤threshold% 화력 배율, attrition=`threshold×60`틱 후 공격자 감속, entrench=`threshold×60`틱 후 피해 감소, retribution=수호 실제 격추 시 공격자 일제사격(player.hp 직접), reflection=코어 피격 시 입사 피해 v% 반사.
- **유니크 4종**: mirage=decoyCore(신규 KIND 18) 스폰(실코어 maxHp×decoyHpPct/100, 파괴돼도 compact victory 미판정), blackout=`cardRuntime.blackoutTicksLeft` 카운트다운(렌더 전용 sim 필드 — 거동 무영향, 조건부 폴드), last-reboot=코어 hp≤0 시 reviveCount>0 이면 1회 부활(수호 재기동과 동형), mirror-gate=reflectPct 에 가산(코어 피격 반사).
- **해시 폴드**: 침공 블록 최후미에 카드 정체성(seed·chargesLeft) + 해석 효력 파라미터(정적·트리거 임계·유니크·런 중 래치) append. 매 틱 배율은 파생 스크래치라 미접힘(엔티티 상태로 이미 반영). 카드 미장착이면 폴드 자체가 없음.

## Rejected
- **DefenseLayout 에 카드 필드**: 카드는 배치가 아니라 침공 컨텍스트(공격자 매치업 포함)라 `InvasionConfig` 가 정합. layoutEquals/normalizeServerLayout(EF) 대칭도 배치만 다루게 유지.
- **decoyCore 를 'core' KIND 재사용**: 파괴 시 compact 가 victory 를 세워 오승리. 신규 KIND(18) append 로 분리.
- **매치업 raw 불리언 해시 폴드**: 활성 조건에 영향 없는 매치업 토글이 무의미하게 해시를 가르면 정직 런 오거부 위험. 대신 **해석된 런타임 효력**만 폴드(서버가 권위 매치업으로 재해석하므로 위조는 재실행 발산으로 잡힘).
- **반사/일제사격에 player iframes 존중**: 방어 시스템 카운터(탄이 아님)라 iframes 무관하게 즉시 적용(결정론·의미 명확). player.hp 는 0 하한 클램프.

## Risks
- **밸런스 미조정(📝)**: 모든 계수(MARGIN 500·PROXIMITY 260·감소 상한 90·decoy 오프셋 240)는 시작값. 튜닝은 후속.
- **매치업 데이터 미배선**: Lane C 가 begin_invasion 스냅샷에 매치업을 채워야 정적 카운터가 실동작. 미배선(card 필드 자체 부재)이면 안전하게 미장착 취급.
- **Lane A 계약 버그 없음** — data/defenseCards.ts·rollCard.ts 무수정.

## Lane C 계약 (서버가 스냅샷에 채울 형태)
`config.invasion.card`(존재 시) 형태:
```ts
card: {
  card: CardInstance,        // 방어자 장착 카드(서버 권위, DB jsonb 그대로 — Lane A CardInstance 계약)
  matchup: {                 // 공격자 스냅샷 파생(정적 카운터 조건 판정 입력)
    fire: boolean,           // 공격자 loadout.fireDmg > 0
    cold: boolean,           // loadout.coldSlow > 0
    lightning: boolean,      // loadout.lightning > 0
    beam: boolean,           // 주무기 weaponType ∈ {2 레일건, 4 빔}
    attackerCp: number,      // 공격자 전투력 점수(combatPower)
    defenderCp: number,      // 방어자 전투력 점수
    revenge: boolean,        // 복수전 대상 공격자
    reinvasion: boolean,     // 동일 공격자 재침공
    subweaponHeavy: boolean, // 공격자 강한 보조무기(서버 임계 판정)
  }
}
```
- **서버 권위 주입**: 정비도·수호와 동형. 공격자 제출 card·matchup 을 신뢰하지 않고, 방어자 장착 카드(defenses 슬롯)와 공격자 라이브 로드아웃/CP 로 **서버가 재구성**해 재실행. EF `verifyInvasion` 의 `authoritativeInvasion` 조립부에 `card` 를 서버 값으로 오버라이드(정비도 override 패턴 그대로). `undefined` 면 필드 미포함(하위호환).
- **layoutEquals/normalizeServerLayout 확장 불필요**: card 는 layout(배치)이 아니라 InvasionConfig 필드. EF 는 layout 대조는 그대로 두고, card 를 서버 권위로 **오버라이드**(제출값 대조 대신 재구성)하면 됨 — hashStream 재실행이 위조를 발산으로 잡는다(정비도와 동일 철학, layoutEquals 에 정비도 대조가 불필요한 것과 동형).
- **차감**: `apply_invasion_result` 확정 시 `chargesLeft` 1 차감(바닥 0, ADR-0012). 스냅샷 고정 효력은 유지.
- **decoyCore/유니크**: 서버는 CardInstance.uniqueId·params 를 그대로 실으면 sim 이 재현(EF 재실행이 클라 hashStream 과 대조).
- **EF 재사용 함수(Lane B 신규, verifyInvasionCore 가 import 가능)**: `initCardRuntime`·`stepCardRuntime`(sim 내부, EF 는 직접 호출 안 하고 재실행 경로로 소비). 타입 `DefenseCardConfig`·`AttackerMatchup` 은 `src/sim/cardEffects.ts` 에서 export.

## Remaining (Lane B 범위 밖)
- Lane C: 스키마(카드 소유/장착 테이블·가드 트리거)·begin_invasion 스냅샷에 card+matchup 주입·EF authoritativeInvasion 에 card 오버라이드·apply_invasion_result 차감.
- Lane D: 슬롯/보관함/상점/합성/분해 UI·타겟 등급 배지·i18n·블랙아웃/트리거 배너 렌더(`cardRuntime.blackoutTicksLeft` 등 sim 필드 읽기). decoyCore 렌더는 실제 코어와 동일 스프라이트(오인 유도).
- 📝 전 계수 밸런스 튜닝.
