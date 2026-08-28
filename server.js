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
const { openStore, newId, newToken } = require('./store.js');
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

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

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
  if (hits.size > 5000) hits.clear();
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

  const row = await store.judge(caseId, { verdict, reason, judge_name: judgeName });
  if (!row) return json(res, 200, { ok: true, delivered: false, already: true });

  // 메일은 한 번만 쓰고 지운다 — 단, 실제로 나갔을 때만.
  // 발송이 실패했는데도 주소를 지우면 다시 보낼 길이 영영 없어진다.
  const delivered = await mailer.sendVerdict(row);
  if (row.email && delivered) await store.clearEmail(row.id);
  json(res, 200, { ok: true, delivered });
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
    created_at: Date.now(),
    claimed_at: null,
    judged_at: null,
    verdict: null,
    reason: null,
    judge_name: null,
  };
  await store.insert(row);
  // 접수증은 보내지 않는다. 메일은 판결 한 통뿐이다.

  const { pending } = await store.counts();
  json(res, 200, { token: row.token, queued: pending, mail: !!row.email && mailer.enabled() });
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

const server = http.createServer(async (req, res) => {
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
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  serveStatic(req, res, p);
});

openStore().then((s) => {
  store = s;
  server.listen(PORT, () => console.log(`무고 — http://localhost:${PORT}`));
}).catch((err) => {
  console.error('저장소를 열지 못했다', err);
  process.exit(1);
});
