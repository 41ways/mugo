/* 무고 — 진행부.
 *
 * 한 판은 이렇게 흐른다.
 *   앞사람의 진술을 서버에서 하나 받아 → 내가 판결하고 (그 사람에게 메일이 나간다)
 *   → 나도 같은 밤을 겪고 → 내 진술을 대기열에 넣는다 (다음 사람이 판결한다)
 *
 * 관찰·추론·추격·몸싸움은 전부 같은 뼈대다. 느려진 시간 안에서 볼 것을 고르고,
 * 고른 것만 나중에 쓸 수 있다.
 */
(function () {
  'use strict';

  const S = window.STORY, PLATES = window.PLATES;
  const stage = document.getElementById('stage');
  const flow = document.getElementById('flow');     // 글자 — 가운데, 위에서 아래로
  const opts = document.getElementById('opts');     // 선택지 — 계속 버튼 위
  const tapslot = document.getElementById('tapslot'); // 계속 — 자리는 늘 비어 있어도 지킨다
  const scene = document.getElementById('scene');   // 사진이 화면을 다 덮는 몰입 화면
  const slowbar = document.getElementById('slowbar');

  /* ── 잡동사니 ───────────────────────────────────────── */

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 받침을 보고 조사를 고른다. 이름 뒤에 괄호가 붙으면 이야기의 김이 샌다.
  function josa(word, pair) {
    const [withBatchim, without] = pair.split('/');
    const ch = String(word == null ? '' : word).trim().slice(-1);
    if (!ch) return without;
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withBatchim : without;
    // 로마자 이름은 읽히는 소리로 친다. Sherlock 은 「이」, Holmes 는 「가」.
    if (/[a-z]/i.test(ch)) return /[aeiouysxz]/i.test(ch) ? without : withBatchim;
    return without;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 대사 안의 {name} 을 장부에 적은 이름으로 바꾼다. 안 적었으면 그냥 「선생」.
  const fill = (t) => String(t == null ? '' : t).replace(/\{name\}/g, () => state.name || '탐정');

  // 누가 말하는지 한눈에 보이게. 「나」는 반대쪽에 붙고 색이 다르다.
  const SPEAKER = { '나': 's-me', '켈러 소장': 's-kel', '남자': 's-man' };

  // 심문에서 받는 답. 길게 답하는 사람은 다들 거짓말을 하더라는 게 켈러의 지론이다.
  const ANSWER_MAX = 10;

  // 글자는 위에서 아래로 쌓이고, 아래에 닿으려 하면 그 줄부터 새 장으로 넘어간다.
  function addLine(n) {
    flow.appendChild(n);
    return n;
  }
  // 넘길 때가 됐는지. 화면 높이를 아직 못 재는 순간이 있어서, 못 재면 계산으로 대신한다.
  // (프레임을 기다리면 탭이 가려져 있을 때 영영 안 돌아온다.)
  function overflows() {
    // 조작 칸은 자기 높이만큼 이미 글 영역을 밀어냈으므로, 여기서 더 깎지 않는다.
    const avail = flow.clientHeight > 40
      ? flow.clientHeight
      : Math.max(160, stage.clientHeight - opts.offsetHeight - tapslot.offsetHeight - 72);
    return flow.scrollHeight > avail + 1;
  }

  // 사진·조서도 글과 같은 흐름에 놓는다. 읽던 자리 다음에 나와야 읽기 편하다.
  async function addBlock(n) {
    // 사진은 로드되기 전엔 높이가 0이라, 로드를 기다렸다가 넘침을 잰다.
    // 연출도 다 받아온 뒤에 시작해야 중간부터 튀어나오지 않는다.
    const img = n.querySelector && n.querySelector('img');
    if (img && !img.complete) {
      await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2500); });
    }
    flow.appendChild(n);
    if (overflows()) {
      n.remove();
      await turn(false);
      flow.appendChild(n);
    }
    return n;
  }
  function setMedia(n) { if (n) flow.appendChild(n); return n; }
  function setFoot(n) { opts.innerHTML = ''; if (n) opts.appendChild(n); return n; }
  function setTap(n) { tapslot.innerHTML = ''; if (n) tapslot.appendChild(n); return n; }
  function wipe() { flow.innerHTML = ''; opts.innerHTML = ''; tapslot.innerHTML = ''; }

  // 한 낱말씩 떠오르게. 줄 전체가 통째로 튀어나오면 딱딱하다.
  function words(text, from = 0) {
    let i = from;
    return String(fill(text)).split(/(\s+)/).map((w) => {
      if (!w || /^\s+$/.test(w)) return w;
      const d = i * 34; i += 1;
      return `<span class="w" style="animation-delay:${d}ms">${esc(w)}</span>`;
    }).join('');
  }
  const wordCount = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
  const put = (node) => addLine(node);
  const toBottom = () => {};   // 이제 스크롤하지 않는다
  const clear = wipe;

  const state = {
    name: '',
    player: playerId(),
    pages: [],       // 저녁에 저택을 돌며 적은 것. 이것만이 수첩에 있다.
    torn: [],        // 그중 찢어낸 장. 이것이 다음 사람에게 넘어간다.
    hits: [],
    humiliation: 0,
    knewWay: false,   // 저녁에 적어둔 길로 들어갔는가
    caseData: null,
    myVerdict: null,
    traces: [],      // 오는 길에 몸에 남은 것들. 유치장의 남자가 이걸 읽는다.
    chased: true,    // 범인을 쫓았는가, 피해자 곁에 남았는가
  };

  function playerId() {
    try {
      let v = localStorage.getItem('mugo.player');
      if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem('mugo.player', v); }
      return v;
    } catch { return 'anon-' + String(Math.random()).slice(2); }
  }

  /* ── 서술 ───────────────────────────────────────────── */

  // 한 박자 쉰다. 누른다고 건너뛰지 않는다 — 그러다 다음 화면까지 넘어가버린다.
  const beat = (ms) => new Promise((r) => setTimeout(r, ms));

  // 화면이 실제로 넘어갈 때만 「계속」이 뜬다. 그 외에는 글이 저절로 흐른다.
  function turn(full) {
    return new Promise((resolve) => {
      if (!flow.children.length) {
        if (full) wipe();
        resolve();
        return;
      }
      const tapEl = setTap(el('div', 'tap', '계속'));
      const go = (e) => {
        if (e.type === 'keydown') {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
        } else if (!tapEl.contains(e.target)) {
          return;   // 계속 버튼을 눌러야만 넘어간다
        }
        removeEventListener('keydown', go, true);
        removeEventListener('click', go, true);
        tapslot.innerHTML = '';
        if (full) { wipe(); } else {
          const keep = [...flow.querySelectorAll('.sticky')];
          flow.innerHTML = '';
          keep.forEach((k) => flow.appendChild(k));
        }
        resolve();
      };
      addEventListener('keydown', go, true);
      addEventListener('click', go, true);
    });
  }

  const lineNode = (l) => {
    if (l.c) return el('div', 'chapter', words(l.c));
    if (l.hr) return el('hr', 'hr');
    if (l.who) return el('div', 'said ' + (SPEAKER[l.who] || 's-etc'),
      `<span class="who">${esc(l.who)}</span>${words(l.s)}`);
    if (l.b) return el('p', 'say beat', words(l.b));
    if (l.w) return el('p', 'say whisper', words(l.w));
    return el('p', 'say', words(l.s));
  };
  const pace = (l) => l.hr ? 180 : Math.min(1250, 300 + wordCount(l.s || l.c || l.b || l.w || '') * 32);

  // 글은 위에서 아래로 흐르고, 아래에 닿으면 그때 「계속」이 뜬다.
  // 한 장에 한 줄만 덩그러니 남기지 않는다. 넘긴 자리에 최소 두세 줄은 들어가게.
  const MIN_LINES = 3;

  async function say(lines, o = {}) {
    // silent 는 「계속」을 세우지 않고 지나가는 자리다. 여기서 기다리면 그대로 멈춘다.
    if (lines.some((l) => l.c)) {
      if (o.silent) wipe(); else await turn(true);
    }
    const clearSoft = () => {
      const keep = [...flow.querySelectorAll('.sticky')];
      flow.innerHTML = '';
      keep.forEach((k) => flow.appendChild(k));
    };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const n = lineNode(l);
      flow.appendChild(n);

      if (overflows()) {
        n.remove();
        if (o.silent) clearSoft(); else await turn(false);
        flow.appendChild(n);

        // 새 장을 열었으면, 뒤따르는 줄들을 미리 붙여 한 줄짜리 화면을 막는다.
        let filled = 1;
        while (filled < MIN_LINES && i + 1 < lines.length) {
          const peek = lineNode(lines[i + 1]);
          flow.appendChild(peek);
          if (overflows()) { peek.remove(); break; }
          i += 1; filled += 1;
          await beat(pace(lines[i]));
        }
      }
      await beat(pace(l));
    }
  }

  async function choose(prompt, choices) {
    return new Promise((resolve) => {
      const box = setFoot(el('div'));
      box.style.cssText = 'display:flex;flex-direction:column;gap:9px';
      if (prompt) box.appendChild(el('p', 'ask', words(prompt)));
      const list = box.appendChild(el('div', 'opts'));
      choices.forEach((o, idx) => {
        const label = typeof o === 'string' ? o : o.label;
        const cost = (typeof o === 'object' && o.cost != null)
          ? `<span class="cost">${o.cost ? '−' + o.cost : '즉시'}</span>` : '';
        const b = list.appendChild(el('button', 'opt', cost + esc(label)));
        b.disabled = typeof o === 'object' && o.disabled;
        b.onclick = () => {
          opts.innerHTML = '';       // 고르고 나면 남기지 않는다
          resolve(idx);
        };
      });
    });
  }

  /* ── 관찰 (느린 시간) ───────────────────────────────── */

  function slow(on) {
    document.body.classList.toggle('slow', !!on);
    if (on) {
      slowbar.firstElementChild.style.transition = 'none';
      slowbar.firstElementChild.style.width = '0%';
      requestAnimationFrame(() => {
        slowbar.firstElementChild.style.transition = 'width 26s linear';
        slowbar.firstElementChild.style.width = '100%';
      });
    }
  }

  // 관찰 결과는 화면 한가운데에 띄운다. 아래로 쌓으면 판에서 눈을 떼야 한다.
  function cluePop(sp) {
    return new Promise((resolve) => {
      const back = document.body.appendChild(el('div', 'clue-back'));
      const pop = document.body.appendChild(el('div', 'clue-pop',
        `<span class="tag">${esc(sp.tag)}</span>` +
        `<p>${esc(sp.text)}</p>` +
        (sp.more ? `<p class="more">${esc(sp.more)}</p>` : '') +
        `<div class="close">닫기</div>`));
      const key = (e) => {
        if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); done();
      };
      const done = () => {
        removeEventListener('keydown', key, true);
        back.remove(); pop.remove();
        resolve();
      };
      back.onclick = done;
      pop.onclick = done;
      addEventListener('keydown', key, true);
    });
  }

  async function observe(cfg) {
    // 사진이 통째로 보여야 하니, 읽던 글은 먼저 넘긴다.
    if (flow.children.length) await turn(false);
    return new Promise((resolve) => {
      const plate = PLATES[cfg.plate];
      const found = [];
      slow(true);
      stage.classList.add('look');

      addLine(el('p', 'say whisper', words(cfg.lead)));

      const pane = el('div', 'sticky');
      pane.style.cssText = 'display:flex;flex-direction:column;gap:9px;min-height:0';
      flow.appendChild(pane);
      const frame = pane.appendChild(el('div', 'plate' + (plate.img ? ' photo' : ''),
        plate.img ? `<img src="${plate.img}" alt="" decoding="async">` : plate.svg));
      const hint = pane.appendChild(el('div', 'hint'));
      const chips = pane.appendChild(el('div', 'chips'));

      const cap = cfg.max || plate.spots.length;
      const btn = el('button', 'btn', '충분하다');

      const refresh = () => {
        hint.innerHTML = `<span>관찰 <b>${found.length}</b> / ${cap}</span>` +
          `<span>${found.length < cfg.need ? '아직 이르다' : '언제든 멈출 수 있다'}</span>`;
        setFoot(found.length >= cfg.need ? btn : null);
      };

      plate.spots.forEach((sp) => {
        const h = frame.appendChild(el('button', 'hot'));
        h.style.left = sp.x + '%';
        h.style.top = sp.y + '%';
        h.setAttribute('aria-label', sp.tag);
        h.onclick = async () => {
          if (h.classList.contains('done')) return;
          h.classList.add('done');
          found.push(sp);
          chips.appendChild(el('span', 'chip', esc(sp.tag)));
          refresh();
          await cluePop(sp);
          if (found.length >= cap) finish();
        };
      });

      const finish = () => {
        [...frame.querySelectorAll('.hot')].forEach((h) => { h.disabled = true; h.classList.add('done'); });
        opts.innerHTML = '';
        slow(false);
        stage.classList.remove('look');
        pane.classList.remove('sticky');
        addLine(el('p', 'say whisper', words(cfg.done)));
        resolve(found);
      };

      btn.onclick = finish;
      refresh();
    });
  }

  /* ── 추론 (틀리면 티가 난다) ────────────────────────── */

  async function deduce(cfg) {
    addLine(el('p', 'say whisper', esc(cfg.lead)));
    let perfect = true;
    for (const q of cfg.questions) {
      const box = setFoot(el('div'));
      box.style.cssText = 'display:flex;flex-direction:column;gap:9px';
      box.appendChild(el('p', 'ask', words(q.q)));
      const list = box.appendChild(el('div', 'opts'));
      await new Promise((resolve) => {
        q.opts.forEach((label, idx) => {
          const b = list.appendChild(el('button', 'opt', esc(label)));
          b.onclick = () => {
            if (idx === q.right) {
              b.classList.add('right');
              [...list.children].forEach((c) => { c.disabled = true; });
              resolve();
            } else {
              perfect = false;
              b.classList.add('wrong');
              b.disabled = true;
              if (!box.querySelector('.err')) box.appendChild(el('p', 'err', esc(q.wrong)));
            }
          };
        });
      });
      opts.innerHTML = '';
    }
    return perfect;
  }

  // 제한 시간. 탭을 가리면 멈춘다 — 브라우저가 타이머를 늦춰버려서,
  // 돌아왔을 때 이미 지나 있으면 그건 플레이어 잘못이 아니다.
  function timed(cueHtml, choices, seconds, dark, img) {
    return new Promise((resolve) => {
      if (img) flow.appendChild(el('div', 'plate photo', `<img src="${img}" alt="" decoding="async">`));
      addLine(el('p', 'say', cueHtml));

      const box = setFoot(el('div'));
      box.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      const bar = box.appendChild(el('div', 'timer', '<i></i>'));
      const fill = bar.firstElementChild;
      const list = box.appendChild(el('div', 'opts'));

      let left = seconds * 1000, since = 0, timer = null, done = false;
      const run = () => {
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        clearTimeout(timer);
        left = Math.max(300, left - (Date.now() - since));
        const pct = (fill.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100;
        fill.style.transition = 'none';
        fill.style.width = pct + '%';
      };
      const onVis = () => { if (document.hidden) hold(); else requestAnimationFrame(run); };

      const end = (idx) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVis);
        [...list.children].forEach((c) => { c.disabled = true; });
        if (idx >= 0) list.children[idx].classList.add('picked');
        bar.remove();
        resolve(idx);
      };

      choices.forEach((label, idx) => {
        const b = list.appendChild(el('button', 'opt', esc(label)));
        b.onclick = () => end(idx);
      });

      document.addEventListener('visibilitychange', onVis);
      if (document.hidden) fill.style.width = '100%';
      else requestAnimationFrame(run);
    });
  }

  /* ── 몰입 화면 — 사진이 화면을 다 덮고, 그 위에서 고른다 ───────── */

  // 사진 위에서 고르는 제한시간 선택. 고르면 같은 화면에서 결과가 이어진다.
  function sceneTimed(cueHtml, choices, seconds) {
    return new Promise((resolve) => {
      const box = sceneBody();
      const text = box.appendChild(el('div', 'scene-text'));
      text.appendChild(el('p', 'say', cueHtml));
      const list = text.appendChild(el('div', 'scene-list'));

      const bar = box.appendChild(el('div', 'scene-foot'));
      const timerEl = bar.appendChild(el('div', 'timer', '<i></i>'));
      const fill = timerEl.firstElementChild;

      const btns = choices.map((label, i) => {
        const n = list.appendChild(el('button', 'dopt'));
        n.innerHTML = `<span class="dtext">${esc(label)}</span>`;
        n.onclick = () => end(i);
        return n;
      });

      let left = seconds * 1000, since = 0, timer = null, done = false;
      const run = () => {
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        clearTimeout(timer);
        left = Math.max(300, left - (Date.now() - since));
        const pct = (fill.getBoundingClientRect().width / timerEl.getBoundingClientRect().width) * 100;
        fill.style.transition = 'none';
        fill.style.width = pct + '%';
      };
      const onVis = () => { if (document.hidden) hold(); else requestAnimationFrame(run); };

      const end = (idx) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVis);
        timerEl.remove();
        btns.forEach((n, i) => { n.disabled = true; if (i !== idx) n.classList.add('faded'); });
        setTimeout(() => resolve(idx), 450);
      };

      document.addEventListener('visibilitychange', onVis);
      if (document.hidden) fill.style.width = '100%';
      else requestAnimationFrame(run);
    });
  }

  function sceneOpen(img) {
    scene.className = 'on';
    scene.innerHTML = `<img src="${img}" alt="" decoding="async"><div class="scene-in"></div>`;
    return scene.querySelector('.scene-in');
  }
  function sceneBody() {
    const box = scene.querySelector('.scene-in');
    box.innerHTML = '';
    return box;
  }
  function sceneClose() {
    scene.className = '';
    scene.innerHTML = '';
  }
  function sceneNode(l) {
    if (l.hr) return el('hr', 'hr');
    if (l.who) return el('p', 'say beat', `「${esc(l.who)}」 ${words(l.s)}`);
    if (l.b) return el('p', 'say beat', words(l.b));
    if (l.w) return el('p', 'say whisper', words(l.w));
    return el('p', 'say', words(l.s));
  }

  // 사진 위에서 글자가 뜬다. 화면은 그대로 두고 내용만 바뀐다.
  function sceneSay(lines) {
    return new Promise((resolve) => {
      const box = sceneBody();
      const text = box.appendChild(el('div', 'scene-text'));
      const bar = box.appendChild(el('div', 'scene-foot'));
      let i = 0, timer = null, ended = false, closed = false;

      const step = () => {
        if (i >= lines.length) return arrive();
        const l = lines[i++];
        text.appendChild(sceneNode(l));
        timer = setTimeout(step, l.hr ? 180 : Math.min(1250, 300 + wordCount(l.s || l.b || l.w || '') * 32));
      };
      const flush = () => {
        clearTimeout(timer);
        while (i < lines.length) text.appendChild(sceneNode(lines[i++]));
        arrive();
      };
      let tapEl = null;
      const arrive = () => { if (ended) return; ended = true; tapEl = bar.appendChild(el('div', 'tap', '계속')); };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        removeEventListener('keydown', onGo, true);
        removeEventListener('click', onGo, true);
        resolve();
      };
      const onGo = (e) => {
        if (e.type === 'keydown') {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
        } else if (!ended || !tapEl || !tapEl.contains(e.target)) {
          return;
        }
        if (!ended) return;
        finish();
      };
      addEventListener('keydown', onGo, true);
      addEventListener('click', onGo, true);
      step();
    });
  }

  // 소리가 난 쪽에 선택지를 놓는다. 고르면 그 자리에서 다음으로 넘어간다.
  function sceneBeat(b, seconds) {
    return new Promise((resolve) => {
      const box = sceneBody();
      const text = box.appendChild(el('div', 'scene-text'));
      text.appendChild(el('div', 'say beat', b.cue));

      const bar = box.appendChild(el('div', 'scene-foot'));
      const timerEl = bar.appendChild(el('div', 'timer', '<i></i>'));
      const fill = timerEl.firstElementChild;

      const holder = b.layout === 'center' ? text.appendChild(el('div', 'center-row')) : box;
      const btns = b.opts.map((o, i) => {
        const n = holder.appendChild(el('button', 'dopt' + (o.pos ? ' p-' + o.pos : '')));
        n.innerHTML = `<span class="dtext">${esc(o.label)}</span>`;
        n.onclick = () => end(i);
        return n;
      });

      let left = seconds * 1000, since = 0, timer = null, done = false;
      const run = () => {
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        clearTimeout(timer);
        left = Math.max(300, left - (Date.now() - since));
        const pct = (fill.getBoundingClientRect().width / timerEl.getBoundingClientRect().width) * 100;
        fill.style.transition = 'none';
        fill.style.width = pct + '%';
      };
      const onVis = () => { if (document.hidden) hold(); else requestAnimationFrame(run); };

      const end = (idx) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVis);
        timerEl.remove();
        const ok = idx === b.right;
        btns.forEach((n, i) => { n.disabled = true; if (i !== idx) n.classList.add('faded'); });
        const mark = el('span', 'hit ' + (ok ? 'ok' : 'no'), ok ? S.act6.hit : S.act6.miss);
        (idx >= 0 ? btns[idx] : text).appendChild(mark);
        setTimeout(() => resolve(idx), 700);
      };

      document.addEventListener('visibilitychange', onVis);
      if (document.hidden) fill.style.width = '100%';
      else requestAnimationFrame(run);
    });
  }

  // 장면 사진 한 장. 이 밑으로 글자가 흐른다.
  function plateCard(img) {
    return addBlock(el('div', 'plate photo', `<img src="${img}" alt="" decoding="async">`));
  }

  function fileCard(head, itemsHtml, stamp, extra) {
    const f = el('div', 'file' + (extra ? ' ' + extra : ''));
    f.appendChild(el('h4', null, esc(head)));
    f.appendChild(el('div', null, itemsHtml));
    if (stamp) f.appendChild(el('div', 'stamp', esc(stamp)));
    return addBlock(f);
  }

  // 찢긴 장에서 떠낸 것. 원문이 아니라 성격만 다음 사람에게 넘어간다.
  function tornSummary(torn) {
    if (!torn.length) return [];
    const T = S.act2.torn;
    const ko = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱'];
    const out = [T.count.replace('{n}', ko[torn.length] || String(torn.length))];
    if (torn.some((p) => p.cat === 'entry')) out.push(T.entry);
    if (torn.some((p) => p.cat === 'habit')) out.push(T.habit);
    if (torn.length >= 4) out.push(T.many);
    out.push(T.tail);
    return out;
  }

  /* ── 서버 ───────────────────────────────────────────── */

  async function api(path, body) {
    const res = await fetch(path, body ? {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
    if (!res.ok) throw new Error('서버가 응답하지 않는다');
    return res.json();
  }

  // 셋째 질문만 갈린다. 부두에서 잡혔으면 흉기가, 저택에서 잡혔으면 현장이 근거가 된다.
  const threeQs = (block, caught) =>
    block.questions.concat([block.third[caught === 'house' ? 'house' : 'dock']]);

  /* ═════════════════════════ 진행 ═════════════════════════ */

  async function titleScreen() {
    wipe();
    stage.classList.add('mid');
    const box = addLine(el('div', 'title'));
    box.innerHTML =
      `<h1 class="han">무고</h1>` +
      `<p class="sub">無辜</p>` +
      `<p class="gloss">안개가 들어오는 밤마다 사람이 하나씩 죽었다. 이번이 세 번째다.</p>`;
    const row = setFoot(el('div', 'row'));
    row.style.justifyContent = 'center';
    const go = row.appendChild(el('button', 'btn', '시작하기'));
    await new Promise((r) => { go.onclick = r; });
    stage.classList.remove('mid');
  }

  // 타이틀에서는 메일 얘기를 꺼내지 않는다. 그건 끝에 가서야 알 일이다.
  function footerNode(tail) {
    const f = el('footer', 'credit',
      `<a href="https://41ways.github.io/norara/">다른 게임</a>` +
      (tail ? `<span>${esc(tail)}</span>` : ''));
    f.style.width = '100%';
    return f;
  }

  async function askName() {
    const box = setFoot(el('div'));
    box.style.cssText = 'display:flex;flex-direction:column;gap:9px';
    box.appendChild(el('label', 'lab', '장부에 적을 이름'));
    const input = box.appendChild(el('input'));
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = '이름 또는 부르는 말';
    const row = box.appendChild(el('div', 'row'));
    const ok = row.appendChild(el('button', 'btn', '적는다'));
    input.focus();
    await new Promise((r) => {
      const go = () => { if (input.value.trim()) r(); };
      ok.onclick = go;
      input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
    state.name = input.value.trim().slice(0, 24);
    opts.innerHTML = '';
    addLine(el('p', 'say whisper', `장부에 「${esc(state.name)}」라고 적힌다.`));
  }

  /* 0장 — 편지, 그리고 오는 길 */
  async function act0() {
    await say(S.intro);

    // 편지는 앞 서술과 같은 장에 놓는다. 자리가 모자랄 때만 알아서 넘어간다.
    const L = S.letter;
    await fileCard(L.head,
      L.body.map((b) => `<p style="margin:0 0 13px">${esc(b)}</p>`).join('') +
      `<p style="margin:20px 0 0;text-align:right">${esc(L.sign)}</p>`, null, 'hand');
    await wait(1900);
    await say([{ w: L.note }]);
    await say(S.act0.lead);

    for (const b of S.act0.beats) {
      const i = await choose(b.ask, b.opts.map((o) => o.label));
      state.traces.push(b.opts[i].trace);
      await say([{ s: b.opts[i].out }]);
    }
    await say(S.act0.arrive);
  }

  /* 1장 — 소장의 코를 납작하게 */
  async function act1() {
    await say(S.act1.open);
    const found = await observe(S.act1.observe);
    const perfect = await deduce(S.act1.deduce);

    const blows = found.map((f) => S.act1.blows[f.id]).filter(Boolean)
      .map((s) => ({ who: '나', s }));
    state.humiliation = found.length + (perfect ? 2 : 0);

    await say(blows.concat(state.humiliation >= 6 ? S.act1.close : S.act1.weak));
  }

  /* 2장 — 앞사람을 판결한다 */
  async function act2(casePromise) {
    await say(S.act2.open);

    const c = await casePromise;
    state.caseData = c;

    const E = S.act2.evidence;
    const torn = (c.clues && c.clues.length) ? c.clues : [];
    await fileCard(E.head,
      `<ul>` +
      `<li>${E.weapon[c.caught === 'house' ? 'house' : 'dock']}</li>` +
      `<li>${E.ticket}</li>` +
      `<li>${torn.length ? E.journal.torn : E.journal.clean}</li>` +
      `</ul>` +
      `<p style="margin:15px 0 0">${E.note[c.caught === 'house' ? 'house' : 'dock']}</p>`,
      E.stamp);
    await wait(1700);

    if (torn.length) {
      const T = S.act2.tamper;
      await fileCard(T.head,
        `<p style="margin:0 0 13px;color:#6f6552;font-size:13.5px">${esc(T.lead)}</p>` +
        torn.map((x) => `<p class="memo">— ${esc(x)}</p>`).join(''), null, 'alarm');
      await wait(1900);
    }

    await say(S.act2.after);
    await observe(S.act2.observe);

    // 사흘 동안 입을 안 열던 사람이, 먼저 당신을 읽는다.
    const R = S.act2.read;
    await say(R.open);
    const pool = state.traces.map((t) => R.lines[t]).filter(Boolean);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // 그가 한 마디 하면 당신이 한 마디 되받는다. 되받을수록 밀린다.
    const reads = pool.slice(0, 3);
    for (let i = 0; i < reads.length; i++) {
      await say([{ who: '남자', s: reads[i] }].concat(R.back[i] || []));
    }
    await say(state.humiliation >= 6 ? R.mirror : R.plain);
    await say(R.close);

    await say(S.act2.lead);

    // 세 마디. 대답은 앞사람이 직접 쓴 것이다.
    for (let i = 0; i < 3; i++) {
      addLine(el('p', 'qq', `${i + 1}. ${esc(threeQs(S.act2, c.caught)[i])}`));
      await wait(1250);
      const a = (c.answers[i] || '').trim();
      addLine(el('p', 'aa' + (a ? '' : ' silent'), esc(a || S.act2.silent)));
      await wait(500);
    }

    await say(S.act2.askVerdict);
    const verdict = await verdictForm();
    state.myVerdict = verdict;

    // 판결을 보낸다. 앞사람에게 메일이 나가는 지점.
    api('/api/verdict', {
      caseId: c.caseId, verdict: verdict.v, reason: verdict.reason, judgeName: state.name,
    }).catch(() => {});

    await say(verdict.v === 'guilty' ? S.act2.guilty : S.act2.innocent);
    if (verdict.v === 'guilty') await say(S.act2.doubt);
  }

  function verdictForm() {
    return new Promise((resolve) => {
      const box = setFoot(el('div'));
      box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      box.appendChild(el('label', 'lab', '판결문 — 이 문장은 그 사람에게 그대로 간다. 짧아도 좋으니 반드시 적으시오.'));
      const ta = box.appendChild(el('textarea'));
      ta.rows = 2;
      ta.maxLength = 220;
      ta.placeholder = '예: 손등의 상처는 때린 사람의 것이 아니었다.';
      const cnt = box.appendChild(el('div', 'count'));

      const row = box.appendChild(el('div', 'row'));
      const g = row.appendChild(el('button', 'btn danger', '유죄 — 재판으로 넘긴다'));
      const i = row.appendChild(el('button', 'btn ghost', '무죄 — 풀어준다'));
      // 한 줄도 없이 사람을 판결할 수는 없다.
      const gate = () => {
        const ok = ta.value.trim().length > 0;
        g.disabled = i.disabled = !ok;
        cnt.textContent = ok ? `${ta.value.length} / 220` : '판결문을 적어야 누를 수 있다';
        cnt.classList.toggle('over', !ok);
      };
      ta.oninput = gate;
      gate();

      const pick = (v) => () => {
        if (!ta.value.trim()) return;
        g.disabled = i.disabled = true;
        ta.disabled = true;
        const out = { v, reason: ta.value.trim() };
        opts.innerHTML = '';
        resolve(out);
      };
      g.onclick = pick('guilty');
      i.onclick = pick('innocent');
    });
  }

  /* 3장 — 해 지기 전에 저택을 한 바퀴. 여기서 적은 것이 수첩의 전부다. */
  async function recon() {
    await say(S.recon.open);
    const found = await observe(S.recon.observe);
    state.pages = found.map((f) => ({ id: f.id, cat: f.cat, text: f.page }));
    await say(state.pages.length >= 3 ? S.recon.close : S.recon.lazy);
  }

  /* 4장 — 비명. 들어가는 길은 저녁에 적어둔 만큼만 안다. */
  async function act3() {
    await say(S.act3.open);
    const known = new Set(state.pages.map((p) => p.id));
    const idx = await choose(S.act3.ask, S.act3.ways.map((w) => ({
      label: w.label + (known.has(w.need) ? '  — 수첩에 있음' : ''),
      cost: known.has(w.need) ? w.known : w.cost,
    })));
    const way = S.act3.ways[idx];
    state.knewWay = known.has(way.need);
    await say([{ s: way.out }, state.knewWay ? { b: S.act3.knew } : { w: S.act3.blind }].concat(S.act3.run));
  }

  /* 5장 — 살릴 수 있을 것 같다. 아니다. */
  async function act4() {
    await say(S.act4.open);

    // 저녁에 길을 적어둔 사람은 한 박자 일찍 닿는다. 그 한 박자만큼 더 희망을 본다.
    const rounds = state.knewWay ? S.act4.rounds : S.act4.rounds.slice(0, 2);
    if (!state.knewWay) await say(S.act4.late, { silent: true });

    for (const r of rounds) {
      const pick = await choose(r.ask, r.opts.map((o) => o.label));
      await say([{ s: r.opts[pick].out }].concat(r.after));
    }

    await say(S.act4.out);

    // 살리는 데는 실패했다. 남은 선택은 하나뿐이다.
    const F = S.act4.fork;
    await say(F.lead, { silent: true });
    const pick = await choose(F.ask, [F.chase.label, F.stay.label]);
    state.chased = pick === 0;
    await say(state.chased ? F.chase.out : F.stay.out);
  }

  /* 6장 — 서른 걸음 뒤. 갈림길마다 사진이 화면을 덮는다. */
  async function act5() {
    await say(S.act5.open, { silent: true });
    for (const j of S.act5.junctions) {
      sceneOpen(j.img);
      slow(true);
      const pick = await sceneTimed(esc(j.cue), j.opts, 9);
      slow(false);
      if (pick === j.right) await sceneSay([{ s: j.win }]);
      else await sceneSay([{ s: pick < 0 ? S.act5.slow : j.lose }]);
      sceneClose();
    }
  }

  /* 7장 — 어둠. 여기서는 화면을 통째로 쓴다. */
  async function act6() {
    await say(S.act6.open);

    sceneOpen(S.act6.img);
    await sceneSay(S.act6.seen);
    scene.classList.add('dim');
    await wait(1500);

    for (const b of S.act6.beats) {
      const pick = await sceneBeat(b, 7);
      if (pick === b.right) await sceneSay([{ b: b.win }]);
      else { state.hits.push(b.hurt); await sceneSay([{ s: b.lose }]); }
    }

    flash();
    await sceneSay(S.act6.end);
    sceneClose();
  }

  function flash() {
    const f = document.body.appendChild(el('div', 'flash on'));
    setTimeout(() => f.remove(), 700);
  }

  /* 8장 — 체포. 그리고 수첩. */
  async function act7() {
    // 챕터 제목이 화면을 비우니, 사진은 그 다음에 얹는다.
    const opening = state.chased ? S.act7.openChase : S.act7.openStay;
    await say(opening.slice(0, 1));
    if (state.chased) { await plateCard('img/arrest.jpg'); await wait(1400); }
    await say(opening.slice(1));
    await say(state.humiliation >= 6 ? S.act7.proud : S.act7.plain);

    if (!state.pages.length) { await say(S.act7.pocketEmpty); return; }

    await say(S.act7.pocket);

    // 수첩은 화면 하나를 통째로 쓴다. 목록이 이야기 글을 덮으면 안 된다.
    await turn(false);
    const bar = setFoot(el('div'));
    bar.style.cssText = 'display:flex;flex-direction:column;gap:9px';
    bar.appendChild(el('p', 'ask', esc(S.act7.tearLead)));
    const list = bar.appendChild(el('div', 'pages'));
    const tear = new Set();

    state.pages.forEach((pg) => {
      const row = list.appendChild(el('div', 'page keep',
        `<span class="mark"></span><span>${esc(pg.text)}</span>`));
      row.onclick = () => {
        if (tear.has(pg)) { tear.delete(pg); row.className = 'page keep'; }
        else { tear.add(pg); row.className = 'page torn'; }
        count.textContent = `찢을 장 ${tear.size} / ${state.pages.length}`;
      };
    });
    const count = bar.appendChild(el('div', 'count', `찢을 장 0 / ${state.pages.length}`));
    const row = bar.appendChild(el('div', 'row'));
    const ok = row.appendChild(el('button', 'btn', S.act7.tearBtn));
    await new Promise((r) => { ok.onclick = r; });
    [...list.children].forEach((c) => { c.onclick = null; });
    opts.innerHTML = '';

    state.torn = state.pages.filter((pg) => tear.has(pg));
    await say(state.torn.length ? S.act7.found : S.act7.kept);
  }

  /* 8장 — 내 차례 */
  async function act8() {
    await say(S.act8.open);
    const answers = [];
    for (let i = 0; i < 3; i++) {
      addLine(el('p', 'qq', `${i + 1}. ${esc(threeQs(S.act8, state.chased ? 'dock' : 'house')[i])}`));
      const box = setFoot(el('div'));
      box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      const input = box.appendChild(el('input'));
      input.type = 'text';
      input.maxLength = ANSWER_MAX;
      input.placeholder = S.act8.placeholder[i];
      const cnt = box.appendChild(el('div', 'count', `0 / ${ANSWER_MAX}`));
      input.oninput = () => { cnt.textContent = `${input.value.length} / ${ANSWER_MAX}`; };
      const row = box.appendChild(el('div', 'row'));
      const ok = row.appendChild(el('button', 'btn', i < 2 ? '대답한다' : '대답을 마친다'));
      input.focus();
      await new Promise((r) => {
        ok.onclick = r;
        input.onkeydown = (e) => { if (e.key === 'Enter') r(); };
      });
      const said = input.value.trim();
      answers.push(said);
      opts.innerHTML = '';
      addLine(el('div', 'said s-me', `<span class="who">나</span>${esc(said || '……')}`));
    }
    return answers;
  }

  /* 9장 — 복면, 그리고 주소 */
  async function act9(answers) {
    await say(S.act9.open);

    const box = setFoot(el('div'));
    box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    box.appendChild(el('label', 'lab', '거주지 — 통지를 받을 곳'));
    const input = box.appendChild(el('input'));
    input.type = 'email';
    input.placeholder = 'name@example.com';
    input.autocomplete = 'email';
    input.required = true;
    addLine(el('p', 'say whisper', esc(S.act9.mailLead)));
    const err = box.appendChild(el('p', 'err'));
    err.style.display = 'none';
    const row = box.appendChild(el('div', 'row'));
    const ok = row.appendChild(el('button', 'btn', '댄다'));
    input.focus();

    const email = await new Promise((r) => {
      ok.onclick = () => {
        const v = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
          err.textContent = '그건 주소가 아니오. 편지가 닿을 곳을 대시오.';
          err.style.display = '';
          return;
        }
        r(v);
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
    });
    opts.innerHTML = '';

    // 복면
    const hood = document.body.appendChild(el('div', 'hood'));
    requestAnimationFrame(() => hood.classList.add('on'));
    await wait(1800);

    let res = null;
    try {
      res = await api('/api/statement', {
        player: state.player, name: state.name, answers, clues: tornSummary(state.torn),
        caught: state.chased ? 'dock' : 'house', email,
      });
    } catch (e) {
      // 서버가 죽어도 이야기는 끝까지 가되, 무슨 일이 있었는지는 남긴다.
      console.error('[진술 제출 실패]', e);
    }

    clear();
    hood.remove();

    await say(S.act9.sealed.concat(
      res ? [{ w: `대기열 ${res.queued}번. 앞에 ${Math.max(0, res.queued - 1)}명이 더 기다리고 있다.` }] : [],
      email && res ? [{ s: res.mail
        ? '주소는 받아 적혔다. 판결이 나오면 한 통이 간다.'
        : '주소는 받아 적혔다. 다만 이 마을의 우편은 아직 열리지 않았다 — 아래 링크로 직접 확인하시오.' }] : [],
    ));

    if (res) {
      const t = addLine(el('div', 'token'));
      const url = location.origin + location.pathname + '?t=' + res.token;
      t.innerHTML = `판결 확인용 조서 번호<br><a href="${esc(url)}">${esc(url)}</a>`;
    }

    await say(state.caseData && !state.caseData.seed ? S.act9.revealReal : S.act9.revealSeed);

    // 유치장. 사흘 전 당신이 밖에서 들여다보던 그 문이다.
    await say(S.act9.cellDoor);
    await plateCard(S.act9.cellIn);
    await wait(1600);
    await say(S.act9.cellShut);
    // 마지막 장면에는 사진을 두지 않는다. 들여다보는 쪽은 이제 이쪽이 아니다.
    await say(S.act9.lastVisit);

    const end = setFoot(el('div'));
    end.style.cssText = 'display:flex;flex-direction:column;gap:12px';
    const endRow = end.appendChild(el('div', 'row'));
    const again = endRow.appendChild(el('button', 'btn ghost', '처음으로'));
    again.onclick = () => { location.href = location.pathname; };
    end.appendChild(footerNode('주소는 판결 한 통을 보내고 나면 지워진다.'));
  }

  /* ── 판결 확인 페이지 ───────────────────────────────── */

  async function lookup(token) {
    clear();
    let r;
    try { r = await api('/api/statement/' + encodeURIComponent(token)); }
    catch {
      await say([{ c: '조서 조회' }, { s: '그런 조서는 없다. 번호를 다시 보시오.' }], { silent: true });
      return backLink();
    }

    const days = Math.floor(r.waited / 86400000);
    const hours = Math.floor(r.waited / 3600000) % 24;
    const held = days ? `${days}일 ${hours}시간째` : `${hours}시간째`;

    if (!r.judged) {
      await say([
        { c: '조서 조회' },
        { s: `${r.name}. 당신의 조서는 아직 봉해진 채다. ${held} 기다리는 중이다.` },
        { s: '다음에 회항에 들어오는 사람이 이걸 읽는다. 언제 올지는 아무도 모른다.' },
      ], { silent: true });
      return backLink();
    }

    clear();
    addLine(el('div', 'verdictbig ' + (r.verdict === 'guilty' ? 'guilty' : 'innocent'),
      r.verdict === 'guilty' ? '유죄' : '무죄'));

    await say(r.verdict === 'guilty' ? [
      { s: `${r.name}. 재판은 열렸고, 십일 분 걸렸다.` },
      { s: `탐정 ${r.judgeName}${josa(r.judgeName, '이/가')} 당신의 진술을 읽었다.` },
      { s: '형은 사흘 뒤 새벽, 부두 창고 앞 광장에서 집행됐다. 안개가 짙어 구경꾼은 많지 않았다.' },
    ] : [
      { s: `${r.name}. 재판은 열리지 않았다.` },
      { s: `탐정 ${r.judgeName}${josa(r.judgeName, '이/가')} 당신의 진술을 읽었고, 증거가 사람을 목매달 만큼은 아니라고 했다.` },
      { s: '아무도 사과하지 않았다. 당신은 그날 밤 뒷문으로 나왔다.' },
    ], { silent: true });

    if (r.reason) await fileCard('탐정의 소견', `<p class="memo">${esc(r.reason)}</p>`);
    backLink();
  }

  function backLink() {
    const row = setFoot(el('div', 'row'));
    const b = row.appendChild(el('button', 'btn', '처음으로'));
    b.onclick = () => { location.href = location.pathname; };
    row.appendChild(footerNode());
  }

  /* ── 시작 ───────────────────────────────────────────── */

  async function main() {
    const t = new URLSearchParams(location.search).get('t');
    if (t) return lookup(t);

    await titleScreen();

    // 앞사람 진술은 미리 받아둔다. 2장에서 기다리는 일이 없도록.
    const casePromise = api('/api/case', { player: state.player })
      .catch(() => ({ caseId: 'seed:offline', seed: true, name: '이름을 말하지 않았다',
        answers: ['안 죽였습니다.', '비명이 났으니까요.', '목을 눌렀으니 묻었겠죠.'], clues: [] }));

    clear();
    await act0();
    await askName();

    await act1();
    await act2(casePromise);
    await recon();
    await act3();
    await act4();
    if (state.chased) {     // 놓아준 사람은 부두까지 가지 않는다
      await act5();
      await act6();
    }
    await act7();
    const answers = await act8();
    await act9(answers);
  }

  main().catch((err) => {
    console.error(err);
    put(el('p', 'err', '어딘가에서 끊겼다. 새로고침하면 처음부터 다시 간다.'));
  });
})();
