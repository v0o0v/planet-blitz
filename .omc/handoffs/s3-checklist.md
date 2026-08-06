# S3 체크리스트 — 다음 세션의 재개 지점

**현재 main: `0f65a5c`** · **배선 96 / 210** · 앵커 21개

정본 인계는 `.omc/handoffs/skill-catalyst-merged-lane.md` §11. 이 파일은 **한 줄 상태만** 담는다.

## S3 — 신규 앵커·필드

진행 브랜치 **`feat/skill-s3-anchors`**(origin 에 push 됨). 각 레인은 자기 브랜치에서
격리 작업 → 이 브랜치로 순차 머지 → 한 PR 로 착지.

- [x] S3-5 막 진입 앵커 **㉒ `onFilmEntry`** — 버블 FI9. 게이트를 넓히지 **않고** 앞에 앵커를
      뒀다(넓히면 파열 훅 9종이 매 치명 피격마다 오발동). `hashWorld` A/B 3경로 동일 실증.
- [x] S3-4 해츨링 출격 앵커 **㉓ `onBroodLaunchParams` · ㉔ `onBroodLaunched`** — 8종 중
      **7종 완전 + BD10 부분**(탄 피해 배율은 `stepTurrets` 앵커가 따로 필요).
- [ ] S3-1 `VolleyParams` 발사각(`aimAngle`) 한 칸 — 스트라이커 F5 · 말로우 SQ7
- [ ] S3-2 탄 수명 만료 소멸 앵커 — 아크캐스터 CH3
- [ ] S3-3 정산액 확정 직전 앵커 — 말로우 ME5 (ME8·ME9 는 순수 함수 개정 대기)

⚠️ **앵커 번호는 리드가 머지하며 다시 매긴다.** S3-4·S3-5 가 둘 다 ㉒ 를 주장해 충돌했고
git 은 그것을 전혀 몰랐다(인계 §6 의 「의미 충돌」). 다음 레인도 번호를 겹쳐 올 것이다.

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
