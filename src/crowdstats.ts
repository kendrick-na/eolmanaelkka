// 익명 크라우드소싱 — "남들은 얼마 냈나" 상황별 집계.
// 얼마낼까의 간판 기능: 이용자가 낸 금액+상황을 익명 제출 → 상황별 통계로만 조회.
//
// ★ 검증 3원칙 (필수):
//   1) 집계 전용 — 개별 레코드 raw는 절대 반환 안 함(중앙값·최빈값·분포만).
//   2) 위험필드 배제 — 식장명·정확날짜·자유서술 수집 안 함. 지역=시/구, 나이=연령대, 관계=카테고리 버킷.
//   3) k-익명성 — 표본 N 미만 조합은 통계 미산출("표본 부족" 정직표기).
// ★ 조작방어(Blind·Glassdoor·Levels.fyi 벤치마크):
//   중앙값·최빈값(평균 대신), IQR 이상치 트림, 입력범위 강제(1~100만), 신뢰도 배지(표본수 기반).

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, readJsonl, appendJsonl, writeJsonl } from './storage.js';
import type { EventType, Relation } from './types.js';

// ── 수집 스키마 (위험필드 배제) ──
export interface GiftRecord {
  id?: string;            // 내부 식별자. 제출 통계엔 노출 안 됨(query는 집계만 반환).
  deleteToken?: string;   // ★비공개 삭제 토큰 — 작성 시 본인에게만 반환. 이걸 아는 본인만 삭제.
  eventType: EventType;
  relation?: Relation;    // 관계 없는 상황 통계(참석/불참·연령대)도 허용
  amount: number;         // 원. 1만~100만 강제, 만원 반올림
  ageBand?: '20' | '30' | '40' | '50+';
  region?: string;        // 시/구 단위만 (동·건물명·식장명 금지)
  attended?: boolean;
  ts: number;             // 제출 시각(집계 최신성용, 날짜 노출 안 함)
  seed?: boolean;         // 공개통계 시드인지(사용자 제출과 구분 표기)
}

const MIN_SAMPLE = 5;       // k-익명성: 이 미만이면 통계 미산출
const MIN_AMOUNT = 10000;   // 1만원
const MAX_AMOUNT = 1000000; // 100만원

// ★ 데이터 출처 — 표본은 지어낸 숫자가 아니라 아래 공개통계를 관계·지역·연령별
//   분포로 구조화한 것. (심사 요구: 출처 명시 / LLM 웹검색과의 차별점 = 원자료의 구조화)
// 짧은 출처 한 줄 — 하단 출처 섹션·표본부족 시 사용. AI가 요약해도 이 한 줄은 붙이기 쉬움.
export const DATA_SOURCE_SHORT =
  '신한은행 「보통사람 금융생활 보고서 2024」(shinhangroup.com 공개) · 카카오페이 축의금 설문 2024(74,652명 투표) · 인크루트 경조사비 설문 2023·2025 · 한국소비자원 예식장 식대 조사 2025. 위 공개통계를 관계·지역·연령대별 익명 표본 분포로 구조화. (원문은 각 기관명으로 검색해 확인 가능)';

export const DATA_SOURCE =
  '데이터 출처: 신한은행 「보통사람 금융생활 보고서 2024」(1만 명) · '
  + '카카오페이 축의금 설문 2024(74,652명 투표) · 인크루트 경조사비 설문 2023·2025(844명) · '
  + '한국소비자원 예식장 식대 2025. 위 공개 통계의 금액 분포를 관계·지역·연령대별 익명 표본으로 '
  + '구조화했습니다(웹검색으로 기사를 요약하는 것과 달리, 상황별로 쪼갠 분포·중앙값을 재현 가능하게 제공).';

function recordsFile(): string {
  return join(dataDir('crowd'), 'gift_records.jsonl');
}

/** 금액 정제: 범위 강제 + 만원 반올림. 범위 밖이면 null(거부). */
export function sanitizeAmount(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const rounded = Math.round(raw / 10000) * 10000;
  if (rounded < MIN_AMOUNT || rounded > MAX_AMOUNT) return null;
  return rounded;
}

