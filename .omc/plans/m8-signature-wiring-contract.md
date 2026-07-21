# M8 시그니처 4종 world.ts 배선 계약 (실측 정찰 결과)

- 작성: 2026-07-21 · 읽기 전용 정찰. **프로덕션 코드 수정 0줄.**
- 대상: 팬텀(typeId 3 / 비트 20) · 해츨링(4 / 21) · 말로우(5 / 22) · 버블(6 / 23)
- 선행 정본: `.omc/plans/m8-champion-design.md` §3·§4·§5·§10 · `src/sim/shipSignature.ts`
- 이 문서의 모든 주장에 `파일:줄` 근거가 붙는다. 근거 없는 문장은 "미확정"으로 명시했다.

---

## 0. 정찰 요약 — 구현 전에 반드시 알아야 할 5가지

1. **적 처치 집계는 단일 지점이다.** `state.kills++` 는 저장소 전체에서 `src/sim/world.ts:2378` **한 곳뿐**이다(`grep kills\+\+` 전수). 모든 사망 경로(총알·화염 DoT·연쇄·폭탄)가 `e.dead = true` 로만 수렴하고 `compact()` 가 집계하므로, 해츨링은 **`state.kills` 만 읽으면 전 경로를 자동으로 덮는다.** 처치 지점에 훅을 심을 필요 자체가 없다.
2. **해츨링은 신규 EntityKind 가 필요 없다.** 플레이어를 돕는 유닛 메커니즘이 이미 있다 — `turretPickup` + `ownerId = DRONE_MARK`(`world.ts:1600-1603` 드론 베이 · `world.ts:1502-1510` 센트리 보조무기). `summonEnemy` 는 **적을 만드는 함수**라 애초에 대상이 아니다.
3. **`aux0`/`aux1` 2슬롯으로 4종 전부 들어간다.** 단 해츨링은 `state.kills` 를 재활용해 aux1 이 남고, 팬텀은 aux1 을 1비트 플래그로만 쓴다.
4. **팬텀 은신을 각 조준 지점에 개별 배선하면 안 된다.** 조준 지점은 PvE 5곳 + 침공 7곳이고, 침공 쪽 일부는 좌표가 **어픽스 트리거 입력**(`facility.ts:361-362`·`coreRoom.ts:371-372`)이라 손대면 방어체 어픽스 의미가 조용히 바뀐다. **PvE 적 AI 의 공격 방출 단계 1곳 + 보스 1곳** 으로 범위를 좁히는 것이 유일하게 안전한 형태다.
5. **피격 파이프라인을 우회하는 직접 피해가 3곳 있다** — `world.ts:2060`(모듈 반사) · `world.ts:2094`(응징 일제사격) · `src/sim/invasion/movingWall.ts:474`(압축 프레스 끼임). 말로우·버블은 여기까지 덮지 않는다(근거 §2.4).

---

## 1. aux 슬롯 배정

### 1.1 플레이어 엔티티 필드 전수 조사

`Entity` 는 kind 무관 단일 struct 다(`src/sim/entities.ts:100-149`). 플레이어(항상 `entities[0]`, `world.ts:715-721`)가 **이미 쓰고 있는** 필드와 그 용도:

| 필드 | 해시 모드 | 플레이어 용도 | 근거 |
|---|---|---|---|
| `x` `y` `vx` `vy` `angle` | f64 | 이동·조준 | `world.ts:992-994`, `1037-1038` |
| `radius` | f64 | 32 고정(픽업 반경) | `world.ts:631`, `2189` |
| `hp` `maxHp` | f64 | 체력 | `world.ts:632-633` |
| `timer` | u32 | **보조무기 사이클 카운트다운** | `world.ts:1476-1477`, `1498`, `1508`, `1544`, `1564`, `1583` |
| `dashCooldown` | u32 | 대시 쿨다운 | `world.ts:996`, `1014`, `1017` |
| `iframes` | u32 | 무적 프레임 | `world.ts:997`, `1015`, `1018`, `2271`, `2275` |
| `cooldown` | u32 | **주무기 발사 쿨다운** | `world.ts:1210-1211`, `1253`, `1278`, `1308`, `1337` |
| `phase` | u32 | **유니크 ① 과열 드럼 연속 명중 스택** | `world.ts:1220`, `2111`, `2283` |
| `ownerId` | u32 | **유니크 ④ 드론 베이 소환 주기 카운트다운** | `world.ts:1596-1603` |
| `targetX` | f64 | **생존 캡스톤 "치명타 1회 무효" 소진 표식(0/1)** | `world.ts:2266-2270` |
| `targetY` | f64 | **유니크 ⑩ 위상 전환막 내부 쿨다운** | `world.ts:998-1000`, `2305-2313` |
| `aux0` `aux1` | u32(조건부) | **시그니처 런타임 상태** | `world.ts:1067-1069`, `1095-1107`, `2261`, `2279-2280` |

**플레이어가 쓰지 않는 잔여 필드(= 대안 슬롯 후보):**

| 필드 | 해시 모드 | 기본값 | 대안 슬롯 적합성 |
|---|---|---|---|
| `pierce` | u32 | 0 | **가장 적합.** 플레이어 경로에서 읽지도 쓰지도 않는다(`grep player\.pierce` 0건). 다른 kind 에서는 배치 슬롯 인덱스로 쓰이지만(`coreRoom.ts:412` `p.pierce` · `guardianBridge.ts:133` `g.pierce` · `boss.ts:96` `boss.pierce`) 플레이어와 무관 |
| `damage` | f64 | 0 | 적합하나 **f64** 라 정수 규율이 강제되지 않는다. 정수 상태에는 `pierce` 를 먼저 쓴다 |
| `life` | u32 | **-1** | 비권장. `blankEntity` 기본이 `-1`(`entities.ts:176`)이라 이미 `0xFFFFFFFF` 로 접히고 있고, "영구" 를 뜻하는 관용이 다른 kind 와 충돌한다 |
| `enemyType` | u32 | **-1** | **사용 금지.** `snapshot.ts:96` 이 렌더로 그대로 내보내고 `entityRenderer` 가 색 분화에 쓴다 — sim 상태를 실으면 렌더가 조용히 오작동한다 |

> 선례: 이 저장소는 "신규 필드 대신 미사용 필드 재활용" 을 이미 4회 했다(`src/sim/uniques.ts:15` 주석이 `player.phase`·`player.ownerId`·`bullet.phase`·`bullet.ownerId` 를 명시). `player.targetX` 를 캡스톤 소진 표식으로 쓴 것도 같은 계열(`world.ts:2266`).

### 1.2 타입별 배정 — 4종 전부 2슬롯 이내에 들어간다

| 타입(비트) | `aux0` | `aux1` | 여분 필요 |
|---|---|---|---|
| 팬텀(20) | 연속 무피격 틱(0..`CLOAK_TICK_CAP`) | 은신 해제 첫 타 대기 플래그(0/1) | **없음** |
| 해츨링(21) | **마지막 출격 시점의 `state.kills` 스냅샷** | 미사용(0) | **없음** |
| 말로우(22) | 적립된 지연 피해(정수) | 연속 무피격 틱 | **없음** |
| 버블(23) | 남은 막 내구(0..`FILM_ABSORB_FLAT`) | 마지막 파열 이후 경과 틱(0..`FILM_PERIOD_TICKS`) | **없음** |

