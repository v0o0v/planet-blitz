# 수호 방어 스펙은 퇴역 시점에 실물 빌드에서 파생하고, 무기 타입이 방어 발사체를 결정한다

ADR-0024가 "방어 참전 스펙도 실물 빌드에서 파생"으로 결정한 것을 예비역 소집 Wave 2에서 구체화한다. 파생을 **퇴역 시점(클라 TS)** 에 수행해 `guardians.data` 스냅샷에 동결하고(스폰 시점 재파생 아님), 프리셋(타이탄/인터셉터)은 **순수 이동 AI 성향** 으로 축소하며, **장착 메인 무기 타입이 수호 발사체 아키타입**(벌컨·산탄·레일건·미사일·빔)을 결정한다.

## 배경

현재 방어 스냅샷은 `makeGuardianSnapshot(preset, combatScore)` — 프리셋 기하에 단일 스칼라 `combatScore` 로 hp·피해만 스케일한다. 무기 타입·어픽스·스킬트리를 반영하지 못해 `combatScore` 가 같으면 빔 글래스캐논과 벌컨 탱커가 **동일한 수호**가 된다. ADR-0024 는 이를 실물 빌드(`GuardianRecord.build` = typeId·equipped·skillInvest) 파생으로 통일해 "한 기체 = 한 스펙" 을 만들기로 했다. 이 ADR 은 그 파생을 어디서·어떻게 하는지를 못박는다.

## 결정

1. **파생 위치 = 퇴역 시점(클라 TS), 동결.** `makeGuardianSnapshot` 를 빌드 파생(`computeLoadoutStats(build.equipped, build.skillInvest, undefined, build.typeId)` → GuardianSnapshot 매핑)으로 교체하고 결과를 `guardians.data` 에 저장한다. 빌드는 퇴역 후 불변이므로 스폰 시점 재파생과 결과가 영원히 동일하다. SQL `inject_guardian_authority`·EF `injectGuardianAuthority` 는 `guardians.data` 를 **통째로 복사** 하므로, 스냅샷 shape 만 유지하면 주입 3자 계약은 불변이다.

2. **프리셋 = 순수 이동 AI 2종.** 프리셋은 이동속도·standoff(교전 유지거리)·히트박스 반지름만 결정한다. 파워(hp·피해·발사간격)도 발사체도 결정하지 않는다. 타이탄 = 원거리 버팀형, 인터셉터 = 근접 추격형.

3. **파워 = 빌드 loadout.** hp(`maxHpAdd`)·접촉피해·발당피해(`damageMult`)·발사간격(`fireRateMult`)은 빌드에서 파생한다. 풍화 성능%·계보 보너스는 기존 `resolveGuardianStats` 로 그 위에 그대로 적용한다(스냅샷 shape 불변이라 이 함수는 손대지 않는다).

4. **발사체 = 메인 무기 타입 5종 전부 고유.** `GuardianSnapshot` 에 발사 서술자 3필드(`weaponType`·`bulletCount`·`spread`[정수 밀리라디안])를 추가하고 `stepInvasionGuardians` 가 무기별로 분기한다 — 벌컨 단발·산탄 팬·레일건 고속·미사일 유도·빔 세그먼트. 유도·산탄은 기존 적탄 primitive(`homingBehavior`·보스 산탄 팬)를 재사용한다. **`pierce` 는 서술자에서 제외** — 적탄은 단일 플레이어 상대라 관통이 무효과이고, 수호 엔티티의 `entity.pierce` 는 이미 **슬롯 인덱스**로 점유돼 충돌 위험이 있다(레일건 정체성은 loadout 속도·피해·간격에 실린다). **서브무기·원소 상태이상·유니크·캡스톤은 수호에 미복제**(방어 경계 — 대부분 플레이어 액티브 메커니즘이라 방어 AI 에 부적합).

## Considered Options

- **파생 위치 A: 스폰 시점(서버가 raw build 로 재파생).** SQL/EF 가 build 를 주입하고 sim 이 매 런 파생. 미래 서버권위 하드닝의 발판이나, build 도 클라가 쓰므로 아이템 권위가 없으면 위조 방어 이득이 실질 없고, 3자 바이트 계약 재작성으로 결정론 hot-path 와 범위가 커진다. 빌드 불변성 때문에 결과가 B(퇴역 시점)와 영원히 동일하므로 기각.
- **발사체: 단발 파워전용.** 무기 타입을 `damageMult`/`fireRateMult` 로만 흡수하고 발사체는 제네릭 단발 유지. EF 재배포 불필요로 최소 범위이나, "한 기체 = 한 스펙" 의 발사 정체성이 사라져 기각(충실도 우선).

## Consequences

- 무기 아키타입 복제로 수호 발사 sim 이 바뀌어 **EF verify-invasion 재배포 + 신규 해시 베이스라인** 이 필요하다(주입 계약은 불변, sim 코드가 바뀌어 재배포). 유도 선회 등 결정론 표면이 늘어 Node↔Deno 바이트 정합 검증이 중요해진다.
- `GuardianSnapshot` 이 발사 서술자 필드를 얻어 `tests/invasionHash.test.ts` 열거·골든이 재생성된다. PvE 불변·`KIND_CODE.guardian:17` append-only 는 유지한다.
- 레일건·빔은 단일 플레이어 상대로 고유 발사체 기하가 거의 없어 정체성이 loadout 속도·피해·간격에 실린다(관통·세그먼트는 시각/엣지 수준).
- 밸런스 계수(수호 HP 계수, 아키타입별 유도 선회율·세그먼트 수·팬 각 등)는 출시 전 일괄 튜닝으로 이월한다 — 이 ADR 은 구조만 확정한다.