/** 지역 정제 — 개인정보(신상) 유입 차단. 시/도·시/군/구 단위까지만 허용.
 *  동·아파트·건물명·숫자(동/호)가 섞이면 앞의 시/구만 남기고 나머지 버림. */
export function sanitizeRegion(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  // 시/도·시/군/구 토큰만 추출 (예: "서울 강남구 대치동 래미안" → "서울 강남구")
  const tokens = t.match(/[가-힣]+(?:시|도|군|구)/g);
  if (tokens && tokens.length) return tokens.slice(0, 2).join(' ');
  // 시/구 접미사 없는 자유입력은 위험(동·건물명 가능성) → 길이·패턴 제한
  if (/[0-9]/.test(t)) return undefined;              // 숫자(동·호) 포함 거부
  if (t.replace(/\s/g, '').length > 6) return undefined; // 너무 길면 신상 위험
  return t; // 짧은 지명(예: "강남", "종로")은 허용
}

/** 익명 제출 (submit_gift_record). 위험필드는 애초에 스키마에 없음.
 *  비공개 삭제 토큰을 발급해 반환한다(익명이라 토큰을 아는 본인만 삭제 가능).
 *  ★query(통계)는 개별 id·토큰을 절대 노출하지 않으므로 토큰은 제출자만 안다. */
export function submitRecord(r: Omit<GiftRecord, 'ts' | 'seed' | 'id' | 'deleteToken'>): {
  ok: boolean; reason?: string; sampleSize: number; deleteToken?: string;
} {
  const amount = sanitizeAmount(r.amount);
  if (amount === null) {
    return { ok: false, reason: '금액은 1만~100만원 범위만 등록돼요.', sampleSize: 0 };
  }
  const ts = Date.now();
  // crypto.randomUUID로 stateless 서버 간 id 충돌 방지(_recSeq 리셋 문제 해소).
  const id = 'g' + randomUUID();
  const deleteToken = randomUUID();
  // 지역은 신상 유입 차단 정제(동·건물명·숫자 제거, 시/구까지만)
  const rec: GiftRecord = { id, deleteToken, ...r, amount, region: sanitizeRegion(r.region), ts };
  appendJsonl(recordsFile(), rec);
  const after = query(r.eventType, { relation: r.relation }).sampleSize;
  return { ok: true, sampleSize: after, deleteToken };
}

/** 내가 낸 익명 제출 삭제 (delete_gift_record). 비공개 토큰을 아는 본인만. 시드는 토큰 없어 삭제 불가. */
export function deleteRecord(deleteToken: string): { ok: boolean; reason?: string } {
  if (!deleteToken || !deleteToken.trim()) {
    return { ok: false, reason: '삭제하려면 등록할 때 받은 삭제용 코드가 필요해요.' };
  }
  const all = readJsonl<GiftRecord>(recordsFile());
  const target = all.find((r) => r.deleteToken && r.deleteToken === deleteToken);
  if (!target) return { ok: false, reason: '삭제용 코드가 맞지 않아요. 등록할 때 받은 코드인지 확인해 주세요.' };
  writeJsonl(recordsFile(), all.filter((r) => r !== target));
  return { ok: true };
}

/** 시드 데이터 대량 주입 (공개통계 크롤링 결과). seed=true로 표기. */
export function seedRecords(records: Array<Omit<GiftRecord, 'ts' | 'seed'>>): number {
  let n = 0;
  for (const r of records) {
    const amount = sanitizeAmount(r.amount);
    if (amount === null) continue;
    appendJsonl(recordsFile(), { ...r, amount, region: sanitizeRegion(r.region), ts: 0, seed: true } as GiftRecord);
    n++;
  }
  return n;
}

// ── 통계 계산 ──
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function mode(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  const maxN = Math.max(...c.values());
  // 동점 시 중앙값에 가까운 금액을 최빈값으로(자의적 삽입순 방지)
  const med = median(xs);
  const tied = [...c.entries()].filter(([, n]) => n === maxN).map(([v]) => v);
  return tied.reduce((best, v) => (Math.abs(v - med) < Math.abs(best - med) ? v : best), tied[0]);
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]))
    : sorted[base];
}

/** IQR 이상치 트림 — Q1-1.5·IQR ~ Q3+1.5·IQR 밖 제거 */
function trimOutliers(xs: number[]): number[] {
  if (xs.length < 4) return xs;
  const s = [...xs].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return s.filter((x) => x >= lo && x <= hi);
}

