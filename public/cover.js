/* 첫 화면 — 밤기차 객실.
   창밖은 한 번 열 때마다 새 씨앗으로 지어서 같은 길이 되풀이되지 않는다.
   먼 하늘·바다만 그림이고, 언덕·숲·마을·호수·전봇대와 가끔 끼어드는
   터널·철교·간이역·마주 오는 기차·비는 전부 여기서 그린다.
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
  const V = { far: 0.022, mid: 0.3, near: 1.15, pole: 1.9 };
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

  /* ── 창밖: 구간 ── */
  // 가까운 땅의 성격 — 호수 · 들 · 숲 · 마을 이 길게 번갈아 나온다
  const zone = (wx) => noise(wx / 10, 1) * 0.75 + noise(wx / 3.3, 7) * 0.25;
  const kindOf = (z) => (z < 0.33 ? 'lake' : z < 0.52 ? 'field' : z < 0.7 ? 'forest' : 'town');
  const groundY = (wx, k) => (k === 'lake' ? 0.95 : 0.83 + 0.05 * (noise(wx * 1.1, 2) - 0.5) * 2);
  const ridge = (mx) => 0.6 + 0.17 * (noise(mx * 0.5, 3) - 0.5) + 0.05 * (noise(mx * 2.3, 4) - 0.5);

  /* ── 끼어드는 일들 ── */
  const STATIONS = ['안개곶', '북포', '등대목', '갯골', '서항', '물푸레'];
  const KINDS = { tunnel: 1, bridge: 1, station: 1, passing: 1, rain: 0.8 };
  function spawn() {
    let pool = Object.keys(KINDS).filter((k) => k !== S.lastKind && !(k === 'rain' && S.t < S.rainUntil));
    let sum = pool.reduce((a, k) => a + KINDS[k], 0), r = rnd() * sum, kind = pool[0];
    for (const k of pool) { r -= KINDS[k]; if (r <= 0) { kind = k; break; } }
    S.lastKind = kind;
    S.nextEv = S.t + 7 + rnd() * 9;
    if (kind === 'rain') { S.rainUntil = S.t + 14 + rnd() * 14; return; }
    const ev = { kind, x: W / H + 0.3, seed: (rnd() * 1e6) | 0, v: V.pole };
    if (kind === 'tunnel') ev.len = 6 + rnd() * 4;
    if (kind === 'bridge') ev.len = 4.5 + rnd() * 3;
    if (kind === 'station') {
      ev.len = 6.5; ev.name = STATIONS[(rnd() * STATIONS.length) | 0];
      ev.who = rnd() < 0.55 ? 1.9 + ((rnd() * 3) | 0) * 1.6 : -1;   // 승강장에 누가 서 있기도 하다
    }
    if (kind === 'passing') { ev.len = 12 + rnd() * 8; ev.v = 7.5; }
    S.evs.push(ev);
  }
  const busy = () => S.evs.length > 0;

  /* ── 그리기 ── */
  function warm(x, y, r, a) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,205,135,${a})`);
    g.addColorStop(0.35, `rgba(240,160,80,${a * 0.35})`);
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

    // 먼 하늘·바다 (그림)
    if (sky && sky.complete && sky.naturalWidth) {
      const dh = h * 1.25, dw = (sky.naturalWidth * dh) / sky.naturalHeight;
      let x = -((S.far * h) % dw);
      while (x > L) x -= dw;
      for (; x < R; x += dw) c.drawImage(sky, x, -h * 0.09, dw, dh);
    }
    if (S.rain > 0) { c.fillStyle = `rgba(8,8,9,${0.35 * S.rain})`; c.fillRect(L, -h, R - L, h * 3); }

    // 먼 능선과 작은 나무들, 드문 불빛
    c.fillStyle = 'rgb(23,20,16)';
    c.beginPath(); c.moveTo(L, h * 1.2);
    for (let x = L; x <= R + 4; x += 4) c.lineTo(x, h * ridge(S.mid + x / h));
    c.lineTo(R, h * 1.2); c.fill();
    const cell = 0.045, i0 = Math.floor((S.mid + L / h) / cell), i1 = Math.ceil((S.mid + R / h) / cell);
    c.beginPath();
    for (let i = i0; i <= i1; i++) {
      const mx = i * cell + hash(i * 5 + 1) * cell * 0.6, dens = noise(mx * 0.35, 5);
      if (hash(i * 5 + 2) > dens * 1.4 - 0.3) continue;
      const x = (mx - S.mid) * h, y = h * ridge(mx) + 2, th = h * (0.025 + 0.05 * hash(i * 5 + 3)), tw = th * 0.36;
      c.moveTo(x - tw, y); c.lineTo(x, y - th); c.lineTo(x + tw, y);
    }
    c.fill();
    for (let i = i0; i <= i1; i++) {
      if (hash(i * 5 + 4) > 0.014) continue;
      const mx = i * cell, x = (mx - S.mid) * h, y = h * ridge(mx) - h * 0.008;
      const tw = 0.55 + 0.45 * noise(S.t * 3 + i, 25);
      warm(x, y, h * 0.03, 0.55 * tw);
    }

    // 안개 — 짙어졌다 옅어졌다
    const fogA = 0.1 + 0.28 * noise(S.mid * 0.12 + S.t * 0.02, 6) + 0.18 * S.rain;
    let g = c.createLinearGradient(0, h * 0.45, 0, h * 0.95);
    g.addColorStop(0, 'rgba(150,136,116,0)');
    g.addColorStop(0.5, `rgba(150,136,116,${fogA})`);
    g.addColorStop(1, 'rgba(150,136,116,0)');
    c.fillStyle = g; c.fillRect(L, h * 0.45, R - L, h * 0.5);

    // 가까운 땅
    const step = 3;
    let lakeMid = false;
    c.fillStyle = 'rgb(24,21,18)';
    for (let x = L; x <= R; x += step) {
      const wx = S.near + x / h;
      if (kindOf(zone(wx)) === 'lake') {
        c.fillRect(x, h * 0.77, step + 0.5, h * 0.4);
        if (Math.abs(x - w * 0.62) < step) lakeMid = true;
      }
    }
    if (lakeMid) {   // 물에 비친 달빛이 잘게 부서진다
      const tick = Math.floor(S.t * 7);
      for (let k = 0; k < 11; k++) {
        const y = h * (0.79 + k * 0.016), half = w * 0.045 * (1 - k / 13) * (0.5 + hash(k + tick * 17));
        const x = w * 0.62 + (hash(k * 3 + tick * 31) - 0.5) * w * 0.05;
        c.fillStyle = `rgba(222,204,170,${0.32 - k * 0.022})`;
        c.fillRect(x - half, y, half * 2, Math.max(1, h * 0.004));
      }
    }
    c.fillStyle = '#0b0a08';
    c.beginPath(); c.moveTo(L, h * 1.2);
    for (let x = L; x <= R + step; x += step) {
      const wx = S.near + x / h;
      c.lineTo(x, h * groundY(wx, kindOf(zone(wx))));
    }
    c.lineTo(R + step, h * 1.2); c.fill();

    // 땅 위의 것들: 울타리 · 짚더미 · 나무 · 집
    const nc = 0.3, n0 = Math.floor((S.near + L / h) / nc) - 2, n1 = Math.ceil((S.near + R / h) / nc) + 1;
    for (let i = n0; i <= n1; i++) {
      const wx = i * nc + hash(i * 7 + 1) * nc * 0.5, k = kindOf(zone(wx));
      const x = (wx - S.near) * h, gy = h * groundY(wx, k);
      if (k === 'field') {
        c.fillStyle = '#0b0a08';
        for (let p = 0; p < 3; p++) c.fillRect(x + p * nc * h / 3, gy - h * 0.06, h * 0.012, h * 0.07);
        c.fillRect(x, gy - h * 0.045, nc * h, Math.max(1, h * 0.006));
        if (hash(i * 7 + 2) < 0.08) {
          c.beginPath(); c.ellipse(x + h * 0.1, gy, h * 0.08, h * 0.06, 0, Math.PI, 0); c.fill();
        }
      } else if (k === 'forest') {
        if (hash(i * 7 + 2) > 0.75) continue;
        const th = h * (0.35 + 0.45 * hash(i * 7 + 3)), tw = th * (0.22 + 0.1 * hash(i * 7 + 4));
        c.fillStyle = '#070605';
        c.fillRect(x - h * 0.012, gy - th * 0.25, h * 0.024, th * 0.3);
        c.beginPath();
        for (let s = 0; s < 4; s++) {   // 층층이 겹친 침엽수
          const y0 = gy - th * 0.18 - s * th * 0.2, ww = tw * (1 - s * 0.2);
          c.moveTo(x - ww, y0); c.lineTo(x, y0 - th * 0.38); c.lineTo(x + ww, y0);
        }
        c.fill();
      } else if (k === 'town') {
        if (hash(i * 7 + 2) > 0.7) continue;
        const bw = h * (0.2 + 0.16 * hash(i * 7 + 3)), bh = h * (0.11 + 0.09 * hash(i * 7 + 4)), rf = h * (0.06 + 0.06 * hash(i * 7 + 5));
        c.fillStyle = '#0a0907';
        c.fillRect(x, gy - bh, bw, bh + 2);
        c.beginPath(); c.moveTo(x - h * 0.015, gy - bh); c.lineTo(x + bw / 2, gy - bh - rf); c.lineTo(x + bw + h * 0.015, gy - bh); c.fill();
        if (hash(i * 7 + 6) < 0.5) c.fillRect(x + bw * 0.7, gy - bh - rf * 0.9, h * 0.025, rf * 0.6);
        const nw = 1 + ((hash(i * 7 + 5) * 3) | 0);
        for (let q = 0; q < nw; q++) {
          if (hash(i * 31 + q) < 0.45) continue;
          const wx2 = x + bw * (q + 0.5) / nw - h * 0.016, wy = gy - bh * 0.62;
          warm(wx2 + h * 0.016, wy + h * 0.02, h * 0.07, 0.22);
          c.fillStyle = 'rgb(226,164,88)';
          c.fillRect(wx2, wy, h * 0.032, h * 0.04);
          c.fillStyle = '#0a0907';
          c.fillRect(wx2 + h * 0.015, wy, Math.max(1, h * 0.004), h * 0.04);
        }
      }
    }

    // 끼어드는 일들 뒤쪽 바닥(철교 아래 물, 승강장)
    for (const ev of S.evs) drawEvent(ev, true);

    // 전봇대와 늘어진 전깃줄 — 지나갈 때마다 줄이 오르내린다
    const pc = 1.35, p0 = Math.floor((S.pole + L / h) / pc) - 1, p1 = Math.ceil((S.pole + R / h) / pc) + 1;
    const poleX = (k) => (k * pc + (hash(k * 3 + 900) - 0.5) * 0.35 - S.pole) * h;
    const blocked = (sx) => S.evs.some((ev) => ev.kind !== 'passing' && sx > (ev.x - 0.7) * h && sx < (ev.x + ev.len + 0.7) * h);
    c.strokeStyle = 'rgba(8,7,6,.92)'; c.lineWidth = Math.max(1, h * 0.004);
    for (let k = p0; k < p1; k++) {
      const a = poleX(k), b = poleX(k + 1);
      if (blocked(a) || blocked(b)) continue;
      for (const dy of [0.115, 0.165]) {
        c.beginPath(); c.moveTo(a, h * dy); c.quadraticCurveTo((a + b) / 2, h * (dy + 0.16), b, h * dy); c.stroke();
      }
    }
    c.fillStyle = '#050404';
    for (let k = p0; k <= p1; k++) {
      const a = poleX(k);
      if (blocked(a)) continue;
      c.fillRect(a - h * 0.017, h * 0.06, h * 0.034, h * 1.2);
      c.fillRect(a - h * 0.11, h * 0.1, h * 0.22, h * 0.018);
      c.fillRect(a - h * 0.09, h * 0.15, h * 0.18, h * 0.014);
    }

    // 끼어드는 일들 앞쪽(터널 벽, 철교 트러스, 가로등, 마주 오는 기차)
    for (const ev of S.evs) drawEvent(ev, false);

    c.restore();

    // 유리 — 빗방울, 등잔 반사, 가장자리 어둠 (유리는 객실과 같이 움직인다)
    if (S.rain > 0.02) {
      c.strokeStyle = `rgba(200,188,165,${0.3 * S.rain})`; c.lineWidth = 1;
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
    if (x1 < -w * 0.2 || x0 > w * 1.2) return;
    const cover = clamp((Math.min(x1, w) - Math.max(x0, 0)) / w, 0, 1);
    if (ev.kind === 'tunnel') {
      if (back) return;
      c.fillStyle = '#030302';
      c.fillRect(x0, -h * 0.3, x1 - x0, h * 1.6);
      // 입구와 출구의 돌테
      c.fillStyle = '#17130f';
      c.fillRect(x0, -h * 0.3, h * 0.16, h * 1.6);
      c.fillRect(x1 - h * 0.16, -h * 0.3, h * 0.16, h * 1.6);
      c.fillStyle = '#0c0a08';
      for (let y = -0.3; y < 1.3; y += 0.11) { c.fillRect(x0, h * y, h * 0.16, h * 0.012); c.fillRect(x1 - h * 0.16, h * (y + 0.05), h * 0.16, h * 0.012); }
      for (let lx = x0 + h * 0.9; lx < x1 - h * 0.5; lx += h * 1.45) {   // 굴 안 등이 휙휙 지나간다
        warm(lx, h * 0.26, h * 0.26, 0.5);
        c.fillStyle = 'rgba(255,214,150,.9)';
        c.fillRect(lx - h * 0.09, h * 0.25, h * 0.18, h * 0.02);
        addLight(lx, 0.35);
      }
      S.dark = Math.max(S.dark, cover);
    } else if (ev.kind === 'bridge') {
      if (back) {
        c.fillStyle = 'rgb(20,18,16)';
        c.fillRect(x0, h * 0.74, x1 - x0, h * 0.5);
        c.fillStyle = 'rgba(200,184,150,.16)';
        for (let k = 0; k < 7; k++) c.fillRect(x0 + ((k * 0.37 + hash(ev.seed + k)) % 1) * (x1 - x0), h * (0.8 + k * 0.025), h * 0.4, Math.max(1, h * 0.004));
        return;
      }
      c.fillStyle = '#060505'; c.strokeStyle = '#060505'; c.lineWidth = h * 0.028;
      c.fillRect(x0, h * 0.04, x1 - x0, h * 0.07);
      c.fillRect(x0, h * 0.85, x1 - x0, h * 0.08);
      const bay = h * 0.78;
      c.beginPath();
      for (let bx = x0; bx < x1 - 1; bx += bay) {
        c.fillRect(bx, h * 0.04, h * 0.05, h * 0.89);
        const ex = Math.min(bx + bay, x1);
        c.moveTo(bx, h * 0.1); c.lineTo(ex, h * 0.86);
        c.moveTo(ex, h * 0.1); c.lineTo(bx, h * 0.86);
      }
      c.stroke();
      c.fillRect(x1 - h * 0.05, h * 0.04, h * 0.05, h * 0.89);
      S.dark = Math.max(S.dark, cover * 0.25);
    } else if (ev.kind === 'station') {
      if (back) {
        // 역사 건물과 이름판
        const bx = x0 + h * 2.2, bw = h * 2.4;
        c.fillStyle = '#0e0c0a';
        c.fillRect(bx, h * 0.4, bw, h * 0.42);
        c.beginPath(); c.moveTo(bx - h * 0.1, h * 0.4); c.lineTo(bx + bw / 2, h * 0.27); c.lineTo(bx + bw + h * 0.1, h * 0.4); c.fill();
        for (const fx of [0.18, 0.62]) {
          warm(bx + bw * fx + h * 0.12, h * 0.56, h * 0.18, 0.3);
          c.fillStyle = 'rgb(214,156,84)';
          c.fillRect(bx + bw * fx, h * 0.5, h * 0.24, h * 0.14);
        }
        c.fillStyle = '#1d1813';
        c.fillRect(bx + bw * 0.28, h * 0.43, h * 0.62, h * 0.07);
        c.fillStyle = '#cdb88f';
        c.font = `700 ${Math.round(h * 0.045)}px 'Nanum Myeongjo','Noto Serif KR',serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(ev.name, bx + bw * 0.28 + h * 0.31, h * 0.468);
        // 승강장
        c.fillStyle = '#14110d';
        c.fillRect(x0, h * 0.8, x1 - x0, h * 0.5);
        c.fillStyle = '#2a231b';
        c.fillRect(x0, h * 0.8, x1 - x0, Math.max(1, h * 0.012));
        return;
      }
      for (let lx = x0 + h * 0.5; lx < x1; lx += h * 1.6) {
        c.fillStyle = '#060505';
        c.fillRect(lx - h * 0.008, h * 0.33, h * 0.016, h * 0.48);
        c.fillRect(lx - h * 0.04, h * 0.31, h * 0.08, h * 0.03);
        warm(lx, h * 0.35, h * 0.5, 0.55);
        addLight(lx, 0.9);
      }
      if (ev.who > 0) {   // 등 밑에 선 사람 — 이쪽을 보는지 아닌지 모른다
        const px = x0 + ev.who * h, py = h * 0.8;
        c.fillStyle = '#040303';
        c.beginPath();
        c.moveTo(px - h * 0.055, py); c.lineTo(px - h * 0.04, py - h * 0.2); c.lineTo(px + h * 0.04, py - h * 0.2); c.lineTo(px + h * 0.055, py); c.fill();
        c.beginPath(); c.arc(px, py - h * 0.225, h * 0.026, 0, Math.PI * 2); c.fill();
        c.fillRect(px - h * 0.045, py - h * 0.25, h * 0.09, h * 0.008);
        c.fillRect(px - h * 0.026, py - h * 0.285, h * 0.052, h * 0.036);
      }
    } else if (ev.kind === 'passing') {
      if (back) return;
      const carL = h * 3.3, gap = h * 0.14;
      for (let cx0 = x0, j = 0; cx0 < x1; cx0 += carL + gap, j++) {
        const cw = Math.min(carL, x1 - cx0);
        c.fillStyle = '#0a0908';
        c.fillRect(cx0, h * 0.12, cw, h * 0.86);
        for (let m = 0; m < 6; m++) {
          const wx = cx0 + h * 0.22 + m * h * 0.5;
          if (wx > cx0 + cw - h * 0.3) break;
          if (hash(ev.seed + j * 13 + m) < 0.3) continue;
          c.fillStyle = 'rgba(240,178,98,.22)';
          c.fillRect(wx - h * 0.14, h * 0.27, h * 0.6, h * 0.28);   // 속도에 번진 빛
          c.fillStyle = 'rgba(244,186,108,.9)';
          c.fillRect(wx, h * 0.3, h * 0.32, h * 0.22);
          addLight(wx + h * 0.16, 0.22);
        }
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
