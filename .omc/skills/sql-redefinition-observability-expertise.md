---
name: sql-redefinition-observability-expertise
description: SQL 함수를 create or replace 로 재정의하면 본문 뒤 문장(revoke·grant·comment)이 조용히 사라진다 — 그리고 계약 테스트가 원본 마이그레이션만 읽어서 그걸 못 본다. 증상이 0 인 보안 회귀
triggers:
  - create or replace function
  - revoke all on function
  - 마이그레이션 재정의
  - security definer
  - 함수 본문 잘라
  - effectiveFunctionBody
  - AC-I6
  - 바이트 동일
  - schema_migrations
---

# SQL 재정의는 본문 뒤 문장을 떨어뜨리고, 테스트는 그걸 못 본다

## The Insight

이 리포의 마이그레이션 관행은 **"이전 마이그레이션에서 함수 본문을 기계적으로 잘라 두 줄만
치환"** 이다(그 파일들이 스스로 "바이트 동일" 이라고 적어 둔다). 그런데 함수 정의는 `$$;` 로
끝나고 **권한 회수는 그 뒤에 온다.** 본문만 잘라 오면 `revoke` 4줄이 함께 안 온다.

그리고 두 번째 층이 있다. 계약 테스트가 **원본 마이그레이션 파일 하나만** 읽으면
(`commissionCode()` 처럼), 뒤따르는 재정의가 회수를 빠뜨려도 **원본에 남은 회수를 보고 초록**이다.
실제로 도는 정의는 마지막 것인데 테스트는 첫 번째를 본다.

## Why This Matters

**증상이 정확히 0 이다.** `create or replace` 는 기존 ACL 을 보존하므로, 순서대로 적용된 원격에서
회수 누락은 **아무 것도 바꾸지 않는다.** 위험은 함수가 **선재하지 않는 경로**에서만 터진다:
baseline 스쿼시 · `drop function` 후 부분 재적용 · 새 환경 구축. 그때 `security definer` 함수가
`EXECUTE to PUBLIC` 기본값으로 새로 생기고, 임의 `authenticated` 가 파라미터를 직접 넣어
**남의 프로필에 지급/발령**을 할 수 있다.

즉 **리포에 남는 정본이 회수 없는 정의가 되어 이후 모든 재적용이 위험을 물려받는다.** 그리고
그 사실을 알려주는 신호가 런타임에도 테스트에도 없다.

같은 파일이 "함수의 나머지는 바이트 동일하다"고 주장하는데 **그 주장이 거짓이 되는 것**도 부수
피해다 — 다음 사람이 그 문장을 믿고 diff 를 안 본다.

## Recognition Pattern

- `create or replace function` 이 들어간 새 마이그레이션을 쓰고 있다.
- 그 함수를 정의한 **이전** 마이그레이션이 본문 뒤에 `revoke` / `grant` / `comment on` 을 갖고 있다.
- 커밋 메시지·파일 머리말에 "바이트 동일" · "두 줄만 치환" 같은 문구를 쓰려 한다.
- 그 축의 계약 테스트가 파일명을 **상수로 고정**해서 읽는다(`const X_FILE = '2026....sql'`).

## The Approach

### 1. 재정의 체크리스트 — 본문 뒤 문장을 세라

`$$;` 뒤에 오는 것 전부가 함수와 **한 몸**이다. 옮길 때 함께 옮긴다:
`revoke` · `grant execute` · `comment on function` · `alter function ... owner` · 관련 트리거 재생성.

멱등이므로 중복 적용은 안전하다 — **의심되면 넣어라.**

### 2. 권한 단언은 **최신 정의 파일**을 읽어야 한다

핵심 함정: 본문만 잘라 주는 헬퍼(`effectiveFunctionBody` 류)는 `$$;` 까지만 반환하므로
**본문 뒤 문장이 애초에 반환값에 없다.** 최신 정의를 담은 파일의 **전문**을 읽는 별도 헬퍼가 필요하다.

```ts
// 최신 정의를 담은 파일 전문(주석만 제거, 본문 절단 없음)
function effectiveDefinitionFile(name: string): string {
  const { file } = effectiveFunctionBody(name);          // 마지막 정의가 있는 파일명
  const hit = migrationsInOrder().find((m) => m.file === file);
  if (hit === undefined) throw new Error(`${file} 을 다시 찾지 못했습니다`);
  return stripLineComments(hit.sql);
}
```

⚠️ **파일명을 상수로 고정한 헬퍼로 권한을 재지 마라.** 그 형태가 이 결함을 못 보게 만든 원인이다.

### 3. 원격에서는 `has_function_privilege` 로 재라 — 유일한 물증이다

DDL 텍스트 대조와 **독립된 축**이다. 네 role 전부 확인하고, 특히 `'public'` 을 빠뜨리지 마라.
`public=False` 가 "회수가 실제로 올라갔다" 는 유일한 관측이다(누락 시 증상 0 이므로).

### 4. 뮤테이션으로 관측면을 검증하라

회수 줄을 지우고 테스트가 **빨개지는지** 확인한다. 안 빨개지면 관측면이 여전히 잘못된 파일을
보고 있는 것이다. 이 축은 증상이 0 이라 뮤테이션 없이는 관측면의 정확성을 확인할 방법이 없다.

### 5. 제약 교체는 **이름을 가정하지 말고 자기 치유형으로**

같은 부류의 함정이다. `drop constraint if exists <기본생성명>` 은 PG 작명을 가정한다. 다른 이름
이면 drop 이 no-op 하고 add 가 제약을 *추가*해 **둘 공존** → 옛 제약이 새 라벨을 거부 →
fail-closed 핸들러가 앵커까지 지우고 warning 하나 → **지급률이 조용히 0%**.

`pg_constraint` 를 돌며 그 컬럼을 참조하는 check 를 **이름 무관하게 전부** 걷어낸 뒤 정본 하나를
세워라. "개수 세서 exception" 은 ①자기 치유 안 됨 ②그 컬럼을 언급하는 복합 check 가 추가되면
정상 상태에서도 거짓 중단 — 지우고 다시 세우는 편이 둘을 함께 없앤다.

### 6. enum/check 로 닫힌 컬럼에 새 값을 쓸 때

**제약 확장을 같은 마이그레이션에** 넣어라. 그리고 그 update 가 실패하면 어떻게 되는지 먼저
물어라 — 서브트랜잭션 `exception when others` 핸들러가 있으면 **앵커 행까지 롤백**되고 증상이
warning 하나뿐이다(= 조용한 0%).

## Example — 재적용으로 첫 적용을 확증한다

적용 스크립트의 전제 조건에 "이미 적용됐나" 를 넣어 두면, 1차 실행이 검증기 버그로 죽었을 때
**2차 실행의 `already_*=True` 전이가 첫 적용 성립의 증거**가 된다. 실제로 이렇게 확증했다.

```
1차: [OK] already_gated=False  → 적용 → 검증기(프로브)가 죽음
2차: [OK] already_gated=True   → 이 전이가 1차 적용이 성립했다는 물증
```
