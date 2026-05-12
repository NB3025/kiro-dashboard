# CLAUDE.md — kiro-dashboard

## Project Overview

**Name**: kiro-dashboard
**Description**: Kiro IDE 사용자 분석 대시보드 — Next.js 14 (App Router) + CloudFront/ALB/ECS Fargate + Athena/Glue/S3 + Bedrock AI 분석
**Version**: 1.2.0
**Language**: Korean (primary), English (secondary)

Kiro IDE 사용자의 활동 데이터를 S3/Glue/Athena로 분석하고, Next.js 대시보드로 시각화하며, Amazon Bedrock으로 AI 인사이트를 제공하는 풀스택 분석 플랫폼.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS v4, dark theme |
| Charts | Recharts |
| Auth | Lambda@Edge + Cognito (PKCE, Hosted UI) |
| AWS Data | Athena, Glue, S3 |
| AWS AI | Bedrock Runtime (Claude models) |
| AWS Identity | IdentityStore (IAM Identity Center) |
| Infrastructure | AWS CDK (TypeScript), 5 stacks (incl. EdgeLambda in us-east-1) |
| Container | Docker, ECS Fargate |
| CDN | CloudFront + ALB |

---

## Key Commands

```bash
# Development
npm run dev            # Local development server (port 3000)
npm run build          # Production build
npm run start          # Start production server
npm run lint           # ESLint checks

# Docker
docker build -t kiro-dashboard .
docker run -p 3000:3000 --env-file .env kiro-dashboard

# CDK Infrastructure
cd infra
npx cdk bootstrap      # First-time bootstrap (set CDK_DEFAULT_ACCOUNT + CDK_DEFAULT_REGION)
npx cdk bootstrap aws://<account>/us-east-1  # Required for Lambda@Edge (one-time)
npx cdk deploy --all   # Deploy all 5 stacks
npx cdk diff           # Preview changes
npx cdk destroy --all  # Tear down

# AWS ECR deploy
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-northeast-2.amazonaws.com
docker tag kiro-dashboard:latest <account>.dkr.ecr.ap-northeast-2.amazonaws.com/kiro-dashboard:latest
docker push <account>.dkr.ecr.ap-northeast-2.amazonaws.com/kiro-dashboard:latest
```

---

## Project Structure

```
app/                    Next.js App Router pages & API routes
  api/                  12 API route handlers (see app/api/CLAUDE.md)
  components/           Shared React components (see app/components/CLAUDE.md)
  analyze/              AI analysis chat page (Bedrock streaming)
  users/                User activity dashboard page
  credits/              Credit usage dashboard page
  trends/               Usage trend dashboard page
  engagement/           Engagement metrics dashboard page
  productivity/         Productivity metrics dashboard page
  model-usage/          AI model usage analysis page (S3 direct read)
lib/                    Shared AWS service clients (see lib/CLAUDE.md)
types/                  TypeScript interfaces (see types/CLAUDE.md)
public/                 Static assets (kiro-logo.svg)
infra/                  AWS CDK infrastructure (see infra/CLAUDE.md)
  bin/app.ts            CDK app entry — instantiates 5 stacks
  lib/                  Stack definitions: network, security, ecs, cdn
  lambda/edge-auth/     Lambda@Edge Cognito auth function (PKCE + JWT)
docs/                   Architecture docs, ADRs, runbooks
scripts/                Setup and utility scripts
tests/                  Project structure and hook tests
```

---

## Conventions

### Athena SQL
- All column names are **lowercase** in SQL queries
- UserId normalization (remove IAM Identity Center prefix):
  ```sql
  REGEXP_REPLACE(userid, '^d-[a-z0-9]+\.', '')
  ```
  This constant is exported as `NORMALIZE_USERID` from `lib/athena.ts`
- Tables are resolved dynamically via `lib/glue.ts` → `resolveTableName()`
- The primary Glue table is `user_report` (env: `GLUE_TABLE_NAME`)
- `by_user_analytic` is a secondary table used for per-user detailed queries

### Date Format Differences
| Table | Date Column Format |
|-------|--------------------|
| `user_report` | `YYYY-MM-DD` |
| `by_user_analytic` | `MM-DD-YYYY` |

Always cast dates appropriately when building WHERE clauses for each table.

### Kiro Raw Log Preprocessing Rules

These rules are enforced in `infra/glue-jobs/prompt_etl.py` and must be
honored by any offline analysis that reads the same raw logs. They were
ratified after Stage 0 analysis (165 real samples) and Facet quality
review — do not bypass them in ad-hoc scripts.

**Empty prompts (`prompt == ""`)** → drop from Facet input.
- Empty-prompt turns represent Kiro's internal multi-step tool-result
  feedback (assistant receives tool output, no user utterance).
