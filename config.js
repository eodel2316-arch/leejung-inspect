// 점검앱 설정
// API_URL: 구글 앱스 스크립트를 배포하면 나오는 웹앱 주소(…/exec)를 넣는다.
//          비워 두면 "시험 모드"로 돌아가고, 기록은 이 휴대폰(브라우저)에만 저장된다.
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwUUWDEo6dqvZld3EL-8SzrP_J_08FdfCZa9Fu4ev_RKz60IegoocKHOpqQ6xKFbest/exec',
  APP_NAME: '이정그룹 매장 점검',
  HQ_NAME: '운영지원팀',
  // 매장 목록. 순서대로 화면에 나온다. id 는 바꾸지 말 것(기록이 이 값으로 묶인다).
  STORES: [
    { id: 'haebong-samsung',   name: '해봉 삼성점',        brand: '해봉' },
    { id: 'haebong-yeouido',   name: '해봉 여의도점',      brand: '해봉' },
    { id: 'haebong-mugyo',     name: '해봉 무교점',        brand: '해봉' },
    { id: 'haebong-sicheong',  name: '해봉 시청점',        brand: '해봉' },
    { id: 'haebong-mokdong',   name: '해봉 목동점',        brand: '해봉' },
    { id: 'dduksim-centerone', name: '뚝심한우 센터원점',  brand: '뚝심한우' },
    { id: 'dduksim-seolleung', name: '뚝심한우 선릉역점',  brand: '뚝심한우' },
    { id: 'sukseong-mapo',     name: '숙성육관 마포점',    brand: '숙성육관' },
    { id: 'utap-gangnam',      name: '우탭 강남점',        brand: '우탭' },
    { id: 'daesong-yeouido',   name: '대송참숯 여의도점',  brand: '대송참숯' },
    { id: 'daesong-gwanghwamun', name: '대송참숯 광화문점', brand: '대송참숯' },
    { id: 'un-garden',         name: '유엔가든',           brand: '유엔가든' },
    { id: 'noransang-yeoksam', name: '노란상소갈비 역삼점', brand: '노란상소갈비' }
  ],
  // 시험 모드 비밀번호(실제 비밀번호는 구글 시트 '매장' 탭에서 정한다)
  DEMO_STORE_PW: '0000',
  DEMO_HQ_PW: '1234'
};
