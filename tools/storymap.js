'use strict';

// 대본에서 분기도를 뽑는다.
//   node tools/storymap.js [나갈파일]
// story.js / plates.js 를 그대로 읽으므로, 선택지를 고치면 도표도 같이 바뀐다.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['public/plates.js', 'public/story.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const S = sandbox.window.STORY;
const P = sandbox.window.PLATES;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── 도표에 실을 정거장들 ──────────────────────────────────── */

const beat = (i) => S.act0.beats[i];

// 저택 답사에서 적은 장이 제4장의 어느 경로를 싸게 만드는지
const ROUTE = {};
S.act3.ways.forEach((w) => { ROUTE[w.need] = w; });
const RISK_KO = ['불리하지 않음', '조금 불리', '불리', '아주 불리'];

const spotRows = (plate) => P[plate].spots.map((sp) => {
  const later = [];
  if (plate === 'office') {
    const blow = S.act1.blows[sp.id];
    if (blow) later.push({ scope: 'run', to: 'A1-E', text: `제1장 마무리에서 이 한마디를 실제로 말한다 — “${blow}”` });
    later.push({ scope: 'run', to: 'A8-T', text: '관찰 하나당 굴욕도 +1. 6 이상이면 제8장에서 켈러가 앙갚음한다' });
  }
  if (plate === 'cell') {
    later.push({ scope: 'now', text: '수치로는 아무것도 안 바뀐다. 판결을 내리는 건 당신이고, 이건 전부 양쪽으로 읽힌다' });
  }
  if (plate === 'manor') {
    const w = ROUTE[sp.id];
    if (w) later.push({ scope: 'run', to: 'A4-W', text: `제4장 「${w.label}」 비용이 −${w.cost}에서 −${w.known}로 내려간다` });
    else later.push({ scope: 'run', to: 'A4-W', text: '진입 경로에는 영향 없음' });
    later.push({ scope: 'across', to: 'A8-T', text: `제8장 찢을 후보에 오른다 — ${RISK_KO[sp.risk] || ''}` });
  }
  return {
    label: sp.tag,
    out: sp.text,
    tag: sp.risk != null ? `위험도 ${sp.risk}` : null,
    later,
  };
});

