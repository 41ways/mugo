'use strict';

// 진술 보관소.
//
// DATABASE_URL 이 있으면 Postgres 를, 없으면 data/statements.json 을 쓴다.
// 파일 저장은 Render 무료 플랜에서 재시작할 때 통째로 날아가므로 로컬 개발용이다.
// "며칠 뒤에 판결이 메일로 온다"가 이 게임의 전부라서, 실제 배포에는 Postgres 를 붙여야 한다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLAIM_TTL_MS = 30 * 60 * 1000; // 배심원이 물고 간 진술을 다시 풀어주기까지
const CLAIM_LOCK = 482019;            // 나눠주기를 줄 세우는 advisory lock 번호 (아무 수나 고정)
// 한 조서를 몇 사람이 읽는가에는 상한이 없다. 지어낸 조서를 주느니 실제 사람이
// 쓴 것을 다시 돌린다. 다만 통지는 두 통까지만 나간다(주소를 그때 지운다).
const MAX_MAILS = 2;

// 판결 하나. 누가 내렸는지(player)까지 남겨야 같은 사람이 같은 조서를 두 번 안 받는다.
const verdictEntry = (patch) => ({
  verdict: patch.verdict,
  reason: patch.reason,
  judge_name: patch.judge_name,
  by: patch.judged_by || '',
  at: Date.now(),
});
const listOf = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : (v || []));
const judgedBy = (row, player) =>
  !!player && listOf(row.verdicts).some((v) => v.by && v.by === player);

// 손으로 빼둔 조서. claimed_at 을 아주 먼 미래(2100년 따위)로 박아두면 대기열에서 빠진다.
const PARK_MS = 365 * 24 * 60 * 60 * 1000;
const parked = (row, now) => Number(row.claimed_at || 0) > now + PARK_MS;

// 지금 이 조서를 붙들고 있는 사람들. 판결까지 안 가고 나간 사람은 시간이 지나면 놓는다.
// 이미 판결한 사람의 손자국은 판결 쪽에서 세므로 여기서는 뺀다.
const liveHolds = (row, now, me) => listOf(row.holds).filter((h) =>
  h && h.by && h.by !== me &&
  now - Number(h.at || 0) < CLAIM_TTL_MS &&
  !judgedBy(row, h.by));

// 판결 자격을 가리려고 손자국은 넉넉히(6시간) 남겨 둔다. 자리 계산(taken)은 위의 liveHolds 로만 한다.
// (TTL 로 지워 버리면 30분 넘게 심문한 사람의 판결이 거절된다)
const HOLD_KEEP_MS = 6 * 60 * 60 * 1000;
const keptHolds = (row, now, me) => listOf(row.holds).filter((h) =>
  h && h.by && h.by !== me && now - Number(h.at || 0) < HOLD_KEEP_MS && !judgedBy(row, h.by));
const heldBy = (row, player) => listOf(row.holds).some((h) => h && h.by === player);

// 몇 자리가 찼는가 — 판결한 사람 + 지금 붙들고 있는 사람.
const taken = (row, now, me) =>
  (row.judged_count != null ? row.judged_count : (row.judged_at ? 1 : 0)) + liveHolds(row, now, me).length;

// 마지막으로 누가 이 조서를 손댄 때 — 받아 갔거나 판결했거나.
const lastTouch = (row) => Math.max(0,
  ...listOf(row.verdicts).map((v) => Number(v.at || 0)),
  ...listOf(row.holds).map((h) => Number(h.at || 0)));

