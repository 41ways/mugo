'use strict';

// 무고 — 서버.
//
// 게임 자체는 브라우저에서 다 돌아간다. 서버가 하는 일은 셋뿐이다.
//   1) 앞사람의 진술을 하나 꺼내준다        POST /api/case
//   2) 그 진술에 내려진 판결을 받아 메일을 쏜다  POST /api/verdict
//   3) 내 진술을 대기열에 넣는다             POST /api/statement

const http = require('http');
const fs = require('fs');
const path = require('path');
const { openStore, newId, newToken, MAX_MAILS, listOf } = require('./store.js');
const { pickSeed } = require('./seeds.js');
const mailer = require('./mailer.js');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, 'public');

const LIMITS = { name: 24, answer: 24, reason: 220, clue: 80, clues: 12, email: 160 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

let store;

/* ─────────────────────────── 도우미 ─────────────────────────── */

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

// 사람이 읽을 글자만 남긴다. 판결문에 그대로 실리는 문장이라 태그가 섞이면 곤란하다.
const clean = (v, n) => clip(v, n).replace(/[<>]/g, '');

// 메일 서버가 받아주는 모양만 통과시킨다. 한글 주소(응애@이메일.com 같은)는 Brevo 가
// 「email is not valid」로 되돌려 보내므로, 받을 때부터 걸러야 판결 통지가 헛돌지 않는다.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isEmail = (v) => EMAIL_RE.test(v);

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function readBody(req, cap = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > cap) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

// 창구 하나에 한 사람씩. 정교할 필요는 없고 장난만 막으면 된다.
const hits = new Map();
function tooFast(ip, perMin) {
  const now = Date.now();
  const row = hits.get(ip) || { t: now, n: 0 };
  if (now - row.t > 60_000) { row.t = now; row.n = 0; }
  row.n += 1;
  hits.set(ip, row);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > 60_000) hits.delete(k);
  return row.n > perMin;
}

const ipOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || '?';

/* ─────────────────────────── API ─────────────────────────── */

// 심문할 상대를 하나 내준다. 실제 플레이어가 없으면 미리 써둔 진술로 때운다.
async function apiCase(req, res) {
  const body = await readBody(req);
  const player = clip(body.player, 64) || 'anon';
  const row = await store.claim(player);
  const src = row || pickSeed();
  json(res, 200, {
    caseId: src.id,
    seed: !row,
    name: src.name,
    answers: (typeof src.answers === 'string' ? JSON.parse(src.answers) : src.answers) || [],
    clues: (typeof src.clues === 'string' ? JSON.parse(src.clues) : src.clues) || [],
    caught: src.caught === 'house' ? 'house' : 'dock',
    waited: row ? Math.max(0, Date.now() - Number(row.created_at)) : null,
  });
}

// 판결. 여기서 앞사람한테 메일이 나간다.
async function apiVerdict(req, res) {
  const body = await readBody(req);
  const caseId = clip(body.caseId, 64);
  const verdict = body.verdict === 'guilty' ? 'guilty' : 'innocent';
  const reason = clean(body.reason, LIMITS.reason);
  const judgeName = clean(body.judgeName, LIMITS.name) || '이름을 밝히지 않은 탐정';

  if (!caseId) return json(res, 400, { error: 'caseId 없음' });
  if (caseId.startsWith('seed:')) return json(res, 200, { ok: true, delivered: false, seed: true });

  const player = clip(body.player, 64) || 'anon';
  const row = await store.judge(caseId, {
    verdict, reason, judge_name: judgeName, judged_by: player,
  });
  if (!row) return json(res, 200, { ok: true, delivered: false, already: true });

  // 한 조서는 여러 번 읽힐 수 있다. 다만 통지는 앞의 두 번까지만 나간다 —
  // 그 뒤에는 주소가 이미 지워져 있어서 보낼 곳이 없다.
  // 순번(seen)은 판결을 기록한 UPDATE 가 한 번에 매기므로 동시에 들어와도 겹치지 않는다.
  // 주소를 지우는 건 발송 뒤라서, 순번으로 막지 않으면 동시에 들어온 판결마다 메일이 나간다.
  const seen = listOf(row.verdicts).length;
  const shouldMail = !!row.email && seen <= MAX_MAILS;
  const report = shouldMail ? await mailer.sendVerdictReport(row, { nth: seen }) : null;
  const delivered = !!(report && report.ok);

  // 나갔는지·어느 길로·받은 쪽 번호·실패 사유를 그 판결 옆에 남긴다.
  // Brevo 로 나간 메일은 Gmail 보낸편지함에 없으니, 나중에 확인할 곳이 여기뿐이다.
  if (report) await store.markMailed(row.id, seen, report).catch((e) => console.error('[mail] 기록 실패', e.message));

  // 주소는 마지막 통지가 실제로 나간 다음에 지운다. 실패했는데 지우면
  // 다시 보낼 길이 영영 없어지고, 첫 통에 지우면 둘째 통을 못 보낸다.
  if (row.email && delivered && seen >= MAX_MAILS) await store.clearEmail(row.id);
  json(res, 200, { ok: true, delivered, nth: seen });
}