const STATIONS = [
  { id: 'P0', act: '제0장', title: '편지', kind: 'scene',
    body: `${S.letter.head} — “${S.letter.body[2]}” · 서명 ${S.letter.sign}`,
    note: '보낸 사람은 마르타 웬들. 제5장에서 당신 손 안에서 죽는 사람이다.' },

  ...[0, 1, 2, 3].map((i) => ({
    id: 'P' + (i + 1), act: '제0장', title: beat(i).ask, kind: 'choice',
    rows: beat(i).opts.map((o) => ({
      label: o.label, out: o.out, tag: o.trace,
      later: [{ scope: 'run', to: 'A2-R', text: `유치장의 남자가 이렇게 말한다 — “${S.act2.read.lines[o.trace]}”` }],
    })),
    note: i === 0 ? '넷 중 셋만 무작위로 튀어나온다. 나머지 하나는 그냥 묻힌다.' : null,
  })),

  { id: 'NM', act: '제0장', title: '장부에 적을 이름', kind: 'input',
    body: '자유 입력 (24자). 다음 사람이 판결할 때 이 이름으로 보이고, 판결 메일에도 이 이름이 실린다.' },

  { id: 'A1-O', act: '제1장', title: '소장실 관찰', kind: 'observe',
    body: `${P.office.spots.length}군데 중 ${S.act1.observe.need}군데 이상. 본 것만 나중에 입 밖으로 나온다.`,
    rows: spotRows('office') },
  { id: 'A1-D', act: '제1장', title: '추론 — 세 문항', kind: 'deduce',
    rows: S.act1.deduce.questions.map((q) => ({
      label: q.q,
      out: `정답: ${q.opts[q.right]}   ·   오답 시 안내: ${q.wrong}`,
      later: [{ scope: 'run', to: 'A1-E', text: '세 문항을 한 번도 안 틀리면 굴욕도 +2. 틀려도 진행은 막히지 않는다' }],
    })),
    note: '한 번도 안 틀리면 +2. 관찰 수 + 이 점수가 6 이상이면 소장이 완전히 무너지고, 제8장에서 그가 앙갚음한다.' },
  { id: 'A1-E', act: '제1장', title: '결과', kind: 'gate',
    rows: [
      { label: '굴욕도 6 이상 (관찰 수 + 무오답 2점)', out: S.act1.close[S.act1.close.length - 1].s,
        later: [{ scope: 'run', to: 'A8-T', text: '제8장에서 켈러가 앙갚음한다 — “이번엔 내가 읽어보겠소”' }] },
      { label: '6 미만', out: S.act1.weak[S.act1.weak.length - 1].s,
        later: [{ scope: 'run', to: 'A8-T', text: '제8장에서 켈러가 눈을 안 마주치고 미안해한다' }] },
    ] },

  { id: 'A2-N', act: '제2장', title: '앞사람의 수첩 — 찢긴 자리', kind: 'inbound',
    body: '앞사람이 제8장에서 찢어낸 장의 “성격”만 넘어온다. 원문은 안 보인다.',
    rows: [
      { label: '앞사람이 찢은 게 있음', out: S.act2.notebook.torn,
        later: [{ scope: 'across', text: `“${S.act2.torn.tail}” — 원문은 안 보이고, 무엇에 관한 장이었는지만 온다` }] },
      { label: '앞사람이 하나도 안 찢음', out: S.act2.notebook.clean,
        later: [{ scope: 'across', text: '판단할 재료가 그만큼 줄어든다' }] },
    ] },
  { id: 'A2-O', act: '제2장', title: '남자 관찰', kind: 'observe',
    body: `${P.cell.spots.length}군데 중 ${S.act2.observe.need}군데 이상. 전부 양쪽으로 읽히도록 쓰여 있다.`,
    rows: spotRows('cell') },
  { id: 'A2-R', act: '제2장', title: '남자가 나를 읽는다', kind: 'inbound',
    body: '제0장에서 고른 흔적 넷 중 셋이 무작위로 튀어나온다.',
    rows: Object.entries(S.act2.read.lines).map(([k, v]) => ({
      label: k, out: v,
      later: [{ scope: 'run', text: 'P1~P4에서 그 흔적을 골랐을 때만 나온다' }],
    })) },
  { id: 'A2-Q', act: '제2장', title: '세 질문', kind: 'inbound',
    rows: S.act2.questions.map((q, i) => ({
      label: `${i + 1}. ${q}`, out: '앞사람이 A9-Q에서 직접 쓴 답이 그대로 나온다',
      later: [{ scope: 'across', to: 'A9-Q', text: '당신도 제9장에서 같은 질문을 받는다 — 그건 아직 모른다' }],
    })) },

  { id: 'A2-V', act: '제2장', title: '판결', kind: 'fork', heavy: true,
    body: '한 줄 소견은 앞사람에게 그대로 간다. 이 시점에 앞사람의 메일이 발송된다.',
    lanes: [
      { label: '유죄 — 재판으로', tone: 'bad',
        out: S.act2.guilty.slice(1).map((l) => l.s || l).filter((x) => typeof x === 'string')[2],
        sets: '앞사람에게 「유죄」 통지. 이야기는 그대로 이어짐' },
      { label: '무죄 — 풀어준다', tone: 'cold',
        out: S.act2.innocent.filter((l) => l.b)[0].b,
        sets: '앞사람에게 「무죄」 통지. 이야기는 그대로 이어짐' },
    ],
    note: '두 갈래 모두 제3장으로 합류한다. 갈리는 것은 앞사람의 운명뿐.' },

  { id: 'A3-O', act: '제3장', title: '저택 답사 — 수첩을 쓰는 유일한 장면', kind: 'observe', heavy: true,
    body: `${P.manor.spots.length}군데 중 ${S.recon.observe.need}~${S.recon.observe.max}군데. 여기 적은 것이 수첩의 전부이고, 제8장에서 찢을 수 있는 후보다.`,
    rows: spotRows('manor'),
    note: '많이 적을수록 제4장이 쉬워지고, 제8장에서 불리해진다. 그게 이 게임의 거래다.' },

  { id: 'A4-W', act: '제4장', title: '어디로 들어갈 것인가', kind: 'choice',
    body: '수첩에 적어둔 경로는 값이 싸다. 박동 예산 = 7 − 여기서 쓴 값 (최소 2).',
    rows: S.act3.ways.map((w) => ({
      label: w.label,
      out: w.out,
      tag: `수첩에 있으면 −${w.known} · 없으면 −${w.cost}`,
      later: [
        { scope: 'run', to: 'A5-B', text: '수첩에 있는 길이면 제5장에서 선택이 한 번 더 주어진다 (희망을 한 번 더 본다)' },
        { scope: 'run', text: '저녁에 적어둔 길로 들어가면 “가장 빠른 길을 이미 알고 있었다”가 된다' },
      ],
    })),
    note: '알고 들어가면 빠르다. 그리고 “이 집에 들어오는 가장 빠른 길을 이미 알고 있었다”가 된다.' },

  { id: 'A5-B', act: '제5장', title: '지혈 — 세 번의 선택', kind: 'choice',
    body: '숫자도 자원도 없다. 무엇을 골라도 나아지는 것처럼 보이고, 무엇을 골라도 그녀는 죽는다.',
    rows: S.act4.rounds.map((r, i) => ({
      label: `${i + 1}. ${r.ask}`,
      out: r.opts.map((o) => o.label).join(' / '),
      tag: i === 2 ? '수첩에 길을 적어둔 경우에만' : null,
      later: [{ scope: 'now', text: `무엇을 고르든 → ${(r.after[0].b || r.after[0].s || '').slice(0, 40)}…` }],
    })),
    note: '제4장에서 저녁에 적어둔 길로 들어갔으면 세 번, 헤맸으면 두 번. 그 한 번만큼 희망을 덜 본다.' },

  { id: 'A5-F', act: '제5장', title: S.act4.fork.ask, kind: 'fork', heavy: true,
    lanes: [
      { label: S.act4.fork.chase.label, tone: 'warm',
        out: S.act4.fork.chase.out.map((l) => l.b || l.s).slice(-2).join(' '),
        sets: '제6장 추격 · 제7장 어둠 → 부두에서 체포' },
      { label: S.act4.fork.stay.label, tone: 'cold',
        out: S.act4.fork.stay.out.map((l) => l.b || l.s).slice(-1)[0],
        sets: '제6·7장 통째로 건너뜀 → 저택 안에서 체포' },
    ],
    note: '놓아주면 추격 장면이 없다. 그만큼 이야기가 짧아지고, 몸에 남는 상처도 없다.' },

  { id: 'A6-J', act: '제6장', title: '갈림길 셋 (제한 9초)', kind: 'timed',
    body: '쫓기를 골랐을 때만. 틀려도 이야기는 이어지고, 거리만 벌어진다.',
    rows: S.act5.junctions.map((j) => ({
      label: `${j.where} — ${j.cue}`,
      out: `정답: ${j.opts[j.right]}   ·   틀리면: ${j.lose}`,
      later: [{ scope: 'now', text: '맞히든 틀리든 다음 갈림길로 간다. 서술만 달라진다' }],
    })) },

  { id: 'A7-B', act: '제7장', title: '어둠 속 몸싸움 (제한 7초)', kind: 'timed',
    body: '화면이 거의 검다. 선택지는 소리가 난 쪽에 놓인다. 고르면 성공/빗나감이 작게 뜬다.',
    rows: S.act6.beats.map((b) => ({
      label: b.cue.replace(/<\/?em>/g, ''),
      out: `${b.opts.map((o) => o.label).join(' / ')}  →  정답: ${b.opts[b.right].label}`,
      tag: { lr: '좌 · 우', ud: '위 · 아래', center: '가운데 3' }[b.layout],
      later: [{ scope: 'now', text: `틀리면 「${b.hurt}」. 서술만 바뀌고 뒤에는 영향이 없다` }],
    })) },

  { id: 'A8-T', act: '제8장', title: '수첩에서 찢어낼 장', kind: 'fork', heavy: true,
    body: '제3장에서 적은 장들이 그대로 목록이 된다. 몇 장이든 고를 수 있다.',
    lanes: [
      { label: '찢는다', tone: 'bad',
        out: S.act7.found[2].s,
        sets: '찢긴 자리가 들통난다. 남은 장은 아무도 안 읽는다. → 다음 사람에게 「계획적이었다」로 전달' },
      { label: '그대로 넘긴다', tone: 'cold',
        out: S.act7.kept[2].s,
        sets: '다음 사람은 찢긴 자리가 없다는 것만 본다' },
    ],
    note: '이 게임에서 가장 중요한 선택. 숨기려 한 것만 다음 사람에게 넘어간다.' },

  { id: 'A9-Q', act: '제9장', title: '내 진술 — 세 마디', kind: 'outbound', heavy: true,
    body: '자유 입력, 각 140자. 이 세 문장이 다음 사람의 화면에 그대로 뜬다.',
    rows: S.act8.questions.map((q, i) => ({
      label: `${i + 1}. ${q}`, out: '자유 입력 (140자)',
      later: [{ scope: 'across', to: 'A2-Q', text: '다음 사람의 제2장 화면에 이 문장이 그대로 뜬다' }],
    })) },

  { id: 'A10', act: '제9장', title: '복면, 그리고 주소', kind: 'outbound',
    body: '주소는 판결 한 통을 보내는 데만 쓰이고, 보낸 뒤 지워진다. 안 대도 조서 번호로 직접 확인할 수 있다.',
    rows: [
      { label: '주소를 댄다', out: '접수 메일이 바로 가고, 판결 메일은 다음 사람이 판결하는 순간 간다',
        later: [{ scope: 'across', text: '주소는 그 한 통을 보내고 나면 서버에서 지워진다' }] },
      { label: '대지 않는다', out: '조서 번호(URL)로만 확인. 대기열 등록은 똑같이 된다',
        later: [{ scope: 'across', text: '판결이 나도 알림이 없다. 직접 들어와서 봐야 한다' }] },
    ] },

  { id: 'END', act: '끝', title: '밝혀지는 것', kind: 'scene',
    body: '앞사람이 실제 플레이어였는지, 미리 써둔 조서였는지가 마지막에 공개된다.',
    note: '여기서 처음으로 “나도 다음 사람에게 넘어간다”가 드러난다. 그 전까지는 어디에도 안 적혀 있다.' },
];

