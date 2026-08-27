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
    const free = this.rows.filter((r) =>
      !r.judged_at &&
      r.player !== excludePlayer &&
      (!r.claimed_at || now - r.claimed_at > CLAIM_TTL_MS));
    if (!free.length) return null;
    free.sort((a, b) => a.created_at - b.created_at); // 오래 기다린 사람부터
    const row = free[0];
    row.claimed_at = now;
    await this.flush();
    return row;
  }

  async byId(id) {
    return this.rows.find((r) => r.id === id) || null;
  }

  async byToken(token) {
    return this.rows.find((r) => r.token === token) || null;
  }

  async judge(id, patch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.judged_at) return null;
    Object.assign(row, patch, { judged_at: Date.now() });
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
  created_at  BIGINT NOT NULL,
  claimed_at  BIGINT,
  judged_at   BIGINT,
  verdict     TEXT,
  reason      TEXT,
  judge_name  TEXT
);
CREATE INDEX IF NOT EXISTS statements_open ON statements (judged_at, created_at);
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
      `INSERT INTO statements (id, token, player, name, answers, clues, email, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.token, row.player, row.name,
       JSON.stringify(row.answers), JSON.stringify(row.clues), row.email, row.created_at]);
    return row;
  }

  // 한 방에 고르고 잠근다. 동시에 들어온 두 사람이 같은 진술을 받지 않도록.
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
    return rows[0] || null;
  }

  async byId(id) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async byToken(token) {
    const { rows } = await this.pool.query('SELECT * FROM statements WHERE token = $1', [token]);
    return rows[0] || null;
  }

  async judge(id, patch) {
    const { rows } = await this.pool.query(
      `UPDATE statements
          SET verdict = $2, reason = $3, judge_name = $4, judged_at = $5
        WHERE id = $1 AND judged_at IS NULL
        RETURNING *`,
      [id, patch.verdict, patch.reason, patch.judge_name, Date.now()]);
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

module.exports = { openStore, newId, newToken, CLAIM_TTL_MS };
