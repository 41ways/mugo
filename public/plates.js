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

    /* ── 경찰서 소장실 ─────────────────────────────────── */
    office: {
      svg: `<svg ${V} xmlns="http://www.w3.org/2000/svg">
        ${base('o')}
        <!-- 창 · 밖은 안개 -->
        <rect x="52" y="58" width="212" height="216" fill="#1f2429" stroke="${L1}" stroke-width="2"/>
        <path d="M158 58v216M52 166h212" stroke="${L1}" stroke-width="2"/>
        <path d="M64 214q52-26 96-6t92-12" stroke="#2e353a" stroke-width="9" fill="none" opacity=".8"/>
        <path d="M64 238q60-18 104 2t84-10" stroke="#272d32" stroke-width="7" fill="none" opacity=".7"/>
        <!-- 벽시계 -->
        <circle cx="862" cy="104" r="46" fill="#0c0c0e" stroke="${L2}" stroke-width="2.5"/>
        <circle cx="862" cy="104" r="3" fill="${L3}"/>
        <path d="M862 104V72M862 104l24 13" stroke="${L3}" stroke-width="2.5"/>
        <!-- 외투 걸이 -->
        <path d="M930 150v250M930 168l-26 16M930 168l26 16" stroke="${L2}" stroke-width="3" fill="none"/>
        <path d="M904 186c-16 22-12 76 2 104 10 20 30 22 42 4 14-22 16-84 2-108z" fill="${INK}" stroke="${L1}" stroke-width="2"/>
        <!-- 소파 -->
        <path d="M20 352h190v34H20z" fill="${INK}" stroke="${L2}" stroke-width="2"/>
        <path d="M20 386h190v78H20z" fill="#0a0a0c" stroke="${L2}" stroke-width="2"/>
        <path d="M14 372h44v96H14z" fill="#0e0e10" stroke="${L3}" stroke-width="2"/>
        <path d="M22 384q16 6 30 0" stroke="${L3}" stroke-width="2" fill="none" opacity=".8"/>
        <!-- 개어둔 담요 -->
        <path d="M96 340h84v16H96z" fill="#15151a" stroke="${L1}" stroke-width="1.5"/>
        <!-- 등불 번짐 -->
        <ellipse cx="640" cy="250" rx="300" ry="200" fill="url(#glowo)"/>
        <!-- 앉은 사람 -->
        <path d="M636 196a44 44 0 1 1 88 0 44 44 0 0 1-88 0z" fill="${INK}" stroke="${L2}" stroke-width="2"/>
        <path d="M604 330c0-58 32-92 76-92s76 34 76 92z" fill="${INK}" stroke="${L2}" stroke-width="2"/>
        <!-- 셔츠 칼라 -->
        <path d="M654 244l26 22 26-22" stroke="${L3}" stroke-width="2.5" fill="none"/>
        <path d="M660 250l20 18 20-18" stroke="#575047" stroke-width="1.5" fill="none"/>
        <!-- 책상 -->
        <path d="M300 356h700v22H300z" fill="#101013" stroke="${L2}" stroke-width="2"/>
        <path d="M320 378h660v130H320z" fill="#0a0a0c" stroke="${L1}" stroke-width="2"/>
        <path d="M356 378v130M944 378v130" stroke="${L1}" stroke-width="2"/>
        <!-- 책상 위 손 -->
        <path d="M492 356c8-16 30-22 48-14 12 6 18 8 26 6" stroke="${L3}" stroke-width="3" fill="none"/>
        <path d="M508 344c14-6 30-4 40 4" stroke="#5f594f" stroke-width="2" fill="none"/>
        <!-- 서류 뭉치 -->
        <path d="M690 348h130v10H690z" fill="#cbc0a6" opacity=".72"/>
        <path d="M700 338h126v10H700z" fill="#b7ac93" opacity=".6"/>
        <path d="M712 330h118v8H712z" fill="#a0967f" opacity=".5"/>
        <!-- 탁상등 -->
        <path d="M866 356v-52M840 304h52l-14-34h-24z" fill="#0d0d10" stroke="${LAMP}" stroke-width="2" opacity=".85"/>
        <!-- 책상 밑으로 나온 구두 -->
        <path d="M410 494c22-6 34-2 44 6 8 6 4 14-8 14h-40c-8 0-10-14 4-20z" fill="${INK}" stroke="${L3}" stroke-width="2"/>
        <path d="M418 500q16-4 28 2" stroke="#6e675c" stroke-width="1.5" fill="none"/>
      </svg>`,
      spots: [
        { x: 52, y: 68, id: 'ring',   tag: '왼손 약지',
          text: '반지가 없다. 그런데 그 자리만 살이 희고, 가장자리에 아직 눌린 홈이 남아 있다.',
          more: '반지를 뺀 지 오래되지 않았다. 오래됐다면 살이 벌써 색을 되찾았을 것이다.' },
        { x: 68, y: 47, id: 'collar', tag: '셔츠 칼라',
          text: '접힌 자국이 두 겹으로 어긋나 있다. 목 뒤쪽 깃에는 기름때가 앉았다.',
          more: '벗지 않고 이틀 이상 입은 셔츠. 아침마다 갈아입을 수 있는 사람의 것이 아니다.' },
        { x: 7, y: 74, id: 'sofa',  tag: '소파 팔걸이',
          text: '가죽이 사람 머리만큼 눌려 반질거린다. 담요는 개어져 있지만 끝단이 아직 축축하다.',
          more: '개어둔 건 손님이 온다는 걸 알아서다. 축축한 건 오늘 아침까지 덮고 있었다는 뜻이고.' },
        { x: 42, y: 90, id: 'shoes',  tag: '구두',
          text: '새것이다. 밑창의 상표가 아직 닳지도 않았다. 반면 외투는 소맷단이 다 해졌다.',
          more: '외투를 못 바꾸는 사람이 구두를 바꿨다. 돈이 생겼는데, 티가 덜 나는 데부터 썼다.' },
        { x: 75, y: 66, id: 'papers', tag: '맨 위 봉투',
          text: '해운조합 문장이 찍혀 있다. 봉인이 뜯긴 자리에 손가락 기름이 두 겹으로 앉았다.',
          more: '한 번 열고, 덮었다가, 다시 열었다. 읽은 게 아니라 몇 번씩 확인한 것이다.' },
        { x: 86, y: 20, id: 'clock',  tag: '벽시계',
          text: '11분 느리다. 태엽 구멍에는 먼지가 앉았다.',
          more: '이 방을 챙기는 사람이 없다. 이 방에서 자는 사람 말고는.' },
      ],
    },

    /* ── 유치장 ───────────────────────────────────────── */
    cell: {
      svg: `<svg ${V} xmlns="http://www.w3.org/2000/svg">
        ${base('c')}
        <ellipse cx="500" cy="150" rx="330" ry="230" fill="url(#glowc)"/>
        <!-- 매달린 등 -->
        <path d="M500 0v52" stroke="${L2}" stroke-width="2"/>
        <path d="M462 52h76l-18 34h-40z" fill="#0d0d10" stroke="${LAMP}" stroke-width="2"/>
        <circle cx="500" cy="92" r="7" fill="${LAMP}" opacity=".85"/>
        <!-- 뒷벽 -->
        <path d="M120 120h760v400H120z" fill="#0b0b0d"/>
        <path d="M120 300h760M120 400h760" stroke="#131318" stroke-width="2"/>
        <!-- 앉은 남자 -->
        <path d="M452 214a48 48 0 1 1 96 0 48 48 0 0 1-96 0z" fill="#16161b" stroke="${L3}" stroke-width="2"/>
        <path d="M462 190a48 48 0 0 1 34-28" stroke="#7d6636" stroke-width="3" fill="none" opacity=".75"/>
        <!-- 눈 -->
        <path d="M470 208h20M510 208h20" stroke="${L3}" stroke-width="3"/>
        <path d="M420 372c0-64 36-100 80-100s80 36 80 100z" fill="#131318" stroke="${L3}" stroke-width="2"/>
        <path d="M436 344c6-40 28-64 56-70" stroke="#6d5930" stroke-width="3" fill="none" opacity=".6"/>
        <!-- 무릎 -->
        <path d="M420 372h48v92h-48zM532 372h48v92h-48z" fill="#101015" stroke="${L2}" stroke-width="2"/>
        <path d="M424 400q22 10 40 0M536 400q22 10 40 0" stroke="#4a453d" stroke-width="2" fill="none"/>
        <!-- 손 · 소맷단 -->
        <path d="M472 346q28 16 56 0" stroke="${L3}" stroke-width="3" fill="none"/>
        <path d="M462 336q14 8 22 6M516 342q14 2 22-6" stroke="#615a50" stroke-width="2" fill="none"/>
        <!-- 신발 -->
        <path d="M416 464h56v20h-56zM528 464h56v20h-56z" fill="#0c0c0f" stroke="${L3}" stroke-width="2"/>
        <!-- 창살 -->
        <g stroke="#2a2a2e" stroke-width="11">
          <path d="M60 0v520M180 0v520M300 0v520M420 0v520M540 0v520M660 0v520M780 0v520M900 0v520"/>
        </g>
        <g stroke="#3a3a40" stroke-width="3" opacity=".55">
          <path d="M66 0v520M186 0v520M306 0v520M426 0v520M546 0v520M666 0v520M786 0v520M906 0v520"/>
        </g>
        <path d="M0 96h1000M0 452h1000" stroke="#2a2a2e" stroke-width="9"/>
      </svg>`,
      spots: [
        { x: 45.5, y: 68, id: 'knuckles', tag: '손등',
          text: '까져 있다. 딱지가 아직 얇은 걸 보면 하루 이틀 안이다.',
          more: '벽을 긁었을 수도, 누굴 때렸을 수도, 누가 물었을 수도 있다. 상처는 순서를 말해주지 않는다.' },
        { x: 56, y: 65, id: 'cuff', tag: '소맷단',
          text: '젖었다 마른 자국. 가장자리에 소금이 하얗게 앉았다. 바닷물이다.',
          more: '부두에서 잡혔으니 당연하다. 아니면, 부두로 간 이유가 따로 있거나.' },
        { x: 50, y: 40, id: 'eyes', tag: '눈',
          text: '깜빡임이 고르다. 열두 번을 세는 동안 한 박자도 어긋나지 않았다.',
          more: '겁먹지 않은 사람의 눈. 혹은 이미 여러 번 겁먹어봐서 익숙해진 사람의 눈.' },
        { x: 42, y: 88, id: 'sole', tag: '신발 밑창',
          text: '검댕이 끼어 있다. 저택 석탄고 바닥의 것과 같은 굵기다.',
          more: '이 마을 부엌 절반의 바닥도 같은 것을 깔고 있다.' },
        { x: 43, y: 78, id: 'knee', tag: '바지 무릎',
          text: '무릎만 젖어 있다. 왼쪽이 오른쪽보다 짙다.',
          more: '누군가 옆에 한쪽 무릎을 꿇고 앉았던 자세. 살리려던 사람도, 눌러 앉히던 사람도 그렇게 앉는다.' },
      ],
    },

    /* ── 저택 바깥 ─────────────────────────────────────── */
    manor: {
      svg: `<svg ${V} xmlns="http://www.w3.org/2000/svg">
        ${base('m')}
        <!-- 건물 덩어리 -->
        <path d="M120 92h700v428H120z" fill="#0a0a0c" stroke="${L2}" stroke-width="2.5"/>
        <path d="M120 92l350-64 350 64" fill="#08080a" stroke="${L2}" stroke-width="2.5"/>
        <!-- 3층 창 하나만 켜져 있다 -->
        <rect x="600" y="126" width="86" height="72" fill="#3a2c16" stroke="${L2}" stroke-width="2"/>
        <path d="M643 126v72M600 162h86" stroke="#1c1710" stroke-width="2"/>
        <ellipse cx="643" cy="162" rx="150" ry="110" fill="url(#glowm)"/>
        <g fill="#101015" stroke="${L1}" stroke-width="2">
          <rect x="200" y="126" width="86" height="72"/><rect x="400" y="126" width="86" height="72"/>
          <rect x="200" y="248" width="86" height="72"/><rect x="400" y="248" width="86" height="72"/>
          <rect x="600" y="248" width="86" height="72"/>
        </g>
        <!-- 담쟁이 -->
        <path d="M540 520c14-70-8-120 4-186 8-44 34-58 42-92" stroke="#232a20" stroke-width="12" fill="none"/>
        <path d="M556 400q26-14 34-40M548 340q-24-10-30-36M566 300q28-8 34-32" stroke="#2c3626" stroke-width="7" fill="none"/>
        <path d="M566 250l-4 -26" stroke="#39472f" stroke-width="5" fill="none"/>
        <!-- 현관 계단 · 문 -->
        <rect x="290" y="356" width="120" height="164" fill="#060608" stroke="${L2}" stroke-width="2"/>
        <circle cx="392" cy="440" r="5" fill="${L3}"/>
        <path d="M262 520h176v-16H262zM274 504h152v-16H274zM286 488h128v-16H286z" fill="#0e0e11" stroke="${L1}" stroke-width="1.5"/>
        <!-- 발자국 -->
        <g fill="#1d2226" opacity=".9">
          <ellipse cx="316" cy="512" rx="11" ry="6"/><ellipse cx="342" cy="498" rx="11" ry="6"/>
          <ellipse cx="324" cy="484" rx="10" ry="5"/><ellipse cx="350" cy="472" rx="10" ry="5"/>
        </g>
        <!-- 석탄 투입구 -->
        <path d="M148 452h96v34h-96z" fill="#0b0b0d" stroke="${L3}" stroke-width="2.5"/>
        <path d="M148 452l96-16v34z" fill="#0f0f12" stroke="${L3}" stroke-width="2"/>
        <path d="M158 492q34 10 74 2" stroke="#191919" stroke-width="9" fill="none" opacity=".9"/>
        <!-- 부엌 쪽문 -->
        <path d="M756 366h84v154h-84z" fill="#0c0c0f" stroke="${L3}" stroke-width="2.5"/>
        <path d="M756 366v154" stroke="${L3}" stroke-width="3"/>
        <circle cx="760" cy="404" r="3.5" fill="#8d8574"/><circle cx="760" cy="482" r="3.5" fill="#8d8574"/>
        <circle cx="760" cy="443" r="3.5" fill="#3f3c36"/>
        <!-- 개집 -->
        <path d="M886 424h96v96h-96z" fill="#0c0c0f" stroke="${L3}" stroke-width="2.5"/>
        <path d="M886 424l48-38 48 38" fill="#0b0b0e" stroke="${L2}" stroke-width="2"/>
        <ellipse cx="934" cy="486" rx="26" ry="34" fill="#020203"/>
        <path d="M886 470l-56 12" stroke="${L3}" stroke-width="2.5"/>
        <!-- 안개 -->
        <path d="M0 492q180-22 340 4t340-10 320 12v22H0z" fill="#0e1114" opacity=".55"/>
      </svg>`,
      // 저녁 답사. 여기서 본 것만 수첩에 적힌다. 그리고 적힌 것만 나중에 문제가 된다.
      spots: [
        { x: 79, y: 78, id: 'hinge', cat: 'entry', tag: '부엌 쪽문',
          text: '자물쇠는 멀쩡한데 경첩 나사 두 개가 유난히 반짝인다. 새것이다.',
          more: '새 나사는 낡은 나무를 물지 못한다. 어깨로 한 번 밀면 경첩째 열릴 것이다.',
          page: '부엌 쪽문 — 경첩 나사가 새것이라 헐겁다. 어깨로 밀면 열림', risk: 2 },
        { x: 19, y: 87, id: 'chute', cat: 'entry', tag: '석탄 투입구',
          text: '뚜껑에 자물통을 걸던 고리가 있다. 고리는 있는데 자물통이 없다.',
          more: '겨울이 아니라 아무도 신경 쓰지 않는 것이다. 어깨가 들어갈 만한 폭이다.',
          page: '석탄 투입구 — 자물통 없음. 어깨가 들어감', risk: 2 },
        { x: 56, y: 46, id: 'ivy', cat: 'entry', tag: '담쟁이',
          text: '2층 창턱까지 닿아 있다. 밑동은 손목만큼 굵고, 위로 갈수록 가늘다.',
          more: '오래된 줄기는 겉만 단단하다. 사람 하나를 두 층까지 버티지는 못한다.',
          page: '담쟁이가 2층 창까지 닿음 — 오래되어 잘 끊김', risk: 1 },
        { x: 91, y: 87, id: 'dog', cat: 'habit', tag: '개',
          text: '사슬에 매인 개가 당신을 본다. 당신은 마당을 가로질러 다섯 걸음 앞까지 갔다.',
          more: '개는 짖지 않았다. 한 번도. 짖지 않는 개가 있는 집은, 지키는 사람이 없는 집이다.',
          page: '개는 낯선 사람에게도 짖지 않음', risk: 1 },
        { x: 64, y: 31, id: 'lamp3', cat: 'habit', tag: '3층 창',
          text: '해가 지고 나서 하나만 켜졌다. 당신은 담 밖에서 그 창을 오래 봤다.',
          more: '열한 시 십 분에 꺼졌다. 그 전에 그림자가 두 번 창을 가로질렀다. 혼자다.',
          page: '3층 침실 등 — 열한 시 십 분에 꺼짐. 혼자 지냄', risk: 3 },
        { x: 35, y: 78, id: 'front', cat: 'entry', tag: '현관',
          text: '참나무 두 짝. 안쪽에 빗장이 둘 걸리는 소리가 났다.',
          more: '이 문은 사람 힘으로 안 열린다. 이 집에서 유일하게 제대로 된 것이다.',
          page: '현관 — 참나무에 빗장 둘. 부술 수 없음', risk: 0 },
        { x: 82, y: 50, id: 'servant', cat: 'habit', tag: '뒤채 창',
          text: '하인 방 쪽 창이 셋 다 어둡고, 빨랫줄에는 아무것도 없다.',
          more: '마을에서 하녀들은 목요일 밤에 쉰다고 했다. 오늘이 목요일이다.',
          page: '하인은 목요일 밤에 집을 비움 — 오늘이 목요일', risk: 3 },
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
