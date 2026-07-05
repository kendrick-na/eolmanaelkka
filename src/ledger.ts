// 관계원장(元帳) — "내가 이 사람에게 얼마 냈나 / 이 사람이 나에게 얼마 냈나" 누적.
// 얼마낼까의 리텐션 축: 쌓일수록 나만을 위해 정확해지고, 내 데이터는 내 앱에만.
//
// 저장: storage.ts의 파일 헬퍼 사용 (userId별 JSON). 나중에 Supabase로 교체 시 이 파일만 수정.
// userId = 호출자 식별자(카카오 계정 등). 없으면 'guest'.

import { join } from 'node:path';
import { dataDir, readJsonArray, writeJsonArray } from './storage.js';
import type { LedgerEntry } from './types.js';

function userFile(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'guest';
  return join(dataDir('ledger'), `${safe}.json`);
}

/** 사용자 원장 전체 로드 */
export function loadLedger(userId: string): LedgerEntry[] {
  return readJsonArray<LedgerEntry>(userFile(userId));
}

/** 원장에 1건 기록 (record_gift) */
export function addLedgerEntry(userId: string, entry: LedgerEntry): LedgerEntry[] {
  const list = loadLedger(userId);
  list.push(entry);
  writeJsonArray(userFile(userId), list);
  return list;
}

/**
 * 특정 상대가 나에게 냈던 금액을 찾아 호혜 기준을 뽑는다.
 * (이름 부분일치 — "김서연"·"서연" 등 유연 매칭)
 */
export function findReciprocity(userId: string, person: string): number | undefined {
  if (!person) return undefined;
  const list = loadLedger(userId);
  const key = person.replace(/\s/g, '');
  const received = list
    .filter((e) => e.direction === 'received')
    .filter((e) => {
      const p = e.person.replace(/\s/g, '');
      return p.includes(key) || key.includes(p);
    })
    .map((e) => e.amount);
  if (received.length === 0) return undefined;
  return received[received.length - 1]; // 가장 최근 금액
}

/** 시즌 브리핑 — 총액·미답례 집계 */
export function summarizeLedger(userId: string): {
  totalGiven: number;
  totalReceived: number;
  count: number;
  entries: LedgerEntry[];
  unreturned: LedgerEntry[];
} {
  const list = loadLedger(userId);
  const given = list.filter((e) => e.direction === 'given');
  const received = list.filter((e) => e.direction === 'received');
  const totalGiven = given.reduce((s, e) => s + e.amount, 0);
  const totalReceived = received.reduce((s, e) => s + e.amount, 0);

  const givenPeople = new Set(given.map((e) => e.person.replace(/\s/g, '')));
  const unreturned = received.filter((e) => !givenPeople.has(e.person.replace(/\s/g, '')));

  return { totalGiven, totalReceived, count: list.length, entries: list, unreturned };
}
