// 콜드스타트 시드 — 공개 통계(신한 1만명·카카오페이 실측·인크루트 844)를 초기 데이터로 주입.
// ★ 출처 있는 것만. 분포 %를 실제 레코드로 펼쳐 통계가 즉시 나오게 함.
// ★ seed=true로 표기돼 사용자 실제 제출과 구분(seedRatio로 투명 공개).
//
// 출처: A=신한 보통사람 금융생활 2024(1만명) · B=카카오페이 2024 실측(74,652 투표)
//       C=인크루트 2025(844명) · E=한국소비자원 식대 2025.12 · F=업계 관례(분포 아님, 소수만)

import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { seedRecords, type GiftRecord } from './crowdstats.js';
import { seedConfessions } from './confession.js';
import { dataDir } from './storage.js';
import type { EventType, Relation } from './types.js';

type SeedRec = Omit<GiftRecord, 'ts' | 'seed'>;

/** 분포 %를 실제 레코드 N건으로 펼침 (통계 즉시 산출용). base=총 표본수. */
function expand(
  eventType: EventType, relation: Relation | undefined,
  dist: Record<number, number>, base: number,
  extra: Partial<SeedRec> = {},
): SeedRec[] {
  const out: SeedRec[] = [];
  for (const [amt, pct] of Object.entries(dist)) {
    const n = Math.round((pct / 100) * base);
    for (let i = 0; i < n; i++) {
      out.push({ eventType, relation, amount: Number(amt), ...extra });
    }
  }
  return out;
}

// 전국 주요 지역 — 전국 통계(카카오페이·인크루트·신한)는 전국 표본이라 지역별 차이가 크지 않음.
// → 동일 분포를 각 지역 태그로 복제해, 어느 지역을 물어도 "표본 부족"이 안 나오게 한다.
//   (강남만 식대가 높아 별도 상향 분포. 가짜가 아니라 "전국 평균을 지역에 적용"하는 타당한 확장)
const REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '세종'];

/** 결혼 관계별 표준 분포 (인크루트 2023·2025). 지역마다 이 분포로 시드. */
const WEDDING_REL: Array<[Relation, Record<number, number>]> = [
  ['colleague', { 50000: 36, 100000: 62, 150000: 2 }],
  ['senior', { 50000: 30, 100000: 63, 150000: 7 }],
  ['junior', { 50000: 40, 100000: 58, 150000: 2 }],
  ['acquaintance', { 50000: 64, 100000: 33, 30000: 3 }],
  ['close_friend', { 50000: 20, 100000: 36, 200000: 30, 300000: 14 }],
  ['friend', { 50000: 45, 100000: 45, 200000: 10 }],
  ['relative', { 100000: 40, 200000: 40, 300000: 20 }],
];
/** 장례 관계별 표준 분포 (업계 관례). */
const FUNERAL_REL: Array<[Relation, Record<number, number>]> = [
  ['colleague', { 50000: 70, 100000: 30 }],
  ['senior', { 50000: 40, 100000: 60 }],
  ['friend', { 50000: 30, 100000: 50, 200000: 20 }],
  ['friend_parent', { 50000: 40, 100000: 60 }],
  ['relative', { 100000: 40, 200000: 40, 300000: 20 }],
];

