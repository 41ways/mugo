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
  // 자리가 다 차도 지어낸 조서로 가지 않는다. 덜 읽힌 것부터 다시 돈다.
  const forP6 = await s.claim('p6');
  assert.ok(forP6, '실제 조서를 다시 준다');

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

  assert.ok(await s.judge(a.id, { verdict: 'guilty', judged_by: 'p7' }), '세 번째 판결도 받는다 — 상한은 없다');

  // 판결하면 손을 놓는다. b 는 판결 하나(p1) + 아직 붙들고 있는 사람 하나(p5) 로 꽉 차 있다
  await s.judge(b.id, { verdict: 'guilty', reason: '이유', judge_name: '무', judged_by: 'p1' });
  assert.equal((await s.byId(b.id)).holds.some((h) => h.by === 'p1'), false, '판결한 사람의 손자국은 지운다');
  // 상한이 없으니 줄 것은 늘 있다. 덜 읽힌 것부터 다시 돈다.
  const forP8 = await s.claim('p8');
  assert.ok(forP8, '지어낸 조서로 가지 않는다 — 실제 조서를 다시 준다');
  assert.equal(forP8.id, b.id, '덜 읽힌 쪽이 먼저다');

  // 한 사람에 한 조서가 기본이다 — 아무도 안 건드린 조서가 있으면 그게 먼저다.
  // 이미 한 번 읽힌 것을 두 사람째 내주는 건 그런 게 하나도 없을 때뿐이다.
  const d = await s.insert(row('p9', '정'));       // 새로 들어온, 아무도 안 건드린 조서
  const forP10 = await s.claim('p10');
  assert.equal(forP10.id, d.id, '읽힌 적 없는 조서가 먼저다 — 오래됐다고 두 번째 자리를 주지 않는다');

  // 그 조서마저 누가 붙들고 있으면, 그때야 이미 읽힌 조서로 넘어간다
  const forP11 = await s.claim('p11');
  assert.equal(forP11.id, d.id, '줄 게 없으면 같은 조서를 두 사람째 — 동시 접속이 이 경우다');
  const forP12 = await s.claim('p12');
  assert.ok(forP12, '자리가 다 차도 실제 조서를 다시 준다');

  // 주소는 보내고 나면 지운다
  await s.clearEmail(a.id);
  assert.equal((await s.byId(a.id)).email, null);

  // 번호로 조회
  assert.equal((await s.byToken(a.token)).name, '갑');

  // a 는 두 번 다 읽혔고, b 는 1/2, d 는 0/2 — 「아직 다 안 읽힌 것」은 둘이다
  // 「기다리는 중」은 아직 아무도 안 읽은 조서다
  const c = await s.counts();
  assert.deepEqual(c, { total: 3, pending: 1 });

  // 다시 열어도 남아 있다
  const s2 = await openStore();
  assert.equal((await s2.byToken(b.token)).name, '을', '파일에서 다시 읽혀야 한다');

  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  console.log('store  ✓');
})().catch((e) => { console.error(e); process.exit(1); });
