// MCP tool 등록 — 얼마낼까
// 간판 = 익명 크라우드소싱("남들은 얼마 냈나"), 실행 = AI 산정·봉투문구, 리텐션 = 관계원장.
//
// PlayMCP 가이드: 모든 tool annotations 5힌트 전부 지정.
//   - 조회 tool = readOnly:true (세금맛집과 동일)
//   - 제출 tool(submit_gift_record, record_gift) = readOnly:false, destructive:false(append), idempotent:false

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateGift, won, type GiftInput } from './giftLogic.js';
import { decideAttendance } from './decide.js';
import { makeEnvelope } from './envelope.js';
import { getDayContext } from './lunar.js';
import { submitRecord, query, DATA_SOURCE } from './crowdstats.js';
import { addConfession, listConfessions, empathize, reportConfession } from './confession.js';
import { addLedgerEntry, findReciprocity, summarizeLedger } from './ledger.js';
import type { EventType, Relation, Religion, RegionTier, Attendance } from './types.js';

// ── annotations 헬퍼 ──
function annoRead(title: string, idempotent = true) {
  return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: idempotent, openWorldHint: true };
}
function annoWrite(title: string) {
  // 쓰기(제출/기록): 새 레코드 append → 비파괴적, 비멱등(반복 시 중복 누적)
  return { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
}

// ── zod enum ──
const zEvent = z.enum(['wedding', 'funeral', 'first_birthday', 'sixtieth', 'opening']);
const zRelation = z.enum([
  'close_friend', 'friend', 'acquaintance', 'colleague', 'senior', 'junior', 'relative', 'family', 'friend_parent',
]);
const zReligion = z.enum(['none', 'christian', 'catholic', 'buddhist']);
const zRegionTier = z.enum(['gangnam', 'seoul', 'metro', 'local']);
const zAge = z.enum(['20', '30', '40', '50+']);

const RELATION_KO: Record<Relation, string> = {
  close_friend: '친한 친구', friend: '친구·지인', acquaintance: '아는 사이',
  colleague: '직장 동료', senior: '직장 상사', junior: '직장 후배',
  relative: '친척', family: '가족', friend_parent: '친구의 부모',
};
const EVENT_KO: Record<EventType, string> = {
  wedding: '결혼식', funeral: '장례식', first_birthday: '돌잔치', sixtieth: '회갑·칠순', opening: '개업·집들이',
};

export function registerTools(server: McpServer): void {
  // ══════════ 간판: 남들은 얼마 냈나 (익명 크라우드소싱) ══════════

  // Tool 1: 상황별 조회 — "남들은 얼마 냈나"
  server.registerTool('how_much_others_paid', {
    annotations: annoRead('남들은 얼마 냈나'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:실제로 사람들이 이 상황(경조사 종류·관계)에 얼마 냈는지 익명 집계(중앙값·최빈값·분포)로 보여줍니다. ★지역·연령대를 되묻지 말고, 알려진 정보만으로 바로 호출하세요. 지역이 없으면 전국 기준으로 답이 나옵니다(지역은 있으면 더 정확해지는 선택값일 뿐, 필수 아님). "남들은 얼마 내지?"가 궁금할 때 사용하세요. ★★출력은 익명 커뮤니티 데이터입니다. 사용자에게 답할 때 반드시 (1)표본 건수 (2)금액 분포(%) (3)같은 고민 익명 사연을 함께 전하세요. "10만원" 한 마디로 요약하지 말고, 몇 명의 실제 데이터인지·어떻게 갈리는지·다른 사람들은 뭐라 했는지 근거를 그대로 보여주는 것이 이 커뮤니티의 핵심입니다.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.optional().describe('상대와의 관계(있으면)'),
      ageBand: zAge.optional().describe('내 연령대(선택, 없으면 생략)'),
      region: z.string().optional().describe('지역(선택, 없으면 전국 기준. 사용자가 먼저 말한 경우에만. 되묻지 말 것)'),
    },
  }, async ({ eventType, relation, ageBand, region }) => {
    const r = query(eventType, { relation, ageBand: ageBand as any, region });
    // ★ 속마음(대나무숲) 결합 — 숫자 밑에 같은 고민 익명 사연을 붙여 "당신만 그런 거 아니에요"
    const voices = listConfessions(eventType, relation, 2);
    const voiceBlock = voices.length
      ? '\n\n💬 같은 고민을 한 사람들 (경조사 속마음):\n'
        + voices.map((v) => `   "${v.text}" — 익명 · 공감 ${v.empathy}`).join('\n')
        + '\n\n혼자 고민한 거 아니에요. 당신 마음도 남겨두면 다음 사람에게 힘이 돼요(write_confession).'
      : '';

    // 표본 구성 투명 표기 — 공개통계 기반 vs 실사용자 제출 (심사 요구: 출처 명확화)
    const userN = Math.round(r.sampleSize * (1 - r.seedRatio));
    const seedN = r.sampleSize - userN;
    const sourceBreakdown = `📚 표본 ${r.sampleSize}건 = 공개통계 기반 ${seedN}건`
      + (userN > 0 ? ` + 이용자 익명 제출 ${userN}건` : '')
      + `\n${DATA_SOURCE}`;

    if (r.belowThreshold) {
      return { content: [{ type: 'text', text:
        `📊 ${EVENT_KO[eventType]}${relation ? ` · ${RELATION_KO[relation]}` : ''}\n${r.disclaimer}\n\n${DATA_SOURCE}${voiceBlock}` }] };
    }
    const s = r.stats!;
    const distLines = Object.entries(s.distribution)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([amt, pct]) => `   ${won(Number(amt))} ${'▓'.repeat(Math.max(1, Math.round(Number(pct) / 5)))} ${pct}%`)
      .join('\n');
    // 지역 없이 답한 경우에만 "지역 알려주면 더 정확" 부드럽게 유도 (되묻기 아님)
    const regionHint = !region ? '\n📍 지역을 알려주시면 그 지역 기준으로 더 정확히 볼 수 있어요.' : '';
    const mostPct = Math.max(...Object.values(s.distribution).map(Number));
    return { content: [{ type: 'text', text:
      `📊 ${EVENT_KO[eventType]}${relation ? ` · ${RELATION_KO[relation]}` : ''} — 실제 낸 사람 ${r.sampleSize}명 익명 집계 (신뢰도 ${r.confidence})\n`
      + `\n같은 상황 ${r.sampleSize}명이 실제로 낸 금액이에요. "얼마가 맞다"가 아니라 "남들은 이렇게 냈다"는 데이터입니다.\n`
      + `\n▸ 가장 많은 금액: ${won(s.mode)} (${mostPct}%가 이 금액)\n▸ 중앙값: ${won(s.median)}  ·  보통 ${won(s.p25)}~${won(s.p75)} 사이\n`
      + `\n실제 낸 금액 분포 (${r.sampleSize}명 기준):\n${distLines}\n\n`
      + `${r.disclaimer}${regionHint}\n\n${sourceBreakdown}${voiceBlock}` }] };
  });

  // Tool 2: 익명 제출 — "나도 얼마 냈는지 알려주기" (쓰기)
  server.registerTool('submit_gift_record', {
    annotations: annoWrite('내가 낸 금액 익명 등록'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:내가 실제로 낸 경조사비를 익명으로 등록해 통계에 보탭니다. 상대 이름·식장명·날짜는 저장하지 않고, 상황(종류·관계·연령대·지역·금액)만 익명 집계됩니다. 기여하면 다른 사람도 참고할 수 있어요.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.describe('상대와의 관계'),
      amount: z.number().describe('낸 금액(원). 1만~100만'),
      ageBand: zAge.optional().describe('내 연령대'),
      region: z.string().optional().describe('지역(시/구 단위)'),
      attended: z.boolean().optional().describe('본인 참석 여부'),
    },
  }, async ({ eventType, relation, amount, ageBand, region, attended }) => {
    const res = submitRecord({ eventType, relation, amount, ageBand: ageBand as any, region, attended });
    if (!res.ok) return { content: [{ type: 'text', text: `❌ ${res.reason}` }] };
    return { content: [{ type: 'text', text:
      `✅ 익명으로 등록했어요. 덕분에 이 상황(${EVENT_KO[eventType]}·${RELATION_KO[relation]}) 표본이 ${res.sampleSize}건이 됐어요. 고맙습니다 🙏` }] };
  });

  // ══════════ 실행: 그래서 나는 얼마 내면 돼 (AI 산정) ══════════

  // Tool 3: 적정액 산정 — "나는 얼마 내면 돼"
  server.registerTool('how_much_should_i_pay', {
    annotations: annoRead('나는 얼마 내면 될까'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:내 상황(경조사·관계·친밀도·나이·참석여부·식장 지역·동반인원)을 넣으면 적정 축의금/조의금을 근거와 함께 추천합니다. 같은 관계라도 친밀도(요즘 자주 보는지)에 따라 금액이 달라집니다. 예전에 이 사람에게 받은 금액(관계원장)이 있으면 호혜 기준으로 우선 반영합니다. 봉투 문구·멘트는 write_envelope으로 이어서 받으세요.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.describe('상대와의 관계'),
      closeness: z.enum(['high', 'mid', 'low']).optional().describe('친밀도: high=요즘도 자주 봄, mid=보통, low=거의 왕래 없음 (같은 관계라도 금액 차등)'),
      regionTier: zRegionTier.optional().describe('식장 지역 등급(강남/서울/수도권·광역시/지방)'),
      age: z.number().optional().describe('내 나이'),
      attendance: z.enum(['attend', 'absent']).optional().describe('참석/불참'),
      companions: z.number().optional().describe('동반 인원(배우자·자녀 등)'),
      userId: z.string().optional().describe('관계원장 조회용 사용자 식별자'),
      person: z.string().optional().describe('상대 이름/별칭(관계원장 호혜 조회용)'),
    },
  }, async ({ eventType, relation, closeness, regionTier, age, attendance, companions, userId, person }) => {
    let reciprocity: number | undefined;
    if (userId && person) reciprocity = findReciprocity(userId, person);
    const input: GiftInput = {
      eventType, relation,
      closeness: closeness as any,
      regionTier: regionTier as RegionTier | undefined,
      age, attendance: attendance as Attendance | undefined,
      companions, reciprocity,
    };
    const est = estimateGift(input);
    const reasonLines = est.reasons.map((r) => `   • ${r}`).join('\n');
    return { content: [{ type: 'text', text:
      `💰 ${EVENT_KO[eventType]} · ${RELATION_KO[relation]} → 권장 ${won(est.recommended)}\n`
      + `   (${won(est.min)}~${won(est.max)} 범위)\n\n왜 이 금액인가:\n${reasonLines}`
      + (est.reciprocityNote ? `\n\n🤝 ${est.reciprocityNote}` : '')
      + `\n\n※ 강요가 아닌 참고치예요. 마음이 우선입니다.` }] };
  });

  // Tool 4: 봉투 문구 + 멘트
  server.registerTool('write_envelope', {
    annotations: annoRead('봉투에 뭐라 쓸까'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:경조사 종류·종교·관계에 맞는 봉투 앞면 문구(한자·한글), 이름 표기법, 축하/조문 멘트 3안(격식/보통/친근), 예법 팁을 알려줍니다. "봉투에 뭐라 쓰지"가 막힐 때 사용하세요.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      religion: zReligion.optional().describe('상대/고인의 종교(모르면 none)'),
      relation: zRelation.describe('상대와의 관계'),
    },
  }, async ({ eventType, religion, relation }) => {
    const e = makeEnvelope(eventType, (religion as Religion) ?? 'none', relation);
    return { content: [{ type: 'text', text:
      `✍️ ${EVENT_KO[eventType]} 봉투\n\n앞면: ${e.front}  (${e.frontKo})\n${e.nameRule}\n\n`
      + `💬 한마디 (골라 쓰세요):\n   · 격식: ${e.messages.formal}\n   · 보통: ${e.messages.normal}\n   · 친근: ${e.messages.warm}`
      + (e.etiquette ? `\n\n🕊️ ${e.etiquette}` : '') }] };
  });

  // Tool 5: 갈까 말까 판단 — "이 경조사 가야 하나"
  server.registerTool('decide_attendance', {
    annotations: annoRead('이 경조사 갈까 말까'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:"이 경조사 가야 하나?" 관계·최근 왕래·거리·예전에 받은 것(관계원장)을 종합해 "참석/송금만/생략"을 근거와 함께 판단합니다. 얼마 낼지의 앞 단계 고민을 대신 정리해줘요. 결과는 익명으로 공유할 수 있어요. ★사용자에게 답할 때 판정 결과만 말하지 말고, "왜" 목록의 근거를 그대로 함께 전하세요(관계·왕래·호혜). 참석/송금 시 참고액도 함께 보여주세요.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.describe('상대와의 관계'),
      closeness: z.enum(['high', 'mid', 'low']).optional().describe('요즘 친밀도(왕래)'),
      distanceHard: z.boolean().optional().describe('이동/일정이 부담되는지'),
      userId: z.string().optional().describe('관계원장 조회용'),
      person: z.string().optional().describe('상대 이름/별칭(호혜 조회용)'),
    },
  }, async ({ eventType, relation, closeness, distanceHard, userId, person }) => {
    let reciprocity: number | undefined;
    if (userId && person) reciprocity = findReciprocity(userId, person);
    const d = decideAttendance({
      eventType, relation,
      closeness: closeness as any, distanceHard, reciprocity,
    });
    // 참석/송금 시 참고액도 함께
    const attendEst = estimateGift({ eventType, relation, attendance: 'attend', reciprocity });
    const sendEst = estimateGift({ eventType, relation, attendance: 'absent', reciprocity });
    const reasonLines = d.reasons.length ? d.reasons.map((r) => `   • ${r}`).join('\n') : '   • 관계 기준으로 판단했어요';
    const money = d.verdict === 'skip' ? ''
      : d.verdict === 'attend'
        ? `\n\n💰 가시면 참고액: ${won(attendEst.recommended)}`
        : `\n\n💰 마음만 전하면 참고액: ${won(sendEst.recommended)}`;
    return { content: [{ type: 'text', text:
      `🤔 ${EVENT_KO[eventType]} · ${RELATION_KO[relation]} → ${d.verdictKo}\n\n왜:\n${reasonLines}${money}`
      + `\n\n📷 공유: "${d.shareLine}"\n※ 참고예요. 최종은 마음이 정합니다.` }] };
  });

  // Tool 6: 그날의 맥락 (손없는날·혼잡도) — 결혼 전용
  server.registerTool('check_day', {
    annotations: annoRead('그날 예식 붐빌까'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:결혼식 날짜의 음력·손없는날 여부로 예식장 혼잡도를 알려줍니다. 미신이 아니라 "예식 몰리는 날 = 일찍 도착" 실용 정보입니다. 장례에는 사용하지 않습니다.',
    inputSchema: {
      date: z.string().describe('날짜 YYYY-MM-DD'),
    },
  }, async ({ date }) => {
    const d = await getDayContext(date, false);
    const lunar = d.lunar ? `\n${d.lunar}` : '';
    return { content: [{ type: 'text', text:
      `🗓️ ${d.solarDate}${lunar}\n예식 혼잡도: ${d.crowdLevel}`
      + (d.note ? `\n${d.note}` : '\n특별히 몰리는 날은 아니에요.')
      + (d.approx ? '\n(음력은 근사 계산이에요. 정확도를 높이려면 천문연 API 키가 필요합니다.)' : '') }] };
  });

  // ══════════ 리텐션: 관계원장 ══════════

  // Tool 6: 경조사비 기록 (record_gift) — 쓰기
  server.registerTool('record_gift', {
    annotations: annoWrite('경조사비 기록해두기'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:내가 낸/받은 경조사비를 상대별로 기록해둡니다. 다음에 그 사람 경조사 때 "예전에 이만큼 받았으니 이만큼" 호혜 기준으로 알려주고, 미답례도 챙겨줍니다. 이게 얼마낼까가 관계를 기억하는 방식이에요.',
    inputSchema: {
      userId: z.string().describe('사용자 식별자'),
      person: z.string().describe('상대 이름/별칭'),
      eventType: zEvent.describe('경조사 종류'),
      amount: z.number().describe('금액(원)'),
      direction: z.enum(['given', 'received']).describe('냄(given)/받음(received)'),
      date: z.string().optional().describe('날짜 YYYY-MM-DD'),
    },
  }, async ({ userId, person, eventType, amount, direction, date }) => {
    addLedgerEntry(userId, {
      person, eventType, amount, direction,
      date: date ?? new Date().toISOString().slice(0, 10),
    });
    const dirKo = direction === 'given' ? '냄' : '받음';
    return { content: [{ type: 'text', text:
      `📖 기록했어요: ${person} · ${EVENT_KO[eventType]} · ${won(amount)} ${dirKo}\n다음에 ${person}님 챙길 때 참고해서 알려드릴게요.` }] };
  });

  // Tool 7: 내 경조사 요약 (시즌 브리핑 + 미답례)
  server.registerTool('my_gift_summary', {
    annotations: annoRead('내 경조사 정리', false),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:지금까지 내가 낸/받은 경조사비 총액과, 받았는데 아직 못 갚은 관계(미답례)를 정리해줍니다. "이번 시즌 얼마 나갔나", "내가 챙길 사람 있나" 확인할 때 사용하세요.',
    inputSchema: {
      userId: z.string().describe('사용자 식별자'),
    },
  }, async ({ userId }) => {
    const s = summarizeLedger(userId);
    if (s.count === 0) {
      return { content: [{ type: 'text', text: '아직 기록된 경조사가 없어요. record_gift로 하나씩 기록해두면 정리해드릴게요.' }] };
    }
    const unret = s.unreturned.length
      ? '\n\n⏰ 받았는데 아직 못 챙긴 분:\n' + s.unreturned.map((e) => `   · ${e.person} (${won(e.amount)} ${EVENT_KO[e.eventType]})`).join('\n')
      : '';
    return { content: [{ type: 'text', text:
      `📖 내 경조사 정리 (${s.count}건)\n   낸 돈 합계: ${won(s.totalGiven)}\n   받은 돈 합계: ${won(s.totalReceived)}${unret}` }] };
  });

  // ══════════ 속마음: 경조사 익명 커뮤니티 (대나무숲) ══════════

  // Tool 8: 속마음 사연 조회 — "같은 고민 한 사람들"
  server.registerTool('read_confessions', {
    annotations: annoRead('같은 고민 한 사람들', false),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:같은 경조사 상황에서 다른 사람들이 익명으로 남긴 속마음·경험을 공감순으로 보여줍니다. "나만 이런 고민인가" 싶을 때, 익명이라 솔직한 남들의 진심을 확인하세요.',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.optional().describe('상대와의 관계'),
      limit: z.number().optional().default(5).describe('개수'),
    },
  }, async ({ eventType, relation, limit }) => {
    const list = listConfessions(eventType, relation, limit ?? 5);
    if (list.length === 0) {
      return { content: [{ type: 'text', text:
        `아직 이 상황의 속마음이 없어요. 당신이 처음 남겨보실래요? (write_confession)\n"당신만 그런 거 아니에요" — 다음 사람에게 힘이 됩니다.` }] };
    }
    return { content: [{ type: 'text', text:
      `💬 ${EVENT_KO[eventType]}${relation ? ` · ${RELATION_KO[relation]}` : ''} — 다들 이런 마음이었어요\n\n`
      + list.map((v) => `"${v.text}"\n   — 익명 · 공감 ${v.empathy}  (공감하려면 empathize, 부적절하면 report_confession)\n   id: ${v.id}`).join('\n\n')
      + `\n\n혼자 고민한 거 아니에요. 당신 마음도 남겨보세요(write_confession).` }] };
  });

  // Tool 9: 속마음 남기기 (쓰기)
  server.registerTool('write_confession', {
    annotations: annoWrite('내 속마음 익명으로 남기기'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:경조사에서 겪은 고민·경험·속마음을 익명 한 줄로 남깁니다. 이름·연락처는 저장하지 않아요. 당신의 한 줄이 같은 고민을 하는 다음 사람에게 위안이 됩니다. "당신만 그런 거 아니에요."',
    inputSchema: {
      eventType: zEvent.describe('경조사 종류'),
      relation: zRelation.optional().describe('상대와의 관계'),
      text: z.string().describe('한 줄 속마음 (최대 140자, 실명·연락처 금지)'),
    },
  }, async ({ eventType, relation, text }) => {
    const res = addConfession({ eventType, relation, text });
    if (!res.ok) return { content: [{ type: 'text', text: `❌ ${res.reason}` }] };
    return { content: [{ type: 'text', text:
      `✅ 속마음을 남겼어요. 같은 고민을 하는 누군가에게 분명 힘이 될 거예요. 고맙습니다 🌿` }] };
  });

  // Tool 10: 공감/신고
  server.registerTool('react_confession', {
    annotations: annoWrite('공감하거나 신고하기'),
    description: '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티:익명 속마음에 공감(👍)을 누르거나, 부적절한 글을 신고합니다. 공감이 많은 글이 위로 올라가고, 신고가 쌓이면 숨겨집니다.',
    inputSchema: {
      id: z.string().describe('속마음 id (read_confessions에서 확인)'),
      action: z.enum(['empathize', 'report']).describe('공감/신고'),
    },
  }, async ({ id, action }) => {
    if (action === 'empathize') {
      const n = empathize(id);
      return { content: [{ type: 'text', text: `👍 공감했어요. (총 ${n})` }] };
    }
    const r = reportConfession(id);
    return { content: [{ type: 'text', text:
      r.hidden ? '🚫 신고 접수됐고, 이 글은 숨겨졌어요.' : '🚩 신고 접수됐어요. 검토할게요.' }] };
  });
}