**해츨링이 aux1 을 안 쓰는 이유(설계 원문 대비 변경 제안):** 임무 브리프는 "마지막 출격 이후 처치 수 · 런 누적 처치 수" 2개를 요구했으나, **런 누적 처치는 이미 `state.kills` 로 존재하고 해시에도 접힌다**(`replay.ts:303`). aux 에 사본을 두면 두 값이 갈릴 여지가 생기고, `hatchThreshold(kills)`(`shipSignature.ts:164-170`)의 입력이 "런 누적" 이므로 **정본을 하나로 두는 편이 안전**하다. 따라서:

```
aux0 = 마지막 출격 시점의 state.kills (초기 0)
출격 조건: state.kills - aux0 >= hatchThreshold(state.kills)
출격 시:   aux0 = state.kills
```

- `state.kills` 는 단조 증가 정수(`world.ts:2378`)이므로 `aux0` 도 정수·단조·유계다 → u32 규율(`entities.ts:141-143`) 안전.
- **부수 효과 주의:** `aux0` 은 첫 출격 전까지 0 이다. `aux1` 도 0 이므로 **첫 출격 전에는 조건부 꼬리가 접히지 않는다**(`replay.ts:161-164`). 이것은 해시 불변 규약(§4)과 정합하되, "시그니처 활성인데 aux 가 계속 0" 인 구간이 생긴다는 뜻이다 — 규약 5("시그니처 비활성 런에서 aux 가 0 이 아니게 되면 안 된다")의 **역방향은 요구되지 않으므로 문제 없다.**

### 1.3 충돌하는 필드 — 명시 목록

신규 배선이 **절대 건드리면 안 되는** 플레이어 필드와 그 소유자:

- `phase` → 과열 드럼 스택. 4종 중 어느 것도 쓰지 마라(`world.ts:2111`, `2283`).
- `targetX` → 생존 캡스톤 소진 표식. 말로우·버블이 "1회성 소모" 상태를 원해도 여기 싣지 마라(`world.ts:2269-2270`).
- `targetY` → 위상 전환막 쿨다운. **매 틱 자동 감소한다**(`world.ts:1000`) — 카운트다운이 필요해도 여기 싣지 마라.
- `ownerId` → 드론 베이 주기. **해츨링이 가장 실수하기 쉬운 지점** — 소환 주기 카운터라 의미가 딱 맞아 보이지만, 드론 베이 유니크와 동시 보유가 가능하므로 겹치면 둘 다 망가진다.
- `timer` → 보조무기 사이클. `cooldown` → 주무기.

---

## 2. world.ts 삽입 지점

### 2.1 `stepShipSignature` — 4개 분기 추가

**현재 구조**(`src/sim/world.ts:1092-1109`, 앞뒤 인용):

```ts
1088  /**
1089   * 시그니처 런타임 카운터를 1틱 진행한다(피해·발사 경로의 게이트가 읽는 값). 스트라이커는
1090   * 두 분기 모두 false 라 본문이 한 줄도 실행되지 않는다.
1091   */
1092  function stepShipSignature(state: WorldState, player: Entity, input: InputFrame): void {
1093    if (signatureOn(state, SIG_BRUISER_ARMOR)) {
...
1100      return;
1101    }
1102    if (signatureOn(state, SIG_ARC_OVERCHARGE)) {
...
1107      else if (player.aux0 < OVERCHARGE_TICK_CAP) player.aux0++;
1108    }
1109  }
```

호출 지점(`world.ts:783-787`):

```ts
783    stepPlayer(state, player, input);
784    // 기체 시그니처 카운터는 이동 직후·발사 이전에 갱신한다 — autoAttack 이 이번 틱의 과충전
785    // 값을 읽고, 피격 판정(resolveCollisions)이 이번 틱의 장갑 스택을 읽는다.
786    stepShipSignature(state, player, input);
787    if (!designedRun) updateWaves(state, player);
```

**조기 반환 패턴 유지 방침 — 채택안: 분기마다 `return`, 아크캐스터에도 `return` 을 명시적으로 붙인다.**

이유: ①브루저 분기(`:1100`)가 이미 `return` 이고, 아크캐스터 분기(`:1102-1108`)는 함수 끝이라 `return` 이 생략돼 있을 뿐 의미는 같다 — 뒤에 분기를 append 하는 순간 **아크캐스터 런이 팬텀 분기까지 흘러들어간다.** 이것이 이 함수에서 가장 조용히 깨지는 지점이다. ②한 런에 시그니처는 최대 하나라는 §1.2 전제와 `return` 이 정합한다.

**성능 주의(거동 영향 없음):** `signatureOn`(`world.ts:1083-1086`)은 호출마다 `shipTypeDef(...)`(`data/ships/index.ts:83-89`)를 부른다. 분기가 6개가 되면 스트라이커 런이 매 틱 6회 호출한다. 선택지:

- (a) 현행 유지 — `shipTypeDef` 는 배열 인덱싱 + 정규화라 저렴하다. 거동·해시 완전 불변. **권장.**
- (b) 함수 진입부에 `const bit = activeSignatureBit(state); if (bit < 0) return;` 단일 조회. 단 `activeSignatureBit` 은 `signatureOn` 의 **2축 OR**(`world.ts:1071-1076` 주석이 명시한 마스크 축 + `config.shipType` 축)를 정확히 재현해야 한다 — 마스크에만 비트가 있고 `shipType` 이 0 인 하네스 조합에서 갈릴 수 있다. 재현이 틀리면 §10-1 결함이 되살아난다.

권장 골격:

```ts
function stepShipSignature(state, player, input): void {
  if (signatureOn(state, SIG_BRUISER_ARMOR))  { /* 기존 */ return; }
  if (signatureOn(state, SIG_ARC_OVERCHARGE)) { /* 기존 */ return; }   // ← return 추가
  if (signatureOn(state, SIG_PHANTOM_CLOAK))  { /* 무피격 틱 ++, 은신 arming */ return; }
  if (signatureOn(state, SIG_HATCHLING_BROOD)){ /* 출격 판정 */ return; }
  if (signatureOn(state, SIG_MALLOW_CUSHION)) { /* 무피격 틱 ++, 지연분 회복 */ return; }
  if (signatureOn(state, SIG_BUBBLE_FILM))    { /* 막 재생성 타이머 */ }
}
```

각 분기가 해야 할 일:

- **팬텀:** `aux0++`(상한 클램프 필수 — 무한 증가는 u32 오버플로 위험). `cloakActive(aux0)`(`shipSignature.ts:136-138`) 가 참이 되는 틱에 `aux1 = 1`(첫 타 대기 arming).
- **해츨링:** `if (state.kills - player.aux0 >= hatchThreshold(state.kills))` → 출격(§3) + `player.aux0 = state.kills`.
- **말로우:** `aux1++`(상한 클램프). `cushionRecovered(aux0, aux1)`(`shipSignature.ts:204-209`)가 0 보다 크면 `player.hp` 회복 + `aux0` 에서 차감. **회복은 `player.maxHp` 상한으로 클램프** — 선례 `world.ts:2312` 의 `Math.min(player.maxHp, ...)`.
- **버블:** `aux0 === 0` 일 때만 `aux1++`(상한 = `FILM_PERIOD_TICKS`). `filmReady(aux1)`(`shipSignature.ts:222-224`)이면 `aux0 = FILM_ABSORB_FLAT; aux1 = 0`.

### 2.2 플레이어 피격 피해 경로 — 삽입 순서 확정

