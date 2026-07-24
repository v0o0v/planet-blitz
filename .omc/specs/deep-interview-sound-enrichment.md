# Deep Interview Spec: 사운드 풍성화 구현 명세

## Metadata
- Interview ID: sound-enrichment-2026-07-24
- Rounds: 8 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: 18.5% (weakest component = bgm-zone)
- Type: brownfield
- Generated: 2026-07-24
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown (overall = 활성 4요소 최약값)
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.2975 |
| Constraint Clarity | 0.80 | 0.25 | 0.2000 |
| Success Criteria | 0.80 | 0.25 | 0.2000 |
| Context Clarity | 0.78 | 0.15 | 0.1170 |
| **Total Clarity** | | | **0.8145** |
| **Ambiguity** | | | **0.1855** |

## Topology
Round 0에서 4개 최상위 구성요소 확정(사용자 승인 2026-07-24). 연기 0.

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| bgm-zone | active | 사운드 존/BGM — 5트랙 큐레이션·로딩·존 매핑·크로스페이드 | AC 1–7 커버. 18% |
| mixing-bus | active | 3버스(BGM/SFX/UI) 게인 + 설정 UI + 저장 마이그레이션 | AC 8–11 커버. 14% |
| sfx-expansion | active | 등급 팡파레·무기별 발사음·패닝·메타 UI음·지터·보이스 관리 | AC 12–19 커버. 17% |
| invasion-gating | active | 침공 라이브 SFX·관전 SFX off·BGM만 | AC 20–21 커버. 15% |

## Goal
Planet Blitz의 사운드를 4개 축(BGM·믹싱·SFX 확장·침공 배선)에서 풍성하게 확장한다. 절차 합성 SFX는 유지하고(ADR-0029 하이브리드), BGM만 외부 음악 5트랙을 도입한다. 모든 사운드는 render 계층에 머물러 결정론(ADR-0005)에 무관하며, sim은 소리를 전혀 모른다. `RunSoundObserver`의 "sim 스냅샷 델타 관찰" 패턴을 확장해 신규 트리거(드랍 등급·무기 타입·화면/런 전환)를 파생한다.

## Constraints
- **결정론 불변**: 모든 사운드는 render-only. `src/sim/`에서 audio를 import 금지. 해시·리플레이·정산에 무영향.
- **하이브리드 에셋(ADR-0029)**: SFX는 절차 합성(외부 에셋 0) 유지, BGM만 외부 음악 루프.
- **음악 소스**: 로열티프리·상업 라이선스 음원만(CC0/구매). 출처·라이선스를 저장소에 기록. 음악 AI 생성(Suno/Udio) 배제.
- **번들/로딩**: 지연 로딩 + 프리페치(메뉴곡 첫 제스처 로드, 나머지 화면 전환 직전 프리페치). ogg + mp3 폴백. 트랙당 ~1–2MB 목표. CrazyGames 초기 로딩 보호.
- **`run` 화면 다형성**: `startInvasionRun`도 `setScreen('run')`을 쓰므로(main.ts:821), 런의 존은 화면 이름이 아니라 **런 종류(PvE vs 침공)**로 선택한다.
- **AudioContext**: 첫 사용자 제스처 이후 지연 생성/resume(자동재생 정책) — 기존 `unlock()` 유지.
- **밸런스 유예**: 지터/레이어 강도, 스로틀 ms, 크로스페이드 duration, 보이스 상한값, 버스 기본 볼륨은 출시 전 밸런스 패스에서 일괄 튜닝(프로젝트 방침). spec은 구조만 확정.

