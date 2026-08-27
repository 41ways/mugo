/* 관찰 장면의 그림판.
 *
 * 사진 대신 선과 실루엣만 쓴다. 회항은 안개가 잦아서 어차피 뚜렷하게 보이는 게 없다.
 * 좌표(x,y)는 판 크기에 대한 백분율이라 화면이 줄어도 단서가 제자리에 붙어 있는다.
 */
(function () {
  'use strict';

  const V = 'viewBox="0 0 1000 520" preserveAspectRatio="xMidYMid slice"';
  const INK = '#050506', L1 = '#4a4a51', L2 = '#726b5c', L3 = '#9b9384', LAMP = '#d8a24a';

  // 어디에나 깔리는 바닥 + 안개
  const base = (id) => `
    <defs>
      <linearGradient id="fog${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1b1d20"/><stop offset="1" stop-color="#08080a"/>
      </linearGradient>
      <radialGradient id="glow${id}">
        <stop offset="0" stop-color="${LAMP}" stop-opacity=".30"/>
        <stop offset="1" stop-color="${LAMP}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1000" height="520" fill="url(#fog${id})"/>`;

  const PLATES = {

    /* ── 경찰서 소장실 ───────────────────────────────────── */
    office: {
      img: 'img/office.jpg',
      spots: [
        { x: 80, y: 64, id: 'ring', tag: '책상 위 왼손',
          text: '반지가 없다. 그런데 그 자리만 살이 희고, 가장자리에 아직 눌린 홈이 남아 있다.',
          more: '반지를 뺀 지 오래되지 않았다. 오래됐다면 살이 벌써 색을 되찾았을 것이다.' },
        { x: 77.5, y: 39, id: 'collar', tag: '셔츠 칼라',
          text: '단추를 두 개나 풀어놨는데도 깃이 목에 붙어 있다. 접힌 자국이 두 겹으로 어긋났다.',
          more: '벗지 않고 이틀 이상 입은 셔츠. 아침마다 갈아입을 수 있는 사람의 것이 아니다.' },
        { x: 31, y: 62, id: 'sofa', tag: '소파와 담요',
          text: '가죽이 사람 머리만큼 눌려 반질거린다. 담요는 개어져 있지만 끝단이 아직 축축하다.',
          more: '개어둔 건 손님이 온다는 걸 알아서다. 축축한 건 오늘 아침까지 덮고 있었다는 뜻이고.' },
        { x: 43, y: 87, id: 'shoes', tag: '책상 밑 구두',
          text: '새것이다. 밑창의 상표가 아직 닳지도 않았다. 그런데 걸려 있는 외투는 소맷단이 다 해졌다.',
          more: '외투를 못 바꾸는 사람이 구두를 바꿨다. 돈이 생겼는데, 티가 덜 나는 데부터 썼다.' },
        { x: 57, y: 63, id: 'papers', tag: '맨 위 봉투',
          text: '해운조합 문장이 찍혀 있다. 봉인이 뜯긴 자리에 손가락 기름이 두 겹으로 앉았다.',
          more: '한 번 열고, 덮었다가, 다시 열었다. 읽은 게 아니라 몇 번씩 확인한 것이다.' },
        { x: 61.5, y: 16, id: 'clock', tag: '벽시계',
          text: '11분 느리다. 유리에 먼지가 고르게 앉았고, 태엽 구멍만 반질거린다.',
          more: '이 방을 챙기는 사람이 없다. 이 방에서 자는 사람 말고는.' },
      ],
    },

    /* ── 유치장 ─────────────────────────────────────────── */
    // 사진: 미국 역사건축물 조사(HABS)가 찍은 일리노이 녹스 카운티 옛 유치장.
    // 퍼블릭 도메인. 어둡게 깔고 등불색을 얹었다.
    cell: {
      img: 'img/cell.jpg',
      spots: [
        { x: 36.5, y: 48, id: 'eyes', tag: '창구멍',
          text: '문에 뚫린 손바닥만 한 창구멍으로 눈만 보인다. 열둘을 세는 동안 깜빡임이 두 번. 고르다.',
          more: '겁먹지 않은 사람의 눈이거나, 이미 여러 번 겁먹어봐서 익숙해진 사람의 눈이거나.' },
        { x: 34, y: 16, id: 'mortar', tag: '문틀 회반죽',
          text: '문틀 둘레의 회반죽이 위쪽만 새것이다. 손가락으로 눌러 편 자국이 그대로 남아 있다.',
          more: '이 문을 최근에 뜯었다가 다시 달았다는 뜻이다. 사흘 전인지 삼 년 전인지는 회반죽이 말해주지 않는다.' },
        { x: 66.5, y: 49, id: 'wire', tag: '천장 전선',
          text: '천장을 따라 전선이 하나 내려온다. 그런데 끝에 등이 달려 있지 않다.',
          more: '이 방에는 불을 켜지 않는다. 사흘 동안 이 사람은 어둠 속에 있었다는 뜻이다.' },
        { x: 77, y: 59, id: 'damp', tag: '오른쪽 벽',
          text: '벽을 타고 물이 흘러내린 자국이 검게 남았다. 손을 대보면 아직 차다.',
          more: '얼음 보관실이었던 자리다. 사람을 두려고 지은 방이 아니다.' },
        { x: 43, y: 64, id: 'slat', tag: '휘어진 쇠띠',
          text: '가로로 지른 쇠띠 하나가 가운데서 휘어 처졌다. 휜 방향은 안쪽에서 바깥이다.',
          more: '누군가 밀어봤다. 이 사람인지, 이 방을 거쳐 간 다른 누구인지는 알 수 없다.' },
        { x: 52.5, y: 81, id: 'hasp', tag: '빗장',
          text: '빗장은 삭았는데 자물통만 새것이다. 기름칠한 자국이 아직 마르지 않았다.',
          more: '이 방을 오래 안 썼다는 뜻이다. 회항에서 사람을 가둘 일이 없었다는 뜻이기도 하다.' },
      ],
    },

    /* ── 저택 바깥 ───────────────────────────────────────── */
    manor: {
      img: 'img/manor.jpg',
      // 저녁 답사. 여기서 본 것만 사건일지에 적힌다. 그리고 적힌 것만 나중에 문제가 된다.
      spots: [
        { x: 41, y: 71, id: 'hinge', cat: 'entry', note: '부엌 쪽문 — 경첩 나사가 새것이라 헐겁다. 어깨로 밀면 열림', risk: 2,
          tag: '부엌 쪽문',
          text: '판자문 하나가 담벼락에 붙어 있다. 자물쇠는 멀쩡한데 경첩 나사 두 개가 유난히 반짝인다. 새것이다.',
          more: '새 나사는 낡은 나무를 물지 못한다. 어깨로 한 번 밀면 경첩째 열릴 것이다.' },
        { x: 54, y: 79, id: 'chute', cat: 'entry', note: '석탄 투입구 — 자물통 없음. 어깨가 들어감', risk: 2,
          tag: '석탄 투입구',
          text: '기초 벽에 쇠뚜껑이 하나 박혀 있다. 자물통을 걸던 고리는 있는데 자물통이 없다.',
          more: '겨울이 아니라 아무도 신경 쓰지 않는 것이다. 어깨가 들어갈 만한 폭이다.' },
        { x: 32, y: 39, id: 'ivy', cat: 'entry', note: '담쟁이가 2층 창까지 닿음 — 오래되어 잘 끊김', risk: 1,
          tag: '담쟁이',
          text: '벽을 타고 올라간 줄기가 2층 창턱까지 닿아 있다. 밑동은 손목만큼 굵고 위로 갈수록 가늘다.',
          more: '오래된 줄기는 겉만 단단하다. 사람 하나를 두 층까지 버티지는 못한다.' },
        { x: 23.5, y: 82, id: 'dog', cat: 'habit', note: '개는 낯선 사람에게도 짖지 않음', risk: 1,
          tag: '개',
          text: '개집 앞에 사슬로 매인 개가 엎드려 당신을 본다. 당신은 마당을 가로질러 다섯 걸음 앞까지 갔다.',
          more: '짖지 않았다. 한 번도. 짖지 않는 개가 있는 집은, 지키는 사람이 없는 집이다.' },
        { x: 40.7, y: 19, id: 'lamp3', cat: 'habit', note: '3층 침실 등 — 열한 시 십 분에 꺼짐. 혼자 지냄', risk: 3,
          tag: '3층 창',
          text: '해가 지고 나서 이 집에서 켜진 창은 저것 하나뿐이다. 당신은 담 밖에서 그 창을 오래 봤다.',
          more: '열한 시 십 분에 꺼졌다. 그 전에 그림자가 두 번 창을 가로질렀다. 혼자다.' },
        { x: 63, y: 58, id: 'front', cat: 'entry', note: '현관 — 참나무에 빗장 둘. 부술 수 없음', risk: 0,
          tag: '현관',
          text: '돌계단 위에 참나무 문. 두드리자 안쪽에서 빗장이 둘 걸리는 소리가 났다.',
          more: '이 문은 사람 힘으로 안 열린다. 이 집에서 유일하게 제대로 된 것이다.' },
        { x: 84, y: 65, id: 'servant', cat: 'habit', note: '하인은 목요일 밤에 집을 비움 — 오늘이 목요일', risk: 3,
          tag: '뒤채와 빨랫줄',
          text: '뒤채 창이 셋 다 어둡고, 그 앞 빨랫줄에는 아무것도 걸려 있지 않다.',
          more: '마을에서 하녀들은 목요일 밤에 쉰다고 했다. 오늘이 목요일이다.' },
      ],
    },

    /* ── 응접실 (시신) ─────────────────────────────────── */
    parlour: {
      svg: `<svg ${V} xmlns="http://www.w3.org/2000/svg">
        ${base('p')}
        <ellipse cx="720" cy="120" rx="290" ry="200" fill="url(#glowp)"/>
        <!-- 벽 · 안쪽에서 열린 창 -->
        <path d="M0 0h1000v340H0z" fill="#0c0c0f"/>
        <rect x="640" y="46" width="180" height="180" fill="#141a1e" stroke="${L2}" stroke-width="2"/>
        <path d="M730 46v180" stroke="${L2}" stroke-width="2"/>
        <path d="M730 46l104 30v180l-104-30z" fill="#0a0f13" stroke="${L3}" stroke-width="2"/>
        <!-- 찢긴 커튼 -->
        <path d="M596 30h56v300q-28-14-56 0z" fill="#12100e" stroke="${L1}" stroke-width="2"/>
        <path d="M840 30h58v190l-22 22 22 24v56q-30-16-58 0z" fill="#12100e" stroke="${L1}" stroke-width="2"/>
        <path d="M876 220l-36 26" stroke="${L3}" stroke-width="2"/>
        <!-- 넘어진 탁자 -->
        <path d="M96 300h150v14H96z" fill="#0e0e11" stroke="${L2}" stroke-width="2" transform="rotate(-16 170 306)"/>
        <path d="M120 316l-16 60M232 300l16 60" stroke="${L2}" stroke-width="4"/>
        <!-- 등유등, 꺼진 것 -->
        <path d="M282 268h48l-10 34h-28z" fill="#0d0d10" stroke="${L2}" stroke-width="2"/>
        <!-- 바닥 -->
        <path d="M0 340h1000v180H0z" fill="#08080a"/>
        <path d="M0 340h1000" stroke="${L1}" stroke-width="2"/>
        <!-- 양탄자 -->
        <path d="M180 370h660v140H180z" fill="#0c0a0a" stroke="#332724" stroke-width="2"/>
        <!-- 시신 -->
        <path d="M356 452c60-26 150-30 230-14 54 10 84 4 108-10" stroke="#212123" stroke-width="46" fill="none" stroke-linecap="round"/>
        <circle cx="342" cy="444" r="30" fill="#1c1c1e" stroke="${L2}" stroke-width="2"/>
        <!-- 목의 상처 -->
        <path d="M368 452q22 8 42 4" stroke="#7d1c14" stroke-width="7" fill="none" stroke-linecap="round"/>
        <!-- 번진 피 -->
        <path d="M330 480q-52 8-70 34 44 16 96 6 40-8 56-24-38-20-82-16z" fill="#2a0d0a"/>
        <path d="M320 492q-30 6-40 18 26 10 58 4" fill="#4a120c" opacity=".8"/>
        <!-- 뻗은 팔 · 손 -->
        <path d="M470 470q40 26 84 22" stroke="#1f1f21" stroke-width="22" fill="none" stroke-linecap="round"/>
        <path d="M556 490q16 2 26-4" stroke="#3a3733" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M566 486l6-8M574 490l8-6M580 496l8-4" stroke="#4d6f66" stroke-width="3"/>
        <!-- 안개처럼 깔린 어둠 -->
        <path d="M0 500h1000v20H0z" fill="#050506"/>
      </svg>`,
      spots: [],
    },

    /* ── 부두 ─────────────────────────────────────────── */
    dock: {
      svg: `<svg ${V} xmlns="http://www.w3.org/2000/svg">
        ${base('d')}
        <ellipse cx="120" cy="200" rx="200" ry="160" fill="url(#glowd)"/>
        <path d="M96 60v120" stroke="${L2}" stroke-width="3"/>
        <path d="M74 180h44l-8 26H82z" fill="#0d0d10" stroke="${LAMP}" stroke-width="2"/>
        <circle cx="96" cy="194" r="6" fill="${LAMP}" opacity=".9"/>
        <!-- 물 -->
        <path d="M0 330h1000v190H0z" fill="#070a0d"/>
        <g stroke="#131a20" stroke-width="3" fill="none" opacity=".9">
          <path d="M0 366q120-14 240 0t240 0 240 0 280 0"/>
          <path d="M0 408q140-16 280 0t280 0 260 0 180 0"/>
          <path d="M0 452q160-18 320 0t320 0 360 0"/>
          <path d="M0 496q180-16 360 0t340 0 300 0"/>
        </g>
        <!-- 널판 -->
        <path d="M0 300h1000v34H0z" fill="#0d0c0b" stroke="${L1}" stroke-width="2"/>
        <g stroke="#17150f" stroke-width="2">
          <path d="M120 300v34M240 300v34M360 300v34M480 300v34M600 300v34M720 300v34M840 300v34"/>
        </g>
        <!-- 말뚝 -->
        <g fill="#0a0908" stroke="${L2}" stroke-width="2">
          <rect x="188" y="252" width="30" height="52"/><rect x="486" y="246" width="30" height="58"/>
          <rect x="784" y="256" width="30" height="48"/>
        </g>
        <!-- 밧줄 -->
        <path d="M203 258q142 34 298 0M501 252q142 40 298 8" stroke="${L2}" stroke-width="3" fill="none"/>
        <!-- 안개 -->
        <path d="M0 286q200-24 400 4t600-8v40H0z" fill="#0f1215" opacity=".8"/>
      </svg>`,
      spots: [],
    },
  };

  window.PLATES = PLATES;
})();
