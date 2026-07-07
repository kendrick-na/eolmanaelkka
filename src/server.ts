// 얼마낼까 MCP 서버 — 카카오 AGENTIC PLAYER 10 출품작
//   [얼마낼까 - 경조사 익명 커뮤니티]
// 두 모드: stdio(로컬 개발) / http(PlayMCP 원격 배포, MODE=http).
// PlayMCP는 원격 MCP(Streamable HTTP·stateless)만 지원 → 배포는 http 모드.

import './env.js'; // ⚠️ 최상단 필수 — 다른 모듈이 process.env 읽기 전에 .env 로드
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { registerTools } from './tools.js';
import { ensureSeed } from './seed.js';

// 서버 소개(instructions) = AI가 이 MCP를 언제·어떻게 쓸지 판단하는 근거.
const SERVER_INSTRUCTIONS =
  '얼마낼까 - 남들은 얼마? 축의금·조의금 익명 커뮤니티(Eolmanaelkka)는 경조사(결혼·장례·돌잔치 등) 축의금·조의금을 도와주는 MCP입니다. ' +
  '핵심은 "남들은 얼마 냈나"입니다: 실제 사람들이 익명으로 등록한 금액을 상황별(관계·연령대·지역)로 집계해 보여주고, ' +
  '같은 고민을 한 사람들의 익명 경험·속마음을 함께 전해 "나만 이런 게 아니구나"를 확인시켜줍니다. ' +
  '다음을 할 수 있습니다: ①남들은 얼마 냈나(익명 통계 중앙값·분포) ②내가 낸 금액 익명 등록 ' +
  '③내 상황에 맞는 적정액 추천(관계·식대·나이·호혜 반영) ④봉투 문구·조문/축하 멘트(종교별) ' +
  '⑤이 경조사 갈까 말까 판단(참석/송금만/생략) ⑥결혼식 날 예식 혼잡도(손없는날) ' +
  '⑦경조사비 기록·미답례 챙김(관계원장) ⑧같은 고민 익명 사연 읽기·남기기·공감. ' +
  '"이 경조사 가야 하나?", "얼마 내지?", "봉투에 뭐라 쓰지?", "남들은 얼마 내?"가 궁금할 때 사용하세요. ' +
  '★데이터 출처: 통계 수치는 지어낸 값이 아니라 신한은행 보통사람 금융생활 보고서 2024(1만 명), ' +
  '카카오페이 축의금 설문 2024(74,652명 투표), 인크루트 경조사비 설문 2023·2025(844명), ' +
  '한국소비자원 예식장 식대 2025 등 공개 통계를 관계·지역·연령대별 익명 표본 분포로 구조화한 것입니다. ' +
  '여기에 이용자의 익명 제출이 실시간으로 누적됩니다. LLM의 웹검색 요약과 달리, 상황별로 쪼갠 분포·중앙값·최빈값을 재현 가능하게 제공합니다.';

function makeServer(): McpServer {
  const server = new McpServer(
    { name: 'eolmanaelkka', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server);
  return server;
}

const MODE = process.env.MODE ?? 'stdio';
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  // 콜드스타트 시드 주입 (최초 1회, 마커로 중복 방지)
  try {
    const s = ensureSeed();
    if (!s.skipped) console.error(`[얼마낼까] 시드 주입: 통계 ${s.records}건 · 속마음 ${s.confessions}건`);
  } catch (e) {
    console.error('[얼마낼까] 시드 주입 건너뜀:', (e as Error).message);
  }

  if (MODE === 'http') {
    // ── PlayMCP 배포용: Streamable HTTP (stateless — no session) ──
    const http = createServer(async (req, res) => {
      if (req.url?.startsWith('/mcp')) {
        try {
          const server = makeServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
          });
          res.on('close', () => { transport.close(); server.close(); });
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (e) {
          console.error('요청 처리 오류:', e);
          if (!res.headersSent) { res.statusCode = 500; res.end('Internal Error'); }
        }
      } else if (req.url === '/health') {
        res.statusCode = 200; res.end('OK');
      } else {
        res.statusCode = 404; res.end('Not Found');
      }
    });
    http.listen(PORT, () => {
      console.error(`[얼마낼까] HTTP MCP 서버 :${PORT}/mcp (PlayMCP 배포용)`);
    });
  } else {
    const server = makeServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[얼마낼까] MCP 서버 시작 (stdio)');
  }
}

main().catch((e) => {
  console.error('얼마낼까 서버 오류:', e);
  process.exit(1);
});
