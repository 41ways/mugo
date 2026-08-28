'use strict';
// 한 사람이 진술을 넣고, 다음 사람이 그걸 받아 판결하고, 첫 사람이 결과를 확인한다.
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8899;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugo-flow-'));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir };
delete env.DATABASE_URL;
delete env.SMTP_URL;

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
const post = (p, b) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json());
const get = (p) => fetch(base + p).then(async (r) => [r.status, await r.json()]);

const done = (code) => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };

(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/healthz'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  // 대기열이 비면 미리 써둔 조서가 나온다
  const first = await post('/api/case', { player: 'A' });
  assert.equal(first.seed, true, '처음에는 seed 가 나와야 한다');
  assert.equal(first.answers.length, 3);
  const seedVerdict = await post('/api/verdict', { caseId: first.caseId, verdict: 'guilty' });
  assert.equal(seedVerdict.delivered, false, 'seed 에는 메일이 안 나간다');

  // A 가 진술을 남긴다
  const a = await post('/api/statement', {
    player: 'A', name: '갑', email: 'a@example.com',
    answers: ['안 죽였다', '비명이 났다', '누른 것뿐이다'],
    clues: ['개가 짖지 않았다', '창문이 안쪽에서 열려 있었다'],
  });
  assert.ok(a.token, '조서 번호가 나와야 한다');
  assert.equal(a.queued, 1);

  // A 는 자기 진술을 못 받는다 → seed 가 나온다
  const selfGuard = await post('/api/case', { player: 'A' });
  assert.equal(selfGuard.seed, true, '자기 진술은 자기가 못 받는다');

  // B 가 A 를 받는다
  const forB = await post('/api/case', { player: 'B' });
  assert.equal(forB.seed, false, '실제 진술이 나와야 한다');
  assert.equal(forB.name, '갑');
  assert.deepEqual(forB.clues, ['개가 짖지 않았다', '창문이 안쪽에서 열려 있었다']);

  // 동시에 들어온 C 도 같은 조서를 받는다. 한 조서는 두 사람이 읽는다
  const forC = await post('/api/case', { player: 'C' });
  assert.equal(forC.seed, false, '두 번째 사람도 같은 조서를 받아야 한다');
  assert.equal(forC.caseId, forB.caseId, '같은 조서다');

  // 세 번째 사람도 지어낸 조서로 가지 않는다. 실제 조서를 다시 준다.
  const forD = await post('/api/case', { player: 'D' });
  assert.equal(forD.seed, false, '줄 게 없어도 시드로 가지 않는다');
  assert.equal(forD.caseId, forB.caseId, '실제 조서를 다시 준다');

  // B 가 판결한다
  const v = await post('/api/verdict', {
    caseId: forB.caseId, verdict: 'guilty', reason: '손등의 상처가 설명되지 않는다',
    judgeName: '을', player: 'B',
  });
  assert.equal(v.ok, true);

  // 자기가 판결한 조서는 다시 안 받는다
  const forBAgain = await post('/api/case', { player: 'B' });
  assert.equal(forBAgain.seed, true, 'B 는 자기가 판결한 조서를 또 받지 않는다');

  // C 의 두 번째 판결. 앞과 반대여도 그대로 받는다
  const v2 = await post('/api/verdict', {
    caseId: forC.caseId, verdict: 'innocent', reason: '증거가 모자란다', judgeName: '병', player: 'C',
  });
  assert.equal(v2.ok, true);
  assert.equal(v2.nth, 2, '두 번째 통지');

  // 세 번째 판결도 받는다. 다만 통지는 두 통까지라 주소가 이미 지워졌으면 안 나간다
  const third = await post('/api/verdict', {
    caseId: forB.caseId, verdict: 'guilty', judgeName: '정', player: 'E',
  });
  assert.equal(third.ok, true, '판결에는 상한이 없다');
  assert.equal(third.nth, 3);

  // 여러 번 읽힌 뒤에도 지어낸 조서로 가지 않는다
  const afterFull = await post('/api/case', { player: 'F' });
  assert.equal(afterFull.seed, false, '실제 조서가 있으면 늘 그걸 준다');

  // A 가 확인한다 — 갈린 두 판결이 나란히 남는다
  const [code, look] = await get('/api/statement/' + a.token);
  assert.equal(code, 200);
  assert.equal(look.judged, true);
  assert.equal(look.verdict, 'guilty', '칸에 남는 것은 첫 판결');
  assert.equal(look.judgeName, '을');
  assert.equal(look.reason, '손등의 상처가 설명되지 않는다');
  assert.equal(look.verdicts.length, 3, '판결이 온 만큼 다 온다');
  assert.equal(look.verdicts[1].verdict, 'innocent');
  assert.equal(look.verdicts[1].judgeName, '병');

  // 주소는 「보내진 뒤에만」 지워진다.
  // 이 테스트에는 발송 경로가 없어서 delivered=false 다. 그러면 주소가 남아야 한다 —
  // 실패했는데도 지워버리면 다시 보낼 길이 영영 없어진다(tools/resend.js 가 이걸 먹고 산다).
  assert.equal(v.delivered, false, '발송 경로가 없으니 delivered 는 false');
  assert.equal(v2.delivered, false);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'statements.json'), 'utf8'));
  assert.equal(saved[0].email, 'a@example.com', '발송에 실패했으면 주소는 남아 있어야 한다');
  assert.ok(log.includes('a@example.com'), '메일이 (콘솔로라도) 나가야 한다');

  // 없는 번호
  const [nf] = await get('/api/statement/deadbeef');
  assert.equal(nf, 404);

  // 빈 진술은 거절
  const empty = await post('/api/statement', { player: 'Z1', answers: ['', '', ''] });
  assert.ok(empty.error, '빈 진술은 안 받는다');

  // 태그는 걸러진다
  const dirty = await post('/api/statement', { player: 'Z2', answers: ['<script>x</script>', '', ''] });
  const [, dl] = await get('/api/statement/' + dirty.token);
  assert.ok(!dl.answers[0].includes('<'), '꺾쇠는 지워진다');

  // 정적 파일
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('무고'));

  console.log('flow   ✓');
  done(0);
})().catch((e) => { console.error(e); console.error('--- 서버 로그 ---\n' + log); done(1); });
