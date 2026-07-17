# Lane C1/C2 → C3(에디터 UI) 데이터 계약

M4 Phase C1(방어 엔티티)·C2(침공 런 모드) sim 구현 완료. C3(방어 배치 에디터 UI,
`src/ui/defenseCommand.ts`)와 후속 `defenses` 테이블이 사용할 계약을 요약한다.

## 1. 방어 배치 JSON 타입 (`src/sim/defense.ts`)

에디터의 출력 = `defenses.layout` 컬럼 = 침공 런 config의 정적 스폰 데이터. 전부 `defense.ts`에서 export.

```ts
interface DefenseLayout {
  core: { x: number; y: number };                       // 침공 목표(배치당 1개 필수)
  turrets: { type: number; x: number; y: number }[];    // type = TURRET_* 코드(0..5)
  obstacles: { x: number; y: number; halfW: number; halfH: number }[]; // AABB 반폭/반높이
  guardianSlots?: unknown[];                             // M5 수호 기체 슬롯(비활성 예약)
}

interface InvasionConfig {
  layout: DefenseLayout;
  timeLimitTicks: number;   // 기본 DEFAULT_TIME_LIMIT_TICKS(3분 = 10800)
}
```

- 침공 런은 `WorldConfig.invasion?: InvasionConfig`로 주입한다(append-only, 미존재 시 PvE 100% 불변).
- 장애물은 별도 kind가 아니라 **기존 `wall` 재사용**(spawnWall이 이동·탄·LOS 차단 제공). AABB 규약:
  `halfW`=반폭(radius 슬롯), `halfH`=반높이(targetX 슬롯) — 에디터도 이 반-치수로 직렬화.

## 2. 포탑 스펙 접근법 (`TURRET_SPECS`, `defense.ts`)

- 포탑 유형 상수: `TURRET_VULCAN=0, TURRET_SNIPER=1, TURRET_SHOTGUN=2, TURRET_FROST=3, TURRET_MISSILE=4, TURRET_TESLA=5` (`TURRET_TYPE_COUNT=6`). **재번호 절대 금지**(배치 JSON·해시 계약).
- `TURRET_SPECS[type]: TurretSpec` — 읽기 전용 테이블. 에디터가 미리보기·툴팁에 쓸 필드:
  `name, cost, hp, radius, range, fireCooldown, damage, ...`(전체 필드는 `TurretSpec` 참고).
- **초기 밸런스 추정값**이다(계획 §5). 값은 튜닝 대상 — 밸런스 최종은 M5. 스펙을 바꿔도 계약(타입·유형 코드)은 불변.

## 3. 배치 포인트 비용 필드 (에디터 예산제)

- 포탑 비용: `TURRET_SPECS[type].cost` (발칸1·산탄2·감속2·전격2·저격3·미사일3 — 추정값).
- 장애물 비용: `OBSTACLE_COST`(=1). 코어: `CORE_COST`(=0, 필수 1개).
- 예산 총액(전원 동일 + 시설 업그레이드 소폭 증가, 계획 §5)은 **아직 미정** — 에디터/시설 레이어에서
  정의할 값. sim은 예산을 강제하지 않는다(에디터가 검증). 비용 데이터만 제공.

## 4. 스폰·판정 헬퍼 (참고)

- `spawnInvasionLayout(sink, layout)` — 코어→포탑→장애물 순 스폰(createWorld가 호출). 순수 데이터 구동.
- 승리: 코어 파괴(플레이어 탄) → `state.victory`. 패배: 격추(`player.hp<=0`) 또는 제한 시간 초과 → `state.gameOver`.
- 플레이어 무기는 `defenseTurret`·`core`를 자동 조준(nearestTarget/homeMissile 확장). 포탑은 플레이어를 조준·발사.

## 5. 결정론·해시 메모 (D 검증 레인 참고)

- `hashWorld`는 **조건부 append**: invasion 존재 시에만 제한시간·배치를 접는다 → PvE fixtures 해시 **바이트 불변**(검증됨: `fixtures.json` diff 없음).
- 방어 거동은 전부 결정론(RNG 미소비, 위치·타이머·엔티티 순서·벽 LOS만). 침공 런 2회 해시 일치 테스트 통과(AC13).

## 6. Phase D 서버 검증 필수 항목 (Lane C 리뷰 carry-forward)

Lane C(C1+C2+C3) 코드리뷰 APPROVE 시점에 확인된, Phase D(서버 재실행 검증) 착수 전 반드시
짚어야 할 잔여 항목. 전부 sim/에디터 자체의 결함이 아니라 **서버 신뢰 경계**·**밸런스** 성격의
후속 확인 사항이다.

1. **서버측 예산 재검증 필수** — C3 에디터의 배치 포인트 예산제는 **클라이언트(에디터) 책임**
   이고 `src/sim/defense.ts`의 sim은 예산을 강제하지 않는다(계약 §3). 즉 변조된 클라이언트가
   예산을 초과한 `DefenseLayout`을 그대로 제출하면 sim은 순순히 스폰한다. Phase D의 Edge
   Function 재실행 경로는 제출된 layout을 실행 전에 **`TURRET_SPECS[type].cost` 합산으로
   재검증**해 예산 초과 배치를 거부(또는 서버 표준 예산으로 클램프)해야 한다.
2. **침공 시나리오 fixtures 교차 런타임 잠금** — 기존 `denoFixture.test.ts`는 M1~M3 대표
   시나리오만 Deno 교차 검증한다. 침공 런(포탑 6종·코어·장애물 조합)은 아직 그 픽스처 세트에
   없다 — Phase D 착수 시 대표 침공 시나리오(예: 6종 포탑 전부 배치 + 장애물 혼합)를
   fixtures.json에 추가해 Node/Deno 양쪽 bit-identical을 잠가야 한다(AC13는 Node 내부 2회
   실행만 검증했고, 교차 런타임까지는 아직).
3. **감속 포탑의 LOS 무시(밸런스 검토 항목)** — `fireTurret`의 TURRET_FROST 분기는 냉기
   장판을 플레이어의 **현재 위치**에 직접 융기시키며, `stepDefenseTurrets`의 사거리 게이트를
   통과하면 `spec.hazardRadius === 0` 조건 때문에 벽 LOS 차단 검사를 건너뛴다(다른 포탑은
   장애물 뒤에 숨으면 발사가 보류되지만 감속 포탑은 엄폐로 회피 불가). 의도적 설계일 수
   있으나(장판형 무기는 탄도가 없어 LOS 개념이 안 맞을 수 있음), 방어자가 감속 포탑만으로
   엄폐 불가 구간을 만드는 것이 밸런스상 허용 범위인지는 M5 밸런싱 패스에서 검토 필요.