- Facet transcript is strict `[User]/[Assistant]` pair format, so User
  side being blank is meaningless.
- Kept separately in the `tool_events` table for completeness; never
  feed them to Facet extraction.

**Routing turns (pure `{"chat":.., "do":.., "spec":..}` JSON response)** → drop entirely.
- These are Kiro's internal router classification tags, not
  user-visible assistant work. Including them inflates session/turn
  counts and caused the Facet LLM to hallucinate "echo/repeat"
  friction claims.
- Detection: `is_routing_turn` in `prompt_etl.py`. Response (after
  trim) must be exactly a JSON object (optionally in a `json` fence)
  whose key set is `{chat, do, spec}` with numeric values.
- Empirical: 154/165 matched real router tags → dropped; 11
  "mixed" forms preserved (see below).

**Routing tag + real text (mixed turns)** → keep, treat as normal turn.
- When the routing JSON is followed/preceded by real assistant work
  (e.g., PPT generation, Aurora explanation), the trimmed response no
  longer equals a pure JSON object so `is_routing_turn` returns False.
- Never mutate or strip the routing prefix from the response — the
  turn is preserved verbatim and Facet input treats it as normal.

**MIN_TURNS_FOR_FACET = 2** — single-turn sessions are not facet-eligible.

### Data Masking
- All user identifiers (displayName, email, username, organization) are masked via `lib/mask.ts`
- `maskText(text)` — shows first 2 characters, replaces rest with `*` (e.g., `"John Smith"` → `"Jo********"`)
- `maskEmail(email)` — masks both local part and domain (e.g., `"admin@whchoi.net"` → `"ad***@wh*******"`)
- Masking is applied server-side in `lib/identity.ts` (resolveUserDetails) and `/api/idc-users`
- `userid` (UUID) is NOT masked — needed for user detail navigation

### i18n
- Korean/English switching via `lib/i18n.tsx` React context
- `useI18n()` hook returns `{ locale, setLocale, t }`
- All user-facing strings must support both `'ko'` and `'en'` keys
- Default language: Korean (`'ko'`)

### Branding & Theming
- **Kiro brand color**: `#9046FF`
- **Dark theme**: page background `bg-black`, cards `bg-gray-900/50`
- All new components must use the dark theme
- KiroLogo and KiroMascot SVG assets in `app/components/ui/`

### Environment Variables
ECS task environment variables are defined in `infra/lib/ecs-stack.ts`:
```
AWS_REGION          = us-east-1
ATHENA_DATABASE     = titanlog
ATHENA_OUTPUT_BUCKET= s3://whchoi01-titan-q-log/athena-results/
GLUE_TABLE_NAME     = user_report
IDENTITY_STORE_ID   = d-90663be888
S3_REPORT_PREFIX    = q-user-log/AWSLogs/120443221648/KiroLogs/user_report/us-east-1/
```

For local development, copy `.env.example` to `.env.local` and fill in values.

### API Route Pattern
Most API routes follow this pattern:
1. Accept query params via `req.url` / `new URL(req.url).searchParams`
2. Resolve Glue table with `resolveTableName()`
3. Build Athena SQL using `NORMALIZE_USERID` constant
4. Execute via `executeQuery()` from `lib/athena.ts`
5. Return `NextResponse.json(data)` or `NextResponse.json({ error }, { status: 500 })`

Exception: `/api/model-usage` reads S3 CSV files directly via `@aws-sdk/client-s3` because dynamic `{Model_name}_Messages` columns cannot be queried through Glue/Athena (OpenCSVSerDe uses positional mapping, but model columns appear in different positions across files).

### Authentication Flow
- CloudFront Viewer Request triggers Lambda@Edge for every request
- Lambda@Edge validates JWT (id_token cookie) via `aws-jwt-verify`
- Invalid/missing tokens redirect to Cognito Hosted UI (PKCE flow)
- Successful auth sets HttpOnly cookies (id_token, access_token, refresh_token)
- Lambda@Edge injects `X-User-Email` and `X-User-Name` headers for downstream app
- Config stored in SSM Parameter Store (us-east-1) — cached on Lambda cold start
- Logout via `/auth/logout` → clears cookies → redirects to Cognito logout endpoint

### CDK Stack Deployment Order
`KiroDashboardNetwork` → `KiroDashboardSecurity` → `KiroDashboardEcs` → `KiroDashboardCdn` (+ `KiroDashboardEdgeLambda` auto-created in us-east-1)

CDK resolves cross-stack dependencies automatically via `npx cdk deploy --all`. The `KiroDashboardEdgeLambda` stack is automatically created by `cloudfront.experimental.EdgeFunction` in us-east-1 — requires CDK bootstrap in that region.

