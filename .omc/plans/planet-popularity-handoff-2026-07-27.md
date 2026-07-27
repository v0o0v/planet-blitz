# 행성 인기 보상 배율 — 구현 인계 (2026-07-27)

ADR-0038 구조·배선·테스트 구현 완료. **밸런스 수치 작업은 전부 제외**했다(리포 방침: 밸런스는
출시 직전 일괄 조정).

## 무엇이 들어갔나

| 층 | 파일 |
|---|---|
| 산식 정본 | `src/economy/planetPopularity.ts` |
| sim 배선 | `src/sim/world.ts`(config·state·3 적용점·`LootRecord.elite`) · `src/sim/drops.ts`(`eliteDropChance`) |
| 해시 | `src/sim/replay.ts` 꼬리 **조건부 폴드** |
| 런 조립 | `src/run/runConfig.ts`(`planetMult: { centi, epoch }`) |
| 정산 | `src/save/settlement.ts`(XP 하한 합성 · 설계도 역수 보정) · `data/planets/index.ts` |
| 네트워크 | `src/net/gateway.ts` · `src/net/planetMultipliers.ts`(30분 폴링 캐시) · `src/net/index.ts` |
| UI | `src/ui/pixi/planetSelect.ts`(행성 카드에 `보상 ×N.NN` 상시 노출) |
| 서버 | `supabase/migrations/20260727010000_planet_popularity.sql` |
| 문서 | `docs/adr/0038-*.md` 신설 · ADR-0022/0035 개정 · `CONTEXT.md` §월드 · `data/planets/index.ts:47` 주석 |
| 테스트 | `tests/planetPopularity.test.ts`(32건) |

## 배포

원격 마이그레이션 1건 적용 필요(상시 승인). **EF 재배포는 불필요**하다 — `planetMultCenti` 가
중립(100)/미지정이면 `hashWorld` 가 한 폴드도 실행하지 않고, 침공 런은 항상 미지정이라
`verify-invasion` 골든이 바이트 불변이다(전체 스위트 3594건 통과가 물증).

절차 정본: `.omc/skills/planet-blitz-supabase-deploy-workflow.md` · 루트 `README.md` `## 서버 배포`.

첫 cron 실행 전까지 `planet_popularity_current` 는 0행이고, 클라는 전 행성 1.0 폴백으로 돈다
(오프라인과 같은 결과). 즉 **배포 순서에 의존성이 없다**.

## 다음 레인 큐 — 밸런스 (전부 이번 레인 범위 밖)

1. **상수 결정·스윕** — `CLAMP_LO 0.85` · `CLAMP_HI 1.20` · `PRIOR_K 80` · `ALPHA 0.2`.
   전부 플레이스홀더다(`// TODO(밸런스)` 주석 부착). TS 와 SQL **양쪽**에 쌍으로 있으니 함께 고칠 것.
2. **배율 도입 후 재측정** — 클리어율 · 런당 레벨업 · 10시간 목표. `balance-impl-handoff-2026-07-27.md`
   의 기준선(클리어율 60.4~80.2% · 런당 레벨업 6.1~7.7 · 장비 2.3~2.8)이 배율 1.0 기준이라,
   0.85~1.20 대역에서 어디까지 흔들리는지 미측정이다.
3. **수량 합성 상한 부재** — 행성 1.20 × 촉매 2.2 = **×2.64** 유입. 상한 캡을 둘지, 둔다면
   어디에 둘지가 미결. `tests/drops.test.ts` 의 "런당 장비 유입" 가드는 **배율 1.0 기준으로 명시
   고정**해 뒀으므로 이 조합에서 깨지지 않는다(= 가드가 이 문제를 감지해 주지 **않는다**).
4. **성공 판정 목표치** — 점유율 max/min 비 ≤ 1.5 등. 지표는 `planet_popularity` 테이블
   (`run_count`·`share_ppm`)에 30일치 쌓이므로 관측 가능하다. **CI 게이트로는 만들지 않았다.**
5. **`ALPHA` 와 30분 주기의 상호작용** — α=0.2 · 30분이면 목표 도달까지 ≈ 3~4시간이다. 이게
   "플레이어가 반응할 수 있을 만큼 느리고, 편식을 되돌릴 만큼 빠른가"는 실측 판단 대상.

## 구현 중 발견한 것 (기록)

**정수 격자 지수평활의 정지 지점(stall).** centi 정수 위에서 평활을 돌리면 목표에 가까워질수록
한 주기 스텝(`α × |target − prev|`)이 0.5 centi 밑으로 내려가고, 그 순간 반올림이 결과를 `prev`
로 되돌려 **영원히 멈춘다**. 목표에 2 centi 못 미친 채 "수렴한 척"하며 `Σwᵢmᵢ = 1` 불변식이
1.019 로 깨진다. §1 런가중 평균 테스트가 잡았다. 보정("목표가 1 centi 이상 남았는데 반올림이
제자리면 최소 1 centi 전진")은 **TS·SQL 양쪽에** 들어가 있다 — 한쪽만 고치면 서버 표가 클라
산식과 갈린다.

## 미해결 · 확인 요청

**서버의 "자원분 재산정"을 상한 확대로 구현했다.** sim 이 이미 배율을 적용해 자원을 적립하므로
(ADR-0038 "적용 레이어는 전부 sim") 서버가 또 곱하면 이중 적용이다. 그래서 서버는 그 epoch 의
자기 스냅샷 배율만큼 **개연성 캡을 넓혀**, 정직한 클라의 정당한 주장이 클램프되지 않게 한다 —
촉매 `resource_mult` 영수증이 캡을 상향하는 규율과 동일하고 추가 RPC 가 0이다. 클라는 배율값을
보내지 않고 **epoch 만** 보내며, epoch 이 현재/직전이 아니면 1.0 취급이다.

원 사양의 "클라 주장은 무시하고 재산정" 문구를 **"클라 주장을 서버 값으로 유계화"** 로 읽은
결과다. 만약 sim 이 자원에는 배율을 적용하지 **않고** 서버가 곱하는 쪽을 의도했다면
`src/sim/world.ts` 의 자원 milli 캐리에서 `planetMult` 를 빼고 SQL 쪽을 곱셈으로 바꾸면 된다
(오프라인 런은 어차피 1.0 이므로 그쪽도 일관되긴 하다).
