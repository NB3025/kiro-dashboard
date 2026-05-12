# Insights Setup Guide

The `/insights/user/<userId>` feature is **opt-in**. When the Insights
environment variables are not set, the ECS task boots normally and every
`/api/insights/*` route responds with a `not_configured` envelope — the
rest of the dashboard (Overview, Users, Trends, Credits, Productivity,
Engagement, Analyze, Model Usage) is unaffected.

This document walks through the additional steps required to turn the
feature on. For a code-level walkthrough of the 5-stage pipeline itself,
see the "Insights Pipeline Workflow" section in `CLAUDE.md`.

---

## 0. Prerequisites (beyond the base dashboard)

Base dashboard setup (README) must already be done:

- `npm install` / `cd infra && npm install`
- `.env.local` configured, CDK bootstrapped, base 5 stacks deployed,
  Docker image pushed to ECR.

On top of that, Insights needs:

- **Kiro IDE/CLI prompt logging enabled** so that raw
  `GenerateAssistantResponse*.json.gz` files land in an S3 bucket you
  own. This is configured inside Kiro itself, not by this repo.
- **Bedrock model access** for `global.anthropic.claude-opus-4-7`
  (cross-region inference profile, us-east-1 default). Request access
  in the AWS console under **Bedrock → Model access**.

---

## 1. Set the opt-in environment variables

Add these to the environment used when you run `npx cdk deploy`:

```bash
# Bucket where Kiro raw logs are collected (see step 0)
export PROMPT_LOGS_BUCKET_NAME="my-kiro-logging-bucket"

# Prefix inside that bucket down to the per-account KiroLogs tree.
# Default: kiro-logging/AWSLogs/<account>/KiroLogs/GenerateAssistantResponse
export PROMPT_LOGS_PREFIX="kiro-logging/AWSLogs/${CDK_DEFAULT_ACCOUNT}/KiroLogs/GenerateAssistantResponse"

# Insights data bucket (Parquet + facets + bundles live here). Defaults to
# kiro-insights-<account>-<region> if you leave it unset.
# export INSIGHTS_BUCKET_NAME="kiro-insights-${CDK_DEFAULT_ACCOUNT}-${CDK_DEFAULT_REGION}"

# Glue database for Insights tables. Defaults to titanlog_insights.
# export ATHENA_DATABASE_NAME="titanlog_insights"

# Optional — EventBridge bundle-warming cron. Omit to skip warming.
# export INSIGHTS_CRON_SCHEDULE="cron(0 23 ? * SUN *)"
```

`bin/app.ts` inspects these variables. When
`PROMPT_LOGS_BUCKET_NAME` is absent, the `KiroDashboardInsights` stack
is **not** instantiated and the ECS task starts without the Insights
env vars.

---

## 2. Deploy the Insights stack

```bash
cd infra
npx cdk deploy KiroDashboardInsights
```

This creates:

- Glue database `titanlog_insights`
- S3 bucket (name from `INSIGHTS_BUCKET_NAME`) with 180-day lifecycle
- Three Glue Python Shell jobs: `prompt_etl`, `session_builder`,
  `facet_builder` — each with IAM for S3 + Bedrock
- A base `daily-etl` EventBridge rule (fires daily at 05:00 UTC)
- An optional `bundle-warming` rule when `INSIGHTS_CRON_SCHEDULE` is set

The updated `KiroDashboardEcs` stack will also be rolled when you
re-run `npx cdk deploy --all`, picking up the Insights IAM statements
and the `PROMPT_LOGS_BUCKET` / `INSIGHTS_BUCKET` env vars.

---

## 3. Upload the Glue job scripts to S3

The CDK stack defines the Glue job records but points `scriptLocation`
at `s3://<INSIGHTS_BUCKET>/glue-jobs/<name>.py`. Sync the local
`infra/glue-jobs/` tree so those paths resolve:

```bash
aws s3 cp infra/glue-jobs/prompt_etl.py \
  s3://${INSIGHTS_BUCKET_NAME}/glue-jobs/prompt_etl.py
aws s3 cp infra/glue-jobs/prompt_parser.py \
  s3://${INSIGHTS_BUCKET_NAME}/glue-jobs/prompt_parser.py
aws s3 cp infra/glue-jobs/session_builder.py \
  s3://${INSIGHTS_BUCKET_NAME}/glue-jobs/session_builder.py
aws s3 cp infra/glue-jobs/facet_extractor.py \
  s3://${INSIGHTS_BUCKET_NAME}/glue-jobs/facet_extractor.py
aws s3 cp infra/glue-jobs/facet_builder.py \
  s3://${INSIGHTS_BUCKET_NAME}/glue-jobs/facet_builder.py
```

Re-run these whenever you edit a Glue script.

---

## 4. Run the ETL jobs in order

First-time / full refresh:

```bash
aws glue start-job-run --job-name prompt_etl --region ${CDK_DEFAULT_REGION}
# wait for SUCCEEDED (a few minutes depending on log volume)

aws glue start-job-run --job-name session_builder --region ${CDK_DEFAULT_REGION}
# wait for SUCCEEDED (usually under 1 minute)

aws glue start-job-run --job-name facet_builder --region ${CDK_DEFAULT_REGION}
# Opus 4.7 is invoked once per SPEC/DAY session (≥2 turns). Budget
# roughly $1-5 per active user for an initial full extraction.
```

