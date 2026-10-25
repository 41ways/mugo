/* 첫 화면 — 밤기차 객실.
   창밖은 제미나이 그림 조각(img/scn)을 한 번 열 때마다 새 씨앗으로 늘어놓아
   같은 길이 되풀이되지 않는다. 언덕·호수·들 파노라마가 뒤집혀 가며 이어지고,
   가까이로 숲·울타리·돌집·전봇대가, 가끔 터널·철교·간이역·마주 오는 기차·비가 지나간다.
   객실은 레일 이음매마다 덜컹이고, 좌우로 기울고, 굽은 길에서 쏠린다.
   창밖은 객실과 반대로 수평을 지켜서 진짜로 차 안에 앉은 것처럼 보인다. */
(function () {
  'use strict';
  const IW = 1376, IH = 768, A = IW / IH;
  const WIN = { x: 378, y: 175, w: 408, h: 313 };   // 그림 속 유리창(둘레를 조금 넉넉히)
  const LAMP = { x: 246, y: 372 };                     // 벽 등잔
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 소음 — 씨앗이 매번 달라서 길이 매번 다르다 ── */
  const SEED = (Math.random() * 2147483647) | 0;
  function hash(i) {
    let h = (i | 0) ^ SEED;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, k) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const a = hash(i * 7919 + k * 104729), b = hash((i + 1) * 7919 + k * 104729);
    return a + (b - a) * u;
  }
  const rnd = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  let root, car, cv, cx, room, lamp, sweep, dim, sky;
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, alive = false;

  // 속도 단위는 "창 높이/초". 가까운 것일수록 빠르다.
  const V = { far: 0.022, mid: 0.26, near: 1.15, pole: 1.9 };
  const S = {
    t: 0, speed: 1, far: rnd() * 40, mid: rnd() * 400, near: rnd() * 4000, pole: rnd() * 4000,
    evs: [], nextEv: 4 + rnd() * 4, lastKind: '',
    rain: 0, rainUntil: 0, drops: [],
    lean: 0, leanT: 0, nextLean: 8 + rnd() * 8,
    light: 0, lightX: 0.5, dark: 0, flick: 1,
    sw: { roll: 0, pitch: 0, yaw: 0, tx: 0, ty: 0 },
  };

  /* ── 객실 흔들림 ── */
  // 레일 이음매 하나를 넘을 때의 덜컥 — 짧게 튀고 금방 잦아든다
  const kick = (x) => (x < 0 ? 0 : Math.exp(-x * 16) * Math.sin(x * 38));
  function sway(dt) {
    const t = S.t, sw = S.sw;
    if (still) { sw.roll = sw.pitch = sw.yaw = sw.tx = sw.ty = 0; return; }
    // 굽은 길 — 가끔 한쪽으로 천천히 쏠렸다가 돌아온다
    if (t > S.nextLean) {
      S.leanT = rnd() < 0.35 ? 0 : (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.75);
      S.nextLean = t + 9 + rnd() * 14;
    }
    S.lean += (S.leanT - S.lean) * Math.min(1, dt * 0.45);
    // 바퀴 두 쌍이 차례로 이음매를 넘는다: 덜컥-덜컥 … 덜컥-덜컥
    const P = 1.08 / S.speed, ph = t % P, ph2 = (t + P * 0.5) % P;
    const j = kick(ph) + 0.75 * kick(ph - 0.15) + 0.35 * (kick(ph2) + 0.75 * kick(ph2 - 0.15));
    const jitter = (noise(t * 9, 21) - 0.5) * 0.6;   // 잔떨림
    sw.roll = S.lean + 0.34 * Math.sin(t * 0.83) + 0.17 * Math.sin(t * 1.91 + 1.3) + 0.22 * (noise(t * 0.5, 22) - 0.5) + j * 0.12;
    sw.pitch = 0.32 * Math.sin(t * 0.61 + 0.5) + 0.12 * Math.sin(t * 2.3) + j * 0.35;
    sw.yaw = 0.42 * Math.sin(t * 0.37) + 0.2 * (noise(t * 0.4, 23) - 0.5) + S.lean * 0.3;
    sw.tx = 4 * Math.sin(t * 0.31) + 2 * (noise(t * 0.7, 24) - 0.5) - S.lean * 5;
    sw.ty = j * 4.4 + 1.4 * Math.sin(t * 2.05) + jitter;
  }

  /* ── 창밖 그림 조각 (tools/scenery.py 가 raw/ 제미나이 그림에서 만든다) ── */
  const IMG = {};
  const PARTS = ['mid_hills', 'mid_lake', 'mid_moor', 'grass', 'pine', 'bare', 'cottage', 'pole', 'fence', 'hay',
    'lamp', 'man', 'sign', 'station', 'bridge', 'train', 'rock0', 'rock1'];
  const SEAM = 170 / 1584;                    // 파노라마 양끝을 녹여 둔 폭(비율)
  const ok = (im) => im && im.complete && im.naturalWidth > 0;
  function loadParts() {
    for (const n of PARTS) { const im = new Image(); im.src = 'img/scn/' + n + '.webp'; IMG[n] = im; }
  }
  // 그림 하나를 바닥 기준으로 세운다. hh 는 창 높이 비율, flip 이면 좌우를 뒤집는다.
  function spr(im, x, base, hh, flip) {
    if (!ok(im)) return 0;
    const h = H * hh, w = (h * im.naturalWidth) / im.naturalHeight;
    if (flip) { cx.save(); cx.translate(x, 0); cx.scale(-1, 1); cx.drawImage(im, -w / 2, base - h, w, h); cx.restore(); }
    else cx.drawImage(im, x - w / 2, base - h, w, h);
    return w;
  }

  // 중간 거리: 언덕·호수·들 파노라마를 무작위로 (뒤집기도 섞어) 이어 붙인다
  const MID_H = 0.6, MID_Y = 0.47;
  const midTiles = [];
  function midTile(prev) {
    const opts = [];
    for (const n of ['mid_hills', 'mid_lake', 'mid_moor']) for (const f of [false, true]) {
      if (!prev || n !== prev.n) opts.push([n, f]);
    }
    const pick = opts[(rnd() * opts.length) | 0], n = pick[0], flip = pick[1];
    const im = IMG[n], w = ok(im) ? (MID_H * im.naturalWidth) / im.naturalHeight : 2.6;
    return { n, flip, w, x: prev ? prev.x + prev.w * (1 - SEAM) : S.mid - 1 };
  }
  // 가까운 둑 풀숲 띠 — 한 장을 뒤집어 가며 잇는다
  const GR_H = 0.36;

  /* ── 창밖: 구간 ── */
  // 가까운 땅의 성격 — 숲 · 들 · 마을 · 탁 트인 곳 이 길게 번갈아 나온다
  const zone = (wx) => noise(wx / 10, 1) * 0.75 + noise(wx / 3.3, 7) * 0.25;
  const kindOf = (z) => (z < 0.33 ? 'open' : z < 0.52 ? 'field' : z < 0.7 ? 'forest' : 'town');

  /* ── 끼어드는 일들 ── */
  const STATIONS = ['안개곶', '북포', '등대목', '갯골', '서항', '물푸레'];
  const KINDS = { tunnel: 1, bridge: 1, station: 1, passing: 1, rain: 0.8 };
  function spawn() {
    const pool = Object.keys(KINDS).filter((k) => k !== S.lastKind && !(k === 'rain' && S.t < S.rainUntil));
    let sum = pool.reduce((a, k) => a + KINDS[k], 0), r = rnd() * sum, kind = pool[0];
    for (const k of pool) { r -= KINDS[k]; if (r <= 0) { kind = k; break; } }
    S.lastKind = kind;
    S.nextEv = S.t + 7 + rnd() * 9;
    if (kind === 'rain') { S.rainUntil = S.t + 14 + rnd() * 14; return; }
    const ev = { kind, x: W / H + 0.6, seed: (rnd() * 1e6) | 0, v: V.pole };
    if (kind === 'tunnel') ev.len = 6 + rnd() * 4;
    if (kind === 'bridge') ev.len = 4 + 2 * ((rnd() * 3) | 0);
    if (kind === 'station') {
      ev.len = 6.5; ev.name = STATIONS[(rnd() * STATIONS.length) | 0];
      ev.who = rnd() < 0.55 ? 1.25 + ((rnd() * 3) | 0) * 1.6 : -1;   // 승강장에 누가 서 있기도 하다
    }
    if (kind === 'passing') { ev.len = 8 + rnd() * 6; ev.v = 7.5; }
    S.evs.push(ev);
  }
  const busy = () => S.evs.length > 0;

  /* ── 그리기 ── */
  function warm(x, y, r, a) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,205,135,' + a + ')');
    g.addColorStop(0.35, 'rgba(240,160,80,' + a * 0.35 + ')');
    g.addColorStop(1, 'rgba(240,160,80,0)');
    cx.fillStyle = g;
    cx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function addLight(sx, a) {
    const k = clamp(1 - Math.abs(sx / W - 0.5) * 1.6, 0, 1) * a;
    if (k <= 0) return;
    S.lightX = (S.lightX * S.light + (sx / W) * k) / (S.light + k);
    S.light += k;
  }
  function flipDraw(im, x, y, w, h, flip) {
    if (!flip) { cx.drawImage(im, x, y, w, h); return; }
    cx.save(); cx.translate(x + w, 0); cx.scale(-1, 1); cx.drawImage(im, 0, y, w, h); cx.restore();
  }

  function paint() {
    const w = W, h = H, c = cx, sw = S.sw;
    const L = -w * 0.1, R = w * 1.1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0d0b09';
    c.fillRect(0, 0, w, h);
    c.save();
    // 객실이 기울면 바깥은 그 반대로 — 수평선은 제자리
    c.translate(w / 2, h / 2);
    c.rotate((-sw.roll * Math.PI) / 180);
    c.translate(-w / 2, -h / 2 - sw.ty * 0.7 + sw.pitch * 2);
    S.light = 0; S.dark = 0;

    // 먼 하늘·바다
    if (ok(sky)) {
      const dh = h * 1.25, dw = (sky.naturalWidth * dh) / sky.naturalHeight;
      let x = -((S.far * h) % dw);
      while (x > L) x -= dw;
      for (; x < R; x += dw) c.drawImage(sky, x, -h * 0.09, dw + 1, dh);
    }
    if (S.rain > 0) { c.fillStyle = 'rgba(8,8,9,' + 0.35 * S.rain + ')'; c.fillRect(L, -h, R - L, h * 3); }

    // 중간 거리 파노라마
    while (midTiles.length && midTiles[0].x + midTiles[0].w < S.mid + L / h) midTiles.shift();
    if (!midTiles.length) midTiles.push(midTile(null));
    while (midTiles[midTiles.length - 1].x + midTiles[midTiles.length - 1].w < S.mid + R / h + 0.2) midTiles.push(midTile(midTiles[midTiles.length - 1]));
    for (const t of midTiles) {
      const im = IMG[t.n];
      if (ok(im)) flipDraw(im, (t.x - S.mid) * h, MID_Y * h, t.w * h, MID_H * h, t.flip);
    }

    // 안개 — 짙어졌다 옅어졌다
    const fogA = 0.06 + 0.22 * noise(S.mid * 0.12 + S.t * 0.02, 6) + 0.16 * S.rain;
    let g = c.createLinearGradient(0, h * 0.45, 0, h * 0.95);
    g.addColorStop(0, 'rgba(150,136,116,0)');
    g.addColorStop(0.5, 'rgba(150,136,116,' + fogA + ')');
    g.addColorStop(1, 'rgba(150,136,116,0)');
    c.fillStyle = g; c.fillRect(L, h * 0.45, R - L, h * 0.5);

    // 철교 위에서는 가까운 둑이 없다 — 그 구간은 가린다
    const gaps = S.evs.filter((ev) => ev.kind === 'bridge').map((ev) => [ev.x * h, (ev.x + ev.len) * h]);
    c.save();
    if (gaps.length) {
      c.beginPath();
      let from = L - h;
      for (const [a, b] of gaps.sort((p, q) => p[0] - q[0])) { if (a > from) c.rect(from, -h, a - from, h * 3); from = Math.max(from, b); }
      c.rect(from, -h, R + h - from, h * 3);
      c.clip();
    }

    // 가까운 것들: 숲의 전나무·마른 나무, 들의 울타리·짚더미, 마을의 돌집
    const base = h * 0.93;
    const nc = 0.32, n0 = Math.floor((S.near + L / h) / nc) - 3, n1 = Math.ceil((S.near + R / h) / nc) + 3;
    for (let i = n0; i <= n1; i++) {
      const wx = i * nc + hash(i * 7 + 1) * nc * 0.5, k = kindOf(zone(wx));
      const x = (wx - S.near) * h, r1 = hash(i * 7 + 2), r2 = hash(i * 7 + 3), flip = hash(i * 7 + 4) < 0.5;
      if (k === 'forest') {
        if (r1 < 0.62) spr(IMG.pine, x, base + h * 0.04, 1.0 + 0.5 * r2, flip);
        else if (r1 < 0.78) spr(IMG.bare, x, base + h * 0.04, 0.8 + 0.35 * r2, flip);
      } else if (k === 'field') {
        spr(IMG.fence, x, base, 0.2, flip);
        if (r1 < 0.09) spr(IMG.hay, x + h * 0.1, base + h * 0.03, 0.24 + 0.06 * r2, flip);
      } else if (k === 'town') {
        if (((i % 3) + 3) % 3 === 0 && r1 < 0.7) spr(IMG.cottage, x, base + h * 0.02, 0.5 + 0.14 * r2, flip);
        else if (((i % 3) + 3) % 3 === 1 && r1 < 0.25) spr(IMG.bare, x, base + h * 0.04, 0.75 + 0.3 * r2, flip);
      } else if (r1 < 0.07) spr(IMG.bare, x, base + h * 0.04, 0.7 + 0.3 * r2, flip);
    }
    // 둑 풀숲
    const gi = IMG.grass;
    if (ok(gi)) {
      const gw = (GR_H * gi.naturalWidth) / gi.naturalHeight, step = gw * 0.97;
      const k0 = Math.floor((S.near + L / h) / step), k1 = Math.ceil((S.near + R / h) / step);
      for (let k = k0; k <= k1; k++) {
        const y = h * (1.02 - GR_H) + hash(k * 11 + 5) * h * 0.03;
        flipDraw(gi, (k * step - S.near) * h, y, gw * h, GR_H * h, hash(k * 11 + 6) < 0.5);
      }
    }
    c.restore();

    // 끼어드는 일들 뒤쪽(역 건물·승강장, 철교)
    for (const ev of S.evs) drawEvent(ev, true);

    // 전봇대와 늘어진 전깃줄 — 지나갈 때마다 줄이 오르내린다
    const PH = 1.3, PY = -0.06;   // 전봇대 높이와 꼭대기 자리(창 높이 비율)
    const pc = 1.35, p0 = Math.floor((S.pole + L / h) / pc) - 1, p1 = Math.ceil((S.pole + R / h) / pc) + 1;
    const poleX = (k) => (k * pc + (hash(k * 3 + 900) - 0.5) * 0.35 - S.pole) * h;
    const blocked = (sx) => S.evs.some((ev) => ev.kind !== 'passing' && sx > (ev.x - 0.7) * h && sx < (ev.x + ev.len + 0.7) * h);
    const pw = ok(IMG.pole) ? (PH * h * IMG.pole.naturalWidth) / IMG.pole.naturalHeight : h * 0.4;
    const arms = [PY + PH * 0.13, PY + PH * 0.355];
    c.strokeStyle = 'rgba(14,12,10,.85)'; c.lineWidth = Math.max(1, h * 0.004);
    c.beginPath();
    for (let k = p0; k < p1; k++) {
      const a = poleX(k), b = poleX(k + 1);
      if (blocked(a) || blocked(b)) continue;
      for (const ay of arms) for (const dx of [-0.05, 0.04]) {   // 옆에서 보면 한 가로대의 줄들은 거의 겹친다
        c.moveTo(a + dx * pw, h * ay); c.quadraticCurveTo((a + b) / 2 + dx * pw, h * (ay + 0.15 + dx * 0.4), b + dx * pw, h * ay);
      }
    }
    c.stroke();
    for (let k = p0; k <= p1; k++) {
      const a = poleX(k);
      if (!blocked(a)) spr(IMG.pole, a, h * (PY + PH), PH, false);
    }

    // 끼어드는 일들 앞쪽(터널, 역 등·사람, 마주 오는 기차)
    for (const ev of S.evs) drawEvent(ev, false);

    // 전체를 객실 사진 톤으로 한 번 누른다
    c.fillStyle = 'rgba(14,10,6,.18)';
    c.fillRect(L, -h, R - L, h * 3);
    c.restore();

    // 유리 — 빗방울, 등잔 반사, 가장자리 어둠 (유리는 객실과 같이 움직인다)
    if (S.rain > 0.02) {
      c.strokeStyle = 'rgba(200,188,165,' + 0.3 * S.rain + ')'; c.lineWidth = 1;
      c.beginPath();
      for (const d of S.drops) { c.moveTo(d.x, d.y); c.lineTo(d.x + d.l, d.y - d.l * 0.28); }
      c.stroke();
    }
    warm(w * 0.05, h * 0.62, h * 0.5, 0.09 * S.flick);
    g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }

  function drawEvent(ev, back) {
    const c = cx, h = H, w = W, x0 = ev.x * h, x1 = (ev.x + ev.len) * h;
    if (x1 < -w * 0.3 || x0 > w * 1.3) return;
    const cover = clamp((Math.min(x1, w) - Math.max(x0, 0)) / w, 0, 1);
    if (ev.kind === 'tunnel') {
      if (back) return;
      c.fillStyle = '#030202';
      c.fillRect(x0, -h * 0.3, x1 - x0, h * 1.6);
      // 들어갈 때와 나올 때 스치는 바위 벽
      if (ok(IMG.rock0) && ok(IMG.rock1)) {
        const rh = h * 1.6;
        const wall = (from, dir) => {   // dir 1: 입구에서 안으로, -1: 출구에서 안으로
          let x = from, edge = from;
          for (let i = 0; i < 4; i++) {
            const rk = IMG['rock' + ((ev.seed + i) % 2)], rw = (rh * rk.naturalWidth) / rk.naturalHeight;
            flipDraw(rk, dir > 0 ? x : x - rw, -h * 0.3, rw, rh, (ev.seed >> i) & 1);
            edge = x + dir * rw;
            x += dir * rw * 0.92;
          }
          // 바위가 끝나는 곳은 어둠 속으로 녹인다
          const fade = h * 0.5, a = dir > 0 ? edge - fade : edge, gr = c.createLinearGradient(a, 0, a + fade, 0);
          gr.addColorStop(dir > 0 ? 0 : 1, 'rgba(3,2,2,0)');
          gr.addColorStop(dir > 0 ? 1 : 0, 'rgba(3,2,2,1)');
          c.fillStyle = gr; c.fillRect(a, -h * 0.3, fade, h * 1.6);
        };
        wall(x0 - h * 0.25, 1);
        wall(x1 + h * 0.25, -1);
      }
      for (let lx = x0 + h * 1.4; lx < x1 - h * 0.9; lx += h * 1.45) {   // 굴 안 등이 휙휙 지나간다
        warm(lx, h * 0.26, h * 0.34, 0.45);
        c.save(); c.translate(lx, h * 0.26); c.scale(4.5, 1);   // 빨리 지나가 가로로 번진 등불
        warm(0, 0, h * 0.035, 0.95);
        c.restore();
        addLight(lx, 0.35);
      }
      S.dark = Math.max(S.dark, cover);
    } else if (ev.kind === 'bridge') {
      if (!back) return;
      const im = IMG.bridge;
      if (!ok(im)) return;
      const bh = h * 1.12, bw = (bh * im.naturalWidth) / im.naturalHeight;
      for (let bx = x0; bx < x1 - 1; bx += bw * 0.985) c.drawImage(im, bx, -h * 0.06, bw, bh);
      S.dark = Math.max(S.dark, cover * 0.25);
    } else if (ev.kind === 'station') {
      const st = IMG.station;
      if (back) {
        if (!ok(st)) return;
        const sh = h * 0.78, sw2 = (sh * st.naturalWidth) / st.naturalHeight, top = h * 1.02 - sh, k = sh / st.naturalHeight;
        // 승강장 — 역 그림 왼쪽의 빈 승강장 부분을 이어 깐다
        const sy = st.naturalHeight * 0.76, sW = st.naturalWidth * 0.33, sH = st.naturalHeight - sy;
        for (let px = x0; px < x1; px += sW * k * 0.98) c.drawImage(st, 0, sy, sW, sH, px, top + sy * k, sW * k, sH * k);
        const bx = x0 + h * 2.1;
        c.drawImage(st, bx, top, sw2, sh);
        // 이름판 — 비어 있는 판에 역 이름을 쓴다
        const sg = IMG.sign;
        if (ok(sg)) {
          const gh = h * 0.3, gw = (gh * sg.naturalWidth) / sg.naturalHeight, gx = bx - gw * 0.55, gy = top + sh * 0.18;
          c.drawImage(sg, gx, gy, gw, gh);
          c.fillStyle = 'rgba(214,196,160,.78)';
          c.font = '700 ' + Math.round(gh * 0.2) + "px 'Nanum Myeongjo','Noto Serif KR',serif";
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(ev.name, gx + gw * 0.53, gy + gh * 0.74);
        }
        return;
      }
      for (let lx = x0 + h * 0.5; lx < x1; lx += h * 1.6) {
        warm(lx, h * 0.3, h * 0.5, 0.5);
        spr(IMG.lamp, lx, h * 0.98, 0.72, false);
        addLight(lx, 0.9);
      }
      if (ev.who > 0) spr(IMG.man, x0 + ev.who * h, h * 0.97, 0.5, true);   // 등 밑에 선 사람
    } else if (ev.kind === 'passing') {
      if (back) return;
      const im = IMG.train;
      if (!ok(im)) return;
      const th = h * 0.8, tw = (th * im.naturalWidth) / im.naturalHeight;
      for (let tx = x0; tx < x1; tx += tw * 1.02) {
        c.drawImage(im, tx, h * 0.17, tw, th);
        for (let m = 0; m < 6; m++) addLight(tx + tw * (0.15 + m * 0.14), 0.12);
      }
      S.dark = Math.max(S.dark, cover * 0.55);
    }
  }

  /* ── 한 틀 ── */
  function frame(dt) {
    dt = Math.min(dt, 0.05);
    S.t += dt;
    const target = 1 + 0.12 * Math.sin(S.t * 0.07) + 0.05 * Math.sin(S.t * 0.23);
    S.speed += (target - S.speed) * Math.min(1, dt);
    const v = S.speed * (still ? 0.35 : 1);
    S.far += V.far * v * dt; S.mid += V.mid * v * dt; S.near += V.near * v * dt; S.pole += V.pole * v * dt;

    for (const ev of S.evs) ev.x -= ev.v * v * dt;
    S.evs = S.evs.filter((ev) => ev.x + ev.len > -0.5);
    if (S.t > S.nextEv && !busy()) spawn();

    // 비 — 들이치고 그치는 것도 천천히
    S.rain += ((S.t < S.rainUntil ? 1 : 0) - S.rain) * Math.min(1, dt * 0.4);
    const want = Math.round(70 * S.rain);
    while (S.drops.length < want) S.drops.push({ x: rnd() * W * 1.2, y: rnd() * H, l: -(6 + rnd() * 16), vx: -(W * (0.25 + rnd() * 0.4)), vy: H * (0.05 + rnd() * 0.08) });
    if (S.drops.length > want) S.drops.length = want;
    for (const d of S.drops) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.x < -30 || d.y > H + 10) { d.x = W + rnd() * 40; d.y = rnd() * H * 0.9; }
    }

    // 등잔은 잔잔히 일렁이다 가끔 숨을 죽인다
    S.flick = 0.82 + 0.12 * noise(S.t * 7, 11) + 0.06 * noise(S.t * 19, 12) - (noise(S.t * 0.9, 13) > 0.86 ? 0.18 : 0);

    sway(dt);
    paint();

    const sw = S.sw;
    car.style.transform =
      `translate3d(${sw.tx.toFixed(2)}px,${sw.ty.toFixed(2)}px,0) rotateX(${sw.pitch.toFixed(3)}deg) rotateY(${sw.yaw.toFixed(3)}deg) rotateZ(${sw.roll.toFixed(3)}deg)`;
    lamp.style.opacity = S.flick.toFixed(3);
    sweep.style.opacity = clamp(S.light * 0.9, 0, 1).toFixed(3);
    sweep.style.setProperty('--gx', (22 + S.lightX * 52).toFixed(1) + '%');
    dim.style.opacity = (S.dark * 0.28).toFixed(3);
  }
  function loop(now) {
    if (!alive) return;
    const dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    frame(dt);
    raf = requestAnimationFrame(loop);
  }

  /* ── 자리 잡기 ── */
  function layout() {
    const vw = innerWidth, vh = innerHeight;
    const tall = vw / vh < 0.9;
    root.classList.toggle('tall', tall);
    let cw, ch, left, top;
    if (tall) {
      // 세로 화면: 창과 탐정이 같이 보이게 위쪽에 크게 걸고, 아래는 어둠에 글을 놓는다
      cw = vw * 1.62; ch = cw / A;
      left = clamp(vw / 2 - 0.55 * cw, vw - cw + 8, -8);
      top = vh * 0.07;
    } else {
      // 아래쪽에 제목 자리가 남도록 조금 더 키워 창을 위로 올린다(천장은 어두워서 잘려도 된다)
      ch = Math.max(Math.max(vw, vh * A) * 1.07 / A, vh * 1.14); cw = ch * A;
      const fx = vw / vh < 1.35 ? 0.57 : 0.5, m = Math.min(cw - vw, ch - vh) * 0.3;
      left = clamp(vw / 2 - fx * cw, vw - cw + m, -m);
      top = clamp(vh * 0.54 - 0.63 * ch, vh - ch + m, -m);
    }
    Object.assign(car.style, { width: cw + 'px', height: ch + 'px', left: left + 'px', top: top + 'px' });
    const s = cw / IW;
    W = WIN.w * s; H = WIN.h * s;
    Object.assign(cv.style, { left: WIN.x * s + 'px', top: WIN.y * s + 'px', width: W + 'px', height: H + 'px' });
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (!alive) paint();
  }

  function start() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'cover';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="cam"><div class="car"><canvas></canvas><img alt="" src="img/title_room.webp">' +
      `<i class="lamp" style="left:${(LAMP.x / IW) * 100}%;top:${(LAMP.y / IH) * 100}%"></i>` +
      '<i class="sweep"></i><i class="dim"></i></div></div><div class="shade"></div>';
    document.body.insertBefore(root, document.getElementById('stage'));
    document.body.classList.add('on-cover');
    car = root.querySelector('.car'); cv = root.querySelector('canvas'); cx = cv.getContext('2d');
    room = root.querySelector('img'); lamp = root.querySelector('.lamp'); sweep = root.querySelector('.sweep'); dim = root.querySelector('.dim');
    sky = new Image(); sky.src = 'img/title_scenery.webp';
    loadParts();
    layout();
    addEventListener('resize', layout);
    const show = () => requestAnimationFrame(() => root && root.classList.add('on'));
    if (room.complete) show(); else { room.onload = show; room.onerror = show; }
    alive = true; last = 0;
    raf = requestAnimationFrame(loop);
  }

  // 시작을 누르면 창 쪽으로 다가가며 어두워진다
  function stop() {
    if (!root) return Promise.resolve();
    const r = root;
    root = null;
    document.body.classList.remove('on-cover');
    removeEventListener('resize', layout);
    r.classList.add('leave');
    return new Promise((done) => setTimeout(() => {
      alive = false; cancelAnimationFrame(raf);
      r.remove();
      done();
    }, still ? 200 : 1100));
  }

  window.TrainCover = { start, stop, _frame: (dt) => frame(dt), _state: S };
})();
