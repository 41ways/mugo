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

  // 물어간 사이 C 는 못 받는다
  const forC = await post('/api/case', { player: 'C' });
  assert.equal(forC.seed, true, '이미 물어간 진술은 안 나온다');

  // B 가 판결한다
  const v = await post('/api/verdict', {
    caseId: forB.caseId, verdict: 'guilty', reason: '손등의 상처가 설명되지 않는다', judgeName: '을',
  });
  assert.equal(v.ok, true);

  // 두 번은 안 먹는다
  const again = await post('/api/verdict', { caseId: forB.caseId, verdict: 'innocent' });
  assert.equal(again.already, true, '판결은 한 번뿐');

  // A 가 확인한다
  const [code, look] = await get('/api/statement/' + a.token);
  assert.equal(code, 200);
  assert.equal(look.judged, true);
  assert.equal(look.verdict, 'guilty');
  assert.equal(look.judgeName, '을');
  assert.equal(look.reason, '손등의 상처가 설명되지 않는다');

  // 주소는 「보내진 뒤에만」 지워진다.
  // 이 테스트에는 발송 경로가 없어서 delivered=false 다. 그러면 주소가 남아야 한다 —
  // 실패했는데도 지워버리면 다시 보낼 길이 영영 없어진다(tools/resend.js 가 이걸 먹고 산다).
  assert.equal(v.delivered, false, '발송 경로가 없으니 delivered 는 false');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'statements.json'), 'utf8'));
  assert.equal(saved[0].email, 'a@example.com', '발송에 실패했으면 주소는 남아 있어야 한다');
  assert.ok(log.includes('a@example.com'), '메일이 (콘솔로라도) 나가야 한다');

  // 없는 번호
  const [nf] = await get('/api/statement/deadbeef');
  assert.equal(nf, 404);

  // 빈 진술은 거절
  const empty = await post('/api/statement', { player: 'D', answers: ['', '', ''] });
  assert.ok(empty.error, '빈 진술은 안 받는다');

  // 태그는 걸러진다
  const dirty = await post('/api/statement', { player: 'E', answers: ['<script>x</script>', '', ''] });
  const [, dl] = await get('/api/statement/' + dirty.token);
  assert.ok(!dl.answers[0].includes('<'), '꺾쇠는 지워진다');

  // 정적 파일
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('무고'));

  console.log('flow   ✓');
  done(0);
})().catch((e) => { console.error(e); console.error('--- 서버 로그 ---\n' + log); done(1); });