**현재 파이프라인 전문**(`world.ts:2185-2316`) 요약:

| 단계 | 줄 | 내용 |
|---|---|---|
| A | `2185-2186` | `dmg = 0`, `invulnerable = player.iframes > 0` |
| B | `2191-2250` | 그리드 질의로 접촉·피탄·해저드 피해를 **최댓값**으로 수집. `2230` 에서 `if (invulnerable) return;` 로 무적 중에는 아예 누적하지 않는다 |
| C | `2251` | `if (dmg > 0 && !invulnerable) {` |
| D | `2259-2263` | **브루저 장갑 감소** (`bp > 0` 일 때만 `dmg -= Math.round((dmg*bp)/10000)`) |
| E | `2269-2271` | **생존 캡스톤 치명타 1회 무효** (`player.hp - dmg <= 0` 이면 피해 전량 무효 + `iframes = CRIT_NEGATE_IFRAMES`) |
| F | `2273-2275` | `player.hp -= dmg` · `iframes = hitIframes` |
| G | `2278-2281` | 브루저 스택 적립 + 소멸 타이머 리셋 |
| H | `2283` | 과열 드럼 스택 리셋 |
| I | `2285-2302` | 유니크 ⑨ 반응 장갑 반격 펄스 |
| J | `2305-2314` | 유니크 ⑩ 위상 전환막 |

D 앞뒤 3줄 인용:

```ts
2256    // 그 함수의 `Math.trunc` 만 뺐다 — 접촉 피해에는 엘리트 배율이 섞여 소수가 될 수 있고,
2257    // trunc 는 스택 0(bp=0)일 때조차 소수부를 지워 **무스택 피해까지 바꾼다.** 정수 피해에
2258    // 대해 두 경로가 같은 값임은 tests/weapons.test.ts 가 못 박는다.
2259    const armorOn = signatureOn(state, SIG_BRUISER_ARMOR);
2260    if (armorOn) {
2261      const bp = clampArmorStacks(player.aux0) * ARMOR_PER_STACK_BP;
2262      if (bp > 0) dmg -= Math.round((dmg * bp) / 10000);
2263    }
2264    // 생존 캡스톤 — 치명타 1회 무효(GDD §4): 이 피격이 치명적(hp가 0 이하로 떨어짐)이고 아직
2265    // 미소진(player.targetX===0)이면 피해를 전부 무효화하고 짧은 무적(CRIT_NEGATE_IFRAMES)을
```

**확정 순서 — `D(브루저) → D1(버블 흡수) → D2(말로우 지연 전환) → E(캡스톤) → F(hp 차감) → F1(팬텀 무피격 리셋) → G…J`**

| 삽입 | 위치 | 내용 |
|---|---|---|
| **D1 버블 흡수** | `2263` 바로 뒤 | `const abs = filmAbsorbed(dmg, player.aux0); if (abs > 0) { player.aux0 -= abs; dmg -= abs; }` |
| **D2 말로우 지연 전환** | D1 뒤 | `const deferred = cushionDeferredDamage(dmg); dmg -= deferred;` (적립은 **F 쪽에서만**, 아래 참조) |
| **F1 팬텀 리셋** | `2280`(브루저 `aux1 = 0`) 옆 | `if (cloakOn) { player.aux0 = 0; player.aux1 = 0; }` |

**순서를 이렇게 고른 이유:**

1. **브루저 감소가 항상 먼저인 것은 기존 코드의 확정 사항**(`world.ts:2252-2254` 주석: "생존 캡스톤 판정보다 먼저 적용해 … 장갑이 살려낸 피격까지 캡스톤을 소진시키지 않는다"). 신규 3종도 같은 논리의 연장선에 둔다.
2. **버블 막이 말로우보다 먼저인 이유:** 막은 선체 **바깥** 층이다. 지연 전환을 먼저 하면, 애초에 막이 다 막아 낼 피해가 지연분으로 적립돼 **막을 통과하지 않은 피해가 나중에 들어온다.** 두 시그니처는 동시 보유가 불가능하므로(§1.2 한 런에 하나) 실제로는 상호배타지만, 순서를 명문화해 두면 훗날 캡스톤·유니크로 합성될 때 논쟁이 없다.
3. **말로우 지연 전환이 캡스톤보다 먼저인 이유:** 캡스톤은 `player.hp - dmg <= 0` 로 **치사 여부**를 판정한다(`2269`). 지연분을 뺀 뒤 판정해야 "완충이 살려 낸 피격까지 캡스톤을 소진" 하지 않는다 — 브루저 주석(`2252-2254`)과 문자 그대로 같은 논증이다.
4. **지연분 적립을 F 쪽(else 분기 안)에서만 하는 이유:** 캡스톤이 무효화한 피격은 `2268` 주석이 "없던 피격처럼 취급" 이라고 못 박는다. 지연분을 D2 에서 즉시 `aux0` 에 적립하면 **없던 피격에서 지연 피해가 생겨** 나중에 플레이어를 죽인다. 따라서 D2 는 `dmg` 에서 빼기만 하고, `player.aux0 += deferred` 는 `2273` 이후(else 분기 내부)에서 실행한다.
5. **무적(iframes) 과의 관계는 배선할 것이 없다.** B 단계 `2230` 의 `if (invulnerable) return;` 이 무적 중 피해 누적 자체를 막으므로 D1·D2·F1 은 자동으로 무적 뒤에 온다. **막 내구가 무적 중에 소모되지 않는다**는 뜻이기도 하다 — 의도된 결과로 본다(무적은 이미 완전 방어이므로 막을 함께 태우면 이중 손실).

**⚠️ D1 이 만드는 신규 상태: `dmg` 가 0 이 될 수 있다.** `2251` 의 `if (dmg > 0 …)` 는 이미 진입한 뒤이므로, 막이 전량 흡수하면 `dmg === 0` 인 채로 F 로 흘러 `player.hp -= 0`(무해) + **`player.iframes = state.config.hitIframes`(유해 — 공짜 무적 40틱)** + G/H/I/J 훅 발동(유해 — 반응 장갑 펄스가 공짜로 나간다)이 된다. 구현은 D1 직후 `if (dmg <= 0) return;` 로 **함수를 빠져나가야 한다**(`resolveCollisions` 는 이 시점 이후 아무것도 하지 않으므로 `return` 이 안전하다 — `2316-2317` 이 함수 끝). 팬텀 카운터 리셋도 이때는 하지 않는다(막이 막았으면 "맞지 않았다").

**⚠️ 지연분은 반드시 정수화하라.** `cushionDeferredDamage`(`shipSignature.ts:184-188`)는 입력을 `Math.trunc` 한다. 그런데 이 경로의 `dmg` 는 **소수일 수 있다** — 엘리트 접촉 피해가 배율을 타기 때문이다(`world.ts:2255-2258` 주석이 브루저에 대해 이미 이 함정을 지적). 두 갈래 중 하나를 택하고 명시하라:

- (a) `player.aux0 += Math.round(deferred)` — aux 는 정수 유지, `dmg` 에서 빼는 값과 적립하는 값이 1 어긋날 수 있다(반올림 손실).
- (b) `const d = Math.round(dmg); const deferred = cushionDeferredDamage(d); dmg -= deferred;` — **합이 정확히 보존**된다(`cushionImmediateDamage` 의 설계 의도, `shipSignature.ts:190-198`). 단 `dmg` 가 반올림되어 **무보유 대비 피해가 바뀐다** — 말로우 런에서만 일어나므로 스트라이커 해시에는 무관. **(b) 권장**, 이유는 "적립분 + 즉시분 = 원래 피해" 라는 순수 함수의 계약을 world 배선이 깨지 않는 것이 회귀 추적에 유리하기 때문.

