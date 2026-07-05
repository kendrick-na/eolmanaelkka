// 갈까 말까 판단기 — "이 경조사, 가야 하나?"
// 간판("얼마")의 앞단계("갈까"). 관계·최근왕래·거리·호혜(원장)를 종합해
// "참석 / 송금만 / 생략"을 근거와 함께 판정. 결과 카드는 자랑·공유 최적("AI도 가지 말래ㅋㅋ").
//
// ⚠️ 강요·단정 아님. "이렇게 정하는 사람이 많아요" 참고 톤. 최종은 본인 마음.

import type { EventType, Relation } from './types.js';
import { won } from './giftLogic.js';

export type Verdict = 'attend' | 'send_only' | 'skip';

export interface DecideInput {
  eventType: EventType;
  relation: Relation;
  closeness?: 'high' | 'mid' | 'low'; // 요즘 친밀도(최근 왕래)
  distanceHard?: boolean;             // 이동이 부담(먼 지역·주말겹침 등)
  reciprocity?: number;               // 관계원장: 이 사람이 나에게 냈던 금액
}

export interface DecideResult {
  verdict: Verdict;
  verdictKo: string;
  reasons: string[];
  giftIfAttend?: number;   // 참석 시 참고액
  giftIfSend?: number;     // 송금만 할 때 참고액
  shareLine: string;       // 공유용 한 줄(익명)
}

const REL_BASE_SCORE: Record<Relation, number> = {
  family: 100, relative: 80, close_friend: 85, friend: 55,
  colleague: 45, senior: 50, junior: 45, friend_parent: 60, acquaintance: 25,
};

/** 갈까 말까 판정 — 점수제(높을수록 참석). */
export function decideAttendance(input: DecideInput): DecideResult {
  const { eventType, relation, closeness = 'mid', distanceHard = false, reciprocity } = input;
  const reasons: string[] = [];

  let score = REL_BASE_SCORE[relation];

  // 친밀도(최근 왕래) 가중
  if (closeness === 'high') { score += 20; reasons.push('요즘도 왕래가 있는 사이'); }
  else if (closeness === 'low') { score -= 25; reasons.push('요즘은 거의 연락이 없는 사이'); }

  // 호혜 — 상대가 내 경조사 챙겼으면 강하게 참석 쪽
  if (reciprocity && reciprocity > 0) {
    score += 25;
    reasons.push(`예전에 이분이 내 경조사를 ${won(reciprocity)}으로 챙겨주셨어요(호혜)`);
  }

  // 이동 부담은 참석을 낮춤(송금 쪽)
  if (distanceHard) { score -= 15; reasons.push('이동이 부담되는 거리·일정'); }

  // 장례는 "가주는 것" 자체가 큰 위로 → 참석 문턱 낮춤
  if (eventType === 'funeral') { score += 15; reasons.push('장례는 빈소에 가주는 것 자체가 큰 위로예요'); }

  let verdict: Verdict;
  if (score >= 75) verdict = 'attend';
  else if (score >= 40) verdict = 'send_only';
  else verdict = 'skip';

  // ★ 호혜 하한: 예전에 나를 챙겨준 사람은 아무리 소원해도 "생략"은 결례 → 최소 송금.
  if (reciprocity && reciprocity > 0 && verdict === 'skip') {
    verdict = 'send_only';
    reasons.push('받은 게 있으니 생략보다는 마음이라도 전하는 게 도리예요');
  }

  const verdictKo =
    verdict === 'attend' ? '가는 걸 추천해요'
    : verdict === 'send_only' ? '안 가고 마음만 전해도 괜찮아요'
    : '이번엔 생략해도 크게 결례는 아니에요';

  // 공유 한 줄 (익명·자조 톤)
  const evKo = eventType === 'funeral' ? '조문' : eventType === 'wedding' ? '결혼식' : '경조사';
  const shareLine =
    verdict === 'attend' ? `이 ${evKo}, 얼마낼까가 "가라"네요 🙂`
    : verdict === 'send_only' ? `이 ${evKo}, 얼마낼까가 "안 가고 마음만"이래요 😌`
    : `이 ${evKo}, 얼마낼까가 "이번엔 패스"래요 😅`;

  return {
    verdict, verdictKo, reasons,
    shareLine,
  };
}
