'use strict';

// 대기열을 들여다본다. 누가 판결을 기다리고 있고, 누가 이미 받았는지.
//
//   DATABASE_URL=... node tools/queue.js
//
// 주소(email)는 찍지 않는다. 있는지 없는지만 본다.

const { openStore } = require('../store.js');

const span = (ms) => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}일 ${h % 24}시간`;
  if (h) return `${h}시간 ${m % 60}분`;
  return `${m}분`;
};

(async () => {
  const store = await openStore();
  const rows = await store.all();
  const now = Date.now();

  const PARK = now + 365 * 24 * 60 * 60 * 1000;
  const cnt = (r) => (r.judged_count != null ? r.judged_count : (r.judged_at ? 1 : 0));
  const open = rows.filter((r) => cnt(r) < 2 && Number(r.claimed_at || 0) < PARK)
    .sort((a, b) => a.created_at - b.created_at);
  const done = rows.filter((r) => r.judged_at).sort((a, b) => b.judged_at - a.judged_at);
  const held = rows.filter((r) => Number(r.claimed_at || 0) >= PARK);

  console.log(`\n진술 ${rows.length}건 — 아직 다 안 읽힌 것 ${open.length}, 판결이 하나라도 난 것 ${done.length}` +
    (held.length ? `, 손으로 빼둔 것 ${held.length}` : '') + '\n');

  if (open.length) {
    console.log('── 대기열 (0/2 인 것이 먼저 나간다. 1/2 은 줄 게 없을 때만) ──');
    open.forEach((r, i) => {
      const holds = (typeof r.holds === 'string' ? JSON.parse(r.holds || '[]') : (r.holds || []))
        .filter((h) => now - Number(h.at || 0) < 30 * 60 * 1000);
      const read = r.judged_count || 0;
      console.log(`${String(i + 1).padStart(2)}. ${r.name}  ${span(now - Number(r.created_at))}째` +
        `  [읽힘 ${read}/2${holds.length ? ', 지금 ' + holds.length + '명이 보는 중' : ''}]` +
        `  ${r.caught === 'house' ? '저택 검거' : '부두 검거'}` +
        `  ${r.email ? '주소 있음' : '주소 없음'}`);
    });
    console.log('');
  }

  if (done.length) {
    console.log('── 판결이 끝난 사람 ──');
    done.slice(0, 20).forEach((r) => {
      const vs = (typeof r.verdicts === 'string' ? JSON.parse(r.verdicts || '[]') : (r.verdicts || []));
      const read = vs.length || (r.judged_at ? 1 : 0);
      const line = vs.length
        ? vs.map((v) => `${v.verdict === 'guilty' ? '유죄' : '무죄'}(${v.judge_name || '?'})`).join('  ·  ')
        : `${r.verdict === 'guilty' ? '유죄' : '무죄'}(${r.judge_name || '?'})`;
      const split = vs.length > 1 && vs[0].verdict !== vs[1].verdict ? '  ← 갈림' : '';
      console.log(`  ${r.name} → ${line}${split}` +
        `  [${read}/2 읽힘]  ${span(now - Number(r.judged_at))} 전` +
        `  ${r.email ? '통지 대기' : '주소 삭제됨'}`);
    });
    console.log('');
  }

  if (store.close) await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
