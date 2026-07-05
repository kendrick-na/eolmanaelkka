// 축의금/조의금 적정액 산정 로직
//
// 근거 데이터 (2025, 공개 통계 — "실시간 API"가 아니라 통계 인용, 정직표기):
//   · 카카오페이 모바일 축의금 평균: 2025년 첫 10만원 돌파
//     연령대별 20대 6만 / 30~40대 10만 / 50~60대 12만 (58%가 10만을 적정선으로 선택)
//   · 예식장 식대(1인): 2025 전국 평균 6만 돌파 / 강남 8.8~9만 / 코스 7~10만
// 원칙: "축의금 ≥ 식대"가 사회 통념. 관계·나이·참석여부·식장등급을 합성.
//       강요 아닌 "권장 + 범위". 식대는 "추정" 항상 표기.

import type { Relation, RegionTier, Attendance, EventType, GiftEstimate } from './types.js';

/** 지역 등급별 1인 식대 추정(원). 2025 통계 기준. */
const MEAL_COST: Record<RegionTier, { mid: number; label: string }> = {
  gangnam: { mid: 88000, label: '강남권' },
  seoul:   { mid: 70000, label: '서울' },
  metro:   { mid: 62000, label: '수도권·광역시' },
  local:   { mid: 55000, label: '지방' },
};

/** 연령대별 축의금 평균(원). 카카오페이 2025. */
const AGE_AVG: Record<string, number> = {
  '20': 60000,
  '30': 100000,
  '40': 100000,
  '50': 120000,
  '60': 120000,
};

/** 관계별 기본 배수(식대·평균 대비 가중). 1.0 = 평균 수준. */
const RELATION_WEIGHT: Record<Relation, { w: number; label: string }> = {
  close_friend:  { w: 1.5, label: '친한 친구' },
  friend:        { w: 1.0, label: '친구·지인' },
  acquaintance:  { w: 0.6, label: '아는 사이' },
  colleague:     { w: 1.0, label: '직장 동료' },
  senior:        { w: 1.1, label: '직장 상사' },
  junior:        { w: 1.0, label: '직장 후배' },
  relative:      { w: 1.5, label: '친척' },
  family:        { w: 2.5, label: '가족' },
  friend_parent: { w: 1.0, label: '친구의 부모' },
};

/** 관습 금액 스냅 — 한국 축의금은 5·7·10·15·20·30·50만 단위로 냄.
 *  계산값(8만·12만 같은 어정쩡한 값)을 실제로 내는 가장 가까운 금액으로 맞춘다. */
const CUSTOM_AMOUNTS = [30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000, 1000000];
function roundGift(n: number): number {
  // 가장 가까운 관습 금액으로 스냅
  return CUSTOM_AMOUNTS.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best, CUSTOM_AMOUNTS[0]);
}

function ageBucket(age?: number): string {
  if (!age) return '30';
  if (age < 30) return '20';
  if (age < 40) return '30';
  if (age < 50) return '40';
  if (age < 60) return '50';
  return '60';
}

export interface GiftInput {
  eventType: EventType;
  relation: Relation;
  closeness?: 'high' | 'mid' | 'low'; // 친밀도(요즘 왕래) — 같은 관계라도 이걸로 금액 차등
  regionTier?: RegionTier;
  age?: number;             // 내 나이 (없으면 30대 가정)
  attendance?: Attendance;  // 참석/불참 (불참이면 식대 논리 약화)
  companions?: number;      // 동반 인원 (배우자·자녀 동반 시 식대 가산)
  reciprocity?: number;     // 관계원장: 이 사람이 나에게 냈던 금액 (호혜 기준)
}

/** 친밀도 배수 — 같은 관계라도 친하면↑ 소원하면↓ */
const CLOSENESS_MULT: Record<'high' | 'mid' | 'low', { m: number; label: string }> = {
  high: { m: 1.2, label: '요즘도 자주 보는 각별한 사이' },
  mid: { m: 1.0, label: '' },
  low: { m: 0.75, label: '요즘은 거의 왕래 없는 사이' },
};

/**
 * 적정 축의금/조의금 산정.
 * 결혼=식대 기반, 장례=관계 기반(식대 논리 약함), 나이·참석·동반·호혜 반영.
 */
export function estimateGift(input: GiftInput): GiftEstimate {
  const {
    eventType, relation, closeness = 'mid',
    regionTier = 'seoul', age, attendance = 'attend',
    companions = 0, reciprocity,
  } = input;

  const reasons: string[] = [];
  const rel = RELATION_WEIGHT[relation];
  const ageAvg = AGE_AVG[ageBucket(age)];
  const meal = MEAL_COST[regionTier];
  const close = CLOSENESS_MULT[closeness];

  // 1) 기준선 = 연령 평균 × 관계 가중 × 친밀도
  let base = ageAvg * rel.w * close.m;
  reasons.push(`${rel.label} 관계 기준 (연령대 평균 ${(ageAvg / 10000).toFixed(0)}만 × 관계 가중)`);
  if (close.label) reasons.push(close.label);

  // 2) 결혼식 & 참석: "축의금 ≥ 식대" 하한 보장
  if (eventType === 'wedding' && attendance === 'attend') {
    const guests = 1 + Math.max(0, companions);
    const mealFloor = meal.mid * guests;
    if (base < mealFloor) {
      base = mealFloor;
      reasons.push(`${meal.label} 식대 약 ${(meal.mid / 10000).toFixed(1)}만(추정) 밑돌지 않게${guests > 1 ? ` × ${guests}명` : ''}`);
    } else {
      reasons.push(`${meal.label} 식대 약 ${(meal.mid / 10000).toFixed(1)}만(추정) 이상 확보됨`);
    }
  }

  // 3) 불참: 식대 부담 없으니 관계 성의 위주 (하향)
  if (attendance === 'absent') {
    base = base * 0.6;
    reasons.push('불참 시엔 식대 부담이 없어 성의 표현 수준으로');
  }

  // 4) 호혜(관계원장) — 이 사람이 나에게 냈던 금액이 있으면 최우선 기준
  let reciprocityNote: string | undefined;
  if (reciprocity && reciprocity > 0) {
    // 받은 만큼이 사회 통념. 물가 반영해 받은 금액과 계산값 중 큰 쪽 근처로.
    const target = Math.max(reciprocity, base);
    reciprocityNote = `예전에 이분이 나에게 ${(reciprocity / 10000).toFixed(0)}만원 하셨어요. 받은 만큼이 기본이라 그 이상으로 맞췄습니다.`;
    base = target;
    reasons.unshift(`호혜 기준: 받은 ${(reciprocity / 10000).toFixed(0)}만원 반영`);
  }

  const recommended = roundGift(base);
  // 범위: 권장 ±1구간
  const min = roundGift(recommended * 0.8);
  const max = roundGift(recommended * 1.2);

  return {
    recommended,
    min: Math.min(min, recommended),
    max: Math.max(max, recommended),
    reasons,
    reciprocityNote,
  };
}

/** 금액을 "N만원"으로 표기 */
export function won(n: number): string {
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000}만원`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만원`;
  return `${n.toLocaleString()}원`;
}
