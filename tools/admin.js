'use strict';

// 대기열을 손으로 정리한다. 플레이하지 않고 판결하고, 못 쓰는 주소를 지우고, 조서를 빼두거나 되돌린다.
//
//   DATABASE_URL=... node tools/admin.js <명령> ...
//
//   list                                   대기열과 판결 난 조서를 한눈에
//   show  <이름>                           진술서 — 탐정이 게임에서 보는 그대로
//   judge <이름> 유죄|무죄 "<판결문>" "<탐정 이름>"   플레이 없이 판결한다. 통지도 실제로 나간다
//   forget-email <이름>                    못 쓰는 주소를 지운다 (장난으로 적은 주소 등)
//   park   <이름>                          대기열에서 빼둔다 (판결도 통지도 안 나간다)
//   unpark <이름>                          빼둔 것을 되돌린다
//
// 쓰는 명령(judge·forget-email·park·unpark)은 먼저 무엇을 할지만 보여준다.
// 실제로 하려면 끝에 --yes 를 붙인다.
//
// 이름이 겹치면(예: 「이름을 말하지 않았다」가 여럿) 목록에 찍힌 #번호 앞자리로 가리킨다.
//   node tools/admin.js show '#5b87'
//
// 판결은 프로덕션 서버를 거쳐 보낸다. 로컬에는 Brevo 키가 없어서 메일을 보낼 수 없기 때문이다.
// 서버는 「조서를 받아 간 사람만 판결」하게 막혀 있으므로, 관리용 손자국을 먼저 DB 에 남긴 뒤
// 그 이름으로 판결을 부른다. 게임에서 판결하는 것과 똑같이 기록되고 통지가 나간다.

global.window = {};
require('../public/story.js');
const S = window.STORY;
const { openStore, listOf, CLAIM_TTL_MS } = require('../store.js');

const SITE = (process.env.PUBLIC_URL || 'https://mug0.onrender.com').replace(/\/$/, '');
const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--yes');
const YES = process.argv.includes('--yes');
const PARK_AT = 4102444800000;            // 2100-01-01. 대기열이 「아주 먼 미래에 누가 받아 갔다」로 여기게
const PARK_MS = 365 * 24 * 60 * 60 * 1000;

const span = (ms) => {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}일 ${h % 24}시간` : h ? `${h}시간 ${m % 60}분` : `${m}분`;
};
const mask = (e) => {
  if (!e) return '(없음)';
  const [id, host] = String(e).split('@');
  return host ? `${id.slice(0, 2)}${'*'.repeat(Math.max(1, id.length - 2))}@${host}` : '***';
};
const judgedCount = (r) => (r.judged_count != null ? r.judged_count : (r.judged_at ? 1 : 0));
const isParked = (r, now) => Number(r.claimed_at || 0) > now + PARK_MS;

async function all(store) {
  if (store.pool) return (await store.pool.query('SELECT * FROM statements ORDER BY created_at')).rows;
  return (await store.all()).sort((a, b) => a.created_at - b.created_at);
}

// 이름 또는 #id앞자리로 한 건을 찾는다. 겹치면 멈추고 후보를 보여준다.
function pick(rows, key) {
  if (!key) throw new Error('누구를 말하는지 이름을 주시오.');
  const found = key.startsWith('#')
    ? rows.filter((r) => r.id.startsWith(key.slice(1)))
    : rows.filter((r) => r.name === key);
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`「${key}」인 조서가 없다. list 로 이름을 확인하시오.`);
  const lines = found.map((r) => `  #${r.id.slice(0, 6)}  ${r.name}  ${new Date(Number(r.created_at)).toISOString().slice(0, 16)}`);
  throw new Error(`「${key}」가 ${found.length}건이다. #번호로 가리키시오.\n${lines.join('\n')}`);
}

function dry(what) {
  if (YES) return false;
  console.log(`\n${what}\n\n실제로 하려면 끝에 --yes 를 붙이시오.\n`);
  return true;
}

