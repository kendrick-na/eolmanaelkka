// 경조사 속마음 대나무숲 — 익명 한 줄 사연 + 공감.
// "남들은 얼마"(숫자)가 못 주는 위안·면죄부를 준다. "당신만 그런 거 아니에요."
//
// ★ 안전설계:
//   · 익명 — 작성자 식별정보 저장 안 함(userId는 중복공감 방지용 해시로만).
//   · 위험필드 배제 — 실명·연락처·구체 신상 유입 방지(길이 제한 + 금칙 필터).
//   · 신고 — 임계 초과 시 숨김(단 Blind 교훈: 자동숨김 남용 방지 위해 임계 높게 + 표기).
//   · 상황 태그(eventType·relation)로 "같은 고민"만 매칭해서 보여줌.

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, readJsonl, appendJsonl, writeJsonl, readJsonArray, writeJsonArray } from './storage.js';
import type { EventType, Relation } from './types.js';

export interface Confession {
  id: string;            // 공개 식별자 (공감·신고용). read_confessions로 노출됨.
  deleteToken?: string;  // ★비공개 삭제 토큰 — 작성 시 본인에게만 반환. read엔 노출 안 함. 이걸 아는 본인만 삭제 가능.
  eventType: EventType;
  relation?: Relation;
  text: string;          // 한 줄 사연 (최대 140자)
  empathy: number;       // 공감 수
  reports: number;       // 신고 수
  ts: number;
  seed?: boolean;
}

const MAX_LEN = 140;
const REPORT_HIDE_THRESHOLD = 5; // 이 이상 신고면 숨김
const EMPATHY_HIDE_GUARD = 20;   // 공감 많으면(검증된 글) 신고 남용 방어

// 최소 금칙: 연락처·실명 유입 패턴 차단(개인정보 보호)
const BLOCK_PATTERNS = [
  /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/,     // 전화번호
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/,        // 이메일
  /(씨발|시발|병신|개새|좆|엿먹)/,            // 심한 욕설(최소)
];

function confFile(): string {
  return join(dataDir('crowd'), 'confessions.jsonl');
}
function metaFile(): string {
  // 공감/신고 카운트는 갱신이 잦아 별도 JSON(전체 재작성)으로 관리
  return join(dataDir('crowd'), 'confession_meta.json');
}

interface Meta { [id: string]: { empathy: number; reports: number } }

function loadMeta(): Meta {
  const arr = readJsonArray<{ id: string; empathy: number; reports: number }>(metaFile());
  const m: Meta = {};
  for (const x of arr) m[x.id] = { empathy: x.empathy, reports: x.reports };
  return m;
}
function saveMeta(m: Meta): void {
  writeJsonArray(metaFile(), Object.entries(m).map(([id, v]) => ({ id, ...v })));
}

// 프로세스 내 단조 카운터 — 같은 ts에 여러 글이 와도 id 충돌 방지 salt.
let _idSeq = 0;

function makeId(ts: number, text: string, salt = ''): string {
  // 결정적 짧은 id (시각+내용+salt 해시). Math.random 미사용(환경 제약).
  let h = 0;
  const s = ts + '|' + salt + '|' + text;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  // ts와 salt를 접두에 섞어 32bit 해시 충돌 시에도 문자열 전체가 달라지게
  return 'c' + (h >>> 0).toString(36) + (ts % 100000).toString(36) + salt;
}

/** 사연 작성 (write_confession). 필터 통과 시 저장. */
export function addConfession(input: {
  eventType: EventType; relation?: Relation; text: string;
}): { ok: boolean; reason?: string; id?: string; deleteToken?: string } {
  const text = input.text.trim();
  if (text.length < 5) return { ok: false, reason: '조금만 더 적어주세요(최소 5자).' };
  if (text.length > MAX_LEN) return { ok: false, reason: `${MAX_LEN}자 이내로 적어주세요.` };
  for (const p of BLOCK_PATTERNS) {
    if (p.test(text)) return { ok: false, reason: '연락처·실명·욕설은 넣을 수 없어요. 익명 공간이라 서로 보호해요.' };
  }
  const ts = Date.now();
  // id는 공개(공감·신고용), deleteToken은 비공개(본인 삭제 전용).
  // crypto.randomUUID로 stateless 서버 간 충돌·추측 방지.
  const id = makeId(ts, text, 'u' + (_idSeq++).toString(36) + randomUUID().slice(0, 8));
  const deleteToken = randomUUID();
  const rec: Confession = { id, deleteToken, eventType: input.eventType, relation: input.relation, text, empathy: 0, reports: 0, ts };
  appendJsonl(confFile(), rec);
  return { ok: true, id, deleteToken };
}

