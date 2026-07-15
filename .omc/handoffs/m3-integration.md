# M3 통합 핸드오프 — Lane 1 + Lane 2 병합

- 작성: 2026-07-16 (Executor, M3 통합)
- 워크트리: `D:\ClaudeCowork\shooting\.claude\worktrees\agent-a4dcb100a58f3410b`
- 브랜치: `worktree-agent-a4dcb100a58f3410b`
- 병합: `git merge feat/m3-progression-complete` (Lane 1 Phase A+C, 커밋 `2222440`)를 Lane 2 Phase B(175/175) 위에 머지.
- 검증: `npm test` 218/218 녹색(150 baseline + Lane2 25 + Lane1 33 + 통합 신규 10), `npx tsc --noEmit` 클린, `npm run lint` 0 경고.
- push/PR 없음(커밋만). 서브에이전트 없음.

## 충돌 해소 결정

### 1) `src/sim/replay.ts` hashWorld — 필드 순서 확정(이후 불변)
- 두 lane 모두 loot 블록 뒤에 append. 통합에서 **확정한 결정적 순서**:
  1. **(Lane2) `state.playerSlowTicks`** — 감속 지대 잔여 틱.
  2. **(Lane1) 스킬 투자 스냅샷** — 길이 프리픽스(`invest.length`) + 각 원소 `v`.
- 주석에 "이 순서는 이후 절대 변경 금지, 신규 M3 필드는 (2) 뒤에만 append" 명시.
- append-only 원칙: 순서만 하나로 고정하면 두 lane 모두 결정론 유지. loadout 블록 내부의 원소 3필드(`fireDmg/coldSlow/lightning`)는 Lane2가 이미 loadout 블록 말미에 넣어둔 위치 그대로 보존.

### 2) `src/sim/world.ts` import 블록
- Lane2는 `TWO_PI`(방사 스폰용), Lane1은 `wrapAngle`(미사일 유도/보스 polygonSpin용)을 각각 `./math.js`에서 import. **양쪽 모두 한 줄로 병합**: `import { cos, sin, atan2, length, TWO_PI, wrapAngle } from './math.js';`
- 나머지 world.ts 본문은 auto-merge 성공(Lane1 autoAttack 미사일/빔 + Lane2 상태이상·특이점 등 서로 다른 구역 편집).

### 3) `src/items/skills.ts` zeroStatSums — StatKey 확장 정합
- Lane2가 `StatKey`에 원소 3키(`fireDmg/coldSlow/lightning`) 추가 → Lane1의 `zeroStatSums()`가 `Record<StatKey, number>` 타입에서 누락(TS2739). 스킬 트리는 원소 스탯을 만들지 않으므로 **3키를 0으로 추가**. `computeLoadoutStats`의 원소 합산은 장비 어픽스(`sums`) 경로에서만 처리(loadout.ts 184~186), 스킬 경로와 무충돌.

### 4) `src/items/loadout.ts` (auto-merge 검수)
- Lane1의 스킬 합류(`computeLoadoutStats(equipped, invest)` + `applyStatSums(lo, computeSkillStats(invest))`)와 Lane2의 원소 필드(`neutralLoadout`/`zeroSums`의 fireDmg/coldSlow/lightning, 184~186 합산) 양쪽 보존 확인. 충돌 없음.

## 유니크 4점 시뮬 훅 완성(Lane2가 슬롯·비트만 확정해둔 무기타입/파워업 의존분)

Lane1의 무기 5타입(weaponType 3=미사일, 4=빔)·파워업 레이어가 실재하므로 실훅 연결. M2 관례대로 **기존 해시 필드/엔티티 재활용**, 신규 WorldState 필드 0, 신규 RNG 소비 0.

