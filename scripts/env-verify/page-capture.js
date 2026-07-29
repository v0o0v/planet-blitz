/**
 * env-verify 페이지 캡처 스니펫 — 브라우저 콘솔/`javascript_tool` 에 붙여 넣어 쓴다.
 *
 * ## 왜 이 순서가 강제인가
 * 전부 실제로 오판을 만든 항목이다(앞의 셋은 카르곤 AAA 레인, 뒤의 둘은 이 레인 첫 촬영).
 *
 *  1. **품질 티어 고정**: 하네스를 일시정지·스텝으로 쓰면 FPS 계측이 10 근처로 잡혀 티어가
 *     `low` 로 강등되고 발광 게이트가 통째로 꺼진다. 그 화면을 보고 "발광이 없다"고 판정하면
 *     안 된다. 캡처 직전 `quality: 'high'` 로 고정하고, **되읽어서** 반영을 확인한다.
 *  2. **탭 포그라운드**: 백그라운드 탭은 rAF 가 1Hz 로 throttle 된다. `visibilityState` 를
 *     결과에 실어 보내 사후에 확인할 수 있게 한다.
 *  3. **캔버스 합성 결과를 읽는다**: `renderer.extract` 는 대상 컨테이너만 뽑아 월드 오버레이를
 *     빠뜨린 전례가 있다. 화면에 실제로 나온 것을 재려면 `app.canvas.toDataURL()` 이다.
 *  4. **`requestAnimationFrame` 을 await 하지 마라**: in-app Browser pane 은 `visibilityState`
 *     가 `hidden` 이라 rAF 콜백이 **영영 불리지 않는다**. await 하면 그대로 교착한다.
 *     `ticker.update()` + `renderer.render()` 를 직접 두 번 돌려 텍스처 업로드 지연분까지 반영한다.
 *  5. **UI 를 반드시 내린다**: `ff` 중 오토파일럿이 레벨업하면 파워업 선택 오버레이(목재 패널)가
 *     화면 83%를 덮는다. 그 상태로 찍으면 명도·격자·위장 세 지표가 전부 **패널**을 잰다.
 *     `post` 슬롯보다 뒤에 있는 stage 자식을 전부 숨긴다(레이블이 없으므로 인덱스가 아니라
 *     `env.slot('post')` 객체 동일성으로 경계를 잡는다).
 *  6. **PNG 를 서버로 보낸다**: data URL 을 반환값으로 실어 나르면 수 MB 라 컨텍스트가 터진다.
 *     `shot-server.mjs` 로 POST 하고 반환값은 요약 JSON 뿐이다.
 *
 * ## 모드
 *  - `mode: 'bg'`(기본) — 엔티티까지 숨긴 **순수 배경**. 지표 판정용. 위장 지표가 적 스프라이트
 *    자체를 세지 않으려면 이쪽이어야 한다.
 *  - `mode: 'full'` — UI 만 숨김. 육안 검토용.
 *
 * ## 사용 예
 *   await __envShot({ name: 'kargon-s1-bg', planet: 0, seed: 1, ticks: 900, mode: 'bg' })
 *   await __envShot({ name: 'kargon-s1-full', mode: 'full' })   // 같은 런에서 이어 찍기
 *
 * `planet`/`seed` 를 주면 새 런을 시작하고, 생략하면 현재 런 상태 그대로 찍는다.
 *
 * ## solo 비교는 반드시 일시정지하고 찍어라
 * `ticker.update()` 가 sim 을 전진시키므로 촬영마다 틱이 밀린다(실측 8~9틱). 레이어별 기여도는
 * 같은 틱이어야 의미가 있다:
 *
 *   __pb.harness.ff(900, { autopilot: true }); __pb.harness.pause();
 *   await __envShot({ name: 'solo-none', solo: '__none__' });
 *   for (const n of __pb.env.activeNames) await __envShot({ name: 'solo-' + n, solo: n });
 *   __pb.harness.resume();
 */
(() => {
  const SHOT_URL = 'http://127.0.0.1:5181/shot';

  /** 한 프레임을 확실히 그린다. hidden pane·일시정지에서도 합성 결과가 갱신되게 강제한다. */
  function forceFrame(app) {
    app.ticker.update(performance.now());
    app.renderer.render(app.stage);
  }

  window.__envShot = async function __envShot(opts) {
    const o = opts ?? {};
    const pb = window.__pb;
    if (!pb) throw new Error('__pb 없음 — dev 빌드가 아니거나 ?harness=1 누락');
    const app = pb.gameApp?.app;
    if (!app) throw new Error('__pb.gameApp.app 없음');
    const root = app.stage.children[0];

    // (1) 품질 티어 고정 — 이걸 빼면 발광이 꺼진 화면을 재게 된다.
    let quality = null;
    try {
      pb.graphicsSettings.set({ quality: 'high' });
      quality = pb.graphicsSettings.getSettings().quality;
    } catch (e) {
      quality = `ERR:${String(e)}`;
    }

    // (2) 런 시작(요청 시). solo 비교는 런을 다시 시작하면 안 되므로 planet 생략이 기본이다.
    if (o.planet !== undefined || o.seed !== undefined) {
      pb.harness.startRun({
        seed: o.seed ?? 1,
        planet: o.planet ?? 0,
        ...(o.tier !== undefined ? { tier: o.tier } : {}),
      });
      if (o.ticks) pb.harness.ff(o.ticks, { autopilot: true });
    }

    // (3) 레이어 solo 토글. null 이면 활성 전부 복원, '__none__' 이면 전부 끔.
    if (o.solo !== undefined) pb.env.solo(o.solo === '__none__' ? ' none ' : o.solo);

    // (4) 배경만 남긴다. stage 자식에 레이블이 없으므로 `post` 슬롯 객체로 경계를 잡는다.
    const postIdx = root.children.indexOf(pb.env.slot('post'));
    const entities = pb.entityRenderer.layer;
    const mode = o.mode ?? 'bg';
    const saved = root.children.map((c) => c.visible);
    root.children.forEach((c, i) => {
      if (i > postIdx) c.visible = false;
      if (mode === 'bg' && c === entities) c.visible = false;
    });

    forceFrame(app);
    forceFrame(app);
    const dataUrl = app.canvas.toDataURL('image/png');

    // 반드시 복원한다 — 안 하면 이후 촬영과 사용자 플레이가 UI 없는 화면이 된다.
    root.children.forEach((c, i) => { c.visible = saved[i]; });
    forceFrame(app);

    const res = await fetch(`${SHOT_URL}?name=${encodeURIComponent(o.name ?? 'shot')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: dataUrl,
    });
    const body = await res.json();
    const snap = pb.harness.snapshot();
    return {
      name: o.name ?? 'shot',
      ok: body.ok === true,
      bytes: body.bytes ?? 0,
      err: body.error ?? null,
      mode,
      quality,
      hiddenFrom: postIdx + 1,
      visibility: document.visibilityState,
      canvas: [app.canvas.width, app.canvas.height],
      solo: o.solo ?? null,
      envActive: pb.env.activeNames,
      tick: snap.tick,
      seed: snap.seed,
      screen: snap.screen,
    };
  };

  return 'ok: __envShot 등록됨';
})();