/* ── 사람이 넘기는 것들 (장면을 가로지르는 네 갈래) ─────────── */

const CHANNELS = [
  { k: '흔적', from: '제0장 · 오는 길의 선택', to: '제2장 · 남자가 나를 읽는다', who: '나 → 나' },
  { k: '수첩', from: '제3장 · 저택 답사', to: '제4장 진입 비용 · 제8장 찢을 목록', who: '나 → 나' },
  { k: '찢긴 자리', from: '제8장 · 내가 숨긴 것', to: '다음 사람의 제2장 압수품', who: '나 → 다음 사람' },
  { k: '세 마디', from: '제9장 · 내 진술', to: '다음 사람의 제2장 심문', who: '나 → 다음 사람' },
  { k: '판결', from: '제2장 · 내가 내린 한마디', to: '앞사람의 편지함', who: '나 → 앞사람' },
];

/* ── 그리기 ────────────────────────────────────────────────── */

const KIND = {
  scene:    { ko: '장면',   cls: 'k-scene' },
  choice:   { ko: '선택',   cls: 'k-choice' },
  observe:  { ko: '관찰',   cls: 'k-observe' },
  deduce:   { ko: '추론',   cls: 'k-deduce' },
  timed:    { ko: '제한시간', cls: 'k-timed' },
  fork:     { ko: '분기',   cls: 'k-fork' },
  gate:     { ko: '판정',   cls: 'k-gate' },
  input:    { ko: '입력',   cls: 'k-input' },
  inbound:  { ko: '받는 것', cls: 'k-in' },
  outbound: { ko: '넘기는 것', cls: 'k-out' },
};