Poll status:

```bash
aws glue get-job-runs --job-name facet_builder --region ${CDK_DEFAULT_REGION} \
  --query 'JobRuns[0].{State:JobRunState,StartedOn:StartedOn,ErrorMessage:ErrorMessage}'
```

After this, the `daily-etl` EventBridge rule will keep the three jobs
running on a schedule.

---

## 5. Register the Athena tables

The three Parquet-backed tables (`prompt_events`, `tool_events`,
`sessions`) are **not** created by the CDK stack — only the
ap-northeast-2 copy of the database is. The ECS task queries Athena in
`AWS_REGION=us-east-1`, and Glue databases are region-scoped, so the
DDL file also (re-)creates the database in the query region.

```bash
# Replace <INSIGHTS_BUCKET> tokens in the SQL file.
sed "s|<INSIGHTS_BUCKET>|${INSIGHTS_BUCKET_NAME}|g" infra/sql/insights-tables.sql \
  > /tmp/insights-tables.sql
```

### 5a. Athena console (recommended)

Open the Athena web console in the **us-east-1** region, pick a
workgroup whose query results go to `ATHENA_OUTPUT_BUCKET`, paste the
contents of `/tmp/insights-tables.sql` into the editor, and run. The
console accepts all four statements in one go.

### 5b. AWS CLI (alternative)

`aws athena start-query-execution` only executes the first statement
per call. Loop over each statement individually:

```bash
# 1. create database
aws athena start-query-execution --region us-east-1 \
  --query-string "CREATE DATABASE IF NOT EXISTS titanlog_insights" \
  --result-configuration OutputLocation=${ATHENA_OUTPUT_BUCKET}

# 2-4. create each table (requires GNU awk for the RS split below)
awk '/^CREATE EXTERNAL TABLE/{flag=1} flag{print} /^\);$/{flag=0; print "---SPLIT---"}' \
  /tmp/insights-tables.sql > /tmp/tables-split.sql

csplit -f /tmp/tbl- -b '%d.sql' -z /tmp/tables-split.sql '/---SPLIT---/' '{*}' 2>/dev/null
for f in /tmp/tbl-*.sql; do
  [ -s "$f" ] || continue
  ddl=$(grep -v '^---SPLIT---' "$f")
  [ -z "$ddl" ] && continue
  aws athena start-query-execution --region us-east-1 \
    --query-string "$ddl" \
    --result-configuration OutputLocation=${ATHENA_OUTPUT_BUCKET}
done
```

Partition projection is enabled in the DDL, so new daily partitions
become queryable as soon as the Glue jobs land them — no
`MSCK REPAIR TABLE` or extra Glue crawler required.

Verify:

```bash
aws glue get-tables --database-name titanlog_insights --region us-east-1 \
  --query 'TableList[*].Name'
# Expected: ["prompt_events", "sessions", "tool_events"]
```

---

## 6. Roll the ECS service

Rebuild the Docker image (Insights opt-in adds new routes that need to
ship in the container) and force a new deployment so the ECS task
picks up the new env vars:

```bash
# from repo root
docker buildx build --platform linux/arm64 --push \
  -t ${CDK_DEFAULT_ACCOUNT}.dkr.ecr.${CDK_DEFAULT_REGION}.amazonaws.com/kiro-dashboard:latest .

aws ecs update-service \
  --cluster kiro-dashboard-cluster \
  --service "$(aws ecs list-services --cluster kiro-dashboard-cluster \
    --region ${CDK_DEFAULT_REGION} --query 'serviceArns[0]' --output text)" \
  --force-new-deployment --region ${CDK_DEFAULT_REGION}
```

Wait until the service reaches steady state (`describe-services →
deployments` has one `PRIMARY` entry, `runningCount == desiredCount`).

---

## 7. Verify in the UI

Open the dashboard via CloudFront (or the ALB if you skipped CDN),
log in with Cognito, then navigate to:

```
https://<cloudfront-domain>/insights/user/<userId>?days=30
```

On the first request, the server streams 8 sections via SSE (~1 minute
with a fresh Bedrock run), then persists the bundle to
`s3://<INSIGHTS_BUCKET>/insights/bundles/user=<userId>/days=30/bundle.json`.
Subsequent requests are cache hits and render instantly.

A successful render shows:

- A hero "At a Glance" card with 4 color-coded sub-cards
  (What's working / What's hindering / Quick wins / Ambitious workflows)
- 8 tabs at the bottom (project_areas / interaction_style / what_works
  / friction_analysis / suggestions / feature_adoption_audit /
  on_the_horizon / fun_ending)
- Markdown + PDF export buttons in the header

If the page shows "Application error" or empty tabs, check the ECS
task logs for errors with the column prefix `[/api/insights/user/*]`.

---

## Opting out

Unset `PROMPT_LOGS_BUCKET_NAME` (and the other Insights env vars) and
re-run `npx cdk deploy --all`. The `KiroDashboardInsights` stack will
be destroyed, the ECS task's Insights-specific env vars will be
removed, and `/api/insights/*` routes will revert to the
`not_configured` envelope. The base dashboard continues to work
unchanged.