---

## Insights Pipeline Workflow

Five sequential stages, mirroring Claude Code's `/insights` reference
pipeline (`docs/reference/claude-code-insights-pipeline.md`). Intentional
Kiro-specific divergences are called out inline.

```
Raw logs → 1. Sessions → 2. Facets → 3. DataContext → 4. 8 sections (parallel) → 5. At a Glance (synthesis)
```

### 1. Session segmentation — `infra/glue-jobs/session_builder.py` (`build_sessions`)

Group ETL-produced prompt turns by two rules:

- **SPEC session**: prompt references `.kiro/specs/<name>/...` →
  session key = sha256(user_id | SPEC | spec_name). Spans arbitrarily
  many days (a spec session is bound to the spec, not the calendar).
- **DAY session**: everything else → session key = sha256(user_id | DAY | YYYY-MM-DD).

Preprocessing rules enforced upstream in
`infra/glue-jobs/prompt_etl.py` (see "Kiro Raw Log Preprocessing Rules"
section earlier in this file): routing turns dropped, mixed-form turns
kept, empty-prompt turns split into `tool_events` (never fed to Facet).

`MIN_TURNS_FOR_FACET = 2` — single-turn sessions are not facet-eligible.

### 2. Facet extraction — `infra/glue-jobs/facet_extractor.py`

**One Bedrock call per session**. Input is the session's transcript in
`[User]/[Assistant]` pair format with CC §7 truncation limits:
`USER_TRUNCATE = 500`, `ASSISTANT_TRUNCATE = 300`.

Output is a CC-style Facet JSON per session, written to
`insights/facets/session=<sid>.json` (S3 or local, request-id-keyed so
reprocessing is idempotent):

```
{underlying_goal, goal_categories, outcome, user_satisfaction_counts,
 kiro_helpfulness, friction_counts, friction_detail, primary_success,
 session_type, brief_summary, user_instructions_to_kiro}
```

Key divergences from CC:
- `user_instructions_to_kiro` (renamed from `user_instructions_to_claude`)
- `kiro_helpfulness` (renamed from `claude_helpfulness`)
- `primary_success` enum trimmed to text-observable values only
  (`none | good_explanations | proactive_help | good_debugging`). Tool-based
  options (`correct_code_edits`, `multi_file_changes`, `fast_accurate_search`)
  were removed because Kiro raw logs carry tool-invocation records in only
  ~0.2% of turns — the LLM would hallucinate outcomes without evidence.
- Narrative fields produced in Korean; JSON keys and enum values remain English.

### 3. DataContext assembly — `lib/insights/data-context.ts` (`buildDataContext`, `schema_version` 1.0.0)

Per user, merges two sources via `Promise.all`:

**A. Athena queries** (numeric scale + Kiro-observable metadata):
`date_range, sessions, messages, hours, spec_count, model_mix, languages,
top_steering_rules, spec_phases`. `languages` is derived from
`active_editor_file` extension with docs/config noise (md/json/yaml/...)
excluded.

**B. Facet-derived blocks** (loaded from S3, filtered by `_user_id`):
- `buildFacetAggregates` → `top_goals (Top 8), outcomes, satisfaction,
  friction, success` (numeric rollups)
- `buildFacetNarrative` → `session_summaries (≤50), friction_details (≤20),
  user_instructions (≤15, deduped)` (pre-rendered string blocks)

Key divergences from CC DataContext:
- `commits` dropped — Kiro has no git access path.
- `top_tools` dropped — tool-invocation records are ~0.2% of turns;
  including this field invites hallucination. `top_steering_rules`
  occupies the analogous role.
- `hook_active_count / subagent_active_count / power_active_list`
  removed — these were always sentinel `'unknown'` in Kiro.
- `spec_count` + Kiro-specific `spec_phases` added.

### 4. Parallel section generation — `lib/insights/section-generator.ts` (`generatePerUserInsights`)

Eight sections generated concurrently via `Promise.all` over
`PER_USER_CORE_SECTIONS`. Each Bedrock call receives the same prompt
structure:

```
<section-specific instructions + JSON schema>

DATA:
<dataContext JSON numeric block>

SESSION SUMMARIES:
<narrative>

FRICTION DETAILS:
<narrative>

USER INSTRUCTIONS TO KIRO:
<narrative>

<EVIDENCE PRIORITY + Korean directive + RESPOND WITH ONLY A VALID JSON OBJECT>
```

The 8 sections (mirror CC §4 with Kiro additions/renames):