const SCOPE = { now: '이 장면에서 끝', run: '이 판 뒤쪽으로', across: '사람을 넘어감' };

function laterHtml(later) {
  if (!later || !later.length) return '';
  return later.filter(Boolean).map((x) => `
    <p class="r-later s-${esc(x.scope)}">
      <span class="arrow" aria-hidden="true">↳</span>
      <span class="scope">${esc(SCOPE[x.scope] || '')}</span>
      ${x.to ? `<a class="goto" href="#n-${esc(x.to)}">${esc(x.to)}</a>` : ''}
      <span class="ltext">${esc(x.text)}</span>
    </p>`).join('');
}

function rowsHtml(rows) {
  return `<ul class="rows">` + rows.map((r) => `
    <li>
      <div class="r-head">
        <span class="r-label">${esc(r.label)}</span>
        ${r.tag ? `<span class="r-tag">${esc(r.tag)}</span>` : ''}
      </div>
      ${r.out ? `<p class="r-out">${esc(r.out)}</p>` : ''}
      ${r.sets ? `<p class="r-sets">${esc(r.sets)}</p>` : ''}
      ${laterHtml(r.later)}
    </li>`).join('') + `</ul>`;
}

function lanesHtml(lanes) {
  return `<div class="lanes">
    <svg class="fork-y" viewBox="0 0 200 34" aria-hidden="true" preserveAspectRatio="none">
      <path d="M100 0 V12 M100 12 H16 V34 M100 12 H184 V34" fill="none" stroke="currentColor" stroke-width="1.4"/>
    </svg>
    <div class="lane-grid">` + lanes.map((l) => `
      <div class="lane lane-${esc(l.tone || 'cold')}">
        <div class="lane-label">${esc(l.label)}</div>
        ${l.out ? `<p class="lane-out">${esc(l.out)}</p>` : ''}
        ${l.sets ? `<p class="lane-sets"><span class="arrow" aria-hidden="true">↳</span>${esc(l.sets)}</p>` : ''}
      </div>`).join('') + `</div></div>`;
}

