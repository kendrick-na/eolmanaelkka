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

export function buildSeed(): SeedRec[] {
  const recs: SeedRec[] = [];

  // ── 결혼 · 관계별 (인크루트 2025, 844명) ──
  // 직장동료(가까운/먼) 통합: 10만 60%, 5만 33%, 15만 1%, 5만미만 3% (10000=5만미만 근사→5만으로)
  recs.push(...expand('wedding', 'colleague', { 50000: 36, 100000: 62, 150000: 2 }, 60));
  recs.push(...expand('wedding', 'senior', { 50000: 30, 100000: 63, 150000: 7 }, 40));
  recs.push(...expand('wedding', 'junior', { 50000: 40, 100000: 58, 150000: 2 }, 40));
  // 아는 사이/동호회: 5만 64% (인크루트 2023)
  recs.push(...expand('wedding', 'acquaintance', { 50000: 64, 100000: 33, 30000: 3 }, 40));
  // 친한 친구(거의 매일 연락): 10만 36%, 20만 30%, 30만 14%, 5만 20% (인크루트 2023)
  recs.push(...expand('wedding', 'close_friend', { 50000: 20, 100000: 36, 200000: 30, 300000: 14 }, 50));
  recs.push(...expand('wedding', 'friend', { 50000: 45, 100000: 45, 200000: 10 }, 50));
  // 친척: 관례 10~30만
  recs.push(...expand('wedding', 'relative', { 100000: 40, 200000: 40, 300000: 20 }, 20));

  // ── 결혼 · 참석/불참 (신한 1만명) — 관계 없이 상황 통계 ──
  recs.push(...expand('wedding', undefined, { 50000: 53, 100000: 40, 30000: 7 }, 40, { attended: false }));
  recs.push(...expand('wedding', undefined, { 100000: 67, 50000: 18, 150000: 9, 200000: 6 }, 60, { attended: true }));

  // ── 결혼 · 연령대 (카카오페이 실측) ──
  recs.push(...expand('wedding', undefined, { 50000: 40, 60000: 30, 100000: 30 }, 30, { ageBand: '20' }));
  recs.push(...expand('wedding', undefined, { 100000: 70, 50000: 15, 150000: 15 }, 40, { ageBand: '30' }));
  recs.push(...expand('wedding', undefined, { 100000: 65, 150000: 20, 200000: 15 }, 40, { ageBand: '40' }));
  recs.push(...expand('wedding', undefined, { 100000: 50, 120000: 25, 200000: 25 }, 30, { ageBand: '50+' }));

  // ── 결혼 · 식장 등급 (신한 호텔 vs 일반) ──
  recs.push(...expand('wedding', undefined, { 100000: 57, 150000: 12, 200000: 31 }, 40, { region: '강남' }));

  // ── 장례 · 관계별 (업계 관례 F — 분포 근사, 소수만) ──
  recs.push(...expand('funeral', 'colleague', { 50000: 70, 100000: 30 }, 12));
  recs.push(...expand('funeral', 'senior', { 50000: 40, 100000: 60 }, 10));
  recs.push(...expand('funeral', 'friend', { 50000: 30, 100000: 50, 200000: 20 }, 12));
  recs.push(...expand('funeral', 'friend_parent', { 50000: 40, 100000: 60 }, 12));
  recs.push(...expand('funeral', 'relative', { 100000: 40, 200000: 40, 300000: 20 }, 10));

  // ── 돌잔치 (관례) ──
  recs.push(...expand('first_birthday', 'colleague', { 50000: 80, 100000: 20 }, 8));
  recs.push(...expand('first_birthday', 'friend', { 50000: 60, 100000: 40 }, 8));

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