// 내 진술을 대기열에 넣는다.
async function apiStatement(req, res) {
  const body = await readBody(req);
  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .slice(0, 3).map((a) => clean(a, LIMITS.answer));
  while (answers.length < 3) answers.push('');
  if (!answers.some((a) => a)) return json(res, 400, { error: '진술이 비었다' });

  const clues = (Array.isArray(body.clues) ? body.clues : [])
    .slice(0, LIMITS.clues).map((c) => clean(c, LIMITS.clue)).filter(Boolean);

  const email = clip(body.email, LIMITS.email);
  const row = {
    id: newId(),
    token: newToken(),
    player: clip(body.player, 64) || 'anon',
    name: clean(body.name, LIMITS.name) || '이름을 말하지 않았다',
    answers,
    clues,
    email: isEmail(email) ? email : null,
    caught: body.caught === 'house' ? 'house' : 'dock',
    nonce: clip(body.nonce, 64) || null,
    created_at: Date.now(),
    claimed_at: null,
    judged_at: null,
    verdict: null,
    reason: null,
    judge_name: null,
  };
  // 같은 판의 진술을 다시 보냈으면(응답만 끊겼던 경우) 새로 넣지 않고 앞의 것을 돌려준다
  const saved = await store.insert(row);

  const { pending } = await store.counts();
  json(res, 200, { token: saved.token, queued: pending, mail: !!saved.email && mailer.enabled() });
}

// 내 판결이 나왔는지 직접 확인한다.
async function apiLookup(res, token) {
  const row = await store.byToken(clip(token, 64));
  if (!row) return json(res, 404, { error: '그런 진술서는 없다' });
  json(res, 200, {
    name: row.name,
    answers: typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers,
    judged: !!row.judged_at,
    verdict: row.verdict,
    reason: row.reason,
    judgeName: row.judge_name,
    // 두 사람이 읽었으면 둘 다 내놓는다. 서로 반대여도 그대로.
    verdicts: listOf(row.verdicts).map((v) => ({
      verdict: v.verdict, reason: v.reason, judgeName: v.judge_name, at: v.at,
    })),
    waited: Date.now() - Number(row.created_at),
  });
}

/* ─────────────────────────── 정적 파일 ─────────────────────────── */

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('없다');
      return;
    }
    // 코드는 자주 바뀌므로 매번 확인하게 하고, 사진만 오래 물고 있게 둔다.
    const ext = path.extname(file);
    const long = ext === '.jpg' || ext === '.png' || ext === '.svg' || ext === '.woff2';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': long ? 'max-age=86400' : 'no-cache',
    });
    res.end(buf);
  });
}

/* ─────────────────────────── 라우팅 ─────────────────────────── */

// 처리 중에 던져진 오류가 밖으로 새면(예: '//' 같은 주소로 new URL 이 던짐) 처리되지 않은
// Promise 거절이 되어 Node 가 프로세스를 통째로 내린다. 파일 저장이면 진술까지 날아간다.
const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error('[http]', req.url, err.message);
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('잘못된 요청');
  });
});

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/healthz') {
    return json(res, 200, {
      ok: true,
      mail: mailer.enabled(),
      via: mailer.via(),       // brevo · resend · smtp · none
      from: mailer.from(),     // 발신자 — Brevo 에서 인증된 주소여야 나간다
      site: mailer.site(),     // 통지에 실리는 주소
    });
  }

  if (p.startsWith('/api/')) {
    const ip = ipOf(req);
    try {
      if (req.method === 'POST' && tooFast(ip, 40)) return json(res, 429, { error: '너무 빠르다' });
      if (req.method === 'POST' && p === '/api/case') return await apiCase(req, res);
      if (req.method === 'POST' && p === '/api/verdict') return await apiVerdict(req, res);
      if (req.method === 'POST' && p === '/api/statement') return await apiStatement(req, res);
      if (req.method === 'GET' && p.startsWith('/api/statement/')) {
        return await apiLookup(res, decodeURIComponent(p.slice('/api/statement/'.length)));
      }
      if (req.method === 'GET' && p === '/api/stats') return json(res, 200, await store.counts());
      return json(res, 404, { error: '없다' });
    } catch (err) {
      console.error('[api]', p, err.message);
      const known = err.message === 'too large' || err.message === 'bad json';
      return json(res, 400, { error: known ? err.message : '처리하지 못했다' });
    }
  }

  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  serveStatic(req, res, p);
}

openStore().then((s) => {
  store = s;
  server.listen(PORT, () => console.log(`무고 — http://localhost:${PORT}`));
}).catch((err) => {
  console.error('저장소를 열지 못했다', err);
  process.exit(1);
});
