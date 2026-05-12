# Changelog

[![English](https://img.shields.io/badge/lang-English-blue.svg)](#english)
[![한국어](https://img.shields.io/badge/lang-한국어-red.svg)](#한국어)

---

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-05-12

### Added

- **Insights Pipeline** — CC-faithful 5-stage pipeline (session segmentation → Facet extraction → DataContext assembly → 8-section parallel generation → At a Glance synthesis). See `CLAUDE.md` "Insights Pipeline Workflow" for the full spec.
- **Spec/day session keying** — `(user_id, SPEC, spec_name)` when `active_spec_name` is present, else `(user_id, DAY, YYYY-MM-DD)`. Spec sessions span multiple days; no time-based timeout.
- **Facet aggregation** — `buildFacetAggregates()` produces `top_goals / outcomes / satisfaction / friction / success` numeric rollups from per-session Facet JSONs.
- **DataContext** — new fields `date_range / messages / hours / spec_count / languages`, `top_goals / outcomes / satisfaction / friction / success` (Facet-derived), plus `top_steering_rules / spec_phases` (Kiro-specific).
- **CC-faithful At a Glance** — synthesis now receives the 8 just-produced core section JSONs (`coreResults`) rather than re-reading raw Facets, mirroring the CC insights pipeline. `maxTokens` raised to 8192 for at_a_glance only.
- **`fun_ending`** — `{headline, detail}` memorable qualitative moment from transcripts, not a statistic (CC parity).
- **Labeled At a Glance cards** — 4 cards with headings ("잘 되고 있는 것" / "방해가 되는 것" / "바로 적용해볼 수 있는 것" / "앞으로 시도해볼 워크플로우") replace bare icons.
- **Insights opt-in infra** — `EcsStackProps.insights` (optional) enables prompt-log IAM + env vars only when the feature is configured. Default deployment keeps the aggregate dashboards unchanged.

### Changed

- **Routing turns filter** — Kiro internal `{chat, do, spec}` router tags (pure JSON responses) dropped at ETL; mixed turns (router + real text) preserved. Detection in `prompt_etl.is_routing_turn`.
- **Empty-prompt turns** — routed to `tool_events` table, excluded from Facet input.
- **Facet schema brand alignment** — `claude_helpfulness` → `kiro_helpfulness`, `user_instructions_to_claude` → `user_instructions_to_kiro`.
- **`primary_success` enum trimmed** — removed `fast_accurate_search / correct_code_edits / multi_file_changes` (require tool-invocation evidence, which Kiro raw logs carry in only ~0.2% of turns). Kept: `none / good_explanations / proactive_help / good_debugging`.

### Removed

- **Org-wide sections** — `org_overview / org_model_routing_audit / org_platform_improvements` along with `/insights` (org dashboard) and `/api/insights/org` routes. `/insights` now serves a simple landing page linking to the user list.
- **Dead code** — `lib/insights/facet-extractor.ts` (Python `facet_extractor.py` is the canonical path) and its test file.
- **Sentinel fields** — `hook_active_count / subagent_active_count / power_active_list` removed from `DataContext` (always `'unknown'` in Kiro).

### Fixed

- **React #31 guard** — double defense: prompt-layer `STRICT TYPE REQUIREMENT` directive + UI-layer `renderGlanceField()` coercion. Every at_a_glance value now provably rendered as `string`.

## [1.1.0] - 2026-04-24

### Added

- Lambda@Edge + Cognito PKCE authentication at CloudFront Viewer Request level, replacing NextAuth.js
- Lambda@Edge function with JWT validation (`aws-jwt-verify`), PKCE flow, token refresh, and HttpOnly cookie management
- SSM Parameter Store config loader (us-east-1) for Lambda@Edge with cold-start caching
- CDK `EdgeFunction` construct with esbuild bundling and cross-region deployment to us-east-1
- `AwsCustomResource` for SSM config writes and Cognito callback URL updates post-deploy
- Public Cognito `EdgeAuthClient` (no client secret) for Lambda@Edge PKCE compatibility
- Server-side data masking for all user identifiers via `lib/mask.ts` — first 2 characters shown, rest replaced with `*`
- Logout menu in sidebar with `/auth/logout` link (Lambda@Edge clears cookies and redirects to Cognito logout)
- Model Usage analysis page with AI model distribution pie chart, Auto vs Manual comparison, daily trend, and per-user model preference table
- `/api/model-usage` endpoint reading S3 CSV files directly for dynamic `{Model_name}_Messages` columns (bypasses Glue OpenCSVSerDe positional mapping limitation)
- `overage_cap` field added to `UserReport` TypeScript interface (was in Glue table but missing from types)

### Changed

- CDK infrastructure expanded from 4 to 5 stacks (`KiroDashboardEdgeLambda` auto-created in us-east-1)
- CdnStack rewritten to include Lambda@Edge, SSM config, and Cognito callback URL management
- SecurityStack updated with EdgeAuthClient UserPoolClient
- User identity resolution (`lib/identity.ts`) now returns masked values for displayName, email, username, organization
- All user-facing API routes (users, credits, productivity, user-detail, idc-users) return masked identifiers

### Removed

- NextAuth.js dependency and configuration (`lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`)
- Custom login page (`app/login/page.tsx`) — replaced by Cognito Hosted UI
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET` environment variables

## [1.0.0] - 2026-04-21

### Added

- Full-stack Next.js 14 dashboard with 7 pages: Overview, Users, Trends, Credits, IDE Productivity, Engagement, AI Analysis
- 12 API routes querying Athena (user_report + by_user_analytic tables) with UserId prefix normalization
- AI-powered natural language analysis via Amazon Bedrock Claude Sonnet 4.6 with tool use (query_athena, lookup_users)
- React-markdown + remark-gfm rendering for AI analysis responses with custom dark theme components
- Identity Center integration displaying 45 IdC users with active/inactive status, display names, emails, and organizations
- User detail drill-down panel with daily activity breakdown and client type analysis
- IDE Productivity page using 46-column legacy by_user_analytic report (chat, inline completion, dev agent, code review, test/doc generation)
- Date range filtering with 14 presets: 1m, 5m, 10m, 1h, 3h, 6h, 12h, 1d, 3d, 7d, 14d, 30d, 60d, 90d
- Animated Kiro ghost mascot with page-themed accessories (dashboard grid, user avatars, trend arrows, coins, code terminal, chat bubbles)
- Animated mini Kiro characters as sidebar navigation icons with per-page accent colors
- Korean/English bilingual interface with sidebar language toggle
- Kiro brand identity using official purple (#9046FF) color palette from kiro.dev
- Real Kiro ghost SVG character from img/kiro.svg applied across all components
- AWS CDK infrastructure with 4 stacks: Network (mgmt-vpc), Security (SG, Cognito), ECS (Fargate, ALB, ECR), CDN (CloudFront)
- Docker multi-stage build (node:20-alpine, ARM64) with standalone Next.js output
- ECS Fargate service with Auto Scaling (1-4 tasks, CPU 70% target)
- CloudFront distribution with X-Custom-Secret header validation for ALB security
- Cognito User Pool with Lambda@Edge PKCE authentication
- Client distribution pie chart with real Athena data (KIRO_IDE vs KIRO_CLI)
- Engagement funnel and user segmentation (Power/Active/Light/Idle tiers)
- Metric cards in AWSops dashboard style (semi-transparent dark, hover effects, font-mono values)
- Athena query pagination via NextToken for datasets exceeding 1,000 rows
- Claude Code project structure with hooks, skills, commands, agents, and documentation

### Fixed

- CDK cross-stack dependency cycle resolved by moving IAM roles to EcsStack
- ARM64 runtime platform mismatch (exec format error) fixed with runtimePlatform setting
- Next.js standalone binding fixed with HOSTNAME=0.0.0.0 environment variable
- Static prerendering issue fixed with force-dynamic export on all data pages
- Empty NEXTAUTH_URL fallback fixed by changing ?? to || operator
- Athena S3 write permission fixed by upgrading to S3FullAccess for query results
- SQL column name case mismatch fixed (PascalCase to lowercase matching Glue catalog)
- Subscription tier case normalization (POWER vs Power) with toUpperCase() mapping
- changeRates key mismatch between API response and frontend consumption
- Bedrock model ID corrected to global inference profile (global.anthropic.claude-sonnet-4-6)
- Bedrock IAM policy expanded to include inference-profile ARN pattern

[Unreleased]: https://github.com/whchoi98/kiro-dashboard/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/whchoi98/kiro-dashboard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/whchoi98/kiro-dashboard/releases/tag/v1.0.0

---

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

## [1.2.0] - 2026-05-12

### Added

- **Insights 파이프라인** — CC 원본에 충실한 5단계 파이프라인 (세션 구분 → Facet 추출 → DataContext 조립 → 8 섹션 병렬 생성 → At a Glance 합성). 상세: `CLAUDE.md` "Insights Pipeline Workflow".
- **Spec/Day 세션 키 체계** — `active_spec_name`이 있으면 `(user_id, SPEC, spec_name)`, 없으면 `(user_id, DAY, YYYY-MM-DD)`. spec 세션은 여러 날에 걸침, 시간 타임아웃 없음.
- **Facet 집계 함수** — `buildFacetAggregates()`가 per-session Facet JSON에서 `top_goals / outcomes / satisfaction / friction / success` 수치 집계 생성.
- **DataContext 개편** — 신규 필드 `date_range / messages / hours / spec_count / languages`, Facet 집계 5종, Kiro 전용 `top_steering_rules / spec_phases` 추가.
- **CC 충실 At a Glance** — 합성 단계가 이미 생성된 8개 core 섹션 JSON(`coreResults`)을 입력으로 받음. raw Facet 재해석 방지. maxTokens 8192로 상향.
- **`fun_ending`** — `{headline, detail}` 통계가 아닌 기억에 남는 질적 순간 (CC parity).
- **At a Glance 카드 레이블링** — 4개 카드에 제목 추가 ("잘 되고 있는 것" / "방해가 되는 것" / "바로 적용해볼 수 있는 것" / "앞으로 시도해볼 워크플로우").
- **Insights opt-in 인프라** — `EcsStackProps.insights` (선택 필드)가 설정되어 있을 때만 프롬프트 로그 IAM + 환경변수가 주입됨. 기본 배포는 기존 집계 대시보드 그대로.

### Changed

- **라우팅 턴 필터** — Kiro 내부 `{chat, do, spec}` 라우터 태그(순수 JSON 응답)는 ETL에서 drop. 실제 텍스트가 섞인 mixed 턴은 보존. `prompt_etl.is_routing_turn`.
- **빈 prompt 턴** — `tool_events` 테이블로 분리, Facet 입력에서 제외.
- **Facet 스키마 브랜드 정합** — `claude_helpfulness` → `kiro_helpfulness`, `user_instructions_to_claude` → `user_instructions_to_kiro`.
- **`primary_success` enum 축소** — 도구 기반 값 `fast_accurate_search / correct_code_edits / multi_file_changes` 제거 (Kiro raw에 도구 기록 ~0.2%뿐이라 할루시네이션 유발). 유지: `none / good_explanations / proactive_help / good_debugging`.

### Removed

- **조직 전용 섹션** — `org_overview / org_model_routing_audit / org_platform_improvements` 삭제. `/insights` 페이지와 `/api/insights/org` 라우트 제거. `/insights`는 이제 사용자 목록으로 안내하는 랜딩 페이지.
- **데드 코드** — `lib/insights/facet-extractor.ts` (정본은 Python `facet_extractor.py`) + 테스트 파일.
- **센티넬 필드** — `hook_active_count / subagent_active_count / power_active_list`를 DataContext에서 제거 (Kiro에서 항상 `'unknown'` 이었음).

### Fixed

- **React #31 가드** — 이중 방어: 프롬프트 레이어 `STRICT TYPE REQUIREMENT` + UI 레이어 `renderGlanceField()` 문자열 강제. at_a_glance 모든 값이 string으로 보장.

## [1.1.0] - 2026-04-24

### Added

- CloudFront Viewer Request 레벨 Lambda@Edge + Cognito PKCE 인증 (NextAuth.js 대체)
- Lambda@Edge 함수: JWT 검증(`aws-jwt-verify`), PKCE 플로우, 토큰 갱신, HttpOnly 쿠키 관리
- SSM Parameter Store 설정 로더 (us-east-1) — Lambda@Edge 콜드 스타트 캐싱
- CDK `EdgeFunction` 구성: esbuild 번들링, us-east-1 크로스 리전 배포
- `AwsCustomResource`: SSM 설정 쓰기 및 Cognito 콜백 URL 배포 후 업데이트
- 공개 Cognito `EdgeAuthClient` (클라이언트 시크릿 없음) — Lambda@Edge PKCE 호환
- `lib/mask.ts` 서버 측 데이터 마스킹 — 모든 사용자 식별자 첫 2글자만 표시, 나머지 `*` 처리
- 사이드바 로그아웃 메뉴 — `/auth/logout` 링크 (Lambda@Edge가 쿠키 삭제 후 Cognito 로그아웃 리다이렉트)
- 모델 사용 분석 페이지: AI 모델 분포 파이 차트, Auto vs 수동 비교, 일별 추이, 사용자별 모델 선호도 테이블
- `/api/model-usage` 엔드포인트: 동적 `{Model_name}_Messages` 컬럼을 위한 S3 CSV 직접 읽기 (Glue OpenCSVSerDe 위치 매핑 한계 우회)
- `UserReport` TypeScript 인터페이스에 `overage_cap` 필드 추가 (Glue 테이블에 존재했으나 타입 누락)

### Changed

- CDK 인프라 4개 → 5개 스택 확장 (`KiroDashboardEdgeLambda` us-east-1 자동 생성)
- CdnStack 재작성: Lambda@Edge, SSM 설정, Cognito 콜백 URL 관리 포함
- SecurityStack에 EdgeAuthClient UserPoolClient 추가
- 사용자 ID 해석(`lib/identity.ts`)이 마스킹된 값 반환 (displayName, email, username, organization)
- 사용자 대면 API 라우트(users, credits, productivity, user-detail, idc-users) 마스킹된 식별자 반환

### Removed

- NextAuth.js 의존성 및 설정 (`lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`)
- 커스텀 로그인 페이지 (`app/login/page.tsx`) — Cognito Hosted UI로 대체
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` 환경변수

## [1.0.0] - 2026-04-21

### Added

- Next.js 14 풀스택 대시보드 7개 페이지 구현: 대시보드, 사용자, 트렌드, 크레딧, IDE 생산성, 참여도, AI 분석
- Athena 연동 12개 API 라우트 구현 (user_report + by_user_analytic 테이블, UserId prefix 정규화 포함)
- Amazon Bedrock Claude Sonnet 4.6 기반 자연어 AI 분석 기능 (query_athena, lookup_users 도구 사용)
- react-markdown + remark-gfm 마크다운 렌더링 (다크 테마 커스텀 컴포넌트 적용)
- Identity Center 통합 — 45명 IdC 사용자 활성/비활성 상태, 이름, 이메일, 소속 표시
- 사용자 상세 드릴다운 패널 (일별 활동 내역, 클라이언트 유형별 분석)
- IDE 생산성 페이지 — 46개 컬럼 레거시 리포트 활용 (채팅, 인라인 완성, Dev Agent, 코드 리뷰, 테스트/문서 생성)
- 14개 기간 프리셋 필터링: 1분, 5분, 10분, 1시간, 3시간, 6시간, 12시간, 1일, 3일, 7일, 14일, 30일, 60일, 90일
- 페이지별 테마 액세서리를 가진 애니메이션 Kiro 유령 마스코트 (대시보드 그리드, 사용자 아바타, 트렌드 화살표, 코인, 코드 터미널, 채팅 말풍선)
- 사이드바 네비게이션 미니 Kiro 캐릭터 애니메이션 (페이지별 고유 액센트 색상)
- 한국어/영어 이중 언어 인터페이스 (사이드바 언어 전환)
- kiro.dev 공식 보라색(#9046FF) 컬러 팔레트 기반 Kiro 브랜드 적용
- img/kiro.svg 실제 Kiro 유령 SVG 캐릭터 전체 컴포넌트 적용
- AWS CDK 4개 스택 인프라: Network(mgmt-vpc), Security(SG, Cognito), ECS(Fargate, ALB, ECR), CDN(CloudFront)
- Docker 멀티 스테이지 빌드 (node:20-alpine, ARM64, standalone 출력)
- ECS Fargate 서비스 오토 스케일링 (1-4 태스크, CPU 70% 타겟)
- CloudFront X-Custom-Secret 헤더 검증을 통한 ALB 보안
- Cognito User Pool + Lambda@Edge PKCE 인증
- Athena 실제 데이터 기반 클라이언트 분포 파이 차트 (KIRO_IDE vs KIRO_CLI)
- 참여도 퍼널 및 사용자 세그먼트 (Power/Active/Light/Idle 등급)
- AWSops 스타일 메트릭 카드 (반투명 다크, hover 효과, font-mono 값)
- NextToken 기반 Athena 쿼리 페이지네이션 (1,000행 초과 데이터셋 대응)
- Claude Code 프로젝트 구조 초기화 (훅, 스킬, 커맨드, 에이전트, 문서)

### Fixed

- CDK 크로스 스택 순환 참조 해결 (IAM 역할을 EcsStack으로 이동)
- ARM64 런타임 플랫폼 불일치 수정 (exec format error, runtimePlatform 설정)
- Next.js standalone 바인딩 수정 (HOSTNAME=0.0.0.0 환경변수 추가)
- 정적 프리렌더링 문제 수정 (모든 데이터 페이지에 force-dynamic 적용)
- 빈 NEXTAUTH_URL 폴백 수정 (?? → || 연산자 변경)
- Athena S3 쓰기 권한 수정 (쿼리 결과 저장을 위한 S3FullAccess 부여)
- SQL 컬럼명 대소문자 불일치 수정 (PascalCase → Glue 카탈로그 소문자 일치)
- Subscription Tier 대소문자 정규화 (POWER vs Power, toUpperCase() 매핑)
- changeRates 키 불일치 수정 (API 응답과 프론트엔드 간 키 이름 통일)
- Bedrock 모델 ID 수정 (global inference profile global.anthropic.claude-sonnet-4-6 적용)
- Bedrock IAM 정책 확장 (inference-profile ARN 패턴 추가)

[Unreleased]: https://github.com/whchoi98/kiro-dashboard/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/whchoi98/kiro-dashboard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/whchoi98/kiro-dashboard/releases/tag/v1.0.0
