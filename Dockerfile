# 얼마낼까 MCP 서버 — 카카오 PlayMCP in KC 배포용 (Git 소스 빌드 방식)
# PlayMCP는 원격 MCP 서버(Streamable HTTP)를 등록 → http 모드로 실행.
#
# ✅ Git 소스 빌드: 카카오 PlayMCP in KC가 이 Dockerfile을 서버(linux/amd64)에서 직접 빌드.
#    내 맥에서 docker build 불필요. GitHub에 올리기만 하면 됨.
# ✅ 런타임 키 불필요: 축의금 통계는 코드 내장 시드로 서버 최초 기동 시 자동 주입.
#    (천문연·카카오 키는 선택 — 손없는날은 자체계산 폴백)
# ⚠️ 크라우드 데이터(익명 제출·속마음)는 컨테이너 로컬 data/에 쌓임. 재배포 시 초기화됨.
#    실서비스로 영속화하려면 src/storage.ts를 외부 DB(Supabase 등) 구현으로 교체.
FROM node:22-slim

WORKDIR /app

# 1) 의존성 설치 (빌드에 typescript 필요)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 2) 소스 복사
COPY . .

# 3) 빌드 후 dev 의존성 제거 (경량화)
RUN npx tsc && npm prune --omit=dev

# 4) HTTP 모드
ENV MODE=http
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
