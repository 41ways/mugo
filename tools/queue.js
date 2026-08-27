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

  const open = rows.filter((r) => !r.judged_at).sort((a, b) => a.created_at - b.created_at);
  const done = rows.filter((r) => r.judged_at).sort((a, b) => b.judged_at - a.judged_at);

  console.log(`\n진술 ${rows.length}건 — 기다리는 중 ${open.length}, 판결 끝 ${done.length}\n`);

  if (open.length) {
    console.log('── 판결을 기다리는 사람 ──');
    open.forEach((r, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${r.name}  ${span(now - Number(r.created_at))}째` +
        `  [${r.caught === 'house' ? '저택에서 검거' : '부두에서 검거'}]` +
        `  ${r.email ? '주소 있음' : '주소 없음'}`);
    });
    console.log('');
  }

  if (done.length) {
    console.log('── 판결이 끝난 사람 ──');
    done.slice(0, 20).forEach((r) => {
      console.log(`  ${r.name} → ${r.verdict === 'guilty' ? '유죄' : '무죄'}` +
        `  (탐정 ${r.judge_name || '?'}, ${span(now - Number(r.judged_at))} 전)` +
        `  ${r.email ? '통지 대기' : '통지 완료·주소 삭제'}`);
    });
    console.log('');
  }

  if (store.close) await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
