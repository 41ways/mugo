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
  const corner = document.getElementById('corner');
  const notesBox = document.getElementById('notes');

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
  // 긴 줄일수록 낱말 간격을 좁힌다 — 안 그러면 다 뜨기도 전에 다음 줄이 내려온다.
  const stepFor = (n) => (n > 16 ? 20 : n > 8 ? 24 : 30);
  const REVEAL = 620;   // .w 애니메이션 길이와 같아야 한다
  const revealMs = (n) => (n ? (n - 1) * stepFor(n) + REVEAL : 0);

  function words(text, from = 0) {
    const parts = String(fill(text)).split(/(\s+)/);
    const step = stepFor(parts.filter((w) => w && !/^\s+$/.test(w)).length);
    let i = from;
    return parts.map((w) => {
      if (!w || /^\s+$/.test(w)) return w;
      const d = i * step; i += 1;
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
    way: '',         // 비명 뒤에 들어간 길
  };

  /* ── 수첩 — 그동안 무엇을 보고 무엇을 골랐는지 ─────────── */

  // 장마다 한 줄씩 적어 둔다. 탐정이 실제로 들고 다니는 그 수첩이다.
  const notebook = [];
  let chapter = '';
  const setChapter = (t) => { chapter = t; };
  const note = (t) => { if (t) notebook.push({ ch: chapter, t: String(t) }); };


  function openNotes() {
    if (!notesBox.hidden) return;
    const sheet = el('div', 'sheet');
    sheet.appendChild(el('h3', null, '수첩'));
    sheet.appendChild(el('p', 'who', state.name ? `장부에 「${esc(state.name)}」라고 적힌 사람의 것` : '아직 이름을 적지 않았다'));

    if (!notebook.length) {
      sheet.appendChild(el('p', 'empty', '아직 적은 것이 없다. 보고 고른 것이 여기 쌓인다.'));
    } else {
      let last = null;
      notebook.forEach((n) => {
        if (n.ch && n.ch !== last) { sheet.appendChild(el('div', 'ch', esc(n.ch))); last = n.ch; }
        sheet.appendChild(el('div', 'li', esc(n.t)));
      });
    }
    notesBox.innerHTML = '';
    notesBox.appendChild(sheet);
    const shut = notesBox.appendChild(el('button', 'shut', '덮는다'));
    shut.onclick = closeNotes;
    notesBox.onclick = (e) => { if (e.target === notesBox) closeNotes(); };  // 바깥을 눌러도 덮인다
    notesBox.hidden = false;
    notesBox.scrollTop = 0;
    addEventListener('keydown', notesKey, true);
  }
  function closeNotes() {
    notesBox.hidden = true;
    notesBox.innerHTML = '';
    removeEventListener('keydown', notesKey, true);
  }
  // 수첩이 펼쳐져 있는 동안에는 밑의 이야기가 넘어가면 안 된다.
  function notesKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNotes(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); }
  }

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
        if (!notesBox.hidden) return;   // 수첩을 펼친 채 누른 Enter·스페이스로 밑의 이야기가 넘어가지 않게
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
  const pace = (l) => l.hr ? 180 : Math.min(1750, revealMs(wordCount(l.s || l.c || l.b || l.w || '')) + 130);

  // 글은 위에서 아래로 흐르고, 아래에 닿으면 그때 「계속」이 뜬다.
  // 한 장에 한 줄만 덩그러니 남기지 않는다. 넘긴 자리에 최소 두세 줄은 들어가게.
  const MIN_LINES = 3;

  async function say(lines, o = {}) {
    // silent 는 「계속」을 세우지 않고 지나가는 자리다. 여기서 기다리면 그대로 멈춘다.
    if (lines.some((l) => l.c)) {
      if (o.silent) wipe(); else await turn(true);
    }
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      const n = lineNode(l);
      flow.appendChild(n);

      if (overflows()) {
        n.remove();
        // 조용한 자리(silent)라도 넘길 때는 「계속」을 세운다. 소리 없이 지우면
        // 짧은 화면에서 앞줄이 그냥 사라지고 마지막 한 줄만 남는다.
        await turn(false);
        flow.appendChild(n);

        // 새 장을 열었으면 뒤따르는 줄까지 이 장에 넣어 한 줄짜리 화면을 막는다.
        // 다만 들어갈 자리만 미리 재보고, 글자는 한 줄씩 차례로 내려 쌓는다.
        let filled = 1;
        while (filled < MIN_LINES && i + 1 < lines.length) {
          const probe = lineNode(lines[i + 1]);
          flow.appendChild(probe);
          const fits = !overflows();
          probe.remove();
          if (!fits) break;
          await beat(pace(l));
          i += 1; filled += 1;
          l = lines[i];
          flow.appendChild(lineNode(l));
        }
      }
      await beat(pace(l));
    }
  }

  // 선택창이 서면 글 영역이 그만큼 줄어든다. 방금 읽던 줄이 그 밑에 깔려
  // 잘려버리지 않게, 세워보고 넘치면 먼저 장을 넘긴 뒤에 다시 세운다.
  async function footWithRoom(box) {
    setFoot(box);
    if (overflows()) {
      setFoot(null);
      await turn(false);
      setFoot(box);
    }
    return box;
  }

  async function choose(prompt, choices) {
    let resolve;
    const picked = new Promise((r) => { resolve = r; });

    const box = el('div');
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

    await footWithRoom(box);
    return picked;
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
        if (!notesBox.hidden) return;
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
      const box = el('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:9px';
      box.appendChild(el('p', 'ask', words(q.q)));
      const list = box.appendChild(el('div', 'opts'));
      await footWithRoom(box);
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
      // 도는 중일 때만 멈추고, 멈춰 있을 때만 다시 돈다. 첫 프레임 전에 탭을 가리면
      // 시작 시각이 없어 남은 시간이 0.3초로 깎이고, 되돌아올 때 타이머가 둘 생겨
      // 다시 가려도 하나가 몰래 끝나 버리던 것을 막는다.
      const run = () => {
        if (done || timer || document.hidden) return;
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
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
  // 자리(at)가 적힌 선택지는 사진 속 그 물건 위에 놓인다.
  // 화면이 좁으면 글자끼리 겹치므로 예전처럼 아래 세로 목록으로 돌아간다.
  const PIN_MIN = 620;

  // 사진이 화면보다 넓게 잘리면 가장자리 선택지가 밖으로 밀린다.
  // 점은 물건 위에 그대로 두고, 글자만 화면 안으로 당긴다.
  // 사진이 계속 확대되므로 매 프레임 다시 잰다. 판이 확대된 만큼 나눠서 밀어야
  // 실제로 민 만큼 움직인다.
  function fitPins(pins) {
    const pad = 14;
    const k = pins.offsetWidth ? pins.getBoundingClientRect().width / pins.offsetWidth : 1;
    [...pins.children].forEach((b) => {
      const t = b.querySelector('.dtext');
      if (!t) return;
      const r = t.getBoundingClientRect();
      const cur = parseFloat(t.dataset.dx || '0');
      let dx = cur;
      if (r.left < pad) dx = cur + (pad - r.left) / k;
      else if (r.right > innerWidth - pad) dx = cur + ((innerWidth - pad) - r.right) / k;
      if (Math.abs(dx - cur) < 0.5) return;
      t.dataset.dx = String(dx);
      t.style.transform = `translateX(${dx.toFixed(1)}px)`;
    });
  }

  function sceneTimed(cueHtml, choices, seconds) {
    return new Promise((resolve) => {
      const pins = scene.querySelector('.scene-frame.pins');
      const spatial = !!pins && innerWidth >= PIN_MIN
        && choices.every((o) => o && typeof o === 'object' && o.at);
      const box = sceneBody();
      const text = box.appendChild(el('div', 'scene-text' + (spatial ? ' low' : '')));
      text.appendChild(el('p', 'say', cueHtml));
      const list = spatial ? pins : text.appendChild(el('div', 'scene-list'));
      if (spatial) pins.innerHTML = '';

      const bar = box.appendChild(el('div', 'scene-foot'));
      const timerEl = bar.appendChild(el('div', 'timer', '<i></i>'));
      const fill = timerEl.firstElementChild;

      const btns = choices.map((o, i) => {
        const label = typeof o === 'string' ? o : o.label;
        const n = list.appendChild(el('button', 'dopt' + (spatial ? ' pin' : '')));
        n.innerHTML = `<span class="dtext">${esc(label)}</span>`;
        if (spatial) { n.style.left = o.at[0] + '%'; n.style.top = o.at[1] + '%'; }
        n.onclick = () => end(i);
        return n;
      });

      let keepIn = 0;
      if (spatial) {
        const hold = () => { fitPins(pins); keepIn = requestAnimationFrame(hold); };
        hold();   // 확대되는 동안에도 글자는 화면 안에 남는다
      }

      let left = seconds * 1000, since = 0, timer = null, done = false;
      // 도는 중일 때만 멈추고, 멈춰 있을 때만 다시 돈다. 첫 프레임 전에 탭을 가리면
      // 시작 시각이 없어 남은 시간이 0.3초로 깎이고, 되돌아올 때 타이머가 둘 생겨
      // 다시 가려도 하나가 몰래 끝나 버리던 것을 막는다.
      const run = () => {
        if (done || timer || document.hidden) return;
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
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
        cancelAnimationFrame(keepIn);
        timerEl.remove();
        btns.forEach((n, i) => { n.disabled = true; if (i !== idx) n.classList.add('faded'); });
        setTimeout(() => {
          if (spatial) pins.innerHTML = '';
          resolve(idx);
        }, 450);
      };

      document.addEventListener('visibilitychange', onVis);
      if (document.hidden) fill.style.width = '100%';
      else requestAnimationFrame(run);
    });
  }

  function sceneOpen(img) {
    document.body.classList.add('in-scene');
    scene.className = 'on';
    scene.innerHTML =
      `<div class="scene-frame"><img src="${img}" alt="" decoding="async"></div>` +
      `<div class="scene-frame pins"></div>` +
      `<div class="scene-in"></div>`;
    // 사진의 실제 비율을 알아야 선택지를 사진 속 자리에 맞출 수 있다.
    const im = scene.querySelector('img');
    const setAr = () => {
      if (!im.naturalWidth) return;
      const ar = (im.naturalWidth / im.naturalHeight).toFixed(4);
      [...scene.querySelectorAll('.scene-frame')].forEach((f) => f.style.setProperty('--ar', ar));
    };
    if (im.complete) setAr(); else im.onload = setAr;
    return scene.querySelector('.scene-in');
  }
  function sceneBody() {
    const box = scene.querySelector('.scene-in');
    box.innerHTML = '';
    return box;
  }
  function sceneClose() {
    document.body.classList.remove('in-scene');
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
  // o.auto 를 주면 「계속」을 세우지 않고 그만큼 있다가 저절로 넘어간다.
  function sceneSay(lines, o = {}) {
    return new Promise((resolve) => {
      const box = sceneBody();
      const text = box.appendChild(el('div', 'scene-text'));
      const bar = box.appendChild(el('div', 'scene-foot'));
      let i = 0, timer = null, ended = false, closed = false;

      const step = () => {
        if (i >= lines.length) return arrive();
        const l = lines[i++];
        text.appendChild(sceneNode(l));
        timer = setTimeout(step, l.hr ? 180 : Math.min(1750, revealMs(wordCount(l.s || l.b || l.w || '')) + 130));
      };
      const flush = () => {
        clearTimeout(timer);
        while (i < lines.length) text.appendChild(sceneNode(lines[i++]));
        arrive();
      };
      let tapEl = null;
      const arrive = () => {
        if (ended) return;
        ended = true;
        if (o.auto) { timer = setTimeout(finish, o.auto); return; }
        tapEl = bar.appendChild(el('div', 'tap', '계속'));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        removeEventListener('keydown', onGo, true);
        removeEventListener('click', onGo, true);
        resolve();
      };
      const onGo = (e) => {
        if (!notesBox.hidden) return;
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
      // 도는 중일 때만 멈추고, 멈춰 있을 때만 다시 돈다. 첫 프레임 전에 탭을 가리면
      // 시작 시각이 없어 남은 시간이 0.3초로 깎이고, 되돌아올 때 타이머가 둘 생겨
      // 다시 가려도 하나가 몰래 끝나 버리던 것을 막는다.
      const run = () => {
        if (done || timer || document.hidden) return;
        since = Date.now();
        timer = setTimeout(() => end(-1), left);
        fill.style.transition = `width ${left}ms linear`;
        fill.style.width = '0%';
      };
      const hold = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
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

  // 앞사람 사건 기록. 길면 안 읽는다 — 증거품 몇 줄, 사건일지는 토막 사실로.
  // 수첩 요약은 진술을 낼 때 저장된 문장이라, 여기서 알아보고 짧은 사실로 바꿔 그린다.
  function recordHtml(c) {
    const R = S.act2.record;
    const at = c.caught === 'house' ? 'house' : 'dock';
    const lines = (c.clues && c.clues.length) ? c.clues : [];
    const kept = isKeptJournal(lines);
    const book = kept ? R.kept : lines.length ? R.torn : null;

    const items = R.items[at].slice(0, 2).concat([book ? book.item : R.items[at][2]]);
    const log = R.log[at].slice();
    if (book) {
      const found = R.facts.filter((f) => lines.some((x) => new RegExp(f.re).test(x))).map((f) => f.t);
      // 찢었으면 「수첩을 찢음 · 무엇을 조사했는지」, 안 찢었으면 조사한 내용만(겹치는 말을 줄인다)
      const sub = book === R.kept && found.length ? `수첩: ${found.join(' · ')}` : [book.s].concat(found).join(' · ');
      log.push({ t: book.t, s: sub });
    }
    return `<div class="rec-items"><span class="rec-sec">${esc(R.itemsHead)}</span>${items.map(esc).join(' · ')}</div>` +
      `<ol class="rec-log">${log.map((l) =>
        `<li><b>${esc(l.t)}</b>${l.s ? `<span>${esc(l.s)}</span>` : ''}</li>`).join('')}</ol>` +
      `<div class="rec-stamps"><span class="stamp">${esc(R.stamp)}</span>` +
      (book ? `<span class="stamp">${esc(book.conclude)}</span>` : '') + `</div>`;
  }


  // 다음 사람에게 넘어가는 사건일지. 찢었으면 찢은 요약, 한 장도 안 찢었으면 남긴 요약.
  // 어느 쪽이든 원문이 아니라 무엇에 관한 기록이었는지만 넘어간다. 적은 게 없으면 빈칸.
  function journalSummary() {
    if (state.torn.length) return tornSummary(state.torn);
    if (!state.pages.length) return [];
    const T = S.act2.torn, K = S.act2.kept, pages = state.pages;
    const ko = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱'];
    const out = [K.count.replace('{n}', ko[pages.length] || String(pages.length))];
    if (pages.some((pg) => pg.cat === 'entry')) out.push(T.entry);
    if (pages.some((pg) => pg.cat === 'habit')) out.push(T.habit);
    if (pages.length >= 4) out.push(T.many);
    return out;
  }
  // 저장된 수첩 요약이 어느 쪽인지 — 찢지 않은 수첩의 요약은 첫 줄로 알아본다(옛 문구도 같이)
  const isKeptJournal = (lines) => !!(lines && lines.length && /적힌 장은|찢기지 않은/.test(lines[0]));

  // 찢긴 장에서 떠낸 것. 원문이 아니라 성격만 다음 사람에게 넘어간다.
  function tornSummary(torn) {
    if (!torn.length) return [];
    const T = S.act2.torn;
    const ko = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱'];
    const out = [T.count.replace('{n}', ko[torn.length] || String(torn.length))];
    if (torn.some((p) => p.cat === 'entry')) out.push(T.entry);
    if (torn.some((p) => p.cat === 'habit')) out.push(T.habit);
    if (torn.length >= 4) out.push(T.many);
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

  // 꼭 닿아야 하는 것(판결·진술)을 보낸다. 무료 서버는 한동안 안 쓰면 잠들고, 배포 때도
  // 재시작해서 30~60초쯤 응답이 없다. 그 사이에 한 번 보내고 포기하면 그대로 사라진다.
  // 그래서 연결이 끊기거나 5xx·429 면 간격을 늘려 가며 다시 보낸다(대략 1분 반).
  // 4xx 는 다시 보내도 같은 답이라 바로 멈춘다. 한 번에 20초 넘게 걸리면 끊고 다시.
  async function deliver(path, body, { tries = 9, onRetry } = {}) {
    let pause = 1000, last;
    for (let n = 0; n < tries; n++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        const res = await fetch(path, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: ctl.signal,
        });
        clearTimeout(timer);
        if (res.ok) return res.json();
        last = Object.assign(new Error(`서버 ${res.status}`), { status: res.status });
        if (res.status < 500 && res.status !== 429) throw last;   // 다시 보내도 소용없다
      } catch (e) {
        clearTimeout(timer);
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        last = e;
      }
      if (n < tries - 1) {
        if (onRetry) onRetry(n + 1);
        await new Promise((r) => setTimeout(r, pause));
        pause = Math.min(pause * 2, 15000);
      }
    }
    throw last || new Error('보내지 못했다');
  }

  // 판결 우편함. 보내기 전에 적어 두고, 닿으면 지운다. 끝내 못 보냈으면 다음에 들어올 때
  // 마저 보낸다 — 서버는 같은 사람의 두 번째 판결을 받지 않으므로 다시 보내도 겹치지 않는다.
  const OUTBOX = 'mugo.outbox';
  const outbox = {
    read() { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } },
    write(list) { try { localStorage.setItem(OUTBOX, JSON.stringify(list)); } catch { /* 사생활 모드 */ } },
    put(v) { this.write(this.read().filter((x) => x.caseId !== v.caseId).concat([v])); },
    drop(caseId) { this.write(this.read().filter((x) => x.caseId !== caseId)); },
  };
  function sendVerdict(v) {
    outbox.put(v);
    return deliver('/api/verdict', v)
      .then(() => outbox.drop(v.caseId))
      .catch((e) => {
        if (e.status && e.status < 500) outbox.drop(v.caseId);   // 서버가 거절한 건 다시 보내도 같다
        console.error('[판결 전송 실패 — 다음에 들어오면 다시 보낸다]', e);
      });
  }
  function flushOutbox() {
    outbox.read().forEach((v) => { sendVerdict(v); });
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
    corner.hidden = false;
    document.getElementById('book').onclick = openNotes;
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
      input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) go(); };   // 한글 조합을 끝내는 Enter 는 흘려보낸다
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

    setChapter('오는 길');
    for (const b of S.act0.beats) {
      const i = await choose(b.ask, b.opts.map((o) => o.label));
      state.traces.push(b.opts[i].trace);
      note(b.opts[i].label);
      await say([{ s: b.opts[i].out }]);
    }
    await say(S.act0.arrive);
  }

  /* 1장 — 소장의 코를 납작하게 */
  async function act1() {
    setChapter('제1장 · 명함을 두 번 뒤집는 사람');
    await say(S.act1.open);
    const found = await observe(S.act1.observe);
    found.forEach((f) => note(`${f.tag} — ${f.text}`));
    const perfect = await deduce(S.act1.deduce);
    note(perfect ? '세 가지를 다 맞췄다. 켈러가 십오 분을 내줬다.' : '헛짚은 데가 있었다. 그래도 십오 분은 받았다.');

    const blows = found.map((f) => S.act1.blows[f.id]).filter(Boolean)
      .map((s) => ({ who: '나', s }));
    state.humiliation = found.length + (perfect ? 2 : 0);

    await say(blows.concat(state.humiliation >= 6 ? S.act1.close : S.act1.weak));
  }

  /* 2장 — 앞사람을 판결한다 */
  async function act2(casePromise) {
    setChapter('제2장 · 이름을 대지 않는 남자');
    await say(S.act2.open);

    const c = await casePromise;
    state.caseData = c;
    const lines = (c.clues && c.clues.length) ? c.clues : [];
    const kept = isKeptJournal(lines);
    note(`유치장의 남자 — ${c.name}. ${c.caught === 'house' ? '피범벅이 된 채 저택에서 현행범 체포' : '흉기를 쥔 채 부두 끝에서 체포'}.`);
    if (lines.length && !kept) note('수첩을 찢어 증거를 없애려 했다. 계획 범행.');
    else if (kept) note('수첩에 저택 침입 방법과 피해자에 대한 내용이 자세히 적혀 있었다.');

    await fileCard(S.act2.record.head, recordHtml(c), null, 'record');
    await wait(2400);

    await say(S.act2.after);
    (await observe(S.act2.observe)).forEach((f) => note(`${f.tag} — ${f.text}`));

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
    const qs = threeQs(S.act2, c.caught);
    for (let i = 0; i < 3; i++) {
      await turn(true);   // 묻고 답하는 한 쌍이 한 화면을 통째로 쓴다
      await say([{ who: '나', s: qs[i] }], { silent: true });
      await wait(900);
      const a = (c.answers[i] || '').trim();
      note(`「${qs[i]}」 — ${a || '대답하지 않았다'}`);
      if (a) await say([{ who: '남자', s: a }], { silent: true });
      else addLine(el('p', 'say whisper', words(S.act2.silent)));
      await wait(700);
    }

    await say(S.act2.askVerdict);
    const verdict = await verdictForm();
    state.myVerdict = verdict;
    note(`내가 내린 판결 — ${verdict.v === 'guilty' ? '유죄' : '무죄'}. 「${verdict.reason}」`);


    // 판결을 보낸다. 앞사람에게 메일이 나가는 지점 — 서버가 잠깐 없어도 닿을 때까지 뒤에서 보낸다.
    sendVerdict({
      caseId: c.caseId, verdict: verdict.v, reason: verdict.reason,
      judgeName: state.name, player: state.player,
    });

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
    setChapter('제3장 · 언덕 위의 집');
    await say(S.recon.open);
    const found = await observe(S.recon.observe);
    state.pages = found.map((f) => ({ id: f.id, cat: f.cat, text: f.page }));
    state.pages.forEach((pg) => note(pg.text));

    await say(state.pages.length >= 3 ? S.recon.close : S.recon.lazy);
  }

  /* 4장 — 비명. 들어가는 길은 저녁에 적어둔 만큼만 안다. */
  async function act3() {
    setChapter('제4장 · 자정을 넘겨서');
    await say(S.act3.open);
    const known = new Set(state.pages.map((p) => p.id));
    const idx = await choose(S.act3.ask, S.act3.ways.map((w) => ({
      label: w.label + (known.has(w.need) ? '  — 수첩에 있음' : ''),
      cost: known.has(w.need) ? w.known : w.cost,
    })));
    const way = S.act3.ways[idx];
    state.knewWay = known.has(way.need);
    note(`들어간 길 — ${way.label}${state.knewWay ? ' (저녁에 적어둔 길)' : ''}`);
    state.way = way.label;
    await say([{ s: way.out }, state.knewWay ? { b: S.act3.knew } : { w: S.act3.blind }].concat(S.act3.run));
  }

  /* 5장 — 살릴 수 있을 것 같다. 아니다. */
  async function act4() {
    setChapter('제5장 · 손');
    await say(S.act4.open);

    // 저녁에 길을 적어둔 사람은 한 박자 일찍 닿는다. 그 한 박자만큼 더 희망을 본다.
    const rounds = state.knewWay ? S.act4.rounds : S.act4.rounds.slice(0, 2);
    if (!state.knewWay) await say(S.act4.late, { silent: true });

    for (const r of rounds) {
      const pick = await choose(r.ask, r.opts.map((o) => o.label));
      note(r.opts[pick].label);
      await say([{ s: r.opts[pick].out }].concat(r.after));
    }

    // 숨이 끊기기 전에 범인이 달아난다. 붙들 것인가, 쫓을 것인가 —
    // 그녀의 죽음은 어느 쪽을 골라도 온다(쫓으면 손을 떼는 순간, 붙들면 손 안에서).
    const F = S.act4.fork;
    await say(F.lead, { silent: true });
    const pick = await choose(F.ask, [F.chase.label, F.stay.label]);
    state.chased = pick === 0;
    note(state.chased ? '손을 떼고 쫓았다.' : '손을 떼지 않고 곁에 남았다.');

    await say(state.chased ? F.chase.out : F.stay.out);
  }

  /* 6장 — 서른 걸음 뒤. 갈림길마다 사진이 화면을 덮는다. */
  async function act5() {
    setChapter('제6장 · 서른 걸음 뒤');
    await say(S.act5.open);
    await turn(false);          // 첫 사진이 글자를 밀어내며 튀어나오지 않도록
    for (const j of S.act5.junctions) {
      sceneOpen(j.img);
      slow(true);
      const pick = await sceneTimed(words(j.cue), j.opts, 9);
      slow(false);
      note(`${j.where} — ${pick === j.right ? '길을 맞췄다' : pick < 0 ? '머뭇거렸다' : '헛짚었다'}`);

      if (pick === j.right) await sceneSay([{ s: j.win }]);
      else await sceneSay([{ s: pick < 0 ? S.act5.slow : j.lose }]);
      sceneClose();
    }
  }

  /* 7장 — 어둠. 여기서는 화면을 통째로 쓴다. */
  async function act6() {
    setChapter('제7장 · 널판 끝');
    await say(S.act6.open);
    await turn(false);          // 부두는 눌러서 들어간다

    sceneOpen(S.act6.img);
    await sceneSay(S.act6.seen);
    scene.classList.add('dim');
    await wait(1500);

    for (let i = 0; i < S.act6.beats.length; i++) {
      const b = S.act6.beats[i];
      const last = i === S.act6.beats.length - 1;
      const pick = await sceneBeat(b, 7);
      const line = pick === b.right ? { b: b.win } : { s: b.lose };
      if (pick !== b.right) { state.hits.push(b.hurt); note(b.hurt); }

      // 마지막 합은 흉기가 손에 들어온 것까지 한 화면에 놓고, 누르지 않아도 넘어간다.
      if (last) await sceneSay([line].concat(S.act6.won), { auto: 1600 });
      else await sceneSay([line]);
    }

    flash();
    await wait(620);
    await sceneSay(S.act6.end);
    sceneClose();
  }

  function flash() {
    const f = document.body.appendChild(el('div', 'flash on'));
    setTimeout(() => f.remove(), 700);
  }

  /* 8장 — 체포. 그리고 수첩. */
  async function act7() {
    setChapter('제8장 · 체포');
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
    state.torn.forEach((pg) => note(`찢어냈다 — ${pg.text}`));
    if (!state.torn.length) note('한 장도 찢지 않고 그대로 넘겼다.');

    await say(state.torn.length ? S.act7.found : S.act7.kept);
  }

  /* 8장 — 내 차례 */
  async function act8() {
    setChapter('제9장 · 창이 없는 방');
    await say(S.act8.open);
    const answers = [];
    for (let i = 0; i < 3; i++) {
      await turn(true);
      await say([{ who: '켈러 소장', s: threeQs(S.act8, state.chased ? 'dock' : 'house')[i] }], { silent: true });
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
        input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) r(); };   // 한글 조합을 끝내는 Enter 는 흘려보낸다
      });
      const said = input.value.trim();
      answers.push(said);
      note(`「${threeQs(S.act8, state.chased ? 'dock' : 'house')[i]}」 — ${said || '……'}`);

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
        // 서버와 같은 규칙. 우편이 알아볼 수 있는 영문 주소만 받는다.
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v)) {
          err.textContent = '그건 주소가 아니오. 우편이 알아볼 수 있게 영문으로 대시오.';
          err.style.display = '';
          return;
        }
        r(v);
      };
      input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) ok.onclick(); };
    });
    opts.innerHTML = '';

    // 복면
    const hood = document.body.appendChild(el('div', 'hood'));
    requestAnimationFrame(() => hood.classList.add('on'));
    await wait(1800);

    let res = null;
    const body = {
      player: state.player, name: state.name, answers, clues: journalSummary(),
      caught: state.chased ? 'dock' : 'house', email,
    };
    // 서버가 막 깨어나거나 재시작하는 중이면 닿을 때까지 기다렸다 보낸다(대략 1분 반).
    // 같은 판의 진술엔 같은 번호를 붙여서, 응답만 끊겼다가 다시 보내도 두 번 들어가지 않는다.
    body.nonce = state.nonce || (state.nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()));
    try {
      res = await deliver('/api/statement', body, {
        onRetry: () => { hood.textContent = '서기가 조서를 옮겨 적고 있다…'; hood.classList.add('busy'); },
      });
    } catch (e) {
      console.error('[진술 제출 실패]', e);
    }

    clear();
    hood.remove();

    await say(S.act9.sealed.concat(
      res ? [{ w: `대기열 ${res.queued}번. 앞에 ${Math.max(0, res.queued - 1)}명이 더 기다리고 있다.` }]
          // 예전엔 실패해도 아무 말이 없어서, 주소를 적은 사람은 판결 메일을 하염없이 기다렸다
          : [{ s: '진술서가 경찰서에 닿지 못했다. 이번 진술은 대기열에 오르지 않았고, 판결 통지도 가지 않는다.' }],
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

    // 처음으로 돌아가기 전에, 이 밤에 무엇을 골랐는지 한 장에 펼친다.
    await showChoices(answers);

    const end = setFoot(el('div'));
    end.style.cssText = 'display:flex;flex-direction:column;gap:12px';
    const endRow = end.appendChild(el('div', 'row'));
    const again = endRow.appendChild(el('button', 'btn ghost', '처음으로'));
    again.onclick = () => { location.href = location.pathname; };
    end.appendChild(footerNode('주소는 판결 통지를 보내고 나면 지워진다.'));
  }

  // 끝에서 되짚는다. 비명 이후 네 갈래 — 들어간 길, 쫓았나, 수첩, 심문 — 와
  // 그래서 무엇이 달라졌는지만 한 줄씩.
  async function showChoices(answers = []) {
    const rows = [];
    const add = (what, then) => rows.push({ what, then });

    add(`저녁에 수첩에 ${state.pages.length}곳을 적고, 비명 뒤에 「${state.way}」`,
      state.knewWay ? '적어둔 길이라 한 박자 먼저 닿았다. 살릴 기회가 세 번 있었다'
                    : '헤매느라 늦었다. 살릴 기회는 두 번뿐이었다');

    add(state.chased ? '손을 떼고 쫓았다' : '손을 떼지 않고 곁에 남았다',
      state.chased ? '부두 끝에서 흉기를 쥔 채 잡혔다'
                   : '피투성이로 그녀의 목을 누른 채 저택에서 잡혔다');

    if (state.pages.length) {
      add(state.torn.length ? `수첩에서 ${state.torn.length}장을 찢었다` : '수첩을 한 장도 찢지 않았다',
        state.torn.length ? '찢은 자리가 들켰다. 다음 사람에게 「증거를 없애려 한 계획 범행」으로 넘어간다'
                          : '켈러가 끝까지 읽었다. 다음 사람에게 「철저히 계획했다」로 넘어간다');
    } else {
      add('수첩에 적은 것이 없었다', '찢을 것도 숨길 것도 없었다');
    }

    const said = answers.map((a) => (a || '').trim() || '……');
    if (said.length) add(`심문에서 「${said.join('」 「')}」`, '다음 사람이 당신 입에서 이 세 마디를 듣는다');

    await turn(true);
    const card = el('div', 'file recap');
    card.appendChild(el('h4', null, '이 밤에 당신이 정한 것'));
    const body = card.appendChild(el('div', 'recap-body'));
    rows.forEach((r) => {
      const item = body.appendChild(el('div', 'recap-item'));
      item.appendChild(el('div', 'recap-what', esc(r.what)));
      item.appendChild(el('div', 'recap-then', esc(r.then)));
    });
    flow.appendChild(card);
    body.scrollTop = 0;

    // 넘겨 볼 게 남았을 때만 「아래로」를 띄우고, 끝에 닿으면 걷는다
    const more = card.appendChild(el('div', 'recap-more', '아래로 넘겨 보시오'));
    const edge = () => {
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
      body.classList.toggle('at-end', atEnd);
      more.classList.toggle('gone', atEnd);
    };
    body.addEventListener('scroll', edge, { passive: true });
    // 글꼴이 늦게 들어오거나 창 크기가 바뀌면 넘치는지가 달라진다. 그때마다 다시 잰다.
    if (window.ResizeObserver) new ResizeObserver(edge).observe(body);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(edge);
    edge();
  }

  /* ── 돌아온 사람 — 「○○님이신가요?」 ─────────────────── */

  // 이 브라우저로 낸 가장 최근 진술에 판결이 났으면 이름으로 묻는다. 조서 하나에 딱 한 번 —
  // 판결문을 읽든 아니라고 하든 그 조서로는 다시 묻지 않는다. 다른 브라우저에서 온 사람에게는
  // 플레이어 번호가 달라 아무것도 뜨지 않는다. 이 브라우저로 새로 한 판을 끝내면 그 사람 진술이
  // 「가장 최근」이 되므로, 다음부터는 그 이름으로 묻는다.
  const ASKED = 'mugo.asked';
  const askedTokens = () => { try { return JSON.parse(localStorage.getItem(ASKED) || '[]'); } catch { return []; } };
  const markAsked = (token) => {
    try { localStorage.setItem(ASKED, JSON.stringify(askedTokens().concat([token]).slice(-20))); } catch { /* 사생활 모드 */ }
  };

  // 물었고 판결문을 읽으러 갔으면 true — 그 경우 여기서 페이지를 옮기므로 부르는 쪽은 멈춘다
  async function askReturning() {
    let me;
    try {
      me = await Promise.race([
        api('/api/mine', { player: state.player }),
        new Promise((_, no) => setTimeout(() => no(new Error('늦다')), 5000)),   // 늦으면 묻지 않고 넘어간다
      ]);
    } catch { return false; }
    if (!me || !me.found || !me.judged || askedTokens().includes(me.token)) return false;

    wipe();
    stage.classList.add('mid');
    const unnamed = /말하지 않았다|^\s*$/.test(me.name || '');
    const who = unnamed ? '지난번에 이 브라우저로 진술하신 분' : `${me.name}님`;
    const box = addLine(el('div', 'title returning'));
    box.innerHTML =
      `<p class="ask-who">${esc(who)}이신가요?</p>` +
      `<p class="gloss">당신의 진술에 대한 판결이 도착했습니다.</p>`;

    const foot = setFoot(el('div'));
    foot.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:center';
    const row = foot.appendChild(el('div', 'row'));
    row.style.justifyContent = 'center';
    const read = row.appendChild(el('button', 'btn', '판결문 읽기'));
    const notMe = row.appendChild(el('button', 'btn ghost',
      unnamed ? '저는 아닙니다' : `저는 ${esc(me.name)}${josa(me.name, '이/가')} 아닙니다`));
    foot.appendChild(el('p', 'once-note',
      '이 질문은 한 번만 드립니다. 어느 쪽을 고르든 다시 묻지 않습니다.<br>' +
      '판결문은 게임 마지막에 받은 조서 번호 링크로 언제든 다시 볼 수 있습니다.'));

    const pick = await new Promise((r) => { read.onclick = () => r(true); notMe.onclick = () => r(false); });
    markAsked(me.token);
    if (pick) { location.href = location.pathname + '?t=' + encodeURIComponent(me.token); return true; }
    stage.classList.remove('mid');
    return false;
  }

  /* ── 판결 확인 페이지 ───────────────────────────────── */

  // 판결 통지. 법원에서 온 봉투를 뜯어 통지서를 꺼내 읽는 장면으로 보여준다.
  // 줄글을 넘기는 게임 화면과 달리, 뜸을 들이고 도장을 찍는 연출이 전부라 따로 그린다.
  async function lookup(token) {
    clear();
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pause = (ms) => wait(calm ? Math.min(ms, 250) : ms);

    // 뒤에 깔린 화면 전체 입자·비네트는 통지서가 덮는다. 보이지도 않는데 계속 그리면 끊긴다
    for (const id of ['grain', 'vignette']) { const n = document.getElementById(id); if (n) n.hidden = true; }
    const root = document.body.appendChild(el('div', 'notice'));
    root.appendChild(el('div', 'notice-light'));
    root.appendChild(el('div', 'notice-warm'));
    const flash = root.appendChild(el('div', 'notice-flash'));
    const stage = root.appendChild(el('div', 'notice-stage'));
    requestAnimationFrame(() => root.classList.add('on'));
    corner.hidden = true;

    const button = (label, cls = 'btn') => new Promise((resolve) => {
      const b = stage.appendChild(el('button', `${cls} notice-btn`, esc(label)));
      requestAnimationFrame(() => b.classList.add('on'));
      b.onclick = () => { b.remove(); resolve(); };
    });
    const endButtons = () => {
      const f = stage.appendChild(el('div', 'notice-end'));
      const b = f.appendChild(el('button', 'btn', '처음으로'));
      b.onclick = () => { location.href = location.pathname; };
      f.appendChild(footerNode());
      requestAnimationFrame(() => f.classList.add('on'));
    };

    // 메일 링크로 들어오면 무료 서버가 자고 있다가 깨는 중일 때가 많다(30~60초).
    // 그 사이의 끊김·5xx 를 「없는 조서」로 말하면 판결을 영영 못 본 줄 안다.
    let r = null, missing = false;
    const waitNote = stage.appendChild(el('p', 'notice-line', '법원 서기가 서류철을 찾고 있다…'));
    for (let n = 0, gap = 1500; n < 8 && !r && !missing; n++, gap = Math.min(gap * 2, 12000)) {
      try {
        const res = await fetch('/api/statement/' + encodeURIComponent(token), { cache: 'no-store' });
        if (res.status === 404) missing = true;
        else if (res.ok) r = await res.json();
      } catch { /* 아직 안 깼다 */ }
      if (!r && !missing) { if (n === 1) waitNote.classList.add('on'); await wait(gap); }
    }
    waitNote.remove();
    if (!r) {
      stage.appendChild(el('p', 'notice-line on', missing
        ? '그런 조서는 없다. 번호를 다시 보시오.'
        : '법원이 답하지 않는다. 잠시 뒤에 이 링크를 다시 여시오.'));
      return endButtons();
    }

    const list = !r.judged ? [] : (r.verdicts && r.verdicts.length)
      ? r.verdicts : [{ verdict: r.verdict, reason: r.reason, judgeName: r.judgeName }];

    // 봉투 — 우편으로 온 앞면. 윗단을 뜯어 연다
    // 찢긴 선 하나를 띠와 봉투가 나눠 갖는다 — 띠는 아랫단, 봉투는 윗단이 톱니가 된다
    const jag = Array.from({ length: 23 }, (_, k) => [k / 22 * 100, k % 2 ? 100 : 74 + (k * 37 % 17)]);
    const torn = [...jag].reverse().map(([x, y]) => `${x.toFixed(1)}% ${y}%`).join(',');
    const left = jag.map(([x, y]) => `${x.toFixed(1)}% ${(y * .17).toFixed(1)}%`).join(',');
    const env = stage.appendChild(el('div', 'env',
      `<div class="env-paper"><b class="env-title">판결문</b></div>` +
      `<div class="env-strip" style="clip-path:polygon(0 0,100% 0,${torn})"></div>`));
    await pause(700);
    env.classList.add('on');
    await pause(900);

    // 아직 판결 전 — 봉투는 열리지 않는다
    if (!list.length) {
      const note = stage.appendChild(el('div', 'notice-lines'));
      [`${r.name}. 당신의 조서는 아직 봉해진 채다.`,
        '다음에 회항에 들어오는 탐정이 이 조서를 읽는다. 언제 올지는 아무도 모른다.']
        .forEach((t) => note.appendChild(el('p', 'notice-line', esc(t))));
      for (const p of note.children) { p.classList.add('on'); await pause(700); }
      return endButtons();
    }

    await button('봉투를 뜯는다');
    env.querySelector('.env-paper').style.clipPath = `polygon(${left},100% 100%,0 100%)`;
    env.classList.add('open');
    await pause(700);
    env.classList.add('out');
    await pause(600);
    env.remove();

    for (let i = 0; i < list.length; i++) {
      await sheet(list[i], i);
      if (i < list.length - 1) {
        await button('다음 통지를 편다', 'btn ghost');
        const prev = stage.querySelector('.sheet:not(.gone)');
        prev.classList.add('gone');
        await pause(600);
        prev.remove();
      }
    }

    endButtons();

    // 통지서 한 장 — 한 줄씩 올라오다, 주문에서 숨을 멈추고, 도장이 떨어진다.
    // 줄은 처음부터 자리를 잡아 둔다. 나올 때마다 밀려나면 화면이 덜컥거린다.
    async function sheet(v, i) {
      const guilty = v.verdict === 'guilty';
      const judge = v.judgeName || '이름을 밝히지 않은 탐정';
      const lines = guilty ? [
        ['sh-sentence', '선고 — 사형'],
        ['', '재판은 열렸으나 오래 걸리지 않았다. 회항에서 탐정의 말은 판결과 같은 무게를 가진다. 배심원은 십일 분 만에 돌아왔다.'],
        ['', '회항에는 상소할 곳이 없다. 판결이 떨어지자 당신은 그 자리에서 끌려 나갔고, 형은 그날 부두 창고 앞 광장에서 곧바로 집행됐다.'],
        ['sh-quiet', '안개가 짙어 구경꾼은 많지 않았다.'],
      ] : [
        ['sh-sentence calm', '석방'],
        ['', '재판은 열리지 않았다. 증거가 사람을 목매달 만큼은 아니었다.'],
        ['', '서류에 도장이 찍혔고, 당신은 그날 밤 뒷문으로 나왔다.'],
        ['sh-quiet', '아무도 사과하지 않았다. 안개 속으로 걸어 나가는 당신의 뒷모습을 간수 하나가 오래 지켜봤다고 한다.'],
      ];

      const paper = stage.appendChild(el('article', 'sheet'));
      paper.innerHTML =
        `<header class="sh-head sh-part"><span>회항 지방법원</span><span>판결 통지</span></header>` +
        `<dl class="sh-meta">` +
          `<div class="sh-part"><dt>피고인</dt><dd>${esc(r.name)}</dd></div>` +
          `<div class="sh-part"><dt>사건</dt><dd>웬들 저택 살인</dd></div>` +
          `<div class="sh-part"><dt>심리</dt><dd>탐정 ${esc(judge)}</dd></div>` +
        `</dl>` +
        `<p class="sh-lead sh-part">${esc(r.name)}. 탐정 ${esc(judge)}${josa(judge, '이/가')} 당신의 진술을 읽었다.</p>` +
        `<div class="sh-order sh-part"><span class="sh-label">주문</span><span class="sh-dots"><i></i><i></i><i></i></span></div>` +
        `<div class="sh-verdict ${guilty ? 'guilty' : 'innocent'}"><span>${guilty ? '유죄' : '무죄'}</span></div>` +
        `<div class="sh-body">${lines.map(([c, t]) => `<p class="${c}">${esc(t)}</p>`).join('')}</div>` +
        (v.reason ? `<blockquote class="sh-reason sh-part"><span>탐정의 소견</span><p>${esc(v.reason)}</p></blockquote>` : '') +
        `<p class="sh-ps sh-part">당신을 판결한 사람도 당신과 똑같은 밤을 보냈고, 지금 어딘가에서 자기 판결을 기다리고 있다.</p>` +
        `<footer class="sh-foot sh-part">회항 지방법원</footer>`;

      stage.scrollTop = 0;
      root.classList.remove('after-guilty', 'after-innocent');   // 앞 통지서의 기운을 걷는다
      requestAnimationFrame(() => paper.classList.add('on'));
      await pause(900);

      for (const p of paper.querySelectorAll('.sh-head, .sh-meta .sh-part, .sh-lead, .sh-order')) {
        p.classList.add('on'); await pause(520);
      }

      // 뜸 — 도장 자리가 화면에 들어오게 미리 옮겨 두고, 점이 찍히는 동안 방이 조여 온다
      const mark = paper.querySelector('.sh-verdict');
      follow(mark, 'center');
      root.classList.add('hush');
      for (const d of paper.querySelectorAll('.sh-dots i')) { d.classList.add('on'); await pause(780); }
      await pause(700);

      if (guilty) {
        mark.classList.add('slam');
        await pause(calm ? 0 : 170);
        root.classList.remove('hush');
        root.classList.add('impact');          // 흔들림 · 붉은 번쩍임 · 가장자리가 닫힌다
        flash.classList.add('on');
        await pause(140);
        flash.classList.remove('on');          // 번쩍임은 한순간. 붉은 기운이 가장자리로 스며든다
        await pause(1900);                     // 아무것도 오지 않는다. 숨이 멎은 채로
      } else {
        mark.classList.add('press');
        await pause(300);
        root.classList.remove('hush');
        root.classList.add('relief');
        await pause(1100);
      }

      for (const p of paper.querySelectorAll('.sh-body p')) {
        p.classList.add('on');
        follow(p);
        await pause(guilty ? 1100 : 800);
      }
      root.classList.remove('impact', 'relief');
      root.classList.add(guilty ? 'after-guilty' : 'after-innocent');

      for (const p of paper.querySelectorAll('.sh-reason, .sh-ps, .sh-foot')) {
        p.classList.add('on');
        follow(p);
        await pause(900);
      }
    }

    // 나온 줄이 화면 아래로 벗어났을 때만 부드럽게 따라간다. 이미 보이면 가만히 둔다.
    function follow(node, where = 'end') {
      const box = stage.getBoundingClientRect(), n = node.getBoundingClientRect();
      const target = where === 'center'
        ? stage.scrollTop + n.top - box.top - (box.height - n.height) / 2
        : stage.scrollTop + n.bottom - box.bottom + 36;
      if (where !== 'center' && n.bottom <= box.bottom - 24) return;
      if (where === 'center' && n.top >= box.top + box.height * .2 && n.bottom <= box.bottom - box.height * .2) return;
      stage.scrollTo({ top: Math.max(0, target), behavior: calm ? 'auto' : 'smooth' });
    }
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

    // 이 브라우저로 진술했던 사람이 돌아왔고 판결이 났으면, 한 번만 묻는다
    if (await askReturning()) return;

    await titleScreen();

    // 앞사람 진술은 미리 받아둔다. 2장에서 기다리는 일이 없도록.
    flushOutbox();
    const casePromise = deliver('/api/case', { player: state.player }, { tries: 5 })
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