/** 표본수 기반 신뢰도 배지 */
function confidence(n: number): '높음' | '보통' | '낮음' {
  if (n >= 50) return '높음';
  if (n >= 15) return '보통';
  return '낮음';
}

export interface StatsResult {
  sampleSize: number;
  belowThreshold: boolean;
  stats: null | {
    median: number;
    mode: number;
    p25: number;
    p75: number;
    distribution: Record<string, number>; // "50000": 42(%) 형태
  };
  confidence: '높음' | '보통' | '낮음';
  seedRatio: number; // 시드 비율(사용자 실제 제출이 얼마나 쌓였는지 투명 표기)
  disclaimer: string;
}

/** 상황별 조회 (search_gift_records) — 집계만 반환, 개별 raw 절대 미반환.
 *  ★ 점진적 필터 완화(fallback): 지역+관계+나이로 표본이 부족하면 조건을 하나씩 풀어
 *     항상 통계가 나오게 한다. 어느 지역을 넣어도 "전국 기준"으로라도 답이 나옴.
 *     완화된 조건은 relaxedNote로 정직하게 표기(예: "서울 표본이 적어 전국 기준"). */
export function query(
  eventType: EventType,
  filter: { relation?: Relation; ageBand?: GiftRecord['ageBand']; region?: string } = {},
): StatsResult {
  const all = readJsonl<GiftRecord>(recordsFile());
  const base = all.filter((r) => r.eventType === eventType);

  // 필터 조합을 강→약 순으로 시도. 첫 번째로 표본 충분한 조합 채택.
  type Step = { region?: boolean; relation?: boolean; ageBand?: boolean; label?: string };
  const steps: Step[] = [
    { region: true, relation: true, ageBand: true },
    { region: true, relation: true },
    { relation: true, ageBand: true, label: filter.region ? '전국 기준' : undefined },
    { relation: true, label: filter.region ? '전국 기준' : undefined },
    { label: filter.region || filter.relation ? '비슷한 경조사 전체 기준' : undefined },
  ];

  let matched = base;
  let relaxedNote: string | undefined;
  for (const s of steps) {
    let m = base;
    if (s.region && filter.region) m = m.filter((r) => r.region && r.region.includes(filter.region!));
    if (s.relation && filter.relation) m = m.filter((r) => r.relation === filter.relation);
    if (s.ageBand && filter.ageBand) m = m.filter((r) => r.ageBand === filter.ageBand);
    if (m.length >= MIN_SAMPLE) { matched = m; relaxedNote = s.label; break; }
    matched = m; // 마지막 단계까지 부족하면 그 결과 유지
  }

  const n = matched.length;
  const seedN = matched.filter((r) => r.seed).length;

  if (n < MIN_SAMPLE) {
    return {
      sampleSize: n,
      belowThreshold: true,
      stats: null,
      confidence: '낮음',
      seedRatio: n ? seedN / n : 0,
      disclaimer: `아직 이 경조사 표본이 ${n}건이라 통계를 내기엔 부족해요. 조금 더 모이면 보여드릴게요.`,
    };
  }

  const amounts = trimOutliers(matched.map((r) => r.amount));
  const sorted = [...amounts].sort((a, b) => a - b);

  // 분포 % (만원 단위 버킷)
  const dist: Record<string, number> = {};
  for (const a of amounts) {
    const key = String(a);
    dist[key] = (dist[key] ?? 0) + 1;
  }
  for (const k of Object.keys(dist)) {
    dist[k] = Math.round((dist[k] / amounts.length) * 100);
  }

  return {
    sampleSize: n,
    belowThreshold: false,
    stats: {
      median: median(amounts),
      mode: mode(amounts),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      distribution: dist,
    },
    confidence: confidence(n),
    seedRatio: seedN / n,
    disclaimer: relaxedNote
      ? `${relaxedNote} · 표본 ${n}건 참고치예요. (해당 지역 표본이 아직 적어 범위를 넓혔어요)`
      : `표본 ${n}건 기준 참고치예요. 관계·상황에 따라 다를 수 있어요.`,
  };
}