// 누구에게 무엇을 줄까.
//   1순위 — 아무도 안 건드린 조서. 플레이가 먼저 끝난 순서대로, 한 사람에 하나.
//   2순위 — 그런 게 없으면 「지금 돌고 있는 조서」, 곧 가장 최근에 누가 받아 가거나
//           판결한 조서를 준다. 안 건드린 조서가 없다는 건 앞사람들이 아직 게임을
//           끝내지 않았다는 뜻이다(끝내면 그 사람 진술이 새로 들어오므로). 그러니
//           그들이 읽고 있는 조서를 같이 읽히는 게 맞다 — 판결까지 마치고 뒤를 진행
//           중이어도 마찬가지다. 몇 번을 읽히든 상한은 없다.
//   줄 게 정말 하나도 없을 때만 null — 그때야 지어낸 조서로 간다.
//
//   예) 대기열에 서혁인 하나. skrrr 가 받아 판결하고 뒤를 진행 중
//       → 새로 온 사람도 서혁인. skrrr 가 끝내면 skrrr 진술이 1순위로 나간다.
function choose(rows, now, me) {
  const line = rows
    .filter((r) => !parked(r, now) && r.player !== me && !judgedBy(r, me))
    .sort((a, b) => a.created_at - b.created_at);
  return line.find((r) => taken(r, now, me) === 0)
      // 같은 때 손댄 것끼리면 더 새로 들어온 조서 — 지금 도는 쪽에 더 가깝다
      || line.slice().sort((a, b) => (lastTouch(b) - lastTouch(a)) || (b.created_at - a.created_at))[0]
      || null;
}

const newId = () => crypto.randomUUID();
const newToken = () => crypto.randomBytes(12).toString('hex');

/* ─────────────────────────── 파일 저장 ─────────────────────────── */

class FileStore {
  constructor(dir) {
    this.file = path.join(dir, 'statements.json');
    this.dir = dir;
    this.rows = [];
    this.writing = Promise.resolve();
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.rows = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.rows = [];
    }
    return this;
  }

  // 쓰기를 직렬화해서 두 요청이 서로의 결과를 덮어쓰지 않게 한다.
  flush() {
    this.writing = this.writing.then(() => {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.rows, null, 2));
      fs.renameSync(tmp, this.file);
    }).catch((err) => console.error('[store] 쓰기 실패', err));
    return this.writing;
  }

  async insert(row) {
    this.rows.push(row);
    await this.flush();
    return row;
  }

  // 들어온 순서대로 하나씩, 한 사람에 한 조서. 그게 기본이다.
  // 아무도 안 건드린 조서가 없을 때만 — 동시에 들어와 앞사람이 붙들고 있거나,
  // 남은 게 이미 읽힌 것뿐일 때만 — 한 조서를 두 사람째 읽힌다.
  async claim(me) {
    const now = Date.now();
    const pick = choose(this.rows, now, me);
    if (!pick) return null;
    pick.holds = keptHolds(pick, now, me).concat([{ by: me, at: now }]);
    await this.flush();
    return pick;
  }

  async byId(id) {
    return this.rows.find((r) => r.id === id) || null;
  }

  async byToken(token) {
    return this.rows.find((r) => r.token === token) || null;
  }

  async judge(id, patch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (patch.judged_by && patch.judged_by !== 'anon' && judgedBy(row, patch.judged_by)) return null;
    // 이 조서를 받아 간 사람만 판결한다 — 아무 조서 번호로나 판결을 쏟아부을 수 없게
    if (!heldBy(row, patch.judged_by || '')) return null;
    const seen = row.judged_count != null ? row.judged_count : (row.judged_at ? 1 : 0);
    const entry = verdictEntry(patch);
    row.verdicts = (row.verdicts || []).concat([entry]);
    row.judged_count = seen + 1;
    if (!row.judged_at) Object.assign(row, patch, { judged_at: entry.at });  // 첫 판결은 칸에도 남긴다
    row.holds = listOf(row.holds).filter((h) => h.by !== entry.by);          // 판결했으니 손을 놓는다
    await this.flush();
    return row;
  }

  async clearEmail(id) {
    const row = this.rows.find((r) => r.id === id);
    if (row) { row.email = null; await this.flush(); }
  }

  async counts() {
    const now = Date.now();
    return {
      total: this.rows.length,
      pending: this.rows.filter((r) =>
        !parked(r, now) && !(r.judged_count != null ? r.judged_count : (r.judged_at ? 1 : 0))).length,
    };
  }

  // 판결은 났는데 통지가 못 나간 것들. 주소가 남아 있으면 아직 못 보냈다는 뜻이다.
  async undelivered() {
    return this.rows
      .filter((r) => r.judged_at && r.email)
      .sort((a, b) => a.judged_at - b.judged_at);
  }

  // n번째 판결의 통지 결과를 그 판결 옆에 적어 둔다. 나중에 「나갔나」를 DB 만 보고 안다.
  async markMailed(id, nth, info) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    const vs = listOf(row.verdicts);
    if (!vs[nth - 1]) return;
    vs[nth - 1].mail = info;
    row.verdicts = vs;
    await this.flush();
  }

  // 대기열을 들여다볼 때만 쓴다(tools/queue.js). 게임 진행에는 안 쓰인다.
  async all() {
    return this.rows.slice();
  }
}