function stationHtml(st) {
  const k = KIND[st.kind] || KIND.scene;
  return `<section class="node ${st.heavy ? 'heavy' : ''}" id="n-${esc(st.id)}">
    <div class="node-rail" aria-hidden="true"><i></i></div>
    <div class="node-card">
      <header class="node-head">
        <span class="nid">${esc(st.id)}</span>
        <span class="nact">${esc(st.act)}</span>
        <span class="kind ${k.cls}">${esc(k.ko)}</span>
      </header>
      <h3>${esc(st.title)}</h3>
      ${st.body ? `<p class="node-body">${esc(st.body)}</p>` : ''}
      ${st.lanes ? lanesHtml(st.lanes) : ''}
      ${st.rows ? rowsHtml(st.rows) : ''}
      ${st.note ? `<p class="node-note">${esc(st.note)}</p>` : ''}
    </div>
  </section>`;
}

const channelsHtml = `<div class="channels">` + CHANNELS.map((c) => `
  <div class="ch">
    <div class="ch-k">${esc(c.k)}</div>
    <div class="ch-line" aria-hidden="true"><i></i><b></b><i></i></div>
    <div class="ch-ends"><span>${esc(c.from)}</span><span>${esc(c.to)}</span></div>
    <div class="ch-who">${esc(c.who)}</div>
  </div>`).join('') + `</div>`;