**버블 흡수도 같다.** `filmAbsorbed`(`shipSignature.ts:227-232`)가 양쪽을 `Math.trunc` 한다. `dmg` 를 먼저 `Math.round` 한 뒤 흡수를 계산하면 `aux0` 이 정수로 유지된다.

### 2.3 팬텀 "해제 첫 타 배율" 의 적용 지점

이것은 **피격 경로가 아니라 발사 경로**다. 아크캐스터 과충전과 정확히 같은 자리(`world.ts:1223-1231`):

```ts
1230    const ocBp = signatureOn(state, SIG_ARC_OVERCHARGE) ? overchargeBp(player.aux0) : 0;
1231    const wDamage = ocBp === 0 ? w.damage : w.damage + Math.round((w.damage * ocBp) / 10000);
```

`wDamage` 계산 뒤에 팬텀 분기를 얹는다. **아크캐스터 주석 `1225-1229` 의 경고를 그대로 상속하라** — `cloakBreakDamage`(`shipSignature.ts:141-145`)도 `Math.trunc` 를 하므로 **직접 부르면 안 된다.** `w.damage` 는 `Math.round(x*100)/100` 로 만들어진 소수 2자리 실수다(`world.ts:611`). 동형 산술(`w.damage + Math.round((w.damage * (CLOAK_BREAK_BP - 10000)) / 10000)` 또는 `Math.round((w.damage * CLOAK_BREAK_BP) / 10000)` 중 택일)을 인라인하고, 정수 피해에 대해 순수 함수와 같은 값임을 `tests/weapons.test.ts` 에 못 박는다(아크캐스터 선례가 이미 그 파일에 있다).

발동 후 `player.aux1 = 0; player.aux0 = 0;`(은신 해제).

> **미확정 — 구현 레인이 확정해야 할 규칙 1건.** 설계서 `:78` 은 "무피격 지속 시 은신(적 조준 제외) + 해제 첫 타 배율" 이라고만 쓴다. **은신이 무엇으로 풀리는가**가 정의돼 있지 않다:
> - (가) **발사로 풀린다** — 은신 중 첫 발이 ×2.5 이고 그 즉시 은신 해제. 자동 조준 특성상 사거리에 적이 있으면 즉시 발사되므로(`world.ts:1213-1214`) 은신은 "적이 없는 동안" 만 유지된다. 히트앤런 루프가 되어 "은신 암살" 컨셉과 맞는다.
> - (나) **피격으로만 풀린다** — 은신 중 계속 쏠 수 있고 첫 발만 ×2.5. 적이 조준하지 못하는 동안 일방적으로 딜을 넣게 되어 밸런스가 위험하다.
>
> **(가) 권장.** 근거는 컨셉 정합과 밸런스뿐이고 코드 근거는 없다 — 사용자/설계 승인 대상.

### 2.4 피격 파이프라인을 우회하는 직접 피해 3곳 — 덮지 않는다

| 지점 | 근거 | 성질 | 판단 |
|---|---|---|---|
| 모듈 반사 | `world.ts:2059-2062` | 플레이어가 코어를 때린 피해의 일부가 되돌아옴. **무적 무시** | 덮지 않음. 침공 전용(`cr !== undefined`)이고 "피격" 이 아니라 자기 행위의 대가 |
| 응징 일제사격 | `world.ts:2093-2096` | 수호 격추 시 반격. **무적 무시** | 덮지 않음. 위와 동일 |
| 압축 프레스 끼임 | `invasion/movingWall.ts:470-476` | 벽에 끼임. **무적은 존중**(`:471`) | 덮지 않음. 물리적 압사는 막·완충 대상이 아니라는 것이 자연스럽다 |

**이 결정을 문서화하지 않으면 반드시 결함 신고로 돌아온다** — "침공에서 버블 막이 안 깎이는데 체력이 준다". 구현 시 해당 3곳에 한 줄 주석으로 "시그니처 완충·흡수 비대상(계약: m8-signature-wiring-contract §2.4)" 을 남길 것을 권장한다.

### 2.5 적 처치 판정 지점 — 전수 조사

**사망을 만드는 경로(모두 `e.dead = true` 로만 수렴):**

| 경로 | 근거 | 대상 kind |
|---|---|---|
| 아군탄 명중 피해 | `world.ts:2075-2090` | enemy·boss·supply·destructible·core·decoyCore·guardian·facility*·defenseBoss·prop |
| 화염 지속피해(DoT) | `status.ts:80-88` (`tickEnemyStatus`, 호출 `world.ts:1127`) | enemy |
| 전격 연쇄 | `status.ts:101-115` | enemy |
| 폭탄 기물 | `events.ts:58-72` | enemy·boss |
| 레이저 캡스톤 / 대시 소거 | `world.ts:1355`, `world.ts:1032` | **enemyBullet 만** — 적을 죽이지 않는다 |
| 수명·컬링 | `world.ts:900`, `1717`, `1822`, `1908`, `1932` | 기믹·투사체·보급 |

**집계 지점은 단 하나:**

```ts
2372    for (const e of state.entities) {
2373      if (!e.dead) {
2374        survivors.push(e);
2375        continue;
2376      }
2377      if (e.kind === 'enemy') {
2378        state.kills++;
```

즉 **`state.kills` 는 kind `enemy` 의 사망만 센다.** 세지 않는 것: `boss`(`2407`) · `supply`(`2390`) · `destructible`(`2394`) · `core`(`2397`) · `guardian`/`facilityGun`/`facilityHazard`/`facilitySpawner`/`prop`/`defenseBoss`(어느 분기에도 걸리지 않음).

**계약: 해츨링은 `state.kills` 를 그대로 쓴다.** 근거 3중:

1. 전 사망 경로가 `compact()` 로 수렴하므로 **반쪽 배선이 구조적으로 불가능**하다(브리프가 우려한 결함 유형이 여기서는 발생할 수 없다).
2. `state.kills` 는 이미 해시에 접힌다(`replay.ts:303`) — 신규 폴드 0.
3. 웨이브 세그먼트 게이트가 쓰는 "처치" 정의(`waves.ts:122`)와 **동일한 정의**를 쓰게 되어, 플레이어가 화면에서 보는 진행도와 부화 진행도가 어긋나지 않는다.

**부작용 주의:** 병아리 드론이 죽인 적도 `kills` 에 들어간다 → 드론이 드론을 부르는 양의 되먹임. `hatchThreshold` 가 누적 처치에 따라 요구치를 올리므로(`shipSignature.ts:164-170`, 상한 40) 발산하지는 않으나, 동시 생존 드론 수 상한을 별도로 두는 것을 권장한다(§3.4).

### 2.6 팬텀 은신이 개입할 수 있는 적 조준 지점 — 전수 + 채택 범위

**PvE (플레이어가 스트라이커/팬텀으로 뛰는 정규 런):**