- **⑤ 군집 벌통(`UQ_HIVE_SWARM`, bit 5, 미사일)**: `resolveCollisions`에서 미사일 원본(`b.ownerId === MISSILE_MARK`)이 적/보스를 격추(`t.hp<=0`)하면 격추 위치를 `hiveSpawns`에 예약 → 루프 뒤 `HIVE_MICRO_COUNT`발을 `TWO_PI` 균등각으로 방사. 마이크로탄은 `HIVE_MICRO_MARK`(MISSILE_MARK와 다른 큰 상수)를 달아 **유도 제외 + 재분열 트리거 제외**(무한 연쇄 방지). 피해 = 주무기 × `HIVE_MICRO_DAMAGE_FRAC`.
- **⑥ 수렴 프리즘(`UQ_CONVERGE_PRISM`, bit 6, 빔)**: 관통 자이로(③)와 동일한 `bullet.phase`(관통 횟수) 재활용. 명중 시 `prismAmp = 1 + phase*PRISM_DAMAGE_AMP`로 피해 증폭, 관통마다 `b.phase++`. gyro/prism은 둘 다 주무기 슬롯이라 상호 배타(else-if로 우선순위 고정).
- **⑦ 쌍둥이 항성(`UQ_TWIN_STAR`, bit 7, 스프레드)**: `autoAttack` 부채꼴 분기에서 `bulletCount×2`, 발당 피해 `×TWIN_STAR_DAMAGE_MULT`. 미장착 시 n·dmg 불변.
- **⑬ 도박사의 칩(`UQ_GAMBLER_CHIP`, bit 13, 모듈)**: `checkLevelUp`에서 파워업 선택지 수를 `3 + GAMBLER_EXTRA_CHOICES`로. 선택 입력 프레임은 2비트(0~3)라 4번째 선택지까지 와이어 호환(stepWorld idxOffered `& 0x3`). 로드아웃 고정값이라 런 내내 결정론적.

튜닝 상수는 `src/sim/uniques.ts`에 섹션별 추가(HIVE_MICRO_*, PRISM_DAMAGE_AMP, TWIN_STAR_DAMAGE_MULT, GAMBLER_EXTRA_CHOICES).

## 정합 점검 결과
- 미사일/빔이 원소 상태이상 적용: resolveCollisions 아군탄-적 분기는 bullet.kind 무관(미사일·빔 세그먼트 모두 `kind==='bullet'`)이라 `elementalOn && t.kind==='enemy'`에서 화염/냉기/전격 정상 부여. 통합 결정론 테스트로 확인(빔+원소, 미사일+원소).
- 섬멸 티어 결정론: 파워업 가중(`drawPowerupChoices`)·엘리트 어픽스 2개는 seed·loadout·skillInvest 고정 → 2회 실행 해시 일치(신규 통합 테스트 2건).

## 결정론 테스트 확장(AC2) — `tests/m3Content.test.ts` (+10건, 총 32건 파일)
- 무기타입 의존 유니크 단위검증 4건(쌍둥이 발사체 2배·군집 마이크로탄 방사·프리즘 관통증폭·도박사 선택지 4개).
- `M3 Lane1+Lane2 통합 결정론` 3건: ①니플헤임 섬멸+빔+수렴 프리즘+원소+스킬투자 ②아르케 섬멸+미사일+군집 벌통+도박사의 칩+스킬투자 (각 2회 해시 일치) ③무기타입 유니크가 무-유니크 런과 해시 분기(훅 활성 증명).
- 방식: 하드코딩 해시 기대값 없이 **동일 config·seed·inputs 2회 실행 해시 배열 일치**(runReplay). 양쪽 lane의 기존 테스트 의미 전부 보존.

## 주의/후속
- `scripts/deno-verify/fixtures.json`은 denoFixture 테스트가 매 실행 재생성(자체 2회 bit-identical 검증). 머지로 hashWorld가 바뀌어 값이 갱신됨 — 커밋에 포함(하드코딩 기대값 아님).
- 밸런스(유니크 4점 수치·TIER_PARAMS·스킬 배율)는 §5 튜닝 루프 대상. 통합은 결정론·정합만 고정.
- weaponType 의존 유니크는 rollItem이 main 슬롯에 임의 weaponType(0~4)을 배정하므로, 예: 쌍둥이 항성이 빔 무기로 롤되면 부채꼴 효과 미발동(빔 분기). 의도상 "스프레드 발사" 유니크라 수용. 유니크별 weaponType 고정이 필요하면 별도 롤 규칙 추가 필요(범위 밖).