## Non-Goals
- 적응형 레이어링(스템 기반 반응형 음악) — 정적 트랙 + 크로스페이드만.
- 거리 감쇠 — Round 4(Contrarian)에서 제거. 플레이어 항상 화면 중앙 + "화면 밖=무음" 규칙과 중복. 좌우 패닝만.
- 풀 3D 공간 오디오(PannerNode).
- 청각 문법 전면(소리=탄 거동 4종) — 발사음은 weaponType 6종 기준.
- 적탄 발사음 전량 재생 — 보스·특수 패턴 경고음만.
- 관전 재생 SFX — 관전은 BGM만.
- 행성/모드별 전투곡 변주 — 확장 예약(5존 공용 전투곡으로 시작).
- 버스별 개별 음소거 — 전역 음소거 1개("음악만 끄기"는 BGM 슬라이더 0으로 달성).
- 정산 스팅어를 SFX victory/defeat로 대체 — 스팅어는 음악 계층으로 신설(기존 SFX와 공존).

## Acceptance Criteria

### bgm-zone
- [ ] AC1: 5개 사운드 존 정의 — 메뉴·기지 / PvE 전투 / 보스 / 침공 / 정산(스팅어).
- [ ] AC2: 화면→존 매핑 — title·base·defense·archive·controlTower·starMap·inventory·research·refinery → 메뉴·기지 존.
- [ ] AC3: `run` 화면은 런 종류로 분기 — PvE 런 → PvE 전투 존, 라이브 침공 런 → 침공 존.
- [ ] AC4: 보스 등장 시(observe의 hasBoss false→true) 보스 존으로 크로스페이드, 보스 처치/런 종료 시 복귀. 짧은 보스전 대비 **최소 유지시간 가드**.
- [ ] AC5: 관전(`spectate` 화면) → 침공 존 BGM.
- [ ] AC6: 런 종료 → `result` 화면 진입 시 전투·보스존 정지 → 정산 스팅어 1회(승/패 분기) → 스팅어 종료 후 메뉴·기지 존 복귀.
- [ ] AC7: 존 전환은 크로스페이드(equal-power), 트랙은 seamless loop. 메뉴곡은 첫 제스처에 로드, 나머지는 프리페치.

### mixing-bus
- [ ] AC8: `GameAudio`가 master 아래 BGM/SFX/UI 3개 GainNode를 갖고 각 사운드를 해당 버스로 라우팅.
- [ ] AC9: `AudioSettings`가 `{muted, bgmVolume, sfxVolume, uiVolume}`로 확장(단일 `volume` 대체). 기본 BGM 0.5·SFX 0.6·UI 0.5.
- [ ] AC10: `parseAudioSettings`가 구 `{muted, volume}` 감지 시 `volume`을 3버스에 동일 복사(무손실 마이그레이션). `audioSettings.test.ts`에 케이스 추가.
- [ ] AC11: `pixi/settingsPanel.ts`가 슬라이더 3개(BGM/SFX/UI) + 전역 음소거 토글 1개 렌더. 라이브 반영(onChange).

### sfx-expansion
- [ ] AC12: `weaponType`(0~5) 6종 각각 고유 발사음. observe 호출 시 현재 weapon.weaponType 전달 → `play`가 무기-인덱스 발사음 선택.
- [ ] AC13: `SoundFrame`에 드랍 관찰 델타 신설 — 이전/현재 loot 길이 비교 + 신규 loot의 rarity 코드(collectLoot, world.ts:3168) 읽기.
- [ ] AC14: 드랍 순간 3단계 — 노말(0)·매직(1) 공용 획득음 / 레어(2) 강조음 / 유니크(3) 팡파레.
- [ ] AC15: 좌우 패닝 — 이벤트 엔티티 x와 플레이어 x 차이로 StereoPanner. 화면 밖 이벤트는 무음(방향은 레이더). 거리 감쇠 없음.
- [ ] AC16: 메타 UI음 팔레트 — 의미 범주 4~5종(이동·탭 / 확인·열기 / 긍정 / 부정 / 승급·축하) 재사용. UI 버스 귀속.
- [ ] AC17: 반복 SFX에 미세 랜덤 지터(피치·게인)로 기계적 단조로움 제거. 처치·피격에 레이어 보강.
- [ ] AC18: 보이스 관리 — kill·hit 등에도 사운드별 최소 간격 스로틀, 전체 동시 재생 보이스 상한(초과 시 oldest steal).
- [ ] AC19: 적탄은 전량 재생 금지 — 보스·특수 패턴 경고음만.