async function list(store) {
  const rows = await all(store);
  const now = Date.now();
  const open = rows.filter((r) => judgedCount(r) === 0 && !isParked(r, now));
  const done = rows.filter((r) => judgedCount(r) > 0);
  const parked = rows.filter((r) => isParked(r, now));

  console.log(`\n대기열 — 아직 아무도 안 읽은 조서 ${open.length}건 (위에서부터 나간다)`);
  open.forEach((r, i) => {
    const live = listOf(r.holds).filter((h) => now - Number(h.at || 0) < CLAIM_TTL_MS).length;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(8)} #${r.id.slice(0, 6)}  ${span(now - Number(r.created_at))}째` +
      `${live ? `  · 지금 ${live}명이 보는 중` : ''}  · 주소 ${r.email ? '있음' : '없음'}`);
  });

  if (done.length) {
    console.log(`\n판결 난 조서 ${done.length}건`);
    done.forEach((r) => {
      const vs = listOf(r.verdicts);
      const line = vs.map((v, i) => {
        const m = v.mail;
        const mail = i >= 2 ? '' : !m ? ' [통지 기록 없음]'
          : m.skipped === 'no-address' ? ' [주소 없음]' : m.skipped ? ' [통지 두 통 끝]'
          : m.ok ? ' [통지 나감]' : ' [통지 못 나감]';
        return `${v.verdict === 'guilty' ? '유죄' : '무죄'}(${v.judge_name || '?'})${mail}`;
      }).join('  ·  ');
      console.log(`  ${r.name.padEnd(8)} #${r.id.slice(0, 6)}  ${line}  · 주소 ${r.email ? '남음' : '지워짐'}`);
    });
  }

  if (parked.length) {
    console.log(`\n빼둔 조서 ${parked.length}건 — 대기열에 안 나온다`);
    parked.forEach((r) => console.log(`  ${r.name.padEnd(8)} #${r.id.slice(0, 6)}  · 주소 ${r.email ? '있음' : '없음'}`));
  }
  console.log('');
}

async function show(store, key) {
  const r = pick(await all(store), key);
  const caught = r.caught === 'house' ? 'house' : 'dock';
  const qs = S.act2.questions.concat([S.act2.third[caught]]);
  const ans = listOf(r.answers), clues = listOf(r.clues);
  console.log(`\n【${r.name}】 #${r.id.slice(0, 6)}  ${span(Date.now() - Number(r.created_at))}째  · 주소 ${mask(r.email)}`);
  // 게임 2장에서 탐정이 보는 사건 기록과 같은 모양으로
  const R = S.act2.record;
  const kept = !!clues.length && /적힌 장은|찢기지 않은/.test(clues[0]);
  const book = kept ? R.kept : clues.length ? R.torn : null;
  const items = R.items[caught].slice(0, 2).concat([book ? book.item : R.items[caught][2]]);
  console.log(`\n증거품  ${items.join(' · ')}`);
  const log = R.log[caught].slice();
  if (book) {
    const found = R.facts.filter((f) => clues.some((x) => new RegExp(f.re).test(x))).map((f) => f.t);
    log.push({ t: book.t, s: book === R.kept && found.length ? `수첩: ${found.join(' · ')}` : [book.s].concat(found).join(' · ') });
  }
  log.forEach((l) => console.log(`  ▪ ${l.t}${l.s ? `\n      ${l.s}` : ''}`));
  console.log(`  [${R.stamp}]${book ? ` [${book.conclude}]` : ''}`);
  console.log('');
  qs.forEach((q, i) => console.log(`  나   ${q}\n  남자 ${(ans[i] || '').trim() || '(대답하지 않는다)'}\n`));
  const vs = listOf(r.verdicts);
  if (vs.length) {
    console.log('이미 난 판결');
    vs.forEach((v, i) => console.log(`  ${i + 1}. ${v.verdict === 'guilty' ? '유죄' : '무죄'} — 탐정 ${v.judge_name}: 「${v.reason || ''}」`));
    console.log('');
  }
}

