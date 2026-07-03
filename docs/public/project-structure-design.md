# 프로젝트 구조 설계 문서

## 목적

이 문서는 `biero` 프로젝트의 전체 구조를 장기 관점에서 정리한 기준 문서다.

이 문서의 목적은 단순히 현재 파일을 재배치하는 것이 아니라, 앞으로 기능이 늘어나더라도 아래 조건을 만족하는 구조를 만드는 것이다.

- 기능 축이 커져도 파일 책임이 무너지지 않을 것
- 외부 서비스 연동이 늘어나도 런타임 로직과 섞이지 않을 것
- 설정, 세션, 타입, 도구 정의가 각자 자연스러운 위치를 가질 것
- 구조 개편이 기능 구현을 방해하지 않을 것

## 설계 원칙

프로젝트 구조는 아래 원칙을 따른다.

### 1. 기능보다 먼저 책임을 나눈다

파일과 폴더는 "무슨 기능을 처리하는가"보다 "어떤 책임을 가지는가" 기준으로 나눈다.

예:

- 사용자 입력과 CLI 흐름
- 외부 API 호출
- 도메인 규칙
- 공통 설정과 타입
- 메시지 전달 및 세션 관리

### 2. 외부 연동과 내부 런타임을 분리한다

LLM, Toss, Telegram, Discord 같은 외부 시스템 연동은 언제든 바뀔 수 있다.

반면 아래는 프로젝트 내부의 핵심 로직이다.

- 대화 흐름
- 세션 유지
- 설정 저장
- 도구 호출 orchestration

이 둘은 같은 폴더에서 커지기 시작하면 유지보수가 어려워진다.

### 3. 얇은 추상화보다 점진적 분리를 택한다

처음부터 깊은 폴더 구조를 만드는 대신:

1. 파일 단위 분리
2. 책임 경계 고정
3. 이후 필요할 때 폴더 단위 분리

순으로 확장한다.

### 4. 구조 개편 커밋은 기능 변경과 분리한다

구조 개편은 가능한 한 아래만 포함한다.

- 파일 이동
- 이름 변경
- import 경로 수정
- 동작 변화 없음

그래야 기능 버그와 리팩터링 버그를 분리해서 볼 수 있다.

## 현재 구조 요약

현재 프로젝트는 대략 아래 구조를 가지고 있다.

```text
bin/
  biero.ts

docs/
  img/
  issue/
  public/

src/
  agent.ts
  chat.ts
  config.ts
  llm.ts
  providers.ts
  setup.ts
  theme.ts
  tools.ts
  toss.ts
  types.ts
  gateway/
    authz.ts
    commands.ts
    config.ts
    core.ts
    run.ts
    session.ts
    setup.ts
    platforms/
```

## 현재 구조의 장점

- 프로젝트 규모가 아직 크지 않아 탐색이 쉽다
- CLI 진입점이 단순하다
- `gateway/`는 이미 독립된 기능 묶음으로 분리돼 있다

## 현재 구조의 한계

### 1. 루트 레벨 파일의 책임이 너무 넓다

현재 `src` 루트에는 아래 성격이 함께 섞여 있다.

- 대화 런타임
- 외부 API 연동
- 설정 저장
- 화면 출력
- 타입 정의

이 구조는 초반에는 빠르지만, 기능이 늘수록 특정 파일에 책임이 몰린다.

### 2. Toss 확장에 취약하다

현재 구조에서는 Toss 관련 기능이 사실상 아래 세 파일로 수렴한다.

- `src/toss.ts`
- `src/tools.ts`
- `src/setup.ts`

계좌, 주문, 시세, 레이트리밋, 인증, 에러 처리까지 모두 이 축에 쌓이기 시작하면 분리 비용이 급격히 커진다.

### 3. 대화 런타임 확장에 취약하다

앞으로 스트리밍, provider별 tool use, 세션 저장, 히스토리 관리가 붙으면 아래 경계가 중요해진다.

- 대화 orchestration
- provider adapter
- 세션 저장
- tool registry

현재는 이 경계가 코드상 명확하지 않다.

### 4. 공통 타입이 비대해질 가능성이 높다

현재 `types.ts`는 다음을 함께 가지고 있다.

- 앱 설정
- gateway 타입
- 채팅 메시지 타입

기능이 늘어나면 도메인별 타입과 공통 타입을 구분할 필요가 생긴다.

## 목표 구조

장기적으로 지향하는 구조는 아래와 같다.

```text
src/
  app/
    cli/
    commands/

  runtime/
    agent/
    conversation/

  integrations/
    llm/
    toss/
    messaging/

  tools/

  shared/
    config/
    ui/
    utils/
    types/
```

이 구조는 "계층"보다 "역할 묶음"에 가깝다.

## 각 영역의 역할

### `app/`

사용자가 직접 만나는 흐름을 담당한다.

예:

- CLI 명령 라우팅
- setup 진입점
- status 출력
- 명령별 orchestration

이곳은 비즈니스 로직을 깊게 들고 있기보다, 실행 순서를 조합하는 역할에 가깝다.

### `runtime/`

앱 내부 동작의 핵심 흐름을 담당한다.

예:

- 에이전트 실행
- 대화 흐름 관리
- 세션 유지
- 히스토리 관리
- 스트리밍 출력 제어

즉, "우리 프로그램이 어떻게 작동하는가"를 담는 곳이다.

### `integrations/`

외부 시스템과 직접 통신하는 모듈을 담당한다.

예:

