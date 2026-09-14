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

  // 안 건드린 조서가 없으면 지금 돌고 있는 조서를 같이 받는다 — 다음 조서로 넘기지 않는다
  const forP5 = await s.claim('p5');
  assert.equal(forP5.id, a.id, '가장 최근에 받아 간 조서를 같이 받는다');
  // 지어낸 조서로 가지 않는다
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

  // 조서를 받아 가지 않은 사람의 판결은 받지 않는다 — 아무 조서 번호로나 판결을 쏟아부을 수 없게
  assert.equal(await s.judge(a.id, { verdict: 'guilty', judged_by: 'p7' }), null, '받아 가지 않은 판결은 거절');
  (await s.byId(a.id)).holds.push({ by: 'p7', at: Date.now() });   // p7 이 이 조서를 받아 갔다
  assert.ok(await s.judge(a.id, { verdict: 'guilty', judged_by: 'p7' }), '세 번째 판결도 받는다 — 상한은 없다');

  // 판결하면 손을 놓는다. b 는 판결 하나(p1) + 아직 붙들고 있는 사람 하나(p5) 로 꽉 차 있다
  await s.judge(b.id, { verdict: 'guilty', reason: '이유', judge_name: '무', judged_by: 'p1' });
  assert.equal((await s.byId(b.id)).holds.some((h) => h.by === 'p1'), false, '판결한 사람의 손자국은 지운다');
  // 상한이 없으니 줄 것은 늘 있다
  const forP8 = await s.claim('p8');
  assert.ok(forP8, '지어낸 조서로 가지 않는다 — 실제 조서를 다시 준다');

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

  // 동시에 들어오면 — 안 읽힌 조서 하나를 누가 붙들고 있을 때, 뒷사람은 이미 판결 끝난
  // 옛 조서가 아니라 그 안 읽힌 조서를 같이 받는다.
  {
    const keep = process.env.DATA_DIR;
    const dirT = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-t-'));
    process.env.DATA_DIR = dirT;
    const t = await openStore();
    const now = Date.now();
    const old1 = await t.insert({ ...row('q1', '옛조서'), created_at: now - 9e6 });
    await t.claim('q2');                                             // 옛조서를 누가 받아
    await t.judge(old1.id, { verdict: 'guilty', judge_name: '갑', judged_by: 'q2' });  // 판결까지 끝냄
    const fresh = await t.insert({ ...row('q3', '새조서'), created_at: now - 1e3 });
    const first = await t.claim('q4');
    assert.equal(first.id, fresh.id, '먼저 온 사람은 안 읽힌 새 조서');
    const second = await t.claim('q5');
    assert.equal(second.id, fresh.id, '동시에 온 사람도 같은 새 조서 — 판결 끝난 옛 조서로 가지 않는다');
    fs.rmSync(dirT, { recursive: true, force: true });
    process.env.DATA_DIR = keep;
  }

  // 판결까지 마친 사람이 뒤를 진행 중일 때 — 대기열에 안 읽힌 조서가 없으면,
  // 새로 온 사람은 오래된 조서가 아니라 그 사람이 막 판결한 조서를 받는다.
  // 그 사람이 끝내 진술을 내면, 다음 사람은 그 진술을 받는다.
  {
    const keep = process.env.DATA_DIR;
    const dirS = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-s-'));
    process.env.DATA_DIR = dirS;
    const k = await openStore();
    const now = Date.now();
    const hwang = await k.insert({ ...row('hw', '황선생'), created_at: now - 20 * 864e5 });
    const seo = await k.insert({ ...row('seo', '서혁인'), created_at: now - 3 * 36e5 });
    // 황선생은 사흘 전에 누가 읽고 끝냈다
    Object.assign((await k.byId(hwang.id)), {
      judged_count: 1, judged_at: now - 3 * 864e5,
      verdicts: [{ verdict: 'innocent', judge_name: 'Jay', by: 'jay', at: now - 3 * 864e5 }], holds: [],
    });
    // 서혁인은 skrrr 가 2분 전에 받아 판결했고, 뒤를 진행 중 — 손자국은 판결하며 지워졌다
    Object.assign((await k.byId(seo.id)), {
      judged_count: 1, judged_at: now - 12e4,
      verdicts: [{ verdict: 'guilty', judge_name: 'skrrr', by: 'skrrr', at: now - 12e4 }], holds: [],
    });

    const forNew = await k.claim('newcomer');
    assert.equal(forNew.id, seo.id, '새로 온 사람은 skrrr 가 막 판결한 서혁인을 받는다 — 옛 황선생이 아니라');

    const skrrr = await k.insert({ ...row('skrrr', 'skrrr'), created_at: Date.now() });   // skrrr 가 끝냄
    const forNext = await k.claim('next');
    assert.equal(forNext.id, skrrr.id, 'skrrr 가 끝내면 다음 사람은 skrrr 의 진술');

    fs.rmSync(dirS, { recursive: true, force: true });
    process.env.DATA_DIR = keep;
  }

  // 운영 규칙 그대로 한 바퀴 — 대기열에 서혁인 하나
  //   A·B 가 동시에 → 둘 다 서혁인. 각자 판결하고 먼저 끝낸 순으로 대기열 1·2
  //   그다음 C·D 가 동시에 → 대기열이 둘이니 C 는 1번, D 는 2번
  {
    const keep = process.env.DATA_DIR;
    const dirQ = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-q-'));
    process.env.DATA_DIR = dirQ;
    const q = await openStore();
    const base = Date.now() - 1e7;
    const seo = await q.insert({ ...row('seo', '서혁인'), created_at: base });

    const forA = await q.claim('A');
    const forB = await q.claim('B');
    assert.equal(forA.id, seo.id, 'A 는 서혁인');
    assert.equal(forB.id, seo.id, '동시에 온 B 도 서혁인');

    await q.judge(seo.id, { verdict: 'guilty', judge_name: 'A탐정', judged_by: 'A' });
    const stA = await q.insert({ ...row('A', 'A의 진술'), created_at: base + 1000 });   // A 가 먼저 끝냄
    await q.judge(seo.id, { verdict: 'innocent', judge_name: 'B탐정', judged_by: 'B' });
    const stB = await q.insert({ ...row('B', 'B의 진술'), created_at: base + 2000 });   // B 는 나중

    assert.equal((await q.byId(seo.id)).judged_count, 2, '서혁인은 두 판결을 받는다');

    const forC = await q.claim('C');
    const forD = await q.claim('D');
    assert.equal(forC.id, stA.id, 'C 는 대기열 1번 — 먼저 끝낸 A 의 진술');
    assert.equal(forD.id, stB.id, 'D 는 대기열 2번 — B 의 진술');

    fs.rmSync(dirQ, { recursive: true, force: true });
    process.env.DATA_DIR = keep;
  }

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