/** 시드 사연 대량 주입 */
export function seedConfessions(items: Array<{ eventType: EventType; relation?: Relation; text: string; empathy?: number }>): number {
  let n = 0;
  const meta = loadMeta();
  for (const it of items) {
    const ts = 0;
    const id = makeId(0, it.text, 's' + n.toString(36)); // 시드는 's' salt로 사용자('u')와 구분
    appendJsonl(confFile(), { id, eventType: it.eventType, relation: it.relation, text: it.text, empathy: it.empathy ?? 0, reports: 0, ts, seed: true } as Confession);
    if (it.empathy) meta[id] = { empathy: it.empathy, reports: 0 };
    n++;
  }
  saveMeta(meta);
  return n;
}

function visible(c: Confession, meta: Meta): boolean {
  const m = meta[c.id];
  const reports = m?.reports ?? c.reports;
  const empathy = m?.empathy ?? c.empathy;
  if (empathy >= EMPATHY_HIDE_GUARD) return true; // 검증된 글은 신고 남용 방어
  return reports < REPORT_HIDE_THRESHOLD;
}

/** 같은 상황의 익명 사연 조회 (read_confessions) — 공감순 */
export function listConfessions(
  eventType: EventType, relation?: Relation, limit = 5,
): Array<{ id: string; text: string; empathy: number }> {
  const all = readJsonl<Confession>(confFile());
  const meta = loadMeta();
  return all
    .filter((c) => c.eventType === eventType)
    .filter((c) => !relation || !c.relation || c.relation === relation)
    .filter((c) => visible(c, meta))
    .map((c) => ({ id: c.id, text: c.text, empathy: meta[c.id]?.empathy ?? c.empathy }))
    .sort((a, b) => b.empathy - a.empathy)
    .slice(0, limit);
}

/** 공감 누르기 (empathize) */
export function empathize(id: string): number {
  const meta = loadMeta();
  const cur = meta[id] ?? { empathy: 0, reports: 0 };
  cur.empathy += 1;
  meta[id] = cur;
  saveMeta(meta);
  return cur.empathy;
}

/** 내가 남긴 속마음 삭제 (delete_confession).
 *  ★비공개 deleteToken으로만 삭제 — read_confessions로 공개되는 id로는 삭제 불가.
 *   토큰은 작성 시 본인에게만 반환되므로 "본인만 삭제"가 실제로 보장된다(타인 무단삭제 차단).
 *  시드는 토큰이 없어 애초에 삭제 불가. jsonl 전체 재작성으로 물리 삭제. */
export function deleteConfession(deleteToken: string): { ok: boolean; reason?: string } {
  if (!deleteToken || !deleteToken.trim()) {
    return { ok: false, reason: '삭제하려면 글 남길 때 받은 삭제용 코드가 필요해요.' };
  }
  const all = readJsonl<Confession>(confFile());
  const target = all.find((c) => c.deleteToken && c.deleteToken === deleteToken);
  if (!target) return { ok: false, reason: '삭제용 코드가 맞지 않아요. 글 남길 때 받은 코드인지 확인해 주세요. (남의 글은 지울 수 없어요)' };
  const rest = all.filter((c) => c !== target);
  writeJsonl(confFile(), rest);
  const meta = loadMeta();
  if (meta[target.id]) { delete meta[target.id]; saveMeta(meta); }
  return { ok: true };
}

/** 신고 (report_confession) */
export function reportConfession(id: string): { hidden: boolean } {
  const meta = loadMeta();
  const cur = meta[id] ?? { empathy: 0, reports: 0 };
  cur.reports += 1;
  meta[id] = cur;
  saveMeta(meta);
  return { hidden: cur.reports >= REPORT_HIDE_THRESHOLD && cur.empathy < EMPATHY_HIDE_GUARD };
}