- OpenAI/Anthropic/Ollama 같은 LLM provider
- Toss Open API
- Telegram/Discord SDK

이 계층의 목표는 외부 서비스 차이를 내부 코드에 덜 퍼지게 만드는 것이다.

### `tools/`

LLM 또는 런타임이 호출하는 도구 정의와 실행을 담당한다.

예:

- tool registry
- tool schema
- Toss 기반 도구 handler

기능이 늘어날수록 `tools.ts` 단일 파일보다는 registry와 handler 분리가 중요해진다.

### `shared/`

여러 영역이 함께 쓰는 공통 요소를 담당한다.

예:

- config load/save
- 공통 타입
- 출력 theme
- mask, time 같은 범용 유틸

단, 도메인 전용 타입까지 모두 여기에 넣지는 않는다.

## 지금 시점의 현실적인 구조

장기 목표 구조는 위와 같지만, 지금 바로 전부 도입하는 것은 과할 수 있다.

현재 프로젝트 규모와 코드 양을 고려하면, 1차 구조 개편은 아래 수준이 적절하다.

```text
src/
  runtime/
    agent.ts
    chat.ts

  llm/
    client.ts
    providers.ts

  toss/
    client.ts

  gateway/
    authz.ts
    commands.ts
    config.ts
    core.ts
    run.ts
    session.ts
    setup.ts
    platforms/

  app/
    setup.ts
    status.ts

  tools/
    registry.ts

  shared/
    config.ts
    theme.ts
    types.ts
```

이 구조가 적절한 이유는 다음과 같다.

- 현재 코드 양에 비해 과하지 않다
- 가장 빨리 복잡해질 `Toss` 축을 먼저 분리할 수 있다
- `gateway`는 현재 구조를 크게 흔들지 않고 유지할 수 있다
- LLM과 runtime 경계를 1차적으로 확보할 수 있다
- 이후 필요하면 더 깊은 구조로 자연스럽게 진화할 수 있다

## 1차 구조 개편 범위

구조 개편 선행 커밋은 아래 수준으로 제한한다.

### 이동 대상

- `src/agent.ts` -> `src/runtime/agent.ts`
- `src/chat.ts` -> `src/runtime/chat.ts`
- `src/llm.ts` -> `src/llm/client.ts`
- `src/providers.ts` -> `src/llm/providers.ts`
- `src/toss.ts` -> `src/toss/client.ts`
- `src/setup.ts` -> `src/app/setup.ts`
- `src/config.ts` -> `src/shared/config.ts`
- `src/theme.ts` -> `src/shared/theme.ts`
- `src/types.ts` -> `src/shared/types.ts`
- `src/tools.ts` -> `src/tools/registry.ts`

### 유지 대상

- `src/gateway/**`는 우선 유지
- `bin/biero.ts`는 새 경로만 반영

### 아직 하지 않을 것

- `toss/accounts.ts`, `toss/orders.ts`, `toss/market.ts` 같은 세부 파일 분리
- `runtime/conversation/` 같은 세션 전용 계층 도입
- `integrations/messaging/`로 `gateway`를 다시 해체하는 작업
- 최종형 `app / runtime / integrations / tools / shared`의 세부 하위 폴더 완성

## 구조 진화 방향

1차 구조 개편 이후에는 기능 증가에 따라 아래 순서로 진화한다.

### 2차

- Toss 내부 세부 파일 분리
- 예: `accounts.ts`, `holdings.ts`, `orders.ts`, `market.ts`

### 3차

- 대화 세션/히스토리/스트리밍을 runtime 내부에서 분리

### 4차

- provider별 LLM adapter 세분화
- 예: `openai-compatible.ts`, `anthropic.ts`

### 5차

- 필요 시 폴더 단위 분리
- 예: `toss/accounts/`, `toss/orders/`

즉, 안전한 순서는 아래다.

1. 책임 분리
2. 파일 분리
3. 기능 성장 확인
4. 필요 시 폴더 분리

## 설계 판단의 핵심

이번 구조 설계에서 가장 중요한 판단은 아래 세 가지다.

### 1. 구조는 미래를 대비해야 하지만 미래를 과하게 선반영하면 안 된다

지금 필요한 건 최종형 아키텍처 완성이 아니라, 앞으로 커질 부분이 무너지지 않게 받쳐줄 구조다.

### 2. 가장 먼저 보호해야 할 축은 Toss다

현재 기능 확장 가능성을 보면, 가장 빨리 비대해질 곳은 Toss 연동이다.

따라서 구조 개편도 Toss 축을 중심으로 시작하는 것이 가장 효율적이다.

### 3. 구조 개편은 기능 구현을 위한 준비 작업이어야 한다

구조 개편 자체가 목적이 되면 안 된다.

구조 개편의 목적은:

- 이후 기능 구현 속도를 유지하고
- 파일 책임을 선명하게 만들고
- 리뷰와 디버깅 비용을 낮추는 것

이다.

## 최종 정리

현재 프로젝트에 가장 적절한 구조 전략은 아래와 같다.

1. 장기 목표 구조는 문서 기준으로 유지한다
2. 실제 1차 리팩터링은 중간 단계 구조까지만 진행한다
3. 구조 개편 커밋은 동작 없는 이동 중심으로 만든다
4. 이후 기능 확장에 따라 Toss, runtime, llm 순으로 점진 분리한다

한 줄로 요약하면:

**지금은 전체 구조를 완성하는 것보다, 확장 시 가장 먼저 무너질 축을 안전하게 분리하는 구조를 만드는 것이 더 중요하다.**