| # | Section | Origin | Role |
|---|---------|--------|------|
| 1 | `project_areas` | CC | 4-5 work areas from session data |
| 2 | `interaction_style` | CC | How the user collaborates with Kiro |
| 3 | `what_works` | CC | What's going well |
| 4 | `friction_analysis` | CC | 3 friction categories × 2 examples |
| 5 | `suggestions` | CC | 3-bucket suggestions (steering/features/usage) |
| 6 | `feature_adoption_audit` | **Kiro-specific** | Adoption signals across spec/steering/skill/hook/subagent/power |
| 7 | `on_the_horizon` | CC | Ambitious next workflows |
| 8 | `fun_ending` | CC §4.7 | Memorable qualitative moment ({headline, detail}) |

Section failures isolate: a failing section returns `null` and other
sections are unaffected. `maxTokens = 4096` for core sections.

CC's `org_overview / org_model_routing_audit / org_platform_improvements`
intentionally dropped — Kiro focuses on per-user insights.

### 5. At a Glance synthesis — sequential after step 4

Only runs if `shouldGenerateAtAGlance(coreResults)` passes — requires at
least 4 of 8 core sections to have succeeded. Otherwise
`sections.at_a_glance = null`.

**CC §6 fidelity**: at_a_glance is a synthesis over the just-produced
core section results, NOT a 9th parallel re-read of Facets. The invoker
gets a `coreResults` field (populated only for this call) and the
prompt appends a `CORE SECTIONS (already generated — synthesize from
these, do not re-interpret raw Facets)` block containing all 8 core
JSONs. `maxTokens = 8192` (core sections stay at 4096) because the input
grows significantly.

Output is the 4-part schema:

```
{whats_working, whats_hindering, quick_wins, ambitious_workflows}
```

**React #31 guard**: every value MUST be a plain string. See the
"LLM Output Safety" section below for the two-layer defense (prompt
constraint + `renderGlanceField` UI coercion).

### Final bundle

Per user, everything is packaged into `PerUserInsightsBundle`:

```
{userId, sections: {project_areas, interaction_style, what_works,
                    friction_analysis, suggestions, feature_adoption_audit,
                    on_the_horizon, fun_ending, at_a_glance}}
```

Cached in S3 via `lib/insights/bundle-cache.ts` and served to
`/insights/user/<userId>` for UI tab rendering.

---

## LLM Output Safety — React #31 crash prevention

**Observed failure**: After logging in, the insights drilldown page shows
`Application error: a client-side exception has occurred` with console
error `Minified React error #31 — args[]=object with keys {type, title, rationale}`.
Root cause verified by capturing the real browser console and inspecting
the offending S3 bundle: Opus occasionally ignores the section prompt's
string schema for `at_a_glance` and returns **arrays of objects** such as
`[{type:"steering", title:"...", rationale:"..."}]`. React cannot render
non-string values in JSX and crashes the entire page.

**Rule — every LLM-sourced field that lands in JSX must be coerced to a
string**. The section prompt schema is a hint, not a guarantee; Opus
drifts when the DATA block grows (facets, narrative blocks). Two-layer
defense is mandatory:

1. **UI layer**: wrap every `{section.<field>}` expression in a renderer
   that accepts `unknown` and always returns `string`. The canonical
   helper for `at_a_glance` is `lib/insights/glance-render.ts#renderGlanceField`
   — extend this pattern to new sections rather than relying on the
   schema alone. Type fields as `unknown` in `BundleSections`, not
   `string`, so TypeScript reminds the reader that the value is not
   guaranteed.

2. **Prompt layer**: include a `STRICT TYPE REQUIREMENT` block in the
   section prompt that spells out "plain string, not object, not array"
   with a concrete counter-example. Verify by inspecting the generated
   S3 bundle (`aws s3 cp insights/bundles/user=<uid>/days=30/bundle.json -`)
   and scanning for objects whose keys match the problematic pattern.

**Verification checklist after any prompt or bundle change:**
- Capture real browser console via Playwright (`page.on('console', ...)`)
- Confirm zero `pageerror` and zero React error #31 in console
- Confirm `body_text` does NOT start with `Application error:`

Never ship a change that adds data to the LLM context (new facets, new
narrative blocks, larger `dataContext`) without re-verifying the above.
More context gives Opus more reasons to drift away from the string schema.

---

## Auto-Sync Rules

When editing files in `app/` or `lib/`:
- If adding a new API endpoint, update `app/api/CLAUDE.md`
- If adding a new component, update `app/components/CLAUDE.md`
- If changing Athena/Glue logic, update `lib/CLAUDE.md` and `docs/architecture.md`
- If adding a new CDK stack or modifying ECS env vars, update `infra/CLAUDE.md`
- If adding new TypeScript interfaces, update `types/CLAUDE.md`

Run `/sync-docs` after significant changes to verify all module docs are current.
