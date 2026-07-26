# TranslationChat

**Google Gemini** 기반의 실시간 다국어 채팅입니다.

각자 사용 언어를 설정한 뒤 모국어로 대화하고, 다른 사람의 메시지는 내 언어로 번역해 볼 수 있습니다. 공통어를 강제하지 않아도 섞인 언어 그룹에서 소통하기 쉽습니다.

**라이브 데모:** [https://translationchat.onrender.com](https://translationchat.onrender.com)  
*(Render 무료 플랜은 일정 시간 미사용 시 슬립하며, 첫 접속에 약 1분 정도 걸릴 수 있습니다.)*

---

## 주요 기능

- **실시간 공유 피드** — Server-Sent Events(SSE)로 새 메시지를 모든 클라이언트에 즉시 전달
- **사용자별 번역 언어** — 프로필 locale이 Gemini 번역 목표 언어로 사용됨
- **자동 번역** — 보이는 메시지를 일괄 번역하거나, 말풍선마다 개별 번역
- **서버 번역 캐시** — 한 번 번역된 메시지·언어 조합은 이후 사용자가 Gemini 없이 재사용. 메시지가 피드에서 밀리면 번역도 함께 삭제
- **휘발성 채팅방** — 메시지는 프로세스 메모리에만 보관(재시작 시 초기화). 프로필·파일 메타데이터는 SQLite에 저장
- **파일 첨부** — 피드에 파일 업로드·공유
- **단일 서비스 배포** — Fastify가 API와 정적 UI를 함께 제공 (Render 배포에 적합)

---

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| 런타임 | Node.js 22.5+ (`node:sqlite`) |
| 서버 | Fastify 5, 쿠키, multipart, static |
| AI | Google Gemini (`@google/genai`) |
| 데이터 | 인메모리 메시지 저장소 + SQLite (사용자 / 파일) |
| 프론트엔드 | Vanilla HTML / CSS / JS (SPA 프레임워크 없음) |
| 배포 | Render Blueprint (`render.yaml`), Docker 선택 가능 |

---

## 번역 동작 방식

```
클라이언트                 서버                            Gemini
  |  POST /api/translate     |                              |
  |------------------------->|  캐시 적중? ----------------->| (호출 생략)
  |                          |  미스 → generateContent ---->|
  |                          |<----- 번역문 -----------------|
  |                          |  메모리 캐시에 저장            |
  |<---- translatedText -----|                              |
```

- 캐시 키: **메시지 ID + 목표 언어**
- 인메모리 피드에서 오래된 메시지가 삭제되면(최대 100개) 해당 번역도 함께 제거
- 피드 응답에 이미 알고 있는 번역을 실어 보내, 클라이언트가 불필요한 요청을 줄임

---

## 로컬에서 실행하기

**필요 환경:** Node.js **≥ 22.5**, [Google AI Studio](https://aistudio.google.com/apikey) API 키

```bash
git clone https://github.com/buc89l2nb41/TranslationChat.git
cd TranslationChat
cp .env.example .env
# GEMINI_API_KEY 설정 (선택: GEMINI_MODEL=gemini-2.5-flash)
npm install
npm start
```

`.env`의 `PORT`(기본 80)에 맞게 `http://localhost` 등으로 접속합니다.

개발 시 자동 재시작:

```bash
npm run dev
```

---

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` | 예 | Google Gemini API 키 |
| `GEMINI_MODEL` | 아니오 | 기본값 `gemini-2.5-flash` |
| `PORT` / `HOST` | 아니오 | 로컬 바인딩 (Render에서는 `PORT`를 설정하지 않음) |
| `FEED_DISPLAY_LIMIT` | 아니오 | 표시 메시지 상한 (기본 50) |
| `TRANSLATE_CONCURRENCY` | 아니오 | 배치당 병렬 Gemini 호출 수 (기본 4) |
| `TRANSLATE_BATCH_MAX` | 아니오 | 배치 요청당 최대 메시지 ID 수 (기본 50) |
| `TRANS_TONE` / `TRANS_DOMAIN` | 아니오 | 프롬프트 톤·도메인 힌트 (선택) |
| `COOKIE_SECRET` | 운영 권장 | 세션 쿠키 서명용 시크릿 |

전체 예시는 `.env.example`을 참고하세요.

---

## Render에 배포하기

1. [Render](https://render.com)에서 이 저장소를 연결합니다 (Blueprint는 `render.yaml` 사용, 또는 Node Web Service를 직접 생성).
2. Environment에 **`GEMINI_API_KEY`** 를 설정합니다 (Blueprint는 이 값을 수동 입력하도록 둡니다).
3. **`NODE_VERSION=22.13.0`** 이상을 권장합니다. 시작 명령은 `npm start`입니다 (`--experimental-sqlite` 포함).
4. `https://<서비스명>.onrender.com` 으로 접속합니다.

---

## 프로젝트 구조

```
TranslationChat/
├── public/              # UI (index, app.js, styles)
├── server/
│   ├── index.js         # Fastify 부트스트랩
│   ├── messageStore.js  # 인메모리 피드 + 번역 캐시
│   ├── db.js            # SQLite (사용자, 파일)
│   ├── adapter/         # Gemini (+ HTTP/stub 어댑터)
│   └── routes/          # REST + SSE + 파일 다운로드
├── render.yaml          # Render Blueprint
└── Dockerfile           # 컨테이너 배포 (선택)
```

---

## 설계 의도

- **프로세스 하나, URL 하나** — 프론트/API 분리로 생기는 CORS·쿠키 문제를 피함
- **휘발성 채팅** — 데모용 채팅방: 장기 메시지 이력 없음, 저장·개인정보 부담 축소
- **채팅·번역은 서버 메모리에만** — 방이 살아있는 동안 Gemini 재호출을 줄이고, 재시작 시 둘 다 초기화 (디스크/DB에는 안 남김)
- **쿠키 기반 익명 사용자** — 복잡한 인증 없이 표시 이름·언어를 SQLite에 유지
