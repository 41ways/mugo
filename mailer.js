'use strict';

// 판결 통지서를 보낸다.
//
// SMTP_URL 이 없으면 아무 데도 보내지 않고 콘솔에만 찍는다(로컬 개발).
// Gmail 이라면 2단계 인증을 켜고 앱 비밀번호를 발급받아
//   SMTP_URL=smtps://아이디@gmail.com:앱비밀번호@smtp.gmail.com:465
// 형태로 넣으면 된다.

const nodemailer = require('nodemailer');

const FROM = process.env.MAIL_FROM || '회항 경찰서 <no-reply@localhost>';
const SITE = (process.env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '');

let transport = null;
if (process.env.SMTP_URL) {
  transport = nodemailer.createTransport(process.env.SMTP_URL);
} else {
  console.warn('[mail] SMTP_URL 없음 — 메일은 콘솔에만 찍힌다.');
}

// 받침을 보고 조사를 고른다. 이름 뒤에 괄호가 붙으면 이야기의 김이 샌다.
function josa(word, pair) {
  const [withBatchim, without] = pair.split('/');
  const ch = String(word == null ? '' : word).trim().slice(-1);
  if (!ch) return without;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withBatchim : without;
  // 로마자 이름은 읽히는 소리로 친다. Sherlock 은 「이」, Holmes 는 「가」.
  if (/[a-z]/i.test(ch)) return /[aeiouysxz]/i.test(ch) ? without : withBatchim;
  return without;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shell(inner) {
  return `<div style="margin:0;padding:32px 16px;background:#14120f;font-family:'Apple SD Gothic Neo','Noto Serif KR',Georgia,serif;">
  <div style="max-width:520px;margin:0 auto;background:#f0e9dc;color:#231f1a;padding:38px 34px 30px;border-radius:2px;box-shadow:0 12px 40px rgba(0,0,0,.5);">
    <div style="font-size:11px;letter-spacing:.34em;color:#8a7c66;text-transform:uppercase;">회항 지방법원</div>
    <div style="height:1px;background:#c9bda4;margin:14px 0 24px;"></div>
    ${inner}
    <div style="height:1px;background:#c9bda4;margin:28px 0 14px;"></div>
    <div style="font-size:11.5px;color:#8a7c66;line-height:1.7;">
      이 통지는 웹 게임 <a href="${SITE}" style="color:#8a5a20;">무고</a>에서 자동으로 발송됐다.
      당신의 주소는 이 한 통을 보내기 위해서만 보관됐고, 발송과 동시에 지워졌다.
    </div>
  </div>
</div>`;
}

const P = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.85;">${t}</p>`;

function verdictMail(row) {
  const guilty = row.verdict === 'guilty';
  const name = esc(row.name || '이름 없는 자');
  const judge = esc(row.judge_name || '이름을 밝히지 않은 탐정');
  const reason = String(row.reason || '').trim();

  const head = guilty
    ? `<div style="font-size:27px;font-weight:700;letter-spacing:-.02em;color:#7d1c14;">유죄</div>`
    : `<div style="font-size:27px;font-weight:700;letter-spacing:-.02em;color:#3d4a3a;">무죄</div>`;

  const body = guilty ? [
    P(`${name}. 재판은 열렸으나 오래 걸리지 않았다.`),
    P(`탐정 <b>${judge}</b>${josa(row.judge_name, '이/가')} 당신의 진술을 읽었고, 당신을 범인으로 지목했다. 회항에서 그 사람의 말은 판결과 같은 무게를 가진다. 배심원은 십일 분 만에 돌아왔다.`),
    P(`형은 사흘 뒤 새벽, 부두 창고 앞 광장에서 집행됐다. 안개가 짙어 구경꾼은 많지 않았다.`),
  ] : [
    P(`${name}. 재판은 열리지 않았다.`),
    P(`탐정 <b>${judge}</b>${josa(row.judge_name, '이/가')} 당신의 진술을 읽었고, 증거가 사람을 목매달 만큼은 아니라고 했다. 서류에 도장이 찍혔고, 당신은 그날 밤 뒷문으로 나왔다.`),
    P(`아무도 사과하지 않았다. 안개 속으로 걸어 나가는 당신의 뒷모습을 간수 하나가 오래 지켜봤다고 한다.`),
  ];

  const quoted = reason ? `
    <div style="margin:22px 0 4px;font-size:11px;letter-spacing:.28em;color:#8a7c66;">탐정의 소견</div>
    <div style="border-left:2px solid #a08a5e;padding:8px 0 8px 14px;margin:8px 0 4px;font-size:14.5px;line-height:1.8;color:#4a4237;">${esc(reason)}</div>` : '';

  const tail = P(`<span style="font-size:13px;color:#6d6355;">당신을 판결한 사람도 당신과 똑같은 밤을 보냈고, 지금 어딘가에서 자기 판결을 기다리고 있다.</span>`);

  return {
    subject: guilty ? '[회항 지방법원] 판결 — 유죄' : '[회항 지방법원] 판결 — 무죄',
    html: shell(head + '<div style="height:18px"></div>' + body.join('') + quoted + tail),
    text: `${guilty ? '유죄' : '무죄'}\n\n${name}. 탐정 ${judge}${josa(row.judge_name, '이/가')} 당신의 진술을 읽었다.\n` +
          (guilty ? '형은 사흘 뒤 새벽에 집행됐다.\n' : '증거 불충분. 당신은 풀려났다.\n') +
          (reason ? `\n탐정의 소견: ${reason}\n` : '') + `\n${SITE}`,
  };
}

async function send(to, mail) {
  if (!to) return false;
  if (!transport) {
    console.log(`\n[mail:콘솔] → ${to}\n  ${mail.subject}\n${mail.text}\n`);
    return false;
  }
  try {
    await transport.sendMail({ from: FROM, to, ...mail });
    console.log(`[mail] 발송 → ${to} : ${mail.subject}`);
    return true;
  } catch (err) {
    console.error('[mail] 발송 실패', err.message);
    return false;
  }
}

module.exports = {
  sendVerdict: (row) => send(row.email, verdictMail(row)),
  enabled: () => !!transport,
};