async function judge(store, key, verdictWord, reason, judgeName) {
  const verdict = /^(유죄|guilty)$/i.test(verdictWord || '') ? 'guilty'
    : /^(무죄|innocent)$/i.test(verdictWord || '') ? 'innocent' : null;
  if (!verdict) throw new Error('유죄 또는 무죄를 주시오.');
  if (!String(reason || '').trim()) throw new Error('판결문을 주시오. 그 사람에게 그대로 간다.');
  if (!String(judgeName || '').trim()) throw new Error('탐정 이름을 주시오.');

  const r = pick(await all(store), key);
  const nth = judgedCount(r) + 1;
  const mails = r.email && nth <= 2;
  if (dry(`【${r.name}】에게 ${nth}번째 판결 — ${verdict === 'guilty' ? '유죄' : '무죄'}, 탐정 ${judgeName}\n` +
    `판결문: 「${reason}」\n통지: ${mails ? `${mask(r.email)} 로 나간다` : '안 나간다 (주소가 없거나 이미 두 통 나감)'}`)) return;

  // 관리용 손자국을 남긴다 — 서버가 「받아 간 사람」으로 알아보도록
  const player = `owner-${Date.now().toString(36)}`;
  const hold = { by: player, at: Date.now() };
  if (store.pool) {
    await store.pool.query(`UPDATE statements SET holds = holds || $2::jsonb WHERE id = $1`, [r.id, JSON.stringify([hold])]);
  } else {
    const row = (await store.all()).find((x) => x.id === r.id);
    row.holds = listOf(row.holds).concat([hold]);
    await store.flush();
  }

  const res = await fetch(`${SITE}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: r.id, verdict, reason, judgeName, player }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || body.already) {
    throw new Error(`서버가 판결을 받지 않았다: ${res.status} ${JSON.stringify(body)}`);
  }

  // 서버가 남긴 통지 결과를 읽어 온다
  const after = pick(await all(store), `#${r.id}`);
  const m = (listOf(after.verdicts)[body.nth - 1] || {}).mail;
  console.log(`\n【${r.name}】 ${body.nth}번째 판결 기록됨 — ${verdict === 'guilty' ? '유죄' : '무죄'}(${judgeName})`);
  console.log(`통지: ${!m ? '보낼 대상 아님' : m.ok ? `나감 · ${m.via} · ${m.id}` : `못 나감 · ${m.err}`}\n`);
}

async function forgetEmail(store, key) {
  const r = pick(await all(store), key);
  if (!r.email) { console.log(`\n【${r.name}】은 이미 주소가 없다.\n`); return; }
  if (dry(`【${r.name}】의 주소 ${mask(r.email)} 를 지운다. 이 조서로는 통지가 더 안 나간다.`)) return;
  await store.clearEmail(r.id);
  console.log(`\n【${r.name}】 주소를 지웠다.\n`);
}

async function park(store, key, on) {
  const r = pick(await all(store), key);
  const now = Date.now();
  if (on && isParked(r, now)) { console.log(`\n【${r.name}】은 이미 빼둔 상태다.\n`); return; }
  if (!on && !isParked(r, now)) { console.log(`\n【${r.name}】은 빼둔 상태가 아니다.\n`); return; }
  if (dry(on ? `【${r.name}】을 대기열에서 빼둔다. 다음 손님부터 이 조서는 안 나간다.`
             : `【${r.name}】을 대기열로 되돌린다. 순서는 원래 들어온 자리(${span(now - Number(r.created_at))} 전)다.`)) return;
  const value = on ? PARK_AT : null;
  if (store.pool) await store.pool.query('UPDATE statements SET claimed_at = $2 WHERE id = $1', [r.id, value]);
  else { const row = (await store.all()).find((x) => x.id === r.id); row.claimed_at = value; await store.flush(); }
  console.log(`\n【${r.name}】 ${on ? '빼뒀다' : '대기열로 되돌렸다'}.\n`);
}

(async () => {
  const store = await openStore();
  try {
    if (cmd === 'list' || !cmd) await list(store);
    else if (cmd === 'show') await show(store, args[0]);
    else if (cmd === 'judge') await judge(store, args[0], args[1], args[2], args[3]);
    else if (cmd === 'forget-email') await forgetEmail(store, args[0]);
    else if (cmd === 'park') await park(store, args[0], true);
    else if (cmd === 'unpark') await park(store, args[0], false);
    else throw new Error(`모르는 명령: ${cmd}\n  list · show · judge · forget-email · park · unpark`);
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exitCode = 1;
  } finally {
    if (store.close) await store.close();
  }
})();
