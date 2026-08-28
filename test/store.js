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

  // 들어온 순서대로. 가장 오래 기다린 것부터
  const forP3 = await s.claim('p3');
  assert.equal(forP3.id, a.id, '오래 기다린 것이 먼저 나온다');

  // 같은 조서를 두 사람이 동시에 읽는다 — 잠그지 않는다
  const forP4 = await s.claim('p4');
  assert.equal(forP4.id, a.id, '두 번째 사람도 같은 조서를 받는다');

  // 두 자리가 다 찼으면 그때 다음 조서로 넘어간다
  const forP5 = await s.claim('p5');
  assert.equal(forP5.id, b.id, '앞 조서가 차면 다음 조서');
  assert.equal(await s.claim('p6'), null, '다 차면 null — 여기서 지어낸 조서로 간다');

  // 한 조서를 두 사람까지 읽는다. 갈린 판결도 그대로 쌓인다
  const first = await s.judge(a.id, { verdict: 'guilty', reason: '이유', judge_name: '병', judged_by: 'p3' });
  assert.equal(first.verdict, 'guilty');
  assert.equal(first.judged_count, 1);

  const second = await s.judge(a.id, { verdict: 'innocent', reason: '반대', judge_name: '정', judged_by: 'p4' });
  assert.ok(second, '두 번째 판결은 받는다');
  assert.equal(second.judged_count, 2);
  assert.equal(second.verdicts.length, 2);
  assert.equal(second.verdicts[1].verdict, 'innocent', '갈린 판결도 그대로');
  assert.equal(second.verdict, 'guilty', '칸에 남는 것은 첫 판결');

  assert.equal(await s.judge(a.id, { verdict: 'guilty', judged_by: 'p7' }), null, '세 번째는 안 받는다');

  // 판결하면 손을 놓는다. b 는 판결 하나(p1) + 아직 붙들고 있는 사람 하나(p5) 로 꽉 차 있다
  await s.judge(b.id, { verdict: 'guilty', reason: '이유', judge_name: '무', judged_by: 'p1' });
  assert.equal((await s.byId(b.id)).holds.some((h) => h.by === 'p1'), false, '판결한 사람의 손자국은 지운다');
  assert.equal(await s.claim('p8'), null, 'a 는 다 읽혔고 b 는 자리가 없다');

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
