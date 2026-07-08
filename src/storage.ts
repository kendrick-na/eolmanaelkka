// 저장 추상화 레이어 — 런타임 쓰기(관계원장·익명 크라우드소싱)용.
//
// 왜 추상화하나:
//   · PlayMCP는 원격 MCP 서버 URL만 등록 → 서버·DB는 개발자 인프라.
//   · Stateless-compute + 외부 영속 스토리지가 표준 패턴(서버리스면 로컬파일·인메모리 유실).
//   · 지금(개발·심사): 파일 구현으로 셋업 0·비용 0. 카카오 배포 컨테이너가 warm이면 재배포 전까지 유지.
//   · 나중(실서비스): SupabaseStore 등 구현체만 갈아끼우면 됨(이 인터페이스 유지).
//
// ⚠️ 파일 구현은 append/read만 — 동시 쓰기 경합은 데모 규모에선 무시 가능.
//    실서비스 대규모 동시쓰기가 필요해지면 Store를 DB 구현으로 교체.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 프로젝트 루트의 data/ 경로 (tsx·빌드 양쪽 대응) */
export function dataDir(sub: string): string {
  const candidates = [
    join(__dirname, '..', 'data', sub),        // tsx: src/ → 루트/data
    join(__dirname, '..', '..', 'data', sub),  // 빌드: dist/src/ → 루트/data
  ];
  const found = candidates.find((p) => existsSync(dirname(dirname(p))) || existsSync(dirname(p)));
  const dir = found ?? candidates[0];
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** JSON 배열 파일 읽기 (없으면 []) */
export function readJsonArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T[];
  } catch {
    return [];
  }
}

/** JSON 배열 파일 통째 쓰기 */
export function writeJsonArray<T>(path: string, arr: T[]): void {
  writeFileSync(path, JSON.stringify(arr, null, 2), 'utf-8');
}

/** JSONL(라인당 1레코드) append — 대량 크라우드 제출에 유리(전체 재작성 불필요) */
export function appendJsonl<T>(path: string, record: T): void {
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8');
}

/** JSONL 전체 재작성 (삭제·수정용 — 본인 데이터 관리에 필요) */
export function writeJsonl<T>(path: string, records: T[]): void {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf-8');
}

/** JSONL 전체 로드 */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}
