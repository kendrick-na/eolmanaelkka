// 봉투 문구 + 조문/축하 멘트 (종교·관계·경조사유형별)
// ⚠️ 표준 표기 근거: 성균관 의례·장례지도사 통용 표기(부의/근조/謹弔, 祝結婚 등).
//    데이터 없는 조합은 무난값으로 폴백(종교 모르면 賻儀).

import type { EventType, Relation, Religion, EnvelopeResult } from './types.js';

/** 경조사·종교별 봉투 앞면 문구 */
function frontText(event: EventType, religion: Religion): { hanja: string; ko: string } {
  if (event === 'funeral') {
    switch (religion) {
      case 'christian': return { hanja: '謹弔', ko: '삼가 고인의 평안을 빕니다 (기독교: 弔意/근조)' };
      case 'catholic':  return { hanja: '謹弔', ko: '삼가 조의를 표합니다 (천주교: 연미사 봉헌도 가능)' };
      case 'buddhist':  return { hanja: '賻儀', ko: '삼가 극락왕생을 빕니다 (불교)' };
      default:          return { hanja: '賻儀', ko: '부의 — 종교 무관 가장 무난' };
    }
  }
  if (event === 'wedding')        return { hanja: '祝 結婚', ko: '축 결혼' };
  if (event === 'first_birthday') return { hanja: '祝 生日', ko: '축 돌 (첫 생일)' };
  if (event === 'sixtieth')       return { hanja: '祝 壽宴', ko: '축 수연 (회갑·칠순)' };
  return { hanja: '祝 發展', ko: '축 발전 (개업·집들이)' };
}

/** 축하/조문 멘트 3안 (격식/보통/친근) */
function makeMessages(
  event: EventType, relation: Relation,
): EnvelopeResult['messages'] {
  if (event === 'funeral') {
    return {
      formal: '삼가 조의를 표합니다. 고인의 명복을 빕니다.',
      normal: '갑작스러운 비보에 마음이 무겁습니다. 삼가 고인의 명복을 빕니다.',
      warm:   '얼마나 힘드실지 감히 헤아릴 수 없습니다. 곁에서 함께하겠습니다.',
    };
  }
  if (event === 'wedding') {
    const casual = relation === 'close_friend' || relation === 'friend' || relation === 'junior';
    return {
      formal: '두 분의 결혼을 진심으로 축하드립니다. 늘 행복하시길 바랍니다.',
      normal: '결혼 축하해요! 두 분 오래오래 행복하세요.',
      warm:   casual
        ? '드디어 결혼이네! 진심으로 축하하고, 꽃길만 걷자 💐'
        : '결혼 진심으로 축하드립니다. 두 분 앞날에 좋은 일만 가득하길요.',
    };
  }
  if (event === 'first_birthday') {
    return {
      formal: '아이의 첫 생일을 진심으로 축하드립니다. 건강하게 자라길 바랍니다.',
      normal: '돌 축하해요! 아이가 건강하고 밝게 자라길 바랄게요.',
      warm:   '우리 아기 벌써 돌이라니! 건강하게만 자라다오 🎂',
    };
  }
  if (event === 'sixtieth') {
    return {
      formal: '만수무강하시길 진심으로 기원합니다.',
      normal: '건강하게 오래오래 함께해 주세요. 축하드립니다.',
      warm:   '늘 건강하시고 좋은 일만 가득하시길 바랍니다!',
    };
  }
  return {
    formal: '새로운 시작을 진심으로 축하드립니다. 번창하시길 바랍니다.',
    normal: '오픈 축하해요! 대박 나시길 바랍니다.',
    warm:   '드디어 시작이네요! 잘 될 거예요, 축하합니다 🎉',
  };
}

/** 봉투 이름 표기 규칙 */
function nameRule(event: EventType): string {
  if (event === 'funeral') {
    return '봉투 뒷면 왼쪽 하단에 소속·이름을 세로로. 직함 없이 성명만 쓰는 게 정중합니다.';
  }
  return '봉투 뒷면 왼쪽에 소속·이름을 세로로. 신권을 준비하면 더 정성스럽습니다.';
}

/** 예법 팁 (장례만) */
function etiquette(event: EventType): string | undefined {
  if (event === 'funeral') {
    return '조문 예법: 빈소에서 분향·헌화 후 영정에 두 번 절, 상주와 맞절 한 번. 복장은 어두운 색. 말은 아끼는 것이 예의입니다.';
  }
  return undefined;
}

export function makeEnvelope(
  event: EventType, religion: Religion, relation: Relation,
): EnvelopeResult {
  const f = frontText(event, religion);
  return {
    front: f.hanja,
    frontKo: f.ko,
    nameRule: nameRule(event),
    messages: makeMessages(event, relation),
    etiquette: etiquette(event),
  };
}
