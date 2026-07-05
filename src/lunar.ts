// 음양력·손없는날·혼잡도 계산
// ⚠️ 손없는날은 천문연 특일 API가 직접 제공하지 않는다 → 음력 끝자리(9·0·19·20·29·30)로 자체계산.
// 음력 변환은 천문연 음양력 API(15012679)를 쓰면 정확하나, 키 없으면 근사(approx=true 정직표기).
//
// 정직성 원칙(놀맵 룰): 손없는날은 "미신"이 아니라 "예식 몰리는 날 = 혼잡도"로 번역해 노출.
//   장례(부고)에는 손없는날을 언급하지 않는다(무례).

import type { DayContext } from './types.js';

const KASI_KEY = process.env.KASI_SERVICE_KEY?.trim();

/** 손없는날 판정: 음력 일(day)의 끝자리가 9 또는 0 (9·10·19·20·29·30일).
 *  '손(귀신)'이 없어 이사·결혼을 선호 → 그날 예식이 몰림 = 혼잡. */
export function isSonEomneunDay(lunarDay: number): boolean {
  const last = lunarDay % 10;
  return last === 9 || last === 0;
}

/** 천문연 음양력 API로 양력→음력 변환 (키 있을 때만).
 *  실패/무키 시 null 반환 → 호출부에서 근사 폴백. */
async function fetchLunarFromKASI(
  y: number, m: number, d: number,
): Promise<{ lunMonth: number; lunDay: number } | null> {
  if (!KASI_KEY) return null;
  const url =
    'http://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo'
    + `?serviceKey=${encodeURIComponent(KASI_KEY)}`
    + `&solYear=${y}&solMonth=${String(m).padStart(2, '0')}&solDay=${String(d).padStart(2, '0')}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    const lm = text.match(/<lunMonth>(\d+)<\/lunMonth>/)?.[1];
    const ld = text.match(/<lunDay>(\d+)<\/lunDay>/)?.[1];
    if (lm && ld) return { lunMonth: parseInt(lm, 10), lunDay: parseInt(ld, 10) };
  } catch {
    // 타임아웃·네트워크 오류 → 폴백
  }
  return null;
}

/** 근사 음력 계산 — 키 없을 때 폴백. 삭망월 평균 29.53일 기준의 대략치.
 *  ⚠️ 정확하지 않음(approx=true로 표기). 손없는날 "가능성" 안내용으로만. */
function approxLunarDay(dateISO: string): number {
  // 기준: 2000-01-06 = 음력 1월 1일 근처(신월). 이후 경과일 % 29.53
  const base = Date.UTC(2000, 0, 6);
  const [y, m, d] = dateISO.split('-').map(Number);
  const cur = Date.UTC(y, m - 1, d);
  const days = Math.floor((cur - base) / 86400000);
  const lunarDay = ((days % 29.53) + 29.53) % 29.53;
  return Math.floor(lunarDay) + 1; // 1~30 근사
}

/** 주말·손없는날 조합으로 예식 혼잡도 추정 */
function crowdLevel(dateISO: string, sonEomneun: boolean): '상' | '중' | '하' {
  const dow = new Date(dateISO + 'T00:00:00').getDay(); // 0=일 6=토
  const weekend = dow === 0 || dow === 6;
  if (weekend && sonEomneun) return '상';
  if (weekend || sonEomneun) return '중';
  return '하';
}

/** 그날의 맥락(음력·손없는날·혼잡도)을 반환.
 *  forFuneral=true면 손없는날/혼잡도 언급을 뺀 담백한 맥락(무례 방지). */
export async function getDayContext(
  dateISO: string,
  forFuneral = false,
): Promise<DayContext> {
  const [y, m, d] = dateISO.split('-').map(Number);
  const kasi = await fetchLunarFromKASI(y, m, d);

  let lunarDay: number;
  let lunarStr: string | undefined;
  let approx: boolean;

  if (kasi) {
    lunarDay = kasi.lunDay;
    lunarStr = `음력 ${kasi.lunMonth}월 ${kasi.lunDay}일`;
    approx = false;
  } else {
    lunarDay = approxLunarDay(dateISO);
    lunarStr = undefined; // 근사라 정확한 음력일 노출 안 함
    approx = true;
  }

  const son = isSonEomneunDay(lunarDay);
  const crowd = crowdLevel(dateISO, son);

  let note: string;
  if (forFuneral) {
    note = ''; // 장례에는 손없는날/혼잡도 언급 안 함
  } else if (approx) {
    note = son
      ? '이 무렵은 손없는날일 가능성이 있어 예식이 몰릴 수 있어요(추정). 조금 일찍 도착 권장.'
      : '';
  } else {
    note = son
      ? '이날은 손없는 날이라 예식이 몰립니다. 주차·이동시간 넉넉히, 30분 일찍 도착 권장.'
      : '';
  }

  return {
    solarDate: dateISO,
    lunar: lunarStr,
    isSonEomneun: son,
    crowdLevel: crowd,
    note,
    approx,
  };
}