| # | 지점 | 근거 | 은신 대상 |
|---|---|---|---|
| P1 | 돌격형 진행 방향 결정 | `patterns/index.ts:79`, `:98`, `:102-106`, `:123` | ✅ (아래 방식으로 간접) |
| P2 | 사수형 거리 유지 | `patterns/index.ts:126-144` | ✅ (간접) |
| P3 | 지원형 폴백 추적 | `patterns/index.ts:146-163` | ✅ (간접) |
| P4 | 박격포 조준 좌표 | `patterns/index.ts:167-180` | ✅ **직접 차단 권장** |
| P5 | 용암 기둥 라인 조준 | `patterns/index.ts:206-227` | ✅ **직접 차단 권장** |
| P6 | 보스 호버 추적 | `boss.ts:113-122` | ✅ (간접) |
| P7 | 보스 공격 조준(`aimedBurst`·격자·라인) | `boss.ts:182`, `:188`, `:214`, `:248-249`, `:264-265`, `:280`, `:286` | ✅ **직접 차단 권장** |

**침공 3레이어:**

| # | 지점 | 근거 | 은신 대상 |
|---|---|---|---|
| I1 | L2 벽부착 방어포 조준·사계·LOS | `invasion/facility.ts:412-419` | ❌ 제외 |
| I2 | L3 중력 앵커 장판 조준 | `invasion/coreRoom.ts:440-451` | ❌ 제외 |
| I3 | L3 고정 주포 조준 | `invasion/coreRoom.ts:463-473` | ❌ 제외 |
| I4 | 방어 보스 이동·조준 | `invasion/coreRoom.ts:667-672`, `:728`, `:753-779` | ❌ 제외 |
| I5 | 수호 기체 추적·사격 | `invasion/guardianBridge.ts:156-188` | ❌ 제외 |
| I6 | 압축 프레스 추적 | `invasion/movingWall.ts:379-398` | ❌ 제외 |
| I7 | 어픽스 트리거 좌표(`playerX`/`playerY`) | `invasion/facility.ts:361-362`, `coreRoom.ts:371-372`, `formation.ts:278-279` | ❌ **절대 건드리지 마라** |

**침공 전량 제외 근거:**

- I7 은 **조준이 아니라 방어체 어픽스의 발동 조건 입력**이다(`DefenseTriggerState`). 여기에 은신을 섞으면 "근접 어픽스가 왜 안 터지나" 형태로 방어체 경제 전체가 조용히 변한다 — M7b 어픽스 sim 반영과 정면 충돌.
- 침공은 **서버(Deno EF)가 재실행 검증**한다(설계서 §10-8: 비스트라이커 침공이 전량 `defense-mismatch` 가 될 수 있는 지점). 은신 배선이 침공 sim 을 건드리면 `scripts/deno-verify` 게이트가 반드시 함께 움직여야 한다 — 범위를 PvE 로 좁히면 그 리스크가 0 이 된다.
- I6(압축 프레스)은 물리적 벽이라 은신 개념이 성립하지 않는다.

**채택 방식 — 개별 조준 지점을 고치지 않는다.**

각 지점에서 `player.x/player.y` 를 "가짜 좌표" 로 바꾸는 방식은 **금지**한다: P1~P3·P6 은 같은 좌표를 **이동**에도 쓰므로 적이 엉뚱한 곳으로 날아가고, 조준과 이동을 분리하려면 12곳을 개별 수정해야 해 반쪽 배선(이 저장소의 8회 재발 결함)이 재현된다.

**대신 "공격 방출" 단계 2곳만 게이트한다:**

- **PvE 잡몹:** `patterns/index.ts:39-42` 의 공격 발동 조건에 은신 게이트를 추가.
  ```ts
  39    if (def.attack.kind !== 'fragments' && e.cooldown <= 0) {
  40      runAttack(state, e, def, player);
  41      e.cooldown = def.fireCooldown;
  42    }
  ```
  + `moveCharge` 안의 파편 분출(`patterns/index.ts:95-98`)과 벽 충돌 분출(`:118-124`)도 같은 게이트가 필요하다(돌격형은 이 경로로만 쏜다).
- **PvE 보스:** `boss.ts:95-108`(패턴 캐스트 진입) 앞에 같은 게이트.

이동은 그대로 둔다 — 은신해도 적이 다가오긴 하되 **쏘지 않는다**. "적 조준 제외" 의 문자적 구현이며, 적을 얼려 세우는 것보다 게임이 덜 망가진다.

**게이트 판정 함수의 위치:** `signatureOn` 은 `world.ts` 의 모듈 private 이다(`:1083`). `patterns/index.ts` 는 이미 `WorldState` 를 import 하므로(`patterns/index.ts:10`), **`world.ts` 가 `export` 하는 얇은 술어**(예: `playerCloaked(state): boolean`)를 하나 추가하고 patterns·boss 가 그것을 부르는 형태가 최소 변경이다. `world.ts ↔ patterns/index.ts` 는 이미 상호 의존(`world.ts:126` ↔ `patterns/index.ts:10`)이므로 신규 순환은 생기지 않는다.

**⚠️ 팬텀 은신이 바꾸는 부수 상태:** 적탄이 안 나가면 `state.enemyBulletCount`(`patterns/index.ts:187`, `:202`, `:259`)와 `bulletCap` 소비가 달라진다. **RNG 는 소비되지 않는다** — `patterns/index.ts:5-7` 이 "No RNG is drawn here" 를 명시하고 실제로 이 파일에 RNG 호출이 없다. 보스도 `boss.ts` 에 RNG 호출이 없다. 따라서 **은신은 RNG 스트림을 밀지 않는다** = 웨이브 구성·드랍·엘리트 어픽스가 팬텀 런에서도 스트라이커와 동일한 시퀀스를 유지한다. 이것이 이 배선 형태의 가장 큰 장점이다.

### 2.7 버블 파열 밀어내기 — 적 속도 변경 지점과 산술

**변경 지점:** 새 함수 하나. 발동 위치는 **막이 소진되는 순간**(§2.2 D1 에서 `player.aux0` 이 0 이 된 틱).

**⚠️ `vx`/`vy` 를 건드리면 안 된다.** 적 속도는 매 틱 이동 컴포넌트가 **덮어쓴다**:

- `aimAt`(`patterns/index.ts:295-299`) — `e.vx = cos(ang)*speed` 대입
- `moveStandoff`(`patterns/index.ts:133-142`) — 세 분기 모두 대입
- `moveSeekWounded`(`patterns/index.ts:155-161`) — 대입
- `stationary`(`patterns/index.ts:50-52`) — `vx = vy = 0`

따라서 속도 push 는 **다음 틱에 흔적 없이 사라진다**(겉보기엔 "아무 일도 안 일어나는데" 해시는 갈리는, 최악의 조용한 결함).

**정본 선례 = `applySingularityPull`**(`world.ts:1142-1151`) — 좌표를 직접 옮긴다:

```ts
1143  function applySingularityPull(e: Entity, player: Entity): void {
1144    const dx = player.x - e.x;
1145    const dy = player.y - e.y;
1146    const d = length(dx, dy);
1147    if (d <= 1 || d >= SINGULARITY_RADIUS) return;
1148    const step = Math.min(SINGULARITY_PULL_SPEED * DT, d);
1149    e.x += (dx / d) * step;
1150    e.y += (dy / d) * step;
1151  }
```

**"정수 결정론" 의 정확한 의미(오해 주의):** 좌표는 f64 이고 `hashFloat` 로 접힌다(`replay.ts:135-136`). ADR-0005 가 요구하는 정수 bp 규율은 **배율·피해 산술**에 대한 것이지 위치에 대한 것이 아니다. 위치에 대해 지켜야 할 것은 **연산 순서의 동일성**뿐이며, 이 코드베이스는 이미 f64 나눗셈·`Math.sqrt`(`math.ts:28-30`, IEEE-754 correctly rounded)를 위치 갱신에 쓴다. 따라서:

- ✅ 허용: `length()` 1회, 나눗셈 1회, 곱셈 1회 — 위 형태를 **문자 그대로** 복제.
- ❌ 금지: `Math.pow`, `Math.hypot`(플랫폼 구현 차 — 이 저장소가 `length` 를 직접 정의한 이유), 반복 누적, `Math.atan2` 를 쓴 각도 경유(불필요한 초월함수 1회 추가).
- 반경 판정은 `d*d > FILM_BURST_RADIUS*FILM_BURST_RADIUS` 로 **제곱 비교**(선례 `world.ts:1673-1674`, `1147`).

**대상 필터:** `e.kind === 'enemy'` 로 좁힐 것. 침공 방어체(`prop`·`facilityGun` 등)는 배치 좌표가 소켓 계약이라 밀어내면 안 되고, 벽(`wall`)은 `activeWalls` 재빌드·`wallIndex` 와 얽힌다(`world.ts:770-773`).

> **미확정 — 상수 해석 1건.** `FILM_BURST_PUSH = 260` 의 주석은 "밀어내는 **속도**(sim 좌표/틱 × 100, 정수 유지용 눈금)"(`shipSignature.ts:218-219`)인데, 위 선례는 **1회성 변위**를 쓴다. 두 해석이 양립하지 않는다:
> - (가) 1회성 변위 `2.6` 유닛 — `FILM_BURST_RADIUS = 220` 대비 무의미하게 작다.
> - (나) 속도로 해석 → 지속시킬 상태 슬롯이 필요한데 **aux 2칸이 이미 찼다**(§1.2).
> - (다) 1회성 변위 = `FILM_BURST_PUSH` 유닛(260)으로 상수 의미를 재정의 — 반경(220)보다 커서 "반경 안의 적을 반경 밖으로 밀어낸다" 가 성립한다.
>
> **(다) 권장** — aux 추가 없이 체감이 나오고 상수 주석만 고치면 된다(순수 함수 파일이므로 `data/skills.ts` 무수정 규율과 무관). **상수 주석 수정은 설계 변경이므로 승인 대상.**

---

## 3. 해츨링 소환 계약

### 3.1 `summonEnemy` 실측 — **적을 만드는 함수다**

```ts
246  export function summonEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
247    const e = blankEntity('enemy');
...
256    e.cooldown = def.fireCooldown; // 고정 쿨다운(결정론, RNG 미소비)
257    return addEntity(state, e);
258  }
```
(`src/sim/waves.ts:246-258`)

- kind 는 하드코딩 `'enemy'` → **플레이어의 적**이다.
- `spawnEnemy`(`waves.ts:220-234`)와의 차이는 `:232` 의 `state.waveRng.int(0, 30)` 소비 유무뿐 — 브리프가 경고한 그 함정은 실재한다.
- `EnemyDef` 구조: `src/sim/patterns/types.ts:47-68`(id·role·typeIndex·radius·hp·contactDamage·speed·movement·attack·fireCooldown·xpValue). 카탈로그는 `data/enemies.ts` + `ENEMY_BY_TYPE`(`waves.ts:16`, 조회 `waves.ts:237-239`).

**결론: 해츨링은 `summonEnemy` 를 쓰지 않는다.** 설계서 `:79` 가 "병아리 드론 자동 출격" = **플레이어를 돕는 유닛**이라고 명시하므로 적 스폰 함수는 대상이 아니다. (브리프 규율 6은 "만약 적을 스폰한다면" 의 조건부 경고로 해석하고, 본 계약은 애초에 적을 스폰하지 않는다.)

### 3.2 sim 에 존재하는 "플레이어를 돕는 유닛" 전수 조사

| 후보 | 실체 | 결론 |
|---|---|---|
| `turretPickup` (활성 포탑) | `spawnEventObject`(`entities.ts:362-374`) → `activateTurret`(`events.ts:75-79`, `phase=1`·`life=TURRET_LIFE_TICKS=600`) → `stepTurrets`(`world.ts:1712-1742`)가 `nearestTarget` 으로 조준해 아군 `bullet` 발사 | ✅ **유일한 아군 유닛 메커니즘. 재사용 대상.** |
| `guardian` | 퇴역 기체의 **방어 AI**. 플레이어를 **추적·사격하는 적**이다(`guardianBridge.ts:156-188`, `isPlayerTargetable` 에 포함 `world.ts:1652`) | ❌ 아군 아님 |
| `formationDrone` / `spawnedDrone` | kind 는 예약돼 있으나(`entities.ts:44,48`, `KIND_CODE 20/24`) **sim 에서 생성·구동하는 코드가 0건**이다(`grep` 결과 render·isInvasionDefender 만). 실제 편대원·소환 드론은 `summonEnemy` 경유라 kind 가 `'enemy'` 다(`world.ts:1439` 주석) | ❌ 사문 kind. 재사용하지 마라 |
| `bullet` (아군탄) | 유닛 아님 | — |

**기존 재사용 선례 2건 — 둘 다 `turretPickup`:**

```ts
1600    const drone = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
1601    drone.ownerId = DRONE_MARK; // 청크 기믹과 구분(isGimmick 제외 → 컬링·상한 비대상)
1602    activateTurret(drone); // 즉시 활성 포탑(TURRET_LIFE_TICKS 동안 자동 사격)
1603    player.ownerId = DRONE_INTERVAL;
```
(유니크 ④ 자율 드론 베이, `world.ts:1593-1604`)

```ts
1505      const sentry = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
1506      sentry.ownerId = DRONE_MARK;
1507      activateTurret(sentry);
```
(보조무기 ③ 센트리, `world.ts:1502-1510`)

### 3.3 채택 — **신규 EntityKind 불요.** `turretPickup` + `DRONE_MARK` 3줄 재사용

```
spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44)
  .ownerId = DRONE_MARK
activateTurret(...)
```

이 형태가 공짜로 얻는 것(전부 이미 배선돼 있음):

- 자동 조준·사격: `stepTurrets`(`world.ts:1712-1742`) — `nearestTarget` 경유라 침공 방어체까지 알아서 표적에 든다.
- 수명 관리: `activateTurret` 이 `life = 600` 을 세우고 `stepTurrets:1715-1719` 가 만료 처리.
- 청크 컬링·기믹 상한 제외: `isGimmick`(`world.ts:826-835`)이 `e.kind === 'turretPickup' && e.ownerId !== DRONE_MARK` 로 판정하므로 `DRONE_MARK` 가 있으면 컬링·`MAX_ACTIVE_GIMMICKS` 대상에서 빠진다.
- 그리드 등록: `world.ts:1970` 에 이미 `turretPickup` 이 있다.
- 렌더: `entityRenderer` 가 `turretPickup` 을 이미 그린다.
- 해시: 신규 `KIND_CODE` 0건 → `entities.ts:57-98` 무수정.