### invasion-gating
- [ ] AC20: 라이브 침공(`run` 화면, 침공 런) → SFX 전량 배선(기존 observe 재사용).
- [ ] AC21: 관전(`spectate` 화면 또는 spectate 재생 상태) → SFX 게이트 off, 침공 존 BGM만. 배속·스킵 SFX 폭주 차단.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| BGM도 절차 합성 가능 | 풍부한 전투 음악의 질적 한계 | 하이브리드 — BGM만 외부 루프(ADR-0029) |
| 발사음은 탄 거동(시각 문법 대칭)으로 | 파밍 피드백이 더 중요한가? | weaponType 6종 고유음 선택 |
| 등급음은 획득 시 | 디아2 "쨍"은 드랍 순간 | 드랍 순간 3단계 |
| 공간감 = 패닝 + 거리 감쇠 | 플레이어 항상 중앙 → 거리감쇠 무의미 + "화면밖=무음"과 중복 (Contrarian) | 패닝만 유지, 거리 감쇠 제거 |
| 메타 UI음 7~8종 개별 | 상호작용별 개별이 필요한가? (Simplifier) | 의미 범주 4~5종 재사용 |
| 3버스 = 버스별 음소거 필요 | "음악만 끄기"는 BGM 슬라이더 0으로 달성 (Simplifier) | 전역 음소거 1 + 볼륨 3 |
| 보스곡은 침공 전용 | PvE 보스 순간의 고조 | 보스 등장 시 mid-run 크로스페이드 |
| 관전에도 SFX | 배속·스킵 SFX 폭주 | 관전은 BGM만 |
| `run`=PvE 전용 | 코드 확인: startInvasionRun도 'run' | 존은 런 종류로 분기 |

## Technical Context (배선 지점, explore + grep 확정)
- **화면 상태**: `currentScreenName` + `setScreen(name)` (main.ts:401–405). 값: title/base/defense/archive/controlTower/starMap/spectate/run/result/inventory/research/refinery. 라이브 침공도 `setScreen('run')` (startInvasionRun, main.ts:821). 종료 `setScreen('result')` (main.ts:1122). → 존 전환은 setScreen + 런 종류 분기에 건다.
- **드랍 등급**: `collectLoot()` (world.ts:3168–3176)이 loot 엔티티의 `enemyType` 필드에 rarity 코드(0~3) 저장. Rarity 타입 items/types.ts:46–61 ('normal'|'magic'|'rare'|'unique'). 현재 `RunSoundObserver.observe()`는 드랍 미관찰(kills/level/hp/resources/boss/bulletCount만) → 델타 신설 필요.
- **주무기 타입**: `Item.weaponType` 숫자 인덱스 0~5 (items/types.ts:173–187). `world.weapon.weaponType`. `autoAttack()` (world.ts:1885~)가 타입별 분기. render가 읽을 수 있음.
- **설정 볼륨 UI**: `buildSlider()` 콜백(pixi/settingsPanel.ts:271)이 `audio.setVolume` 호출, 음소거 토글(248–259). `GameAudio.setVolume/setMuted/getSettings`(audio.ts:98–305). 현재 master 단일 게인.
- **침공/관전**: `beginSpectate()`(main.ts:641–683)이 `createWorld()` 재사용 — 침공은 **별개 world 아님, 동일 render 루프**. `spectateReplay/spectateCursor/spectatePlaying/spectateSpeed` 상태. `SpectateOverlay`(replaySpectate.ts:95–144, DOM). observe() 호출(main.ts:1337)이 관전 중에도 실행됨 → SFX 게이트 필요.
- **관찰 호출부**: main.ts:1337이 이미 `w.entities` 순회 → 패닝용 위치·현재 weapon 접근 가능.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 사운드 존 | core domain | id(5종), track, loop, crossfade | 화면/런종류가 존을 선택; 보스 등장이 보스존 오버라이드 |
| 정산 스팅어 | core domain | variant(승/패), oneShot | result 화면 진입이 트리거; 존 정지 후 재생 |
| 등급 팡파레 | core domain | rarity(0~3), trigger=drop | collectLoot 드랍이 트리거; 유니크=팡파레, 레어=강조, 노말·매직=공용 |
| 오디오 버스 | supporting | BGM/SFX/UI gain, muted(전역) | 모든 사운드가 3버스 중 하나로 라우팅 |
| SoundFrame 델타 | supporting | kills/level/hp/resources/boss/bulletCount + dropRarity + weaponType | observe가 프레임 델타로 트리거 파생 |
| 발사음 | supporting | weaponType(0~5) | weapon 장착이 발사음 선택 |
| 관전 게이트 | supporting | isSpectating flag | spectate 상태가 SFX off + BGM만 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|-----------------|
| 1 | 3 (발사음, weaponType, SoundFrame) | 3 | - | - | N/A |
| 2 | 4 (+등급 팡파레) | 1 | 0 | 3 | 75% |
| 3 | 5 (+사운드 존) | 1 | 0 | 4 | 80% |
| 4~5 | 6 (+오디오 버스, 패닝은 발사음에 흡수) | 1 | 0 | 5 | 83% |
| 6~8 | 7 (+정산 스팅어, 관전 게이트) | 2 | 0 | 5 | 71%→100% |

