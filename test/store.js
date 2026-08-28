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
  // 미판결이 다 나갔으면, 지어낸 조서 대신 이미 판결된 것을 다시 돌린다 —
  // 다만 아직 아무것도 판결이 안 났으니 지금은 줄 게 없다
  assert.equal(await s.claim('p4'), null, '판결된 것도 없으면 null');

  // 한 조서를 두 사람까지 읽는다
  const first = await s.judge(a.id, { verdict: 'guilty', reason: '이유', judge_name: '병', judged_by: 'p3' });
  assert.equal(first.verdict, 'guilty');
  assert.equal(first.judged_count, 1);

  // 판결이 난 조서는 두 번째 배심원에게 다시 나간다
  const again = await s.claim('p4');
  assert.equal(again && again.id, a.id, '판결된 조서가 한 번 더 나가야 한다');
  assert.equal(await s.claim('p3'), null, '자기가 판결한 조서는 다시 안 받는다');

  const second = await s.judge(a.id, { verdict: 'innocent', reason: '반대', judge_name: '정', judged_by: 'p4' });
  assert.ok(second, '두 번째 판결은 받는다');
  assert.equal(second.judged_count, 2);
  assert.equal(second.verdicts.length, 2);
  assert.equal(second.verdicts[1].verdict, 'innocent', '갈린 판결도 그대로 쌓인다');
  assert.equal(second.verdict, 'guilty', '칸에 남는 것은 첫 판결');

  assert.equal(await s.judge(a.id, { verdict: 'guilty', judged_by: 'p5' }), null, '세 번째는 안 받는다');
  assert.equal(await s.claim('p5'), null, '두 번 다 읽힌 조서는 더 안 나간다');

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
