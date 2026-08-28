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
const MAX_VERDICTS = 2;              // 한 조서를 몇 사람까지 읽는가

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

  async claim(excludePlayer) {
    const now = Date.now();
    const older = (a, b) => a.created_at - b.created_at;   // 오래 기다린 사람부터

    // 1순위 — 아직 판결 안 난 진술. 둘 이상 쌓여 있으면 잠금이 걸려 하나씩 나간다.
    const fresh = this.rows.filter((r) =>
      !r.judged_at &&
      r.player !== excludePlayer &&
      (!r.claimed_at || now - r.claimed_at > CLAIM_TTL_MS)).sort(older);
    if (fresh.length) {
      fresh[0].claimed_at = now;
      await this.flush();
      return fresh[0];
    }

    // 2순위 — 이미 판결이 난 진술을 한 번 더 돌린다. 판결이 갈려도 상관없다.
    // 지어낸 조서를 주느니, 실제로 누가 쓴 것을 주는 편이 낫다.
    const again = this.rows.filter((r) =>
      r.judged_at &&
      (r.judged_count || 1) < MAX_VERDICTS &&
      r.player !== excludePlayer &&
      !judgedBy(r, excludePlayer)).sort(older);
    if (again.length) return again[0];

    return null;
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
    const seen = row.judged_count != null ? row.judged_count : (row.judged_at ? 1 : 0);
    if (seen >= MAX_VERDICTS) return null;
    const entry = verdictEntry(patch);
    row.verdicts = (row.verdicts || []).concat([entry]);
    row.judged_count = seen + 1;
    if (!row.judged_at) Object.assign(row, patch, { judged_at: entry.at });  // 첫 판결은 칸에도 남긴다
    await this.flush();
    return row;
  }

  async clearEmail(id) {
    const row = this.rows.find((r) => r.id === id);
    if (row) { row.email = null; await this.flush(); }
  }

  async counts() {
    return {
      total: this.rows.length,
      pending: this.rows.filter((r) => !r.judged_at).length,
    };
  }

  // 판결은 났는데 통지가 못 나간 것들. 주소가 남아 있으면 아직 못 보냈다는 뜻이다.
  async undelivered() {
    return this.rows
      .filter((r) => r.judged_at && r.email)
      .sort((a, b) => a.judged_at - b.judged_at);
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
  async claim(excludePlayer) {
    const now = Date.now();
    const { rows } = await this.pool.query(
      `UPDATE statements SET claimed_at = $1
        WHERE id = (
          SELECT id FROM statements
           WHERE judged_at IS NULL
             AND player <> $2
             AND (claimed_at IS NULL OR claimed_at < $3)
           ORDER BY created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [now, excludePlayer, now - CLAIM_TTL_MS]);
    if (rows[0]) return rows[0];

    // 두 번째 배심원. 잠그지 않는다 — 이미 판결이 난 조서라 서로 겹쳐도 된다.
    const again = await this.pool.query(
      `SELECT * FROM statements
        WHERE judged_at IS NOT NULL
          AND judged_count < $2
          AND player <> $1
          AND NOT (verdicts @> $3::jsonb)
        ORDER BY created_at
        LIMIT 1`,
      [excludePlayer, MAX_VERDICTS, JSON.stringify([{ by: excludePlayer }])]);
    return again.rows[0] || null;
  }

  async byId(id) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async byToken(token) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE token = $1', [token]);
    return rows[0] || null;
  }

  // 두 사람까지. 동시에 들어와도 한 번의 UPDATE 안에서 세므로 셋이 되지 않는다.
  async judge(id, patch) {
    const entry = verdictEntry(patch);
    const { rows } = await this.pool.query(
      `UPDATE statements
          SET judged_count = judged_count + 1,
              verdicts     = verdicts || $2::jsonb,
              verdict      = COALESCE(verdict, $3),
              reason       = COALESCE(reason, $4),
              judge_name   = COALESCE(judge_name, $5),
              judged_at    = COALESCE(judged_at, $6)
        WHERE id = $1 AND judged_count < $7
        RETURNING *`,
      [id, JSON.stringify([entry]), patch.verdict, patch.reason,
       patch.judge_name, entry.at, MAX_VERDICTS]);
    return rows[0] || null;
  }

  async clearEmail(id) {
    await this.pool.query('UPDATE statements SET email = NULL WHERE id = $1', [id]);
  }

  async counts() {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE judged_at IS NULL)::int AS pending
         FROM statements`);
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

  // 대기열을 들여다볼 때만 쓴다(tools/queue.js). 주소는 있는지 없는지만 가져온다.
  async all() {
    const { rows } = await this.pool.query(
      `SELECT id, name, caught, created_at, claimed_at, judged_at, verdict, judge_name,
              judged_count, verdicts, (email IS NOT NULL) AS email
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

module.exports = { openStore, newId, newToken, CLAIM_TTL_MS, MAX_VERDICTS, listOf };