관찰: 엔티티가 신규 추가만 있었고 rename/삭제 0 — 개념 안정적 수렴. 최종 7 엔티티 고정.

## Interview Transcript
<details>
<summary>Full Q&A (Round 0 + 8 rounds)</summary>

### Round 0 — Topology
**Q:** 4개 최상위 구성요소(bgm-zone/mixing-bus/sfx-expansion/invasion-gating)가 맞나?
**A:** 맞음 — 4개 그대로.

### Round 1
**Q:** 발사음을 무엇 기준으로 나눌까? (탄 거동 4종 / weaponType 6종 / 2~3부류)
**A:** weaponType 6종 각각 고유음.
**Ambiguity:** sfx 48%→45%

### Round 2
**Q:** 등급 사운드 언제·몇 단계? (드랍 3단계 / 획득 3단계 / 드랍 2단계)
**A:** 드랍 순간, 3단계.
**Ambiguity:** sfx 45%→37%

### Round 3
**Q:** PvE 런 보스 등장 시 BGM? (보스존 크로스페이드 / 단일 전투곡 / 스팅어+SFX)
**A:** 보스 등장 시 보스존 크로스페이드, 처치 시 복귀.
**Ambiguity:** bgm 39%→29%

### Round 4 — Contrarian
**Q:** 플레이어 항상 중앙이면 거리 감쇠 실익 약함 — 어디까지? (패닝만 / 플랫 / 원안)
**A:** 패닝만 유지, 거리 감쇠 제거.
**Ambiguity:** sfx 37%→34%

### Round 5
**Q:** 메타 UI음 몇 종·원리? (의미 범주 4~5 / 개별 7~8 / 최소 2~3)
**A:** 의미 범주 소수(4~5종) 재사용.
**Ambiguity:** sfx 34%→28%

### Round 6 — Simplifier
**Q:** 3버스 저장·음소거 단순화? (전역음소거1+볼륨3+복사 / 버스별음소거 / 리셋)
**A:** 전역 음소거 1 + 볼륨 3 + 구볼륨 복사.
**Ambiguity:** mixing 26%→14%

### Round 7
**Q:** 런 종료→정산 스팅어 거동? (존정지+스팅어+메뉴 / 덕킹 / 스팅어없음)
**A:** 전투·보스존 정지 → 스팅어 1회 → 메뉴존.
**Ambiguity:** bgm 23%→18%

### Round 8
**Q:** 탄막 밀도 소리 폭주 방지 구조? (스로틀+보이스상한 / 스로틀만 / coalescing)
**A:** 사운드별 스로틀 + 동시 보이스 상한.
**Ambiguity:** sfx 22%→17%
</details>
