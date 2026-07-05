// .env 로더 — 다른 어떤 모듈보다 먼저 import 되어야 함 (side-effect only).
// Node 20.6+ 네이티브 process.loadEnvFile 사용 (의존성 0).
// ⚠️ 얼마낼까는 런타임 필수 키가 없다(천문연 API는 무키 or 선택). 그래도 향후
//    키(천문연 SERVICE_KEY 등) 붙일 때를 위해 세금맛집과 동일 패턴 유지.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const candidates = [
  join(__dirname, '..', '.env'),        // tsx: src/ → 루트
  join(__dirname, '..', '..', '.env'),  // 빌드: dist/src/ → 루트
];

const envPath = candidates.find((p) => existsSync(p));
if (envPath && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    console.error('[env] .env 로드 실패:', (e as Error).message);
  }
}
