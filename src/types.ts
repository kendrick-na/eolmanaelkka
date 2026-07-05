// 얼마낼까 — 경조사 도메인 타입

/** 경조사 유형 */
export type EventType =
  | 'wedding'      // 결혼식 (축의금)
  | 'funeral'      // 장례식 (조의금)
  | 'first_birthday' // 돌잔치
  | 'sixtieth'     // 회갑·칠순 등
  | 'opening';     // 개업·집들이

/** 관계 카테고리 — 적정액 산정의 핵심 축 */
export type Relation =
  | 'close_friend'   // 친한 친구
  | 'friend'         // 친구·지인
  | 'acquaintance'   // 그냥 아는 사이
  | 'colleague'      // 직장 동료
  | 'senior'         // 직장 상사
  | 'junior'         // 직장 후배
  | 'relative'       // 친척
  | 'family'         // 가족
  | 'friend_parent'; // 친구의 부모(장례에서 흔함)

/** 종교 (봉투 문구 분기) */
export type Religion = 'none' | 'christian' | 'catholic' | 'buddhist';

/** 지역 등급 (식대 추정 버킷) */
export type RegionTier = 'gangnam' | 'seoul' | 'metro' | 'local';

/** 참석 여부 */
export type Attendance = 'attend' | 'absent';

/** 축의금/조의금 산정 결과 */
export interface GiftEstimate {
  recommended: number;    // 권장 금액(원)
  min: number;            // 하한
  max: number;            // 상한
  reasons: string[];      // "왜 이 금액인가" 근거 배열
  reciprocityNote?: string; // 관계원장 기반 호혜 메모 (있으면)
}

/** 그날의 맥락 (음력·손없는날·혼잡도) */
export interface DayContext {
  solarDate: string;      // YYYY-MM-DD
  lunar?: string;         // 음력 (예: "음력 9월 19일")
  isSonEomneun: boolean;  // 손없는날 여부 (음력 끝자리 9·0)
  crowdLevel: '상' | '중' | '하'; // 예식 혼잡도 추정
  note: string;           // 맥락 문구 (미신 아닌 혼잡도로)
  approx: boolean;        // 음력이 API 아닌 근사 계산인지 (정직 표기)
}

/** 봉투/멘트 결과 */
export interface EnvelopeResult {
  front: string;          // 봉투 앞면 (예: 賻儀, 祝 結婚)
  frontKo: string;        // 한글 병기
  nameRule: string;       // 이름 표기법
  messages: {             // 축하/조문 멘트 3안
    formal: string;       // 격식
    normal: string;       // 보통
    warm: string;         // 친근
  };
  etiquette?: string;     // 예법 팁 (절·복장 등)
}

/** 관계원장 1건 — record_gift 저장 단위 */
export interface LedgerEntry {
  person: string;         // 상대 (이름/별칭)
  eventType: EventType;
  amount: number;         // 금액(원)
  direction: 'given' | 'received'; // 냄 / 받음
  date: string;           // YYYY-MM-DD
  memo?: string;
}
