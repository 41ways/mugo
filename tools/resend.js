'use strict';

// 못 나간 판결 통지를 다시 보낸다.
//
// 판결은 났는데 주소가 아직 남아 있다면, 그건 발송이 실패했다는 뜻이다
// (성공했으면 server.js 가 그 자리에서 주소를 지운다).
//
//   DATABASE_URL=... RESEND_API_KEY=... MAIL_FROM='회항 경찰서 <...>' PUBLIC_URL=https://... \
//     node tools/resend.js
//
// 먼저 보지 않고 쏘는 일이 없도록, 기본은 목록만 보여주는 것이다.
// 실제로 보내려면 --send 를 붙인다.
//
//   node tools/resend.js          # 누가 밀려 있는지만 본다
//   node tools/resend.js --send   # 실제로 보낸다

const { openStore } = require('../store.js');
const mailer = require('../mailer.js');

const SEND = process.argv.includes('--send');

const span = (ms) => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d}일 ${h % 24}시간`;
  if (h) return `${h}시간 ${m % 60}분`;
  return `${m}분`;
};

// 주소는 통째로 찍지 않는다. 누구 것인지 알아볼 만큼만.
const mask = (e) => {
  const [id, host] = String(e).split('@');
  if (!host) return '***';
  return `${id.slice(0, 2)}${'*'.repeat(Math.max(1, id.length - 2))}@${host}`;
};

(async () => {
  const store = await openStore();
  const rows = await store.undelivered();
  const now = Date.now();

  if (!rows.length) {
    console.log('\n밀려 있는 통지가 없다.\n');
    if (store.close) await store.close();
    return;
  }

  console.log(`\n못 나간 판결 통지 ${rows.length}건\n`);
  rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.name} → ${r.verdict === 'guilty' ? '유죄' : '무죄'}` +
      `  (탐정 ${r.judge_name || '?'}, 판결 ${span(now - Number(r.judged_at))} 전)  ${mask(r.email)}`);
  });

  if (!SEND) {
    console.log(`\n실제로 보내려면 --send 를 붙인다.`);
    console.log(`발송 경로: ${mailer.enabled() ? '살아 있음' : '없음 — 콘솔에만 찍힌다'}\n`);
    if (store.close) await store.close();
    return;
  }

  if (!mailer.enabled()) {
    console.error('\nRESEND_API_KEY 도 SMTP_URL 도 없다. 보낼 길이 없으니 그만둔다.\n');
    process.exitCode = 1;
    if (store.close) await store.close();
    return;
  }

  console.log('');
  let ok = 0, fail = 0;
  for (const row of rows) {
    const sent = await mailer.sendVerdict(row);
    if (sent) { await store.clearEmail(row.id); ok += 1; }
    else fail += 1;
    // Resend 무료 등급은 초당 2통이다. 한 박자 쉰다.
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n보냄 ${ok}건, 실패 ${fail}건.`);
  if (fail) console.log('실패한 건은 주소가 그대로 남아 있으니 고친 뒤 다시 돌리면 된다.');
  console.log('');

  if (store.close) await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
