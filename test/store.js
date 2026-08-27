'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-'));
delete process.env.DATABASE_URL;

const { openStore, newId, newToken } = require('../store.js');

const row = (player, name) => ({
  id: newId(), token: newToken(), player, name, answers: ['a', 'b', 'c'], clues: [],
  email: 'x@y.zz', created_at: Date.now(), claimed_at: null, judged_at: null,
  verdict: null, reason: null, judge_name: null,
});

(async () => {
  const s = await openStore();

  const a = await s.insert(row('p1', '갑'));
  const b = await s.insert(row('p2', '을'));

  // 자기 진술은 자기가 못 받는다
  const forP1 = await s.claim('p1');
  assert.equal(forP1.id, b.id, '자기 것이 아닌 진술이 나와야 한다');

  // 이미 물어간 것은 다시 안 나온다
  const forP3 = await s.claim('p3');
  assert.equal(forP3.id, a.id, '남은 것 하나가 나와야 한다');
  assert.equal(await s.claim('p4'), null, '더 없으면 null');

  // 판결은 한 번만 먹는다
  const judged = await s.judge(a.id, { verdict: 'guilty', reason: '이유', judge_name: '병' });
  assert.equal(judged.verdict, 'guilty');
  assert.equal(await s.judge(a.id, { verdict: 'innocent' }), null, '두 번째 판결은 무시');

  // 주소는 보내고 나면 지운다
  await s.clearEmail(a.id);
  assert.equal((await s.byId(a.id)).email, null);

  // 번호로 조회
  assert.equal((await s.byToken(a.token)).name, '갑');

  const c = await s.counts();
  assert.deepEqual(c, { total: 2, pending: 1 });

  // 다시 열어도 남아 있다
  const s2 = await openStore();
  assert.equal((await s2.byToken(b.token)).name, '을', '파일에서 다시 읽혀야 한다');

  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  console.log('store  ✓');
})().catch((e) => { console.error(e); process.exit(1); });