**⚠️ `DRONE_MARK` 를 재사용하라. 신규 마크 상수를 만들지 마라.** `isGimmick`(`world.ts:832`)이 `DRONE_MARK` 를 **리터럴로 비교**하므로, 새 마크(`BROOD_MARK` 등)를 만들면 병아리 드론이 청크 컬링에 잘리고 기믹 상한을 잡아먹는다 — 그리고 **컬링은 조용히 일어나므로 "가끔 드론이 사라진다" 로만 관측된다.** 시각적 구분이 필요하면 `enemyType` 렌더 태그(선례: 보조무기 발사체가 `world.ts:1497`·`1542`·`1563`·`1582` 에서 쓰는 방식)를 쓰고 `ownerId` 는 건드리지 마라.

### 3.4 권장 파라미터 (밸런스 패스 대상)

- 동시 생존 상한: 없음 → **상한을 두라.** `stepShipSignature` 안에서 `countKind` 유사 스캔으로 `isActiveTurret(e) && e.ownerId === DRONE_MARK` 를 세어 상한(제안 4)을 넘으면 출격을 보류한다. §2.5 의 양의 되먹임 방어.
- 배치 좌표: `player.x + DRONE_SPAWN_OFFSET, player.y` (선례와 동일). 여러 기가 겹치므로 결정론적 오프셋 분산(예: `aux0 % 4` 기반 각도)을 고려. **RNG 를 쓰지 마라.**

### 3.5 (반례 대비) 신규 EntityKind 를 만든다면 반드시 등록해야 할 지점 — 전량

채택안은 신규 kind 를 만들지 않지만, 훗날 필요해질 경우를 위해 열거한다. `world.ts:1630-1636` 주석이 "세 목록은 항상 같이 바뀐다" 고 경고하는 그 목록 + 실측으로 찾은 5곳:

1. `EntityKind` 유니온 — `entities.ts:14-50`
2. `KIND_CODE` — `entities.ts:57-98` (**27 부터 append**, `:89` 가 "19..26 은 계약, 신규는 27 부터" 명시)
3. **충돌 격자 등록** — `world.ts:1959-1985`
4. **아군탄 표적 화이트리스트** — `world.ts:2020-2034`
5. **`isPlayerTargetable`** — `world.ts:1638-1660`
6. `isInvasionDefender` — `world.ts:1441-1455` (침공 피해 감소 대상 여부)
7. `compact()` 사망 처리 분기 — `world.ts:2372-2418` (미등록 시 처치·드랍 없이 조용히 사라짐)
8. `isGimmick` — `world.ts:826-835` (컬링·상한 대상 여부)
9. 렌더 스프라이트 매핑 — `src/render/entityRenderer.ts:74-75`, `:142-145`, `:250-251` + `src/render/textures.ts:187-189`, `:813-814`, `:938-939`, `:1020-1021` (**미등록은 조용히 null 폴백**)
10. `snapshot.ts:88-108` — kind 는 그대로 통과하므로 별도 등록 불요(자동)

---

## 4. 해시 안전성 체크리스트 — typeId 0 바이트 불변 논증

### 4.1 공통 게이트

전 신규 경로의 진입 술어는 `signatureOn(state, bit)`(`world.ts:1083-1086`):

```ts
1083  function signatureOn(state: WorldState, bit: number): boolean {
1084    if (hasSignature(state.config.loadout?.uniqueMask ?? 0, bit)) return true;
1085    return shipTypeDef(state.config.shipType ?? 0).signatureBit === bit;
1086  }
```

스트라이커에서 두 축 모두 false 임의 증명:

- **축 1(마스크):** `computeLoadoutStats` 의 OR-in 은 `src/items/loadout.ts:292-293` 의 `const sig = shipType.signatureBit; if (sig >= 0) uniqueMask |= 1 << sig;` 뿐이고, 스트라이커는 `signatureBit: NO_SIGNATURE_BIT`(`data/ships/striker.ts:40`) = -1 이므로 **OR 자체가 실행되지 않는다.** 비트 18~23 을 세우는 다른 경로는 존재하지 않는다(유니크 0~14 `src/sim/uniques.ts` · 캡스톤 15~17 `src/sim/capstones.ts`).
- **축 2(shipType):** `shipTypeDef(0).signatureBit === -1` 이고 비교 대상 `bit` 은 항상 18~23 → 항상 false. `config.shipType` 미지정도 `?? 0` 으로 같은 결과(`world.ts:1085`).

### 4.2 조기 탈출 지점 — 코드 수준 명시

| 배선 | 조기 탈출 줄 | 스트라이커에서 실행되는 연산 |
|---|---|---|
| `stepShipSignature` 4개 신규 분기 | `world.ts:1093`·`1102` + 신규 4개 `if` | `signatureOn` 6회 호출(순수 조회, 상태 미변경) 후 함수 반환. **`player.aux0`/`aux1` 은 0 유지** |
| 버블 흡수(D1) | `if (signatureOn(state, SIG_BUBBLE_FILM))` false | `dmg` 미변경 |
| 말로우 지연(D2) | `if (signatureOn(state, SIG_MALLOW_CUSHION))` false | `dmg` 미변경. **⚠️ `Math.round(dmg)` 를 게이트 밖에 두지 마라** — 무보유 런의 소수 피해가 바뀐다(`world.ts:2255-2258`·`1225-1229` 가 지적한 바로 그 함정) |
| 팬텀 리셋(F1) | `if (cloakOn)` false | 미실행 |
| 팬텀 발사 배율 | `world.ts:1230` 형태의 삼항 | `wDamage === w.damage` 로 **완전히 같은 값** |
| 팬텀 적 AI 게이트 | `playerCloaked(state)` false | `patterns/index.ts:39`·`boss.ts:95` 의 조건식에 `&& !cloaked` 가 추가되나 단락 평가로 **원래 분기와 동일 경로**. 상태·RNG 미변경 |
| 해츨링 출격 | `signatureOn(..., SIG_HATCHLING_BROOD)` false | `state.kills` 미조회, 엔티티 미생성 |
| 버블 파열 밀어내기 | 막 소진 시점에서만 호출 → 스트라이커는 D1 미실행이라 도달 불가 | 미실행 |

### 4.3 해시 레이아웃 불변 논증

1. **엔티티 폴드:** `aux0`/`aux1` 이 둘 다 0 이면 두 폴드가 **생략**된다(`replay.ts:161-164`). 스트라이커는 §4.2 에 의해 두 값이 0 을 벗어나지 않는다 → 폴드 생략 유지.
2. **신규 필드 0:** `WorldState`·`WorldConfig`·`Entity` 에 필드를 추가하지 않는다(§1 이 기존 슬롯만 쓰고, §3 이 신규 kind 를 만들지 않는다).
3. **신규 `KIND_CODE` 0:** `entities.ts:57-98` 무수정(§3.3).
4. **`hashWorld` 꼬리 폴드 불변:** `replay.ts:449-453` 의 `if (st !== 0)` 은 이미 존재하는 배선이며 이 작업이 건드리지 않는다.
5. **RNG 스트림 불변:** 신규 배선 중 어느 것도 `state.*Rng` 를 호출하지 않는다. 해츨링 출격은 `spawnEventObject`(`entities.ts:362-374`, RNG 미소비) 경유이고, 팬텀 게이트는 RNG 없는 파일만 만진다(§2.6).
6. **`data/skills.ts` 무수정:** 이 배선은 `src/sim/*` 만 만진다 → 삼중 해시 계약(설계서 §1)에 닿지 않는다.
7. **`state.kills` 정의 불변:** 해츨링이 `compact()` 를 수정하지 않고 읽기만 한다(§2.5) → `waves.ts:122` 의 세그먼트 게이트도 불변.

