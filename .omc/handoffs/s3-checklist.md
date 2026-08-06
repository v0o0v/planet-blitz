# S3 체크리스트 — 다음 세션의 재개 지점

**현재 main: `9d03e72`**(PR #336 머지) · **배선 96 / 210** · **앵커 25개**

⚠️ **S3 는 자리만 만들었다 — 배선 수는 96 그대로다.** 다음 세션의 첫 일은 **새로 열린 자리에
스킬을 태우는 것**이다(아래 §「S3 가 연 자리를 쓰는 배선」).

정본 인계는 `.omc/handoffs/skill-catalyst-merged-lane.md` §11. 이 파일은 **한 줄 상태만** 담는다.

## S3 — 신규 앵커·필드

진행 브랜치 **`feat/skill-s3-anchors`**(origin 에 push 됨). 각 레인은 자기 브랜치에서
격리 작업 → 이 브랜치로 순차 머지 → 한 PR 로 착지.

- [x] S3-5 막 진입 앵커 **㉒ `onFilmEntry`** — 버블 FI9. 게이트를 넓히지 **않고** 앞에 앵커를
      뒀다(넓히면 파열 훅 9종이 매 치명 피격마다 오발동). `hashWorld` A/B 3경로 동일 실증.
- [x] S3-4 해츨링 출격 앵커 **㉓ `onBroodLaunchParams` · ㉔ `onBroodLaunched`** — 8종 중
      **7종 완전 + BD10 부분**(탄 피해 배율은 `stepTurrets` 앵커가 따로 필요).
- [x] S3-1 `VolleyParams` **`aimAngle`**(읽기 전용) — F5 는 열렸다. **SQ7 은 여전히 반쪽**:
      술어가 *"입력 벡터 · 발사각의 내적"* 인데 **입력 벡터 항이 레코드에 없다.**
- [x] S3-2 앵커 ⑥ 에 **`reason: 'pierce' | 'life'`** — 아크캐스터 CH3. 기본값 없는 필수 인자라
      새 호출부가 사유를 빠뜨리면 `tsc` 가 잡는다. 기존 case 는 F4 하나뿐이라 `'pierce'` 게이트로 봉인.
- [x] S3-3 정산액 확정 직전 앵커 **㉕ `onCushionSettleDue`** — ME5 만 열린다.
      ME8·ME9 는 ㉕ 로도 못 온다(탕감률·임계가 순수 함수 **안**).

**최종 앵커 번호 (리드가 머지하며 재배번)**: ㉒ `onFilmEntry` · ㉓ `onBroodLaunchParams` ·
㉔ `onBroodLaunched` · ㉕ `onCushionSettleDue`. **총 25개 + 공유 술어 1.**

⚠️ **앵커 번호는 리드가 머지하며 다시 매긴다.** S3-4·S3-5 가 둘 다 ㉒ 를, S3-3 이 ㉔ 를
주장해 충돌했고 git 은 그것을 전혀 몰랐다(인계 §6 의 「의미 충돌」). 자동 병합 충돌은 전부
*다른* 곳(import 줄·테스트 계측기)에서 났다. 다음 레인도 번호를 겹쳐 올 것이다.

### 검증 결과 (S3 통합)
- `tsc --noEmit` 0줄 · `eslint` 0줄
- `pnpm verify` → `Tests 2 failed | 7157 passed` — 실패 2건은 main 사전 적색
  (`pilotFrameFreeze` · `shipSignaturePhantom`) 그대로
- **골든**: `test:sim` 을 통합 브랜치와 기준선 워크트리(`0f65a5c`)에서 각각 돌려
  ANSI·시간 정규화 후 `diff` → **3,859줄 0 diff.** 실패 32건 목록도, 발산 해시 22개
  값도, `denoFixture` 단언 diff 도 바이트 동일. ⚠️ **건수 일치는 증명이 아니다** —
  이미 빨간 골든은 값이 갈려도 여전히 빨갛다. 값 대조가 근거다.

### ⚠️ 다음 레인이 「열렸다」고 믿으면 안 되는 것 — 반쪽으로 남았다
- **말로우 SQ7** — 발사각만으로 부족. 술어에 **입력 벡터** 항이 있고 그 칸이 아직 없다.
- **해츨링 BD10 탄 피해 배율** — `stepTurrets` 에 별도 앵커가 필요하다.
- **말로우 ME8·ME9** — 순수 함수 개정(골든 재생성 창) 대기.
- **버블 FI9** 배선 시 주의: 설계서가 쓰는 상수 `FILM_PERIOD_TICKS` 가 `shipSignature.ts` 에
  **없다**(`FILM_ABSORB_FLAT` 만 있다). 재생 주기 상수의 실제 이름을 먼저 확인해라.
- **아크캐스터 CH3** 배선 시 주의: 앵커 ⑥ 수명 만료 호출부가 `for (const e of state.entities)`
  순회 **안**이라 훅에서 엔티티를 스폰하면 안 된다. `splitSpawns` 처럼 루프 뒤로 미뤄라.

### 보고된 설계 문서 오류 (문서는 고치지 않았다)
1. **BD10** — 설계서가 *"`BROOD_MAX_DRONES` 를 읽는 곳은 `stepHatchBrood` 한 곳"* 이라 하는데
   실제로는 `src/sim/skills/hatchling.ts:103` 에 지역 사본이 있고 SH3 의 만석 술어가 그걸 읽는다.
   **읽는 곳이 둘이다.** world 쪽만 고치면 "만석이 아닌데 만석" 갈림이 조용히 난다.
2. **SH10 배치식**(`live % 5`, 우상단 고정 1칸) — 5번째 자리 오프셋을 임의로 정하면 문서와
   갈리므로 열지 않았다. **어긋남이 아니라 미결.**
3. `skillHooks.ts` 파일 헤더가 아직 "앵커 15개" 로 낡아 있다(현재 25개).

## ⭐ 다음 세션의 출발점 — S3 가 연 자리를 쓰는 배선

앵커는 섰고 스킬은 아직 하나도 안 태웠다. 값싼 순서(전부 **기존 필드/앵커만 쓴다**):

- [ ] 해츨링 **7종** — ㉓ BD1·BD2·SH10·NU10 · ㉔ BD6·NU2·NU7. **이 기체가 9/30 로 가장 뒤처졌다**
- [ ] 버블 **FI9** — ㉒ (⚠️ `FILM_PERIOD_TICKS` 상수 이름부터 확인)
- [ ] 아크캐스터 **CH3** — ⑥ `reason === 'life'` (⚠️ 순회 안이라 스폰 금지 → 루프 뒤로 미뤄라)
- [ ] 말로우 **ME5** — ㉕
- [ ] 스트라이커 **F5** — `VolleyParams.aimAngle`
- [ ] 배치1 재방문: 브루저 **BL2**(`targetDist`) · 팬텀 **AS3**(`cloakBreak`) — S2.1 이 이미 열어 뒀다

⚠️ 배선 레인은 **격리 워크트리 병렬 → 순차 머지**. 프롬프트에 **`break;` 필수**를 명시해라
(fallthrough 누적 5건). 그리고 **번호·목록을 겹쳐 오므로** 리드가 머지하며 조정해라.

## 그 뒤

- [ ] 순수 함수 개정(`cushionSettled`/`cushionRecovered` 임계 인자 · `filmAbsorbed`/
      `filmRemainingDamage` 효율 인자) — **골든에 닿는다. D 단계와 한 창에 묶어라**
- [ ] 배치1 기체 재방문 — 브루저 BL2(`targetDist`) · 팬텀 AS3(`cloakBreak`) · 스트라이커 F5 · 말로우 SQ7
- [ ] 촉매 48종 배선(선결 완료)
- [ ] D 단계 골든 재생성 **1회** + EF 재배포
- [ ] 단계 3~7(어픽스 재편 → ADR-0050 §1 → 배포 3단계 → 개연성 캡 → 밸런스)

## 미결(사용자 판단)

- 촉매 SQL 마이그레이션 미배포(`SLOT_CAP` 8→3) — 클라 먼저, SQL 나중
- `dailyRewardSelection` 촉매 축 사거리 축소 — 밸런스로 미룸
- 로컬 `main` 체크아웃(`D:/ClaudeCowork/shooting`)이 `ef8220a` 로 뒤처져 있다
