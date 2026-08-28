'use strict';

// 판결 통지서를 보낸다.
//
// 길은 넷. 위에서부터 있는 것을 쓴다.
//
//   1) BREVO_API_KEY  — Brevo 에 HTTPS(443) 로 던진다. 포트를 안 탄다.
//   2) RESEND_API_KEY — Resend 에 HTTPS(443) 로 던진다. 포트를 안 탄다.
//   3) SMTP_URL       — nodemailer 로 직접 SMTP 를 문다. 로컬 개발용.
//   4) 아무것도 없음   — 콘솔에만 찍는다.
//
// Render 무료 플랜은 2025-09-26 부터 아웃바운드 25·465·587 을 전부 막았다.
// 거기서 SMTP 는 무조건 Connection timeout 이 난다. 코드도 앱 비밀번호도
// 잘못된 게 아니다. 포트를 안 타는 HTTPS API 라야 나간다 — 그게 1)·2) 가 있는 이유다.
//
// 1) 과 2) 중에 1) 이 먼저인 이유. Resend 는 도메인을 인증해야 남에게 보낼 수 있다.
// 인증 전에는 onboarding@resend.dev 로 「내 계정 주소에만」 갈 수 있어서, 모르는
// 사람에게 판결을 보내야 하는 이 게임에는 못 쓴다. Brevo 는 발신자 주소 한 개만
// 인증하면(gmail 주소도 된다) 아무에게나 보낼 수 있다. 도메인이 없으면 Brevo 다.

const nodemailer = require('nodemailer');

const FROM = process.env.MAIL_FROM || '회항 경찰서 <no-reply@localhost>';
const SITE = (process.env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, '');

const BREVO_KEY = process.env.BREVO_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';

// Brevo 는 이름과 주소를 따로 받는다. "회항 경찰서 <a@b.c>" 를 갈라둔다.
function splitFrom(s) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(s);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: String(s).trim() };
}

let transport = null;
if (BREVO_KEY) {
  console.log('[mail] Brevo (HTTPS)');
} else if (RESEND_KEY) {
  console.log('[mail] Resend (HTTPS)');
} else if (process.env.SMTP_URL) {
  transport = nodemailer.createTransport(process.env.SMTP_URL);
  console.log('[mail] SMTP');
} else {
  console.warn('[mail] 발송 경로 없음 — 메일은 콘솔에만 찍힌다.');
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
      회항에서는 한 조서를 두 사람이 읽는다. 당신의 주소는 그 두 통을 보내기 위해서만
      보관되고, 마지막 한 통이 나가는 즉시 지워진다.
    </div>
  </div>
</div>`;
}

const P = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.85;">${t}</p>`;

const listOf = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : (v || []));