/* ─────────────────────────── Postgres ─────────────────────────── */

const DDL = `
CREATE TABLE IF NOT EXISTS statements (
  id          TEXT PRIMARY KEY,
  token       TEXT UNIQUE NOT NULL,
  player      TEXT NOT NULL,
  name        TEXT NOT NULL,
  answers     JSONB NOT NULL,
  clues       JSONB NOT NULL DEFAULT '[]'::jsonb,
  email       TEXT,
  caught      TEXT,
  created_at  BIGINT NOT NULL,
  claimed_at  BIGINT,
  judged_at   BIGINT,
  verdict     TEXT,
  reason      TEXT,
  judge_name  TEXT
);
CREATE INDEX IF NOT EXISTS statements_open ON statements (judged_at, created_at);
ALTER TABLE statements ADD COLUMN IF NOT EXISTS caught TEXT;

-- 한 조서를 두 사람까지 읽는다. 판결은 갈려도 된다.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS judged_count INT NOT NULL DEFAULT 0;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS verdicts JSONB NOT NULL DEFAULT '[]'::jsonb;
-- 지금 이 조서를 붙들고 있는 사람들. 두 자리까지 동시에 찬다.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS holds JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 이미 판결이 난 옛 행들을 새 칸으로 옮긴다. 한 번 읽힌 것으로 친다.
UPDATE statements
   SET judged_count = 1,
       verdicts = jsonb_build_array(jsonb_build_object(
         'verdict', verdict, 'reason', reason, 'judge_name', judge_name,
         'by', '', 'at', judged_at))
 WHERE judged_at IS NOT NULL AND judged_count = 0;
`;

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: url,
      // Neon·Supabase 는 TLS 를 요구하는데 체인이 로컬에 없을 수 있다.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 4,
    });
  }

  async init() {
    await this.pool.query(DDL);
    return this;
  }

  async insert(row) {
    await this.pool.query(
      `INSERT INTO statements (id, token, player, name, answers, clues, email, caught, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.token, row.player, row.name,
       JSON.stringify(row.answers), JSON.stringify(row.clues), row.email, row.caught, row.created_at]);
    return row;
  }

  // 한 방에 고르고 잠근다. 동시에 들어온 두 사람이 같은 진술을 받지 않도록.
  // 아직 판결 안 난 것이 먼저고, 그게 없으면 이미 판결된 것을 한 번 더 돌린다.
  // 마지막까지 없을 때만 지어낸 조서로 간다 — 사람이 쓴 것이 늘 우선이다.
  // 들어온 순서대로 하나씩, 한 사람에 한 조서. 아무도 안 건드린 것이 없을 때만
  // 이미 한 자리 찬 조서를 두 사람째 내준다(동시 접속, 또는 남은 게 읽힌 것뿐일 때).
  //
  // 자리를 세는 일과 채우는 일이 갈라지면 셋이 들어갈 수 있어서, 한 트랜잭션 안에서
  // 앞줄 몇 개를 FOR UPDATE 로 잡고 센다. SKIP LOCKED 를 쓰면 자리가 남았는데도
  // 건너뛰어 버리므로 여기서는 기다리는 쪽이 맞다.
  async claim(me) {
    const now = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 조서 나눠주기는 한 번에 하나씩. 행을 골라 잠그면 「가장 최근에 손댄 조서」가
      // 잠근 범위 밖에 있을 수 있어, 나눠주기 전체를 트랜잭션 잠금 하나로 줄 세운다.
      await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK]);
      const { rows } = await client.query(
        `SELECT * FROM statements
          WHERE player <> $1
            AND NOT (verdicts @> $2::jsonb)
            AND (claimed_at IS NULL OR claimed_at < $3)`,
        [me, JSON.stringify([{ by: me }]), now + PARK_MS]);

      const r = choose(rows, now, me);
      if (r) {
        const next = keptHolds(r, now, me).concat([{ by: me, at: now }]);
        const upd = await client.query(
          `UPDATE statements SET holds = $2::jsonb WHERE id = $1 RETURNING *`,
          [r.id, JSON.stringify(next)]);
        await client.query('COMMIT');
        return upd.rows[0];
      }
      await client.query('COMMIT');
      return null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async byId(id) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async byToken(token) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE token = $1', [token]);
    return rows[0] || null;
  }

  // 판결은 몇 번이든 쌓이지만 한 사람은 한 번이다. 순번은 한 번의 UPDATE 안에서 매겨져 겹치지 않고,
  // 통지를 몇 번째까지 보낼지는 server.js 가 그 순번으로 가른다.
  async judge(id, patch) {
    const entry = verdictEntry(patch);
    const { rows } = await this.pool.query(
      `UPDATE statements
          SET judged_count = judged_count + 1,
              verdicts     = verdicts || $2::jsonb,
              holds        = COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(holds) h
                                        WHERE h->>'by' IS DISTINCT FROM $7), '[]'::jsonb),
              verdict      = COALESCE(verdict, $3),
              reason       = COALESCE(reason, $4),
              judge_name   = COALESCE(judge_name, $5),
              judged_at    = COALESCE(judged_at, $6)
        WHERE id = $1
          AND ($7 = 'anon' OR $7 = '' OR NOT (verdicts @> $8::jsonb))   -- 같은 사람이 두 번 판결하지 못한다
          AND holds @> $8::jsonb                                        -- 이 조서를 받아 간 사람만
        RETURNING *`,
      [id, JSON.stringify([entry]), patch.verdict, patch.reason,
       patch.judge_name, entry.at, entry.by, JSON.stringify([{ by: entry.by }])]);
    return rows[0] || null;
  }

  async clearEmail(id) {
    await this.pool.query('UPDATE statements SET email = NULL WHERE id = $1', [id]);
  }

  async counts() {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE judged_count = 0
                  AND (claimed_at IS NULL OR claimed_at < $1))::int AS pending
         FROM statements`, [Date.now() + PARK_MS]);
    return rows[0];
  }

  // 판결은 났는데 통지가 못 나간 것들. 다시 보내야 하므로 주소를 그대로 가져온다.
  async undelivered() {
    const { rows } = await this.pool.query(
      `SELECT * FROM statements
        WHERE judged_at IS NOT NULL AND email IS NOT NULL
        ORDER BY judged_at`);
    return rows;
  }

  // n번째 판결의 통지 결과를 그 판결 옆에 적어 둔다.
  // 판결 목록 전체를 덮어쓰지 않고 그 칸만 고친다 — 사이에 다른 판결이 붙어도 안 지워진다.
  async markMailed(id, nth, info) {
    await this.pool.query(
      `UPDATE statements
          SET verdicts = jsonb_set(verdicts, ARRAY[$2::text, 'mail'], $3::jsonb, true)
        WHERE id = $1 AND jsonb_array_length(verdicts) >= $4`,
      [id, String(nth - 1), JSON.stringify(info), nth]);
  }

  // 대기열을 들여다볼 때만 쓴다(tools/queue.js). 주소는 있는지 없는지만 가져온다.
  async all() {
    const { rows } = await this.pool.query(
      `SELECT id, name, caught, created_at, claimed_at, judged_at, verdict, judge_name,
              judged_count, verdicts, holds, (email IS NOT NULL) AS email
         FROM statements`);
    return rows;
  }

  async close() {
    await this.pool.end();
  }
}

/* ─────────────────────────── 공용 입구 ─────────────────────────── */

async function openStore() {
  if (process.env.DATABASE_URL) {
    console.log('[store] Postgres');
    return new PgStore(process.env.DATABASE_URL).init();
  }
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  console.warn('[store] 파일 저장 — 재시작하면 진술이 사라진다. 배포에는 DATABASE_URL 을 붙일 것.');
  return new FileStore(dir).init();
}

module.exports = { openStore, newId, newToken, CLAIM_TTL_MS, MAX_MAILS, listOf };
