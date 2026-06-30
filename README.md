# Biero

> **B.I.E.R.O** — **B**ehavioral **I**ntelligence for **E**valuating **R**isk & **O**ptimization
>
> 리스크 평가 및 최적화를 위한 **행동 지능 비서**

**Biero**는 주식 투자를 위한 AI 비서입니다. 시장의 행동(behavior)을 읽고, 리스크를 평가하며, 포트폴리오와 의사결정을 최적화하도록 돕습니다.

터미널에서 동작하는 CLI 비서로, 어떤 LLM 공급자든 연결해 쓰고, 토스증권 Open API로 실제 시세를 조회합니다. 모든 것은 사용자 PC에서 로컬로 실행됩니다.

---

## 요구사항 (Requirements)

- **Node.js 18 이상**
- **LLM 공급자 API Key** (OpenAI · OpenRouter · Google Gemini · Groq · xAI · DeepSeek · Mistral · Anthropic · Ollama(로컬) · 직접 입력)
- **토스증권 Open API 키** — `API Key`(tsck_live_…)와 `Secret Key`(tssk_live_…)
  - 발급: 토스증권 WTS 로그인 → 설정 → Open API ([가이드](https://developers.tossinvest.com/docs))
  - 발급 화면의 **허용 IP**에 현재 PC의 공인 IP가 포함돼 있어야 합니다.

## 설치 (Install)

```bash
git clone https://github.com/my-gumi/biero
cd biero
npm install
npm link        # 전역 `biero` 명령 등록 (또는: npm install -g .)
```

## 빠른 시작 (Quickstart)

```bash
biero
```

처음 실행하면 설정 위저드가 열립니다:

1. **LLM 공급자 선택** → API Key 입력 (자동으로 연결 확인) → 모델 선택
2. **토스 API Key / Secret Key 입력** → OAuth 토큰 발급으로 자동 검증
3. `~/.biero/config.json`에 저장 (파일 권한 `600`) → 바로 대화 시작

대화창에서 시세를 물어보세요:

```text
나: 삼성전자 얼마야?
Biero: 삼성전자(005930) 현재가는 333,500원이에요. …
```

설정이 끝난 뒤에는 `biero`만 입력하면 바로 대화가 열립니다.

## 명령어 (Commands)

| 명령 | 설명 |
| --- | --- |
| `biero` | 설정돼 있으면 대화, 아니면 설정 위저드 |
| `biero chat` | AI 비서와 대화 (LLM에 바로 요청·응답, 시세 도구 사용) |
| `biero setup` | LLM 공급자 · 토스 API 키 설정 (대화형) |
| `biero config` | 현재 설정 보기 (키는 마스킹) |
| `biero reset` | 저장된 설정 삭제 |
| `biero --help` | 도움말 |

> 전역 등록 없이 실행하려면: `node bin/biero.js <command>` 또는 `npm start`.

## 보안 (Security)

- 모든 키는 **사용자 PC(`~/.biero/config.json`, 권한 600)** 에만 저장됩니다.
- 키는 검증·사용할 때만 사용자가 고른 공급자(LLM·토스)와 **직접** 통신하며, 별도의 Biero 서버를 거치지 않습니다.

## 상태 (Status)

초기 개발 단계입니다. 현재는 **설정 → 대화 → 시세 조회**까지 동작합니다. (잔고·매수가능금액·주문 연동은 예정)