const HTML = `<title>회항 분기도</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --ground:#f2efe8; --card:#fbf9f5; --edge:#ddd6c8; --rail:#c8bfab;
  --ink:#241f1a; --mid:#5d564b; --soft:#8b8373;
  --amber:#a8641b; --oxblood:#8a2318; --slate:#3f5b63;
  --wash:#efe9dc;
  --serif:"Gowun Batang",Georgia,serif;
  --sans:"IBM Plex Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ground:#14130f; --card:#1c1b17; --edge:#312e27; --rail:#3d3931;
    --ink:#ece5d6; --mid:#a79f8e; --soft:#7c7466;
    --amber:#d99a48; --oxblood:#c9645a; --slate:#7fa6b0;
    --wash:#221f19;
  }
}
:root[data-theme="dark"]{
  --ground:#14130f; --card:#1c1b17; --edge:#312e27; --rail:#3d3931;
  --ink:#ece5d6; --mid:#a79f8e; --soft:#7c7466;
  --amber:#d99a48; --oxblood:#c9645a; --slate:#7fa6b0;
  --wash:#221f19;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:var(--sans); font-weight:300; line-height:1.75;
  padding:clamp(28px,6vw,64px) clamp(16px,4vw,32px) 100px;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:840px; margin:0 auto}

/* ── 머리 ── */
.masthead{border-bottom:1px solid var(--edge); padding-bottom:26px; margin-bottom:34px}
.eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.3em; color:var(--soft); text-transform:uppercase; margin:0 0 12px}
h1{font-family:var(--serif); font-weight:700; font-size:clamp(30px,7vw,44px); letter-spacing:-.02em; margin:0 0 10px; text-wrap:balance}
.lede{margin:0; color:var(--mid); font-size:15.5px; max-width:56ch}
.howto{
  margin:22px 0 0; padding:13px 16px; background:var(--wash); border-left:2px solid var(--amber);
  font-size:14px; color:var(--mid);
}
.howto code{font-family:var(--mono); font-size:12.5px; color:var(--amber)}

/* ── 넘어가는 것들 ── */
h2.sec{
  font-family:var(--mono); font-size:11px; letter-spacing:.28em; text-transform:uppercase;
  color:var(--soft); font-weight:500; margin:48px 0 16px; padding-bottom:9px; border-bottom:1px solid var(--edge);
}
.channels{display:flex; flex-direction:column; gap:14px}
.ch{display:grid; grid-template-columns:76px 1fr; gap:4px 14px; align-items:center}
.ch-k{font-family:var(--serif); font-weight:700; font-size:15px; color:var(--amber)}
.ch-line{display:flex; align-items:center; gap:0; color:var(--rail)}
.ch-line i{flex:1; height:1px; background:currentColor}
.ch-line b{width:6px; height:6px; border-radius:50%; background:var(--amber); flex:none}
.ch-ends{grid-column:2; display:flex; justify-content:space-between; gap:12px; font-size:12.5px; color:var(--mid)}
.ch-ends span:last-child{text-align:right}
.ch-who{grid-column:2; font-family:var(--mono); font-size:10.5px; letter-spacing:.16em; color:var(--soft)}

/* ── 마디 ── */
.map{margin-top:8px}
.node{display:grid; grid-template-columns:34px 1fr; align-items:stretch}
.node-rail{position:relative; display:flex; justify-content:center}
.node-rail::before{content:''; position:absolute; top:0; bottom:0; width:1px; background:var(--rail)}
.node-rail i{
  position:relative; margin-top:26px; width:9px; height:9px; border-radius:50%;
  background:var(--ground); border:1.5px solid var(--rail); flex:none;
}
.node.heavy .node-rail i{background:var(--amber); border-color:var(--amber); width:11px; height:11px}
.node:first-child .node-rail::before{top:26px}
.node:last-child .node-rail::before{bottom:calc(100% - 30px)}

.node-card{
  background:var(--card); border:1px solid var(--edge); border-radius:3px;
  padding:18px 20px 16px; margin:14px 0 14px 14px; position:relative;
}
.node-card::before{
  content:''; position:absolute; left:-15px; top:17px; width:14px; height:1px; background:var(--rail);
}
.node.heavy .node-card{border-color:var(--amber); box-shadow:0 1px 0 var(--edge)}

.node-head{display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-bottom:8px}
.nid{font-family:var(--mono); font-size:11px; font-weight:500; letter-spacing:.1em; color:var(--amber); background:var(--wash); padding:2px 7px; border-radius:2px}
.nact{font-family:var(--mono); font-size:10.5px; letter-spacing:.2em; color:var(--soft)}
.kind{margin-left:auto; font-size:11px; letter-spacing:.1em; padding:2px 9px; border-radius:999px; border:1px solid var(--edge); color:var(--mid)}
.k-fork,.k-out{border-color:var(--amber); color:var(--amber)}
.k-in{border-color:var(--slate); color:var(--slate)}
.k-timed{border-color:var(--oxblood); color:var(--oxblood)}

.node-card h3{font-family:var(--serif); font-weight:700; font-size:19px; line-height:1.5; margin:0 0 8px; letter-spacing:-.01em; text-wrap:balance}
.node-body{margin:0 0 4px; color:var(--mid); font-size:14px}
.node-note{
  margin:14px 0 0; padding-top:12px; border-top:1px dashed var(--edge);
  font-family:var(--serif); font-size:14px; color:var(--mid);
}

/* ── 선택지 줄 ── */
ul.rows{list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:11px}
ul.rows li{padding-left:16px; position:relative}
ul.rows li::before{
  content:''; position:absolute; left:0; top:11px; width:9px; height:1px; background:var(--rail);
}
ul.rows li::after{
  content:''; position:absolute; left:0; top:0; bottom:-11px; width:1px; background:var(--edge);
}
ul.rows li:last-child::after{bottom:auto; height:11px}
.r-head{display:flex; gap:10px; align-items:baseline; flex-wrap:wrap}
.r-label{font-weight:500; font-size:14.5px}
.r-tag{font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; color:var(--soft); white-space:nowrap}
.r-out{margin:2px 0 0; font-size:13.5px; color:var(--mid)}
.r-sets{margin:3px 0 0; font-family:var(--mono); font-size:11.5px; letter-spacing:.02em; color:var(--slate)}

/* 이 선택이 나중에 무엇으로 돌아오는가 */
.r-later{
  margin:5px 0 0; font-size:12.8px; line-height:1.65; color:var(--mid);
  display:grid; grid-template-columns:15px auto auto 1fr; gap:0 7px; align-items:baseline;
}
.r-later .arrow{color:var(--rail)}
.r-later .scope{
  font-family:var(--mono); font-size:10px; letter-spacing:.14em; white-space:nowrap;
  padding:1px 6px; border-radius:2px; border:1px solid var(--edge);
}
.r-later .goto{
  font-family:var(--mono); font-size:10.5px; letter-spacing:.08em; text-decoration:none;
  color:var(--amber); border-bottom:1px dotted currentColor;
}
.r-later .ltext{grid-column:4}
.s-now .scope{color:var(--soft)}
.s-run .scope{color:var(--amber); border-color:var(--amber)}
.s-across .scope{color:var(--oxblood); border-color:var(--oxblood)}
.s-across .ltext{color:var(--ink)}
@media (max-width:520px){
  .r-later{grid-template-columns:15px 1fr; }
  .r-later .ltext{grid-column:2}
  .r-later .goto{grid-column:2}
}

/* 범례 */
.legend{display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin:26px 0 0}
.lg{border-left:2px solid var(--edge); padding:6px 0 6px 11px}
.lg b{display:block; font-size:13px; font-weight:500}
.lg span{font-size:12.5px; color:var(--mid)}
.lg.s-now{border-left-color:var(--soft)}
.lg.s-run{border-left-color:var(--amber)}
.lg.s-across{border-left-color:var(--oxblood)}

.lane-sets .arrow{color:var(--rail); margin-right:5px}

/* ── 두 갈래 ── */
.lanes{margin:16px 0 4px; color:var(--rail)}
.fork-y{display:block; width:100%; height:30px}
.lane-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.lane{border:1px solid var(--edge); border-top-width:2px; border-radius:2px; padding:12px 13px; background:var(--ground)}
.lane-bad{border-top-color:var(--oxblood)}
.lane-warm{border-top-color:var(--amber)}
.lane-cold{border-top-color:var(--slate)}
.lane-label{font-family:var(--serif); font-weight:700; font-size:15px; margin-bottom:6px; color:var(--ink)}
.lane-out{margin:0; font-size:13.5px; color:var(--mid)}
.lane-sets{margin:8px 0 0; font-family:var(--mono); font-size:11.5px; color:var(--slate); line-height:1.6}
@media (max-width:560px){ .lane-grid{grid-template-columns:1fr} .fork-y{display:none} }

footer{margin-top:56px; padding-top:18px; border-top:1px solid var(--edge); color:var(--soft); font-size:12.5px; font-family:var(--mono); letter-spacing:.04em}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">무고 · 誣告 · 無辜 — 진행 구조</p>
    <h1>회항에서 고를 수 있는 것들</h1>
    <p class="lede">한 판이 어떤 순서로 흐르고, 어느 선택이 무엇을 바꾸는지. 그리고 그중 무엇이 나를 떠나 다른 사람에게 넘어가는지.</p>
    <p class="howto">고칠 데가 있으면 <code>마디 번호</code>로 짚어 주면 됩니다. 예: <code>P3의 세 번째 선택지 문구</code>, <code>A4-W의 담쟁이 비용</code>, <code>A5-F 놓아준다 결과</code>.</p>
  </header>

  <div class="legend">
    <div class="lg s-now"><b>이 장면에서 끝</b><span>서술만 바뀐다</span></div>
    <div class="lg s-run"><b>이 판 뒤쪽으로</b><span>뒤 장면의 수치나 대사를 바꾼다</span></div>
    <div class="lg s-across"><b>사람을 넘어감</b><span>다른 플레이어 화면에 나타난다</span></div>
  </div>

  <h2 class="sec">장면을 가로지르는 것 — 다섯 갈래</h2>
  ${channelsHtml}

  <h2 class="sec">한 판의 흐름</h2>
  <div class="map">
    ${STATIONS.map(stationHtml).join('\n')}
  </div>

  <footer>tools/storymap.js 가 public/story.js · public/plates.js 를 읽어 만든 문서. 대본을 고치면 다시 뽑으면 된다.</footer>
</div>`;

const out = process.argv[2] || path.join(ROOT, 'storymap.html');
fs.writeFileSync(out, HTML);
console.log('분기도 생성:', out, `(마디 ${STATIONS.length}개, ${(HTML.length / 1024).toFixed(1)}KB)`);