function verdictMail(row, o = {}) {
  const all = listOf(row.verdicts);
  const nth = o.nth || all.length || 1;
  // 이번에 알릴 판결. 칸에 남은 것은 늘 첫 판결이라, 둘째 통지는 목록에서 꺼낸다.
  const mine = all[nth - 1] || { verdict: row.verdict, reason: row.reason, judge_name: row.judge_name };
  const first = all[0] || mine;
  const second = nth >= 2;
  const flipped = second && first.verdict !== mine.verdict;

  const guilty = mine.verdict === 'guilty';
  // 장부에 적은 이름. 제목과 본문 텍스트는 날것으로, HTML 본문만 이스케이프한다.
  const rawName = String(row.name || '이름 없는 자');
  const rawJudge = String(mine.judge_name || '이름을 밝히지 않은 탐정');
  const name = esc(rawName);
  const judge = esc(rawJudge);
  const reason = String(mine.reason || '').trim();

  const eyebrow = second
    ? `<div style="font-size:11px;letter-spacing:.28em;color:#8a7c66;margin:0 0 8px;">두 번째 판결</div>`
    : '';
  const head = eyebrow + (guilty
    ? `<div style="font-size:27px;font-weight:700;letter-spacing:-.02em;color:#7d1c14;">유죄</div>`
    : `<div style="font-size:27px;font-weight:700;letter-spacing:-.02em;color:#3d4a3a;">무죄</div>`);

  // 두 번째 통지. 회항은 한 조서를 두 사람에게 읽힌다. 두 사람이 반대로 읽어도
  // 아무도 그걸 조정하지 않는다 — 그게 이 마을의 재판이다.
  const openLine = second
    ? P(`${name}. 당신의 조서는 한 번 더 읽혔다. 이번에는 다른 사람이었다.` +
        (flipped ? ' 그리고 앞사람과 정반대로 읽었다.' : ' 그리고 앞사람과 같은 결론에 닿았다.'))
    : null;

  const body = guilty ? [
    openLine || P(`${name}. 재판은 열렸으나 오래 걸리지 않았다.`),
    P(`탐정 <b>${judge}</b>${josa(rawJudge, '이/가')} 당신의 진술을 읽었고, 당신을 범인으로 지목했다. 회항에서 그 사람의 말은 판결과 같은 무게를 가진다. 배심원은 십일 분 만에 돌아왔다.`),
    P(`선고는 사형이었다. 회항에는 상소할 곳이 없다. 판결이 떨어지자 당신은 그 자리에서 끌려 나갔고, 형은 그날 부두 창고 앞 광장에서 곧바로 집행됐다. 안개가 짙어 구경꾼은 많지 않았다.`),
  ] : [
    openLine || P(`${name}. 재판은 열리지 않았다.`),
    P(`탐정 <b>${judge}</b>${josa(rawJudge, '이/가')} 당신의 진술을 읽었고, 증거가 사람을 목매달 만큼은 아니라고 했다. 서류에 도장이 찍혔고, 당신은 그날 밤 뒷문으로 나왔다.`),
    P(`아무도 사과하지 않았다. 안개 속으로 걸어 나가는 당신의 뒷모습을 간수 하나가 오래 지켜봤다고 한다.`),
  ];

  const quoted = reason ? `
    <div style="margin:22px 0 4px;font-size:11px;letter-spacing:.28em;color:#8a7c66;">탐정의 소견</div>
    <div style="border-left:2px solid #a08a5e;padding:8px 0 8px 14px;margin:8px 0 4px;font-size:14.5px;line-height:1.8;color:#4a4237;">${esc(reason)}</div>` : '';

  const clash = flipped ? P(
    `<span style="font-size:13px;color:#6d6355;">두 사람이 같은 조서를 읽고 정반대에 닿았다. ` +
    `회항에는 그 둘을 맞춰줄 사람이 없다. 두 판결은 그냥 나란히 남는다.</span>`) : '';

  const tail = P(`<span style="font-size:13px;color:#6d6355;">당신을 판결한 사람도 당신과 똑같은 밤을 보냈고, 지금 어딘가에서 자기 판결을 기다리고 있다.</span>`);

  return {
    // 제목에도 장부에 적은 이름을 넣는다. 받은 사람이 자기 앞으로 온 것인 줄 알아야 한다.
    subject: `[회항 지방법원] ${rawName} — ${second ? '두 번째 판결' : '판결'}: ${guilty ? '유죄' : '무죄'}`,
    html: shell(head + '<div style="height:18px"></div>' + body.join('') + quoted + clash + tail),
    text: `${second ? '두 번째 판결 — ' : ''}${guilty ? '유죄' : '무죄'}\n\n${rawName}. 탐정 ${rawJudge}${josa(rawJudge, '이/가')} 당신의 진술을 읽었다.\n` +
          (guilty ? '사형이 선고됐고, 그 자리에서 곧바로 집행됐다.\n' : '증거 불충분. 당신은 풀려났다.\n') +
          (reason ? `\n탐정의 소견: ${reason}\n` : '') + `\n${SITE}`,
  };
}

// Brevo. 포트를 타지 않으므로 SMTP 를 막는 곳에서도 나간다.
// 발신자 주소는 Brevo 대시보드에서 미리 인증해둬야 한다 — 안 그러면 여기서 거절당한다.
async function viaBrevo(to, mail) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: splitFrom(FROM),
      to: [{ email: to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  // 실패 사유를 그대로 물고 나온다. 키 오류·발신자 미인증이 여기서 걸린다.
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).messageId;
}

// Resend. 포트를 타지 않으므로 SMTP 를 막는 곳에서도 나간다.
async function viaResend(to, mail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  // 실패 사유를 그대로 물고 나온다. 키 오류·도메인 미인증이 여기서 걸린다.
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).id;
}

async function send(to, mail) {
  if (!to) return false;
  if (!BREVO_KEY && !RESEND_KEY && !transport) {
    console.log(`\n[mail:콘솔] → ${to}\n  ${mail.subject}\n${mail.text}\n`);
    return false;
  }
  try {
    if (BREVO_KEY) {
      const id = await viaBrevo(to, mail);
      console.log(`[mail] 발송 → ${to} : ${mail.subject} (${id})`);
    } else if (RESEND_KEY) {
      const id = await viaResend(to, mail);
      console.log(`[mail] 발송 → ${to} : ${mail.subject} (${id})`);
    } else {
      await transport.sendMail({ from: FROM, to, ...mail });
      console.log(`[mail] 발송 → ${to} : ${mail.subject}`);
    }
    return true;
  } catch (err) {
    // false 를 돌려주면 server.js 가 주소를 지우지 않는다. tools/resend.js 로 다시 보낼 수 있다.
    console.error('[mail] 발송 실패', err.message);
    return false;
  }
}

// 어느 길로 나가는지. 대시보드를 안 열고도 /healthz 로 확인할 수 있어야 한다 —
// 키가 빠졌는데 mail:true 만 보고 넘어가면 통지가 죽는 걸 알 방법이 없다.
const via = () => (BREVO_KEY ? 'brevo' : RESEND_KEY ? 'resend' : transport ? 'smtp' : 'none');

module.exports = {
  sendVerdict: (row, o) => send(row.email, verdictMail(row, o)),
  verdictMail,
  enabled: () => !!BREVO_KEY || !!RESEND_KEY || !!transport,
  via,
  // 통지에 실리는 주소. mug0 과 mugo 는 한 글자 차이로 죽은 링크가 된다.
  site: () => SITE,
  from: () => splitFrom(FROM).email,
};