**검증 게이트(구현 레인이 반드시 통과시킬 것):** `tests/shipHashBaseline.test.ts` 33건 — 골든·fixture 재생성 금지. 깨지면 §4.2 의 조기 탈출 중 하나가 뚫린 것이다.

---

## 5. 위험 순위 (오름차순) 와 "조용히 깨지는 방법"

### 1위(가장 안전) — 말로우 (비트 22)

- 삽입 3곳(§2.1 분기 · §2.2 D2 · F 쪽 적립)이 전부 한 파일·한 함수 안이고, 외부 시스템을 건드리지 않는다.
- **조용히 깨지는 방법 ①:** 지연분을 정수화하지 않고 `player.aux0 += deferred` → `aux0` 이 소수가 되고 `hashEntity` 의 `>>> 0`(`replay.ts:162`)이 소수부를 **조용히 버려** 클라와 서버 재실행이 갈린다. 화면상으로는 아무 이상이 없다.
- **조용히 깨지는 방법 ②:** 지연분 적립을 캡스톤 무효 분기(`world.ts:2269-2271`) 밖에 두면, "없던 피격" 에서 지연 피해가 태어나 몇 초 뒤 플레이어를 죽인다 — 사인이 캡스톤으로 보이지 않아 추적이 어렵다.

### 2위 — 버블 (비트 23)

- 삽입 위치는 말로우와 같으나 **`dmg` 를 0 으로 만들 수 있어** 하류 훅 전체와 상호작용한다.
- **조용히 깨지는 방법 ①:** 전량 흡수 후 `return` 을 빠뜨림 → `player.iframes = hitIframes`(`world.ts:2275`) 가 공짜로 서고 반응 장갑 펄스(`:2285`)·위상 전환막(`:2305`)이 **피해 0 인 피격**에서 발동한다. 플레이어가 더 강해지므로 "버그" 로 신고되지 않는다.
- **조용히 깨지는 방법 ②:** 파열 밀어내기를 `e.vx/e.vy` 로 구현 → 다음 틱 이동 컴포넌트가 덮어써서(`patterns/index.ts:295-299`, `:133-142`) **화면상 아무 일도 안 일어나는데 그 1틱의 해시만 갈린다.**

### 3위 — 해츨링 (비트 21)

- `state.kills` 단일 정본 덕에 "반쪽 배선" 은 막았으나, 소환 배선이 4개 시스템(엔티티·컬링·포탑 루프·렌더)에 걸친다.
- **조용히 깨지는 방법 ①:** `DRONE_MARK` 대신 신규 마크 → `isGimmick`(`world.ts:832`)에 걸려 청크 컬링(`:892-901`)이 드론을 지운다. 플레이어에게는 "가끔 안 나온다" 로만 보인다.
- **조용히 깨지는 방법 ②:** `summonEnemy` 로 스폰(적이 됨) 또는 `spawnEnemy`(`waves.ts:220-234`)로 스폰(`waveRng` 소비 → **런 전체의 웨이브 구성이 갈린다**). 후자는 단위 테스트가 전부 그린인 채로 리플레이 검증만 실패한다.
- **조용히 깨지는 방법 ③:** 동시 생존 상한 미설정 → 드론이 처치를 쌓아 드론을 부르는 되먹임. `hatchThreshold` 상한(40, `shipSignature.ts:155`)이 있어 폭주하진 않지만 후반 프레임이 조용히 무너진다.

### 4위(가장 위험) — 팬텀 (비트 20)

- 유일하게 **`world.ts` 바깥 파일(`patterns/index.ts`·`boss.ts`)을 수정**하고, 적 AI 의 방출 여부를 바꾼다.
- **조용히 깨지는 방법 ①:** 게이트를 조준 좌표 치환으로 구현 → P1·P2·P3·P6 이 좌표를 **이동에도** 쓰므로 적이 엉뚱한 방향으로 날아가고, 12개 지점 중 일부만 고치면 "어떤 적은 은신을 뚫는다" 가 된다.
- **조용히 깨지는 방법 ②:** 침공 지점(I1~I7)까지 확장 → `DefenseTriggerState`(`facility.ts:361-362`, `coreRoom.ts:371-372`)의 좌표가 어픽스 발동 조건이라 방어체 어픽스가 조용히 다르게 발동하고, **서버 재실행만 갈려 `defense-mismatch` 로 라이브 침공이 전량 거부된다**(설계서 §10-8 이 예측한 시나리오).
- **조용히 깨지는 방법 ③:** 무피격 카운터를 캡스톤 무효 분기에서도 리셋 → "없던 피격" 이 은신을 깨서 은신이 사실상 발동하지 않는다. 반대로 리셋을 F 쪽에 안 넣으면 **맞아도 은신이 유지**된다. 둘 다 테스트를 안 짜면 관측되지 않는다.
- **조용히 깨지는 방법 ④:** 은신 해제 첫 타에 `cloakBreakDamage`(`shipSignature.ts:141-145`)를 **직접 호출** → 내부 `Math.trunc` 가 `w.damage` 의 소수 2자리(`world.ts:611`)를 지워 은신과 무관한 평상시 피해까지 바뀐다. 아크캐스터가 이미 밟고 주석으로 남긴 함정(`world.ts:1225-1229`).

---

## 6. 구현 레인에 넘기는 미확정 사항 (승인 필요)

| # | 항목 | 근거 위치 | 권장안 |
|---|---|---|---|
| Q1 | 은신 해제 조건 — 발사로 풀리는가, 피격으로만 풀리는가 | 설계서 `:78` 에 정의 없음 | **발사로 풀린다**(§2.3 (가)) |
| Q2 | `FILM_BURST_PUSH` 가 속도인가 1회 변위인가 | `shipSignature.ts:218-219` 주석 vs `world.ts:1148-1150` 선례 | **1회 변위 260 유닛으로 상수 주석 재정의**(§2.7 (다)) |
| Q3 | 말로우 지연분 반올림 — 적립만 반올림 vs `dmg` 전체 반올림 | `shipSignature.ts:190-198` 의 합 보존 계약 | **`dmg` 를 먼저 반올림**(§2.2 (b)) |
| Q4 | 병아리 드론 동시 생존 상한 | 근거 없음(신규 밸런스 값) | **4기** (§3.4) |
| Q5 | `signatureOn` 6회 호출을 단일 조회로 최적화할지 | `world.ts:1083-1086` | **하지 않는다**(§2.1 (a)) — 2축 OR 재현 실패가 §10-1 결함을 되살린다 |

## 7. 구현 후 반드시 통과해야 할 게이트

- `npx vitest run tests/shipHashBaseline.test.ts` — 33건. **골든 재생성 금지.**
- `git diff -- data/skills.ts` 공백.
- `tests/shipIntegration.test.ts` 확장: `Profile{typeId: 3|4|5|6}` → `buildRunConfig`(`src/run/runConfig.ts:79`) → `createWorld` → `stepWorld` 로 **효과가 관측되고** typeId 0 런과 결과가 실제로 다름. 기존 브루저·아크캐스터 케이스가 그 형식의 선례다(`tests/shipIntegration.test.ts:88-` 이하).
- 팬텀 한정 추가 게이트: 같은 seed·입력으로 **PvE 스트라이커 런의 per-tick 해시 배열이 M8 이전과 바이트 동일**(§4.3) + 침공 시나리오에서 `scripts/deno-verify` Node↔Deno 일치(설계서 §10-8).