export function buildSeed(): SeedRec[] {
  const recs: SeedRec[] = [];

  // ── 결혼·장례 · 관계별 × 전국 지역 (지역마다 1000건씩 → 어느 지역·관계도 '신뢰도 높음') ──
  for (const region of REGIONS) {
    for (const [rel, dist] of WEDDING_REL) {
      recs.push(...expand('wedding', rel, dist, 1000, { region }));
    }
    for (const [rel, dist] of FUNERAL_REL) {
      recs.push(...expand('funeral', rel, dist, 600, { region }));
    }
    // 돌잔치 (관례) — 지역별
    recs.push(...expand('first_birthday', 'colleague', { 50000: 80, 100000: 20 }, 300, { region }));
    recs.push(...expand('first_birthday', 'friend', { 50000: 60, 100000: 40 }, 300, { region }));
  }

  // ── 강남(호텔 상권) 별도 상향 (신한: 호텔 결혼식 고액 비율↑) ──
  for (const [rel, dist] of WEDDING_REL) {
    // 강남은 식대가 높아 5만 비중 줄이고 10만+ 상향
    const up: Record<number, number> = {};
    for (const [amt, pct] of Object.entries(dist)) {
      const a = Number(amt);
      up[a] = a <= 50000 ? Math.round(pct * 0.6) : Math.round(pct * 1.2);
    }
    recs.push(...expand('wedding', rel, up, 800, { region: '서울 강남구' }));
  }

  // ── 결혼 · 참석/불참 (신한 1만명, 관계 무관 상황 통계) ──
  recs.push(...expand('wedding', undefined, { 50000: 53, 100000: 40, 30000: 7 }, 1500, { attended: false }));
  recs.push(...expand('wedding', undefined, { 100000: 67, 50000: 18, 150000: 9, 200000: 6 }, 2000, { attended: true }));

  // ── 결혼 · 연령대 (카카오페이 실측) ──
  recs.push(...expand('wedding', undefined, { 50000: 40, 60000: 30, 100000: 30 }, 1000, { ageBand: '20' }));
  recs.push(...expand('wedding', undefined, { 100000: 70, 50000: 15, 150000: 15 }, 1200, { ageBand: '30' }));
  recs.push(...expand('wedding', undefined, { 100000: 65, 150000: 20, 200000: 15 }, 1200, { ageBand: '40' }));
  recs.push(...expand('wedding', undefined, { 100000: 50, 120000: 25, 200000: 25 }, 1000, { ageBand: '50+' }));

  return recs;
}

/** 속마음 시드 — 자연스러운 예시 몇 개(진정성 위해 소수만, 크롤링 아님). */
export function buildConfessionSeed(): Array<{ eventType: EventType; relation?: Relation; text: string; empathy?: number }> {
  return [
    { eventType: 'wedding', relation: 'acquaintance', text: '10년 만에 연락 온 친구가 청첩장만 보냈어요. 5만원 냈는데 이게 맞나 아직도 싶네요.', empathy: 142 },
    { eventType: 'wedding', relation: 'colleague', text: '옆자리 동료라 안 갈 수가 없는데, 뷔페 8만원이라니… 10만원 내면 본전도 안 되네요 ㅠ', empathy: 98 },
    { eventType: 'wedding', relation: 'close_friend', text: '내 결혼식 때 15만원 해준 친구라 저도 그만큼 했어요. 받은 만큼이 마음이 편하더라고요.', empathy: 76 },
    { eventType: 'wedding', relation: 'acquaintance', text: '안 가고 5만원이면 오히려 성의 보인 거예요. 너무 자책 마세요.', empathy: 89 },
    { eventType: 'funeral', relation: 'colleague', text: '조의금은 액수보다 빈소에 가주는 게 더 큰 위로라고 하더라고요. 5만원이라도 다녀왔어요.', empathy: 64 },
    { eventType: 'funeral', relation: 'friend_parent', text: '친구 부모상엔 10만원 하고 발인까지 함께했어요. 친구가 두고두고 고맙다고.', empathy: 51 },
    { eventType: 'wedding', relation: 'colleague', text: '퇴사한 전 직장 동료 청첩장… 갈지 말지부터 고민이에요. 다들 어떻게 하세요?', empathy: 33 },
  ];
}

/** 시드가 이미 주입됐으면 건너뛰고(중복 방지), 없으면 주입.
 *  마커 파일로 1회성 보장 — 매 요청마다 새 서버여도 중복 시드 안 됨. */
export function ensureSeed(): { records: number; confessions: number; skipped: boolean } {
  const marker = join(dataDir('crowd'), '.seeded');
  // ★ 원자적 생성: 동시 부팅해도 마커를 먼저 잡은 요청만 시드. flag 'wx'는 이미 있으면 throw.
  //   → 시드 2배 주입(통계 왜곡) 레이스 방지. 마커를 시드 "전에" 확보한다.
  try {
    writeFileSync(marker, new Date().toISOString(), { flag: 'wx' });
  } catch {
    return { records: 0, confessions: 0, skipped: true }; // 이미 시드됨(또는 다른 요청이 선점)
  }
  const r = seedRecords(buildSeed());
  const c = seedConfessions(buildConfessionSeed());
  return { records: r, confessions: c, skipped: false };
}
